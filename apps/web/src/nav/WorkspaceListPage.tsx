import type { Role } from '@arch-canvas/auth';
import { can } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { createExportClient } from '../export/exportClient.js';
import * as css from '../styles/classNames.js';
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
/**
 * RBAC-13: the person's effective role in each workspace, shown where it changes what the
 * row offers. Mirrors `WorkspaceMembersPage`'s `ROLE_KEY`; kept local rather than imported
 * across pages, since the i18n keys are the shared contract, not the map.
 */
function roleLabelKey(role: Role): string {
  const segment: Record<Role, string> = {
    org_admin: 'orgAdmin',
    workspace_admin: 'workspaceAdmin',
    editor: 'editor',
    reviewer: 'reviewer',
    viewer: 'viewer',
  };
  return `nav.members.roleOptions.${segment[role]}`;
}

export function WorkspaceListPage({ fetchImpl }: WorkspaceListPageProps): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const store = useMemo(() => createResourceListStore<WorkspaceItem>(), []);
  const client = useMemo(() => createResourceClient<WorkspaceItem>(CONFIG, fetchImpl), [fetchImpl]);
  // XPRT-13..15: fire-and-forget workspace bundle request — same `exportClient.ts` (T1) the
  // diagram editor's `ExportMenu`/`BundleButton` use.
  const exportClient = useMemo(() => createExportClient(fetchImpl), [fetchImpl]);

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

  const [bundleRequestingId, setBundleRequestingId] = useState<string | null>(null);

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

  /** XPRT-14/15: fires the fire-and-forget queue request — never promises progress or a result this UI cannot deliver (spec.md Problem Statement item 3). */
  async function requestBundle(item: WorkspaceItem): Promise<void> {
    setBundleRequestingId(item.id);
    const result = await exportClient.requestWorkspaceBundle(item.id);

    if (result.status === 'ok') {
      setAnnouncement(t('nav.workspaceBundle.queued'));
    } else if (result.status === 'unavailable') {
      setAnnouncement(t('nav.workspaceBundle.unavailable'));
    } else {
      setAnnouncement(t('nav.error.generic'));
    }
    setBundleRequestingId(null);
  }

  const showEmptyState = status === 'ready' && items.length === 0;

  /**
   * PROV-05/06: the global provider scope is administered by anyone holding
   * `org_admin` in ANY workspace — exactly the rule the server's
   * `assertProviderAdmin` applies for `scope === "global"` (this codebase has no
   * separate org-membership table). `GET /workspaces` already returns the
   * caller's `role` per workspace, so that answer is derivable here with no new
   * backend surface.
   */
  const canAdministerGlobalProviders = items.some((item) => item.role === 'org_admin');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={css.pageTitle}>{t('nav.workspaces.title')}</h2>
        {canAdministerGlobalProviders && (
          <Link className={css.link} to="/admin/ai-providers">
            {t('adminProviders.globalLink')}
          </Link>
        )}
      </div>
      <div aria-live="polite" className={css.helpText} data-testid="workspace-announcement">
        {announcement}
      </div>

      {status === 'error' && <p className={css.errorBox}>{t('nav.error.generic')}</p>}

      {/* UIF-09: a loading state of its own, in place of the content. Before this the page
          rendered an empty frame while the request was in flight, which reads as "no
          workspaces" rather than "not yet". */}
      {status === 'loading' && <p className={css.stateBox}>{t('nav.loading')}</p>}

      {showEmptyState && <p className={css.stateBox}>{t('nav.workspaces.emptyState')}</p>}

      {status === 'ready' && items.length > 0 && (
        <ul className={css.list}>
          {items.map((item) => {
            const canWrite = can({ role: item.role }, 'workspace:write', {
              workspaceId: item.id,
            }).allowed;
            // XPRT-13: same `workspace:manage_members` gate the server route itself checks
            // (R4's role-management precedent) — only `org_admin`/`workspace_admin` hold it.
            const canManageMembers = can({ role: item.role }, 'workspace:manage_members', {
              workspaceId: item.id,
            }).allowed;
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
                      {t('nav.workspaces.nameLabel')}
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
                    {renameError && <p className={css.errorBox}>{renameError}</p>}
                  </form>
                ) : (
                  <>
                    <Link className={`${css.listRowTitle} ${css.link}`} to={`/w/${item.id}`}>
                      {item.name}
                    </Link>
                    <span className={css.badge}>{t(roleLabelKey(item.role))}</span>
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
                      {canManageMembers && (
                        <button
                          className={css.buttonSecondary}
                          type="button"
                          onClick={() => void requestBundle(item)}
                          disabled={bundleRequestingId === item.id}
                        >
                          {t('nav.workspaceBundle.action')}
                        </button>
                      )}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form
        className={`${css.panelPadded} flex flex-wrap items-end gap-3`}
        onSubmit={(event) => void handleCreate(event)}
      >
        <label className={`${css.field} min-w-60 flex-1`}>
          <span className={css.label}>{t('nav.workspaces.nameLabel')}</span>
          <input
            className={css.input}
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
          />
        </label>
        <button className={css.buttonPrimary} type="submit">
          {showEmptyState ? t('nav.workspaces.emptyStateCta') : t('nav.workspaces.create')}
        </button>
        {createError && <p className={`${css.errorBox} w-full`}>{createError}</p>}
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
