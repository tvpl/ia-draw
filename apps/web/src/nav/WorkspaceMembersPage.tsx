import type { Role } from '@arch-canvas/auth';
import { can } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import * as css from '../styles/classNames.js';
import { ConfirmArchiveDialog } from './ConfirmArchiveDialog.js';
import { createMemberClient, type WorkspaceMember } from './memberClient.js';
import { createResourceListStore } from './resourceListStore.js';

/** `resourceListStore` requires `{id: string}` — shims the server's `userId` at the fetch boundary (design.md's Assumptions table). */
interface MemberItem extends WorkspaceMember {
  id: string;
}

function toMemberItem(member: WorkspaceMember): MemberItem {
  return { ...member, id: member.userId };
}

/** Roles ordered exactly like the server's own `ROLE_VALUES` (`apps/server/src/modules/workspace/routes.ts`). */
const ROLE_VALUES: readonly Role[] = [
  'org_admin',
  'workspace_admin',
  'editor',
  'reviewer',
  'viewer',
];

const ADMIN_ROLES: readonly Role[] = ['org_admin', 'workspace_admin'];

/** Maps a `Role` to its `nav.members.roleOptions.*` i18n key segment. */
const ROLE_KEY: Record<Role, string> = {
  org_admin: 'orgAdmin',
  workspace_admin: 'workspaceAdmin',
  editor: 'editor',
  reviewer: 'reviewer',
  viewer: 'viewer',
};

export interface WorkspaceMembersPageProps {
  /** Injectable for tests; defaults to the global fetch (same convention as `ProjectListPage`). */
  fetchImpl?: typeof fetch;
}

/**
 * `/w/:workspaceId/members` route (spec.md) — lists the workspace's members (universal read),
 * gates invite/role-change/remove on `workspace:manage_members`, and adds a client-side-only
 * (never authoritative) guard against a workspace ending up with zero admins: a sole admin can
 * neither remove themselves nor downgrade their own role (spec.md's Problem Statement — the
 * server has no such guard, and this page never claims to replace one).
 */
export function WorkspaceMembersPage({
  fetchImpl: fetchImplProp,
}: WorkspaceMembersPageProps): JSX.Element | null {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();

  const client = useMemo(() => createMemberClient(fetchImplProp), [fetchImplProp]);
  const store = useMemo(() => createResourceListStore<MemberItem>(), []);

  const items = store((s) => s.items);
  const listStatus = store((s) => s.status);
  const setItems = store((s) => s.setItems);
  const addItem = store((s) => s.addItem);
  const removeItem = store((s) => s.removeItem);
  const replaceItem = store((s) => s.replaceItem);

  const [notFound, setNotFound] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role | ''>('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteInFlight, setInviteInFlight] = useState(false);

  const [removeTarget, setRemoveTarget] = useState<MemberItem | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    (async () => {
      try {
        const list = await client.list(workspaceId);
        if (!cancelled) setItems(list.map(toMemberItem));
      } catch {
        // MEM-03: any failure to load the member list — 404 or otherwise — is treated as "this
        // workspace doesn't exist or you don't have access to it", the same IDOR convention
        // ProjectListPage already uses for its own workspace-detail lookup.
        if (!cancelled) setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, client, setItems]);

  useEffect(() => {
    if (removeTarget) dialogRef.current?.showModal();
  }, [removeTarget]);

  if (!workspaceId) return null;
  // Narrowed alias: the handlers below are separate function scopes, so TS doesn't carry the
  // `!workspaceId` guard's narrowing into their closures — same shape as ProjectListPage's own
  // `if (!workspaceId) return null;` plus direct calls needing a definite `string`.
  const currentWorkspaceId = workspaceId;

  const me = items.find((item) => item.userId === user?.id);
  const canManage = me
    ? can({ role: me.role }, 'workspace:manage_members', { workspaceId }).allowed
    : false;
  const adminCount = items.filter((item) => ADMIN_ROLES.includes(item.role)).length;
  const isSoleAdmin = !!me && ADMIN_ROLES.includes(me.role) && adminCount === 1;

  async function handleInviteSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (inviteInFlight) return;
    const email = inviteEmail.trim();
    if (!email || !inviteRole) return;
    const role = inviteRole;

    setInviteError(null);
    setInviteInFlight(true);
    try {
      const lookup = await client.lookupByEmail(email);

      if (lookup.status === 'not_found') {
        setInviteError(t('nav.members.notFound'));
        setAnnouncement(t('nav.members.notFound'));
        return;
      }
      if (lookup.status === 'error') {
        setInviteError(t('nav.error.generic'));
        setAnnouncement(t('nav.error.generic'));
        return;
      }

      const alreadyMember = items.some((item) => item.userId === lookup.user.id);
      if (alreadyMember) {
        setInviteError(t('nav.members.alreadyMember'));
        setAnnouncement(t('nav.members.alreadyMember'));
        return;
      }

      const result = await client.add(currentWorkspaceId, lookup.user.id, role);
      if (result.status === 'added') {
        addItem(toMemberItem(result.member));
        setInviteEmail('');
        setInviteRole('');
        setAnnouncement(t('nav.members.added'));
        return;
      }
      if (result.status === 'conflict') {
        setInviteError(t('nav.members.alreadyMember'));
        setAnnouncement(t('nav.members.alreadyMember'));
        return;
      }
      setInviteError(t('nav.error.generic'));
      setAnnouncement(t('nav.error.generic'));
    } finally {
      setInviteInFlight(false);
    }
  }

  async function handleRoleChange(item: MemberItem, newRole: Role): Promise<void> {
    if (item.userId === user?.id && isSoleAdmin && !ADMIN_ROLES.includes(newRole)) {
      setAnnouncement(t('nav.members.lastAdminBlock.selfDowngrade'));
      return;
    }

    const result = await client.changeRole(currentWorkspaceId, item.userId, newRole);
    if (result.status === 'ok') {
      replaceItem(item.id, { ...item, role: newRole });
      setAnnouncement(t('nav.members.roleChanged'));
      return;
    }
    setAnnouncement(t('nav.error.generic'));
  }

  function requestRemove(item: MemberItem): void {
    if (item.userId === user?.id && isSoleAdmin) {
      setAnnouncement(t('nav.members.lastAdminBlock.selfRemove'));
      return;
    }
    setRemoveTarget(item);
  }

  function closeDialog(): void {
    dialogRef.current?.close();
    setRemoveTarget(null);
  }

  async function confirmRemove(): Promise<void> {
    if (!removeTarget) return;
    const target = removeTarget;

    const result = await client.remove(currentWorkspaceId, target.userId);
    if (result.status === 'removed') {
      removeItem(target.id);
      setAnnouncement(t('nav.members.removed'));
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
        <h2 className={css.pageTitle}>{t('nav.members.title')}</h2>
      </div>
      <div aria-live="polite" className={css.helpText} data-testid="members-announcement">
        {announcement}
      </div>

      {/* UIF-09: loading in place of the content. */}
      {listStatus === 'loading' && <p className={css.stateBox}>{t('nav.loading')}</p>}

      {listStatus === 'error' && <p className={css.errorBox}>{t('nav.error.generic')}</p>}

      {listStatus === 'ready' && (
        <ul className={css.list}>
          {items.map((item) => (
            <li className={css.listRow} key={item.id}>
              <span className={css.listRowTitle}>{item.displayName}</span>{' '}
              <span className={css.helpText}>{item.email}</span>{' '}
              {canManage ? (
                <span className={css.listRowActions}>
                  <select
                    className={css.select}
                    aria-label={`${t('nav.members.roleLabel')} — ${item.displayName}`}
                    value={item.role}
                    onChange={(event) => void handleRoleChange(item, event.target.value as Role)}
                  >
                    {ROLE_VALUES.map((role) => (
                      <option key={role} value={role}>
                        {t(`nav.members.roleOptions.${ROLE_KEY[role]}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    className={css.buttonDanger}
                    type="button"
                    onClick={() => requestRemove(item)}
                  >
                    {t('nav.members.remove')}
                  </button>
                </span>
              ) : (
                <span className={css.badge}>
                  {t(`nav.members.roleOptions.${ROLE_KEY[item.role]}`)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form
          className={`${css.panelPadded} flex flex-wrap items-end gap-3`}
          onSubmit={(event) => void handleInviteSubmit(event)}
        >
          <label className={`${css.field} min-w-60 flex-1`}>
            <span className={css.label}>{t('nav.members.emailLabel')}</span>
            <input
              className={css.input}
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>{t('nav.members.roleLabel')}</span>
            <select
              className={css.select}
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as Role | '')}
            >
              <option value="">{t('nav.members.roleSelectPlaceholder')}</option>
              {ROLE_VALUES.map((role) => (
                <option key={role} value={role}>
                  {t(`nav.members.roleOptions.${ROLE_KEY[role]}`)}
                </option>
              ))}
            </select>
          </label>
          <button className={css.buttonPrimary} type="submit">
            {t('nav.members.invite')}
          </button>
          {inviteError && <p className={`${css.errorBox} w-full`}>{inviteError}</p>}
        </form>
      )}

      {removeTarget && (
        <ConfirmArchiveDialog
          ref={dialogRef}
          itemName={removeTarget.displayName}
          onConfirm={() => void confirmRemove()}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
