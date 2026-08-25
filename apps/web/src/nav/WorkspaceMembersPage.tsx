import type { Role } from '@arch-canvas/auth';
import { can } from '@arch-canvas/auth';
import { type FormEvent, type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import * as css from '../styles/classNames.js';
import { ConfirmArchiveDialog } from './ConfirmArchiveDialog.js';
import { createMemberClient, type WorkspaceMember } from './memberClient.js';
import {
  createOrganizationAdminClient,
  type OrganizationAdmin,
} from './organizationAdminClient.js';
import { createResourceListStore } from './resourceListStore.js';

/** `resourceListStore` requires `{id: string}` — shims the server's `userId` at the fetch boundary (design.md's Assumptions table). */
interface MemberItem extends WorkspaceMember {
  id: string;
}

function toMemberItem(member: WorkspaceMember): MemberItem {
  return { ...member, id: member.userId };
}

/** `resourceListStore` requires `{id: string}` — same shim as `MemberItem` above. */
interface OrgAdminItem extends OrganizationAdmin {
  id: string;
}

function toOrgAdminItem(admin: OrganizationAdmin): OrgAdminItem {
  return { ...admin, id: admin.userId };
}

/**
 * ORG-12/13: roles a workspace invite or role change may assign going forward — `org_admin` is
 * deliberately absent (design.md's "Seletor de papel de workspace"). The server's own
 * `ROLE_VALUES` (`apps/server/src/modules/workspace/routes.ts`) still lists all five: it keeps
 * accepting `org_admin` on the wire (a legacy row's `PATCH` to another role still needs the
 * schema to parse its current value, and the role no longer carries organization-wide reach
 * either way — see design.md), the narrowing lives entirely in this client-side options list.
 */
const ASSIGNABLE_ROLE_VALUES: readonly Role[] = ['workspace_admin', 'editor', 'reviewer', 'viewer'];

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

  // LRA-04: `loadMembers` is the named async body the initial load effect and the "Tentar
  // novamente" retry button (rendered in the `notFound` branch below, where this page's load
  // failures actually surface) both call. `cancelledRef` is the same cancellation guard the
  // effect always used, now shared with the button too.
  const cancelledRef = useRef(false);

  const loadMembers = useCallback(async (): Promise<void> => {
    if (!workspaceId) return;
    try {
      const list = await client.list(workspaceId);
      if (!cancelledRef.current) {
        setItems(list.map(toMemberItem));
        setNotFound(false);
      }
    } catch {
      // MEM-03: any failure to load the member list — 404 or otherwise — is treated as "this
      // workspace doesn't exist or you don't have access to it", the same IDOR convention
      // ProjectListPage already uses for its own workspace-detail lookup. The retry button
      // (LRA-04) re-enters this exact branch on a repeated failure, so it never reveals whether
      // the cause was network, permission, or a workspace that doesn't exist.
      if (!cancelledRef.current) setNotFound(true);
    }
  }, [workspaceId, client, setItems]);

  useEffect(() => {
    cancelledRef.current = false;
    void loadMembers();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadMembers]);

  useEffect(() => {
    if (removeTarget) dialogRef.current?.showModal();
  }, [removeTarget]);

  // ORG-05..11: organization-wide admin section (design.md's "Cliente web") — its own client,
  // store, and load effect, independent of the workspace-member list above.
  const orgAdminClient = useMemo(
    () => createOrganizationAdminClient(fetchImplProp),
    [fetchImplProp],
  );
  const orgAdminStore = useMemo(() => createResourceListStore<OrgAdminItem>(), []);
  const orgAdminItems = orgAdminStore((s) => s.items);
  const orgAdminStatus = orgAdminStore((s) => s.status);
  const setOrgAdminItems = orgAdminStore((s) => s.setItems);
  const removeOrgAdminItem = orgAdminStore((s) => s.removeItem);

  const [orgAdminEmail, setOrgAdminEmail] = useState('');
  const [orgAdminError, setOrgAdminError] = useState<string | null>(null);
  const [orgAdminInFlight, setOrgAdminInFlight] = useState(false);

  // ORG-11: a boolean, not the whole `items` array, so this only re-fires when the caller's
  // org-admin status actually flips — not on every unrelated member-list change.
  const isOrgAdmin = useMemo(
    () => items.some((item) => item.userId === user?.id && item.role === 'org_admin'),
    [items, user],
  );

  const orgAdminCancelledRef = useRef(false);

  const loadOrgAdmins = useCallback(async (): Promise<void> => {
    if (!workspaceId) return;
    try {
      const list = await orgAdminClient.list(workspaceId);
      if (!orgAdminCancelledRef.current) setOrgAdminItems(list.map(toOrgAdminItem));
    } catch {
      // Best-effort: the section only renders for an org_admin (ORG-11); a failed load just
      // leaves the list empty instead of surfacing a second not-found screen.
    }
  }, [workspaceId, orgAdminClient, setOrgAdminItems]);

  useEffect(() => {
    if (!isOrgAdmin) return;
    orgAdminCancelledRef.current = false;
    void loadOrgAdmins();
    return () => {
      orgAdminCancelledRef.current = true;
    };
  }, [isOrgAdmin, loadOrgAdmins]);

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

  async function handleAddOrgAdmin(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (orgAdminInFlight) return;
    const email = orgAdminEmail.trim();
    if (!email) return;

    setOrgAdminError(null);
    setOrgAdminInFlight(true);
    try {
      const result = await orgAdminClient.add(currentWorkspaceId, email);
      if (result.status === 'ok') {
        setOrgAdminEmail('');
        // ORG-06: the POST response carries no admin identity to add optimistically — reload
        // the list so the new row shows the right email/displayName.
        await loadOrgAdmins();
        return;
      }
      if (result.status === 'not_found') {
        setOrgAdminError(t('nav.orgAdmins.notFound'));
        return;
      }
      setOrgAdminError(t('nav.error.generic'));
    } finally {
      setOrgAdminInFlight(false);
    }
  }

  async function handleRemoveOrgAdmin(item: OrgAdminItem): Promise<void> {
    setOrgAdminError(null);
    const result = await orgAdminClient.remove(currentWorkspaceId, item.userId);
    if (result.status === 'ok') {
      removeOrgAdminItem(item.id);
      return;
    }
    if (result.status === 'conflict') {
      // ORG-09: refused because it would leave the organization without an administrator —
      // nothing removed from the server, so the visible list keeps the row too.
      setOrgAdminError(t('nav.orgAdmins.lastAdmin'));
      return;
    }
    setOrgAdminError(t('nav.error.generic'));
  }

  if (notFound) {
    return (
      <div>
        <Link to={`/w/${workspaceId}`}>{t('nav.back')}</Link>
        <p>{t('nav.notFound')}</p>
        <button className={css.buttonSecondary} type="button" onClick={() => void loadMembers()}>
          {t('nav.error.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link className={css.link} to={`/w/${workspaceId}`}>
          {t('nav.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className={css.pageTitle}>{t('nav.members.title')}</h2>
          {/* RBAC-13: the person's own effective role, shown where it decides what this page
              offers. A control that is simply absent is indistinguishable from a defect. */}
          {me && (
            <span className={css.badge}>
              {t('nav.members.yourRole')}: {t(`nav.members.roleOptions.${ROLE_KEY[me.role]}`)}
            </span>
          )}
        </div>
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
                  {ASSIGNABLE_ROLE_VALUES.includes(item.role) ? (
                    <select
                      className={css.select}
                      aria-label={`${t('nav.members.roleLabel')} — ${item.displayName}`}
                      value={item.role}
                      onChange={(event) => void handleRoleChange(item, event.target.value as Role)}
                    >
                      {ASSIGNABLE_ROLE_VALUES.map((role) => (
                        <option key={role} value={role}>
                          {t(`nav.members.roleOptions.${ROLE_KEY[role]}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={css.badge}>
                      {t(`nav.members.roleOptions.${ROLE_KEY[item.role]}`)}
                    </span>
                  )}
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

      {/* RBAC-14: the reason, next to the absence. */}
      {!canManage && listStatus === 'ready' && (
        <p className={css.helpText}>{t('nav.members.noPermission')}</p>
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
              {ASSIGNABLE_ROLE_VALUES.map((role) => (
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

      {isOrgAdmin && (
        <div className="flex flex-col gap-3">
          <h2 className={css.sectionTitle}>{t('nav.orgAdmins.title')}</h2>

          {orgAdminStatus === 'ready' && orgAdminItems.length === 0 && (
            <p className={css.helpText}>{t('nav.orgAdmins.empty')}</p>
          )}

          {orgAdminStatus === 'ready' && orgAdminItems.length > 0 && (
            <ul className={css.list}>
              {orgAdminItems.map((item) => (
                <li className={css.listRow} key={item.id}>
                  <span className={css.listRowTitle}>{item.displayName}</span>{' '}
                  <span className={css.helpText}>{item.email}</span>{' '}
                  <button
                    className={css.buttonDanger}
                    type="button"
                    onClick={() => void handleRemoveOrgAdmin(item)}
                  >
                    {t('nav.orgAdmins.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className={`${css.panelPadded} flex flex-wrap items-end gap-3`}
            onSubmit={(event) => void handleAddOrgAdmin(event)}
          >
            <label className={`${css.field} min-w-60 flex-1`}>
              <span className={css.label}>{t('nav.orgAdmins.emailLabel')}</span>
              <input
                className={css.input}
                type="email"
                value={orgAdminEmail}
                onChange={(event) => setOrgAdminEmail(event.target.value)}
              />
            </label>
            <button className={css.buttonPrimary} type="submit">
              {t('nav.orgAdmins.add')}
            </button>
            {orgAdminError && <p className={`${css.errorBox} w-full`}>{orgAdminError}</p>}
          </form>
        </div>
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
