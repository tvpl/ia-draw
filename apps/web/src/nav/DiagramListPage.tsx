import type { Role } from '@arch-canvas/auth';
import { can } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as css from '../styles/classNames.js';
import { ConfirmArchiveDialog } from './ConfirmArchiveDialog.js';
import { createResourceClient, type ResourceClientConfig } from './resourceClient.js';
import { createResourceListStore } from './resourceListStore.js';

/** A `GET /diagrams` list item (design.md's `Diagram`, fields this page actually uses). */
export interface DiagramItem {
  id: string;
  title: string;
}

interface ProjectDetailResponseBody {
  project: { name: string };
}

interface WorkspaceDetailResponseBody {
  workspace: { role: Role };
}

/**
 * What `ConfirmArchiveDialog` is currently confirming — either a diagram row (T9's original
 * scope) or the project this page is itself showing (NAV-21: archiving the container
 * currently being viewed navigates up a level, so it needs its own DELETE target and its own
 * post-`204` outcome instead of `removeItem`).
 */
type ArchiveTarget = { kind: 'diagram'; item: DiagramItem } | { kind: 'project' };

function diagramsConfig(projectId: string): ResourceClientConfig {
  return {
    listUrl: `/diagrams?projectId=${projectId}`,
    createUrl: '/diagrams',
    createBody: (title) => ({ projectId, title }),
    itemUrl: (id) => `/diagrams/${id}`,
    renameBody: (title) => ({ title }),
    itemKey: 'diagram',
  };
}

export interface DiagramListPageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as `AuthProvider`). */
  fetchImpl?: typeof fetch;
}

/**
 * `/w/:workspaceId/p/:projectId` route (design.md) — resolves the current project's title
 * via `GET /projects/:id` and the caller's workspace-level role via `GET /workspaces/:id`
 * (`diagram:write` is workspace-scoped, same single-role-for-the-whole-page shape as
 * `ProjectListPage`), lists its diagrams, and gates create/rename/archive on that role
 * (NAV-12). Creating navigates straight into the new diagram's editor
 * (`/w/:workspaceId/d/:diagramId`, unmodified) rather than staying on this list — the only
 * one of the three create flows that leaves the page, matching NAV-06..12's per-story ACs.
 */
export function DiagramListPage({
  fetchImpl: fetchImplProp,
}: DiagramListPageProps): JSX.Element | null {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Named `fetchImpl` (not the generic `doFetch`) so the repo-tools route-inventory
  // extractor — which only recognizes literal `fetch(`/`fetchImpl(` call sites — can
  // resolve this page's own direct `GET /projects/:id` and `GET /workspaces/:id` lookups.
  const fetchImpl = useMemo(() => fetchImplProp ?? fetch.bind(globalThis), [fetchImplProp]);

  const store = useMemo(() => createResourceListStore<DiagramItem>(), []);
  const client = useMemo(
    () => createResourceClient<DiagramItem>(diagramsConfig(projectId ?? ''), fetchImplProp),
    [projectId, fetchImplProp],
  );

  const items = store((s) => s.items);
  const listStatus = store((s) => s.status);
  const setItems = store((s) => s.setItems);
  const setError = store((s) => s.setError);
  const removeItem = store((s) => s.removeItem);
  const replaceItem = store((s) => s.replaceItem);

  const [projectName, setProjectName] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [announcement, setAnnouncement] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    let cancelled = false;

    (async () => {
      const [projectResponse, workspaceResponse] = await Promise.all([
        fetchImpl(`/projects/${projectId}`),
        fetchImpl(`/workspaces/${workspaceId}`),
      ]);
      if (cancelled) return;
      if (!projectResponse.ok || !workspaceResponse.ok) {
        setNotFound(true);
        return;
      }
      const projectBody = (await projectResponse.json()) as ProjectDetailResponseBody;
      const workspaceBody = (await workspaceResponse.json()) as WorkspaceDetailResponseBody;
      if (cancelled) return;
      setProjectName(projectBody.project.name);
      setRole(workspaceBody.workspace.role);

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
  }, [workspaceId, projectId, client, fetchImpl, setItems, setError]);

  useEffect(() => {
    if (archiveTarget) dialogRef.current?.showModal();
  }, [archiveTarget]);

  if (!workspaceId || !projectId) return null;

  const canWrite = role !== null ? can({ role }, 'diagram:write', { workspaceId }).allowed : false;
  const canWriteProject =
    role !== null ? can({ role }, 'project:write', { workspaceId }).allowed : false;

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = createTitle.trim();
    if (!title) return;

    setCreateError(null);
    const result = await client.create(title);

    if (result.status === 'created') {
      setCreateTitle('');
      navigate(`/w/${workspaceId}/d/${result.item.id}`);
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

  function startRename(item: DiagramItem): void {
    setRenamingId(item.id);
    setRenameValue(item.title);
    setRenameError(null);
  }

  function cancelRename(): void {
    setRenamingId(null);
    setRenameError(null);
  }

  async function submitRename(item: DiagramItem): Promise<void> {
    const title = renameValue.trim();
    if (!title) return;

    const result = await client.rename(item.id, title);

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

  function requestArchive(item: DiagramItem): void {
    setArchiveTarget({ kind: 'diagram', item });
  }

  function requestArchiveProject(): void {
    setArchiveTarget({ kind: 'project' });
  }

  function closeDialog(): void {
    dialogRef.current?.close();
    setArchiveTarget(null);
  }

  async function confirmArchive(): Promise<void> {
    if (!archiveTarget) return;
    const target = archiveTarget;

    if (target.kind === 'project') {
      // No diagram-scoped `client` covers this — it archives the project itself, not a row
      // in this page's list, so the DELETE is issued directly (NAV-21).
      const response = await fetchImpl(`/projects/${projectId}`, { method: 'DELETE' });
      if (response.status === 204) {
        closeDialog();
        navigate(`/w/${workspaceId}`);
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
        <Link to={`/w/${workspaceId}`}>{t('nav.back')}</Link>
        <p>{t('nav.notFound')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className={css.link} to={`/w/${workspaceId}`}>
          {t('nav.back')}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={css.pageTitle}>{projectName ?? t('nav.diagrams.title')}</h2>
          {canWriteProject && (
            <button className={css.buttonDanger} type="button" onClick={requestArchiveProject}>
              {t('nav.projects.archiveCurrent')}
            </button>
          )}
        </div>
      </div>
      <div aria-live="polite" className={css.helpText} data-testid="diagram-announcement">
        {announcement}
      </div>

      {listStatus === 'error' && <p className={css.errorBox}>{t('nav.error.generic')}</p>}

      {/* UIF-09: loading in place of the content. */}
      {listStatus === 'loading' && <p className={css.stateBox}>{t('nav.loading')}</p>}

      {listStatus === 'ready' && items.length === 0 && (
        <p className={css.stateBox}>{t('nav.diagrams.empty')}</p>
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
                      {t('nav.diagrams.nameLabel')}
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
                      to={`/w/${workspaceId}/d/${item.id}`}
                    >
                      {item.title}
                    </Link>
                    {canWrite && (
                      <span className={css.listRowActions}>
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
                      </span>
                    )}
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
            <span className={css.label}>{t('nav.diagrams.nameLabel')}</span>
            <input
              className={css.input}
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
            />
          </label>
          <button className={css.buttonPrimary} type="submit">
            {t('nav.diagrams.create')}
          </button>
          {createError && <p className={`${css.errorBox} w-full`}>{createError}</p>}
        </form>
      )}

      {archiveTarget && (
        <ConfirmArchiveDialog
          ref={dialogRef}
          itemName={
            archiveTarget.kind === 'project' ? (projectName ?? '') : archiveTarget.item.title
          }
          onConfirm={() => void confirmArchive()}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
