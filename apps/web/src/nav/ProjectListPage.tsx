import type { Role } from '@arch-canvas/auth';
import { can } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ImportDialog } from '../export/ImportDialog.js';
import * as css from '../styles/classNames.js';
import { ConfirmArchiveDialog } from './ConfirmArchiveDialog.js';
import { createResourceClient, type ResourceClientConfig } from './resourceClient.js';
import { createResourceListStore } from './resourceListStore.js';

/** A `GET /projects` list item (design.md's `Project`, fields this page actually uses). */
export interface ProjectItem {
  id: string;
  name: string;
}

interface WorkspaceDetail {
  name: string;
  role: Role;
}

interface WorkspaceDetailResponseBody {
  workspace: { name: string; role: Role };
}

/**
 * What `ConfirmArchiveDialog` is currently confirming — either a project row (T8's original
 * scope) or the workspace this page is itself showing (NAV-21: archiving the container
 * currently being viewed navigates up a level, so it needs its own DELETE target and its own
 * post-`204` outcome instead of `removeItem`).
 */
type ArchiveTarget = { kind: 'project'; item: ProjectItem } | { kind: 'workspace' };

function projectsConfig(workspaceId: string): ResourceClientConfig {
  return {
    listUrl: `/projects?workspaceId=${workspaceId}`,
    createUrl: '/projects',
    createBody: (name) => ({ workspaceId, name }),
    itemUrl: (id) => `/projects/${id}`,
    renameBody: (name) => ({ name }),
    itemKey: 'project',
  };
}

export interface ProjectListPageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as `AuthProvider`). */
  fetchImpl?: typeof fetch;
}

/**
 * `/w/:workspaceId` route (design.md) — resolves the current workspace's name and the
 * caller's effective role via `GET /workspaces/:id` (a single role value applied to every
 * row here, unlike `WorkspaceListPage`'s per-item role: `project:write` is workspace-scoped,
 * not per-project), lists its projects, and gates create/rename/archive on that role
 * (NAV-09..11). A 404 on the workspace lookup renders the shared "not found or no access"
 * message (NAV-04), never distinguishing the two cases.
 */
export function ProjectListPage({
  fetchImpl: fetchImplProp,
}: ProjectListPageProps): JSX.Element | null {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Named `fetchImpl` (not the generic `doFetch`) so the repo-tools route-inventory
  // extractor — which only recognizes literal `fetch(`/`fetchImpl(` call sites — can
  // resolve this page's own direct `GET /workspaces/:id` lookup below.
  const fetchImpl = useMemo(() => fetchImplProp ?? fetch.bind(globalThis), [fetchImplProp]);

  const store = useMemo(() => createResourceListStore<ProjectItem>(), []);
  const client = useMemo(
    () => createResourceClient<ProjectItem>(projectsConfig(workspaceId ?? ''), fetchImplProp),
    [workspaceId, fetchImplProp],
  );

  const items = store((s) => s.items);
  const listStatus = store((s) => s.status);
  const setItems = store((s) => s.setItems);
  const setError = store((s) => s.setError);
  const addItem = store((s) => s.addItem);
  const removeItem = store((s) => s.removeItem);
  const replaceItem = store((s) => s.replaceItem);

  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [announcement, setAnnouncement] = useState('');
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    (async () => {
      const response = await fetchImpl(`/workspaces/${workspaceId}`);
      if (cancelled) return;
      if (!response.ok) {
        setNotFound(true);
        return;
      }
      const body = (await response.json()) as WorkspaceDetailResponseBody;
      if (cancelled) return;
      setWorkspace({ name: body.workspace.name, role: body.workspace.role });

      try {
        const list = await client.list();
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) setError();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, client, fetchImpl, setItems, setError]);

  useEffect(() => {
    if (archiveTarget) dialogRef.current?.showModal();
  }, [archiveTarget]);

  if (!workspaceId) return null;

  const canWrite = workspace
    ? can({ role: workspace.role }, 'project:write', { workspaceId }).allowed
    : false;
  const canWriteWorkspace = workspace
    ? can({ role: workspace.role }, 'workspace:write', { workspaceId }).allowed
    : false;
  // XPRT-12: gates the "import diagram" action per project row — `diagram:write` is
  // workspace-scoped (same single-role-for-the-whole-page shape as `canWrite` above), so one
  // computed value applies to every row.
  const canImportDiagram = workspace
    ? can({ role: workspace.role }, 'diagram:write', { workspaceId }).allowed
    : false;
  // WHK-02: the webhooks screen is admin-only end to end — every one of its 5 server routes,
  // `GET` included, requires `workspace:manage_members`. A link shown to a non-admin would only
  // lead to a "no access" page, so it is gated here instead of in the destination.
  const canManageWebhooks = workspace
    ? can({ role: workspace.role }, 'workspace:manage_members', { workspaceId }).allowed
    : false;
  // PROV-07: `workspace:manage_members` grants exactly `org_admin`/`workspace_admin`, which is
  // the same pair the server's `assertProviderAdmin` requires for a workspace-scoped provider
  // config — so this gate mirrors the server instead of inventing its own rule.
  const canAdministerProviders = workspace
    ? can({ role: workspace.role }, 'workspace:manage_members', { workspaceId }).allowed
    : false;

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = createName.trim();
    if (!name) return;

    setCreateError(null);
    const result = await client.create(name);

    if (result.status === 'created') {
      addItem(result.item);
      setCreateName('');
      setAnnouncement(t('nav.projects.create'));
      return;
    }
    if (result.status === 'conflict') {
      setCreateError(t('nav.error.conflict'));
      setAnnouncement(t('nav.error.conflict'));
      return;
    }
    setCreateError(t('nav.error.generic'));
    setAnnouncement(t('nav.error.generic'));
  }

  function startRename(item: ProjectItem): void {
    setRenamingId(item.id);
    setRenameValue(item.name);
    setRenameError(null);
  }

  function cancelRename(): void {
    setRenamingId(null);
    setRenameError(null);
  }

  async function submitRename(item: ProjectItem): Promise<void> {
    const name = renameValue.trim();
    if (!name) return;

    const result = await client.rename(item.id, name);

    if (result.status === 'ok') {
      replaceItem(item.id, result.item);
      setRenamingId(null);
      setAnnouncement(t('nav.rename'));
      return;
    }
    if (result.status === 'conflict') {
      setRenameError(t('nav.error.conflict'));
      setAnnouncement(t('nav.error.conflict'));
      return;
    }
    setRenameError(t('nav.error.generic'));
    setAnnouncement(t('nav.error.generic'));
  }

  function requestArchive(item: ProjectItem): void {
    setArchiveTarget({ kind: 'project', item });
  }

  function requestArchiveWorkspace(): void {
    setArchiveTarget({ kind: 'workspace' });
  }

  function closeDialog(): void {
    dialogRef.current?.close();
    setArchiveTarget(null);
  }

  async function confirmArchive(): Promise<void> {
    if (!archiveTarget) return;
    const target = archiveTarget;

    if (target.kind === 'workspace') {
      // No project-scoped `client` covers this — it archives the workspace itself, not a row
      // in this page's list, so the DELETE is issued directly (NAV-21).
      const response = await fetchImpl(`/workspaces/${workspaceId}`, { method: 'DELETE' });
      if (response.status === 204) {
        closeDialog();
        navigate('/');
        return;
      }
      setAnnouncement(t('nav.error.generic'));
      closeDialog();
      return;
    }

    const result = await client.archive(target.item.id);
    if (result.status === 'ok') {
      removeItem(target.item.id);
      setAnnouncement(t('nav.archive'));
    } else {
      setAnnouncement(t('nav.error.generic'));
    }
    closeDialog();
  }

  if (notFound) {
    return (
      <div>
        <Link to="/">{t('nav.back')}</Link>
        <p>{t('nav.notFound')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className={css.link} to="/">
          {t('nav.back')}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={css.pageTitle}>{workspace ? workspace.name : t('nav.projects.title')}</h2>
          {canWriteWorkspace && (
            <button className={css.buttonDanger} type="button" onClick={requestArchiveWorkspace}>
              {t('nav.workspaces.archiveCurrent')}
            </button>
          )}
        </div>
        {/* UIF-07/12: these three used to render as bare inline links with nothing between
            them, which is how "MembrosWebhooksProviders de IA" appeared as one run-on word. */}
        <nav className="flex flex-wrap items-center gap-2">
          <Link className={css.buttonSecondary} to={`/w/${workspaceId}/members`}>
            {t('nav.members.link')}
          </Link>
          {canManageWebhooks && (
            <Link className={css.buttonSecondary} to={`/w/${workspaceId}/webhooks`}>
              {t('nav.webhooks.link')}
            </Link>
          )}
          {canAdministerProviders && (
            <Link className={css.buttonSecondary} to={`/w/${workspaceId}/admin/ai-providers`}>
              {t('adminProviders.workspaceLink')}
            </Link>
          )}
        </nav>
      </div>
      <div aria-live="polite" className={css.helpText} data-testid="project-announcement">
        {announcement}
      </div>

      {listStatus === 'error' && <p className={css.errorBox}>{t('nav.error.generic')}</p>}

      {/* UIF-09: loading in place of the content, so an in-flight request does not read as an
          empty project list. */}
      {listStatus === 'loading' && <p className={css.stateBox}>{t('nav.loading')}</p>}

      {listStatus === 'ready' && items.length === 0 && (
        <p className={css.stateBox}>{t('nav.projects.empty')}</p>
      )}

      {listStatus === 'ready' && items.length > 0 && (
        <ul className={css.list}>
          {items.map((item) => {
            const isRenaming = renamingId === item.id;

            return (
              <li className={css.listRow} key={item.id}>
                {isRenaming ? (
                  <form
                    className="flex w-full flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRename(item);
                    }}
                  >
                    <label className="flex flex-1 items-center gap-2 text-sm">
                      {t('nav.projects.nameLabel')}
                      <input
                        className={css.input}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                    </label>
                    <button className={css.buttonPrimary} type="submit">
                      {t('nav.renameSave')}
                    </button>
                    <button className={css.buttonSecondary} type="button" onClick={cancelRename}>
                      {t('nav.renameCancel')}
                    </button>
                    {renameError && <p className={`${css.errorBox} w-full`}>{renameError}</p>}
                  </form>
                ) : (
                  <>
                    <Link
                      className={`${css.listRowTitle} ${css.link}`}
                      to={`/w/${workspaceId}/p/${item.id}`}
                    >
                      {item.name}
                    </Link>
                    <span className={css.listRowActions}>
                      {canWrite && (
                        <>
                          <button
                            className={css.buttonSecondary}
                            type="button"
                            onClick={() => startRename(item)}
                          >
                            {t('nav.rename')}
                          </button>
                          <button
                            className={css.buttonDanger}
                            type="button"
                            onClick={() => requestArchive(item)}
                          >
                            {t('nav.archive')}
                          </button>
                        </>
                      )}
                      <ImportDialog
                        projectId={item.id}
                        workspaceId={workspaceId}
                        canImport={canImportDiagram}
                        fetchImpl={fetchImplProp}
                      />
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && (
        <form
          className={`${css.panelPadded} flex flex-wrap items-end gap-3`}
          onSubmit={(event) => void handleCreate(event)}
        >
          <label className={`${css.field} min-w-60 flex-1`}>
            <span className={css.label}>{t('nav.projects.nameLabel')}</span>
            <input
              className={css.input}
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </label>
          <button className={css.buttonPrimary} type="submit">
            {t('nav.projects.create')}
          </button>
          {createError && <p className={`${css.errorBox} w-full`}>{createError}</p>}
        </form>
      )}

      {archiveTarget && (
        <ConfirmArchiveDialog
          ref={dialogRef}
          itemName={
            archiveTarget.kind === 'workspace' ? (workspace?.name ?? '') : archiveTarget.item.name
          }
          onConfirm={() => void confirmArchive()}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
