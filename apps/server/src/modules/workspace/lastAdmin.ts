import type { Role } from '@arch-canvas/auth';
import { workspaceMembers, workspaces } from '@arch-canvas/database';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

/**
 * RBAC-08..12 (AD-016): refuses any membership change that would leave a workspace with no
 * administrator.
 *
 * The proteção existed only in the browser before this: `WorkspaceMembersPage` blocked a
 * sole admin from removing or downgrading themselves, and its own doc comment admitted the
 * server had no such guard. A direct `DELETE` against the API emptied a workspace of
 * administrators irreversibly.
 *
 * The check runs INSIDE the transaction that performs the change, under a row lock on the
 * membership rows. Checking first and mutating after would let two concurrent removals both
 * see two admins and both proceed.
 */

/** Roles that count as administering a workspace. */
const ADMIN_ROLES: readonly Role[] = ['org_admin', 'workspace_admin'];

function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

/** Thrown when the change would leave the workspace without an administrator. */
export class LastAdminError extends Error {
  constructor() {
    super('This change would leave the workspace without an administrator');
    this.name = 'LastAdminError';
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * RBAC-10: an `org_admin` anywhere in the owning organisation keeps the workspace
 * administered even with no `workspace_admin` row of its own, so removing the last
 * `workspace_admin` is legitimate in that case.
 */
async function organizationHasAdminBesides(
  tx: Tx,
  workspaceId: string,
  excludedUserId: string,
): Promise<boolean> {
  const [owner] = await tx
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!owner) return false;

  const [row] = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.organizationId, owner.organizationId),
        ne(workspaceMembers.workspaceId, workspaceId),
        ne(workspaceMembers.userId, excludedUserId),
        eq(workspaceMembers.role, 'org_admin'),
      ),
    );
  return row !== undefined;
}

/**
 * Runs `change` in a transaction, refusing it when it would remove the workspace's last
 * administrator. `nextRole` is the role the target ends up with, or `null` when the target
 * is being removed entirely.
 */
export async function withLastAdminGuard<T>(
  db: Db,
  workspaceId: string,
  targetUserId: string,
  nextRole: Role | null,
  change: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Locks the workspace's membership rows for the rest of this transaction, so a
    // concurrent removal cannot read the same count and reach the opposite conclusion.
    await tx.execute(
      sql`select id from workspace_members where workspace_id = ${workspaceId} for update`,
    );

    const rows = await tx
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    const target = rows.find((row) => row.userId === targetUserId);
    // Nothing to guard: the target is not a member, or is not an administrator, so the
    // change cannot reduce the administrator count.
    if (!target || !isAdmin(target.role)) return change(tx);
    // The change keeps them an administrator.
    if (nextRole && isAdmin(nextRole)) return change(tx);

    const otherAdmins = rows.filter((row) => row.userId !== targetUserId && isAdmin(row.role));
    if (otherAdmins.length > 0) return change(tx);

    if (await organizationHasAdminBesides(tx, workspaceId, targetUserId)) return change(tx);

    throw new LastAdminError();
  });
}
