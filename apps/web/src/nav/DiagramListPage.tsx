import type { Role } from '@arch-canvas/auth';
import { can } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
export function DiagramListPage({ fetchImpl }: DiagramListPageProps): JSX.Element | null {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const doFetch = useMemo(() => fetchImpl ?? fetch.bind(globalThis), [fetchImpl]);

  const store = useMemo(() => createResourceListStore<DiagramItem>(), []);
  const client = useMemo(
    () => createResourceClient<DiagramItem>(diagramsConfig(projectId ?? ''), fetchImpl),
    [projectId, fetchImpl],
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

  const [archiveTarget, setArchiveTarget] = useState<DiagramItem | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    let cancelled = false;

    (async () => {
      const [projectResponse, workspaceResponse] = await Promise.all([
        doFetch(`/projects/${projectId}`),
        doFetch(`/workspaces/${workspaceId}`),
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
  }, [workspaceId, projectId, client, doFetch, setItems, setError]);

  useEffect(() => {
    if (archiveTarget) dialogRef.current?.showModal();
  }, [archiveTarget]);

  if (!workspaceId || !projectId) return null;

  const canWrite = role !== null ? can({ role }, 'diagram:write', { workspaceId }).allowed : false;

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
    setArchiveTarget(item);
  }

  function closeDialog(): void {
    dialogRef.current?.close();
    setArchiveTarget(null);
  }

  async function confirmArchive(): Promise<void> {
    if (!archiveTarget) return;
    const target = archiveTarget;

    const result = await client.archive(target.id);
    if (result.status === 'ok') {
      removeItem(target.id);
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
    <div>
      <Link to={`/w/${workspaceId}`}>{t('nav.back')}</Link>
      <h2>{projectName ?? t('nav.diagrams.title')}</h2>
      <div aria-live="polite" data-testid="diagram-announcement">
        {announcement}
      </div>

      {listStatus === 'error' && <p>{t('nav.error.generic')}</p>}

      {listStatus === 'ready' && items.length === 0 && <p>{t('nav.diagrams.empty')}</p>}

      {listStatus === 'ready' && items.length > 0 && (
        <ul>
          {items.map((item) => {
            const isRenaming = renamingId === item.id;

            return (
              <li key={item.id}>
                {isRenaming ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRename(item);
                    }}
                  >
                    <label>
                      {t('nav.diagrams.nameLabel')}
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                    </label>
                    <button type="submit">{t('nav.renameSave')}</button>
                    <button type="button" onClick={cancelRename}>
                      {t('nav.renameCancel')}
                    </button>
                    {renameError && <p>{renameError}</p>}
                  </form>
                ) : (
                  <>
                    <Link to={`/w/${workspaceId}/d/${item.id}`}>{item.title}</Link>
                    {canWrite && (
                      <>
                        <button type="button" onClick={() => startRename(item)}>
                          {t('nav.rename')}
                        </button>
                        <button type="button" onClick={() => requestArchive(item)}>
                          {t('nav.archive')}
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && (
        <form onSubmit={(event) => void handleCreate(event)}>
          <label>
            {t('nav.diagrams.nameLabel')}
            <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
          </label>
          <button type="submit">{t('nav.diagrams.create')}</button>
          {createError && <p>{createError}</p>}
        </form>
      )}

      {archiveTarget && (
        <ConfirmArchiveDialog
          ref={dialogRef}
          itemName={archiveTarget.title}
          onConfirm={() => void confirmArchive()}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
