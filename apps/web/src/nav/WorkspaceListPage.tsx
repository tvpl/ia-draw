import type { Role } from '@arch-canvas/auth';
import { can } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ConfirmArchiveDialog } from './ConfirmArchiveDialog.js';
import { createResourceClient, type ResourceClientConfig } from './resourceClient.js';
import { createResourceListStore } from './resourceListStore.js';

/** A `GET /workspaces` list item — carries the caller's own effective `role` (T1). */
export interface WorkspaceItem {
  id: string;
  name: string;
  role: Role;
}

/**
 * Normalizes a workspace name into a URL/DB-safe slug for `POST /workspaces`'s required
 * `slug` field — lowercase, non-alphanumeric runs collapsed to a single `-`, no leading/
 * trailing `-`. Single-use, only `WorkspaceListPage` builds a create body with a slug.
 */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const CONFIG: ResourceClientConfig = {
  listUrl: '/workspaces',
  createUrl: '/workspaces',
  createBody: (name) => ({ name, slug: slugify(name) }),
  itemUrl: (id) => `/workspaces/${id}`,
  renameBody: (name) => ({ name }),
  itemKey: 'workspace',
};

export interface WorkspaceListPageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as `AuthProvider`). */
  fetchImpl?: typeof fetch;
}

/**
 * `/` index route (design.md) — lists the caller's workspaces, each linking to
 * `/w/:workspaceId`; create is always offered (NAV-06); rename/archive are gated per item by
 * that item's own `role` (NAV-13, NAV-17), since a user can hold a different role in each
 * workspace. Zero workspaces renders a dedicated empty state with the create CTA in focus
 * (NAV-22/23), not the ordinary empty list.
 */
export function WorkspaceListPage({ fetchImpl }: WorkspaceListPageProps): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const store = useMemo(() => createResourceListStore<WorkspaceItem>(), []);
  const client = useMemo(() => createResourceClient<WorkspaceItem>(CONFIG, fetchImpl), [fetchImpl]);

  const items = store((s) => s.items);
  const status = store((s) => s.status);
  const setItems = store((s) => s.setItems);
  const setError = store((s) => s.setError);
  const removeItem = store((s) => s.removeItem);
  const replaceItem = store((s) => s.replaceItem);

  const [announcement, setAnnouncement] = useState('');

  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [archiveTarget, setArchiveTarget] = useState<WorkspaceItem | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let cancelled = false;
    client.list().then(
      (list) => {
        if (!cancelled) setItems(list);
      },
      () => {
        if (!cancelled) setError();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, setItems, setError]);

  useEffect(() => {
    if (archiveTarget) dialogRef.current?.showModal();
  }, [archiveTarget]);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = createName.trim();
    if (!name) return;

    setCreateError(null);
    const result = await client.create(name);

    if (result.status === 'created') {
      setCreateName('');
      navigate(`/w/${result.item.id}`);
      return;
    }
    if (result.status === 'conflict') {
      setCreateError(t('nav.workspaces.conflict'));
      setAnnouncement(t('nav.workspaces.conflict'));
      return;
    }
    setCreateError(t('nav.error.generic'));
    setAnnouncement(t('nav.error.generic'));
  }

  function startRename(item: WorkspaceItem): void {
    setRenamingId(item.id);
    setRenameValue(item.name);
    setRenameError(null);
  }

  function cancelRename(): void {
    setRenamingId(null);
    setRenameError(null);
  }

  async function submitRename(item: WorkspaceItem): Promise<void> {
    const name = renameValue.trim();
    if (!name) return;

    const result = await client.rename(item.id, name);

    if (result.status === 'ok') {
      // The PATCH response carries no `role` (server-side `updateWorkspace` never joins
      // `workspace_members`) — renaming never changes the caller's role, so the
      // previously-known value is preserved rather than dropped.
      replaceItem(item.id, { ...result.item, role: item.role });
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

  function requestArchive(item: WorkspaceItem): void {
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

  const showEmptyState = status === 'ready' && items.length === 0;

  return (
    <div>
      <h2>{t('nav.workspaces.title')}</h2>
      <div aria-live="polite" data-testid="workspace-announcement">
        {announcement}
      </div>

      {status === 'error' && <p>{t('nav.error.generic')}</p>}

      {showEmptyState && <p>{t('nav.workspaces.emptyState')}</p>}

      {status === 'ready' && items.length > 0 && (
        <ul>
          {items.map((item) => {
            const canWrite = can({ role: item.role }, 'workspace:write', {
              workspaceId: item.id,
            }).allowed;
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
                      {t('nav.workspaces.nameLabel')}
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
                    <Link to={`/w/${item.id}`}>{item.name}</Link>
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

      <form onSubmit={(event) => void handleCreate(event)}>
        <label>
          {t('nav.workspaces.nameLabel')}
          <input value={createName} onChange={(event) => setCreateName(event.target.value)} />
        </label>
        <button type="submit">
          {showEmptyState ? t('nav.workspaces.emptyStateCta') : t('nav.workspaces.create')}
        </button>
        {createError && <p>{createError}</p>}
      </form>

      {archiveTarget && (
        <ConfirmArchiveDialog
          ref={dialogRef}
          itemName={archiveTarget.name}
          onConfirm={() => void confirmArchive()}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
