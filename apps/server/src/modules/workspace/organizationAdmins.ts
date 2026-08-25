import { organizationMembers, users } from '@arch-canvas/database';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

/**
 * ORG-05..09: the data layer behind the organization-admins routes (T8) — grant, revoke, and
 * list who administers an organization, plus the guard that keeps an organization from ever
 * losing its last administrator.
 *
 * Structural template: `lastAdmin.ts`'s `withLastAdminGuard`, applied to `organization_members`
 * instead of `workspace_members`. There is no role column here (spec.md Assumptions: presence
 * IS the grant), so the guard only concerns removal — there is no "downgrade" case to consider.
 */

export interface OrganizationAdmin {
  userId: string;
  email: string;
  displayName: string;
}

export async function listOrganizationAdmins(
  db: Db,
  organizationId: string,
): Promise<OrganizationAdmin[]> {
  return db
    .select({
      userId: organizationMembers.userId,
      email: users.email,
      displayName: users.displayName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId));
}

/** ORG edge case: idempotent — granting someone who is already an administrator neither errors nor duplicates the row. */
export async function addOrganizationAdmin(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<void> {
  await db.insert(organizationMembers).values({ organizationId, userId }).onConflictDoNothing();
}

/** Thrown when a revocation would leave the organization without an administrator. */
export class LastOrgAdminError extends Error {
  constructor() {
    super('This change would leave the organization without an administrator');
    this.name = 'LastOrgAdminError';
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Runs `change` in a transaction, refusing it when it would remove the organization's last
 * administrator. Locks the organization's `organization_members` rows for the rest of the
 * transaction first, so two concurrent revocations cannot both read the same count and both
 * proceed (mirrors `withLastAdminGuard`'s row lock).
 */
export async function withLastOrgAdminGuard<T>(
  db: Db,
  organizationId: string,
  targetUserId: string,
  change: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from organization_members where organization_id = ${organizationId} for update`,
    );

    const rows = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId));

    const isTargetAdmin = rows.some((row) => row.userId === targetUserId);
    // Nothing to guard: the target is not an administrator, so the change cannot reduce the
    // administrator count.
    if (!isTargetAdmin) return change(tx);

    const otherAdmins = rows.filter((row) => row.userId !== targetUserId);
    if (otherAdmins.length > 0) return change(tx);

    throw new LastOrgAdminError();
  });
}

/** RBAC edge case (this feature's mirror of RBAC-08/12): guarded and transactional — see `withLastOrgAdminGuard`. */
export async function removeOrganizationAdmin(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  return withLastOrgAdminGuard(db, organizationId, userId, async (tx) => {
    const rows = await tx
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .returning({ userId: organizationMembers.userId });
    return rows.length > 0;
  });
}
