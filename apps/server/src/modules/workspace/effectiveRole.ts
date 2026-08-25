import type { Role } from '@arch-canvas/auth';
import { workspaceMembers, workspaces } from '@arch-canvas/database';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

/**
 * RBAC-01/05 (AD-016): the single place that answers "what may this person do in this
 * workspace?".
 *
 * Before this, `resolveWorkspaceRole` read `workspace_members` and nothing else, so a person
 * holding `org_admin` had no power at all outside the one workspace where they happened to
 * have a row — the API offered a role whose name promised organisation-wide reach and whose
 * behaviour was identical to `workspace_admin`.
 *
 * There is no `organization_members` table and this deliberately does not add one (AD-016:
 * no migration). Holding `org_admin` in ANY workspace of an organisation is what makes
 * someone an administrator of that organisation, which is the only reading the existing
 * schema supports and the one the role name already implied.
 */

/** Highest privilege first — the order `packages/auth`'s `ROLES` already publishes. */
const PRIVILEGE_ORDER: readonly Role[] = [
  'org_admin',
  'workspace_admin',
  'editor',
  'reviewer',
  'viewer',
];

/** The more permissive of two roles; `null` means "no access from this source". */
export function morePermissive(left: Role | null, right: Role | null): Role | null {
  if (!left) return right;
  if (!right) return left;
  return PRIVILEGE_ORDER.indexOf(left) <= PRIVILEGE_ORDER.indexOf(right) ? left : right;
}

/**
 * `org_admin` in any workspace of the organisation that owns `workspaceId`, or `null`.
 *
 * Returns `null` when the owning organisation cannot be resolved: an unresolvable owner
 * must never widen access (spec.md's edge case), so the caller falls back to the direct
 * membership alone.
 */
async function resolveOrganizationRole(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  const [owner] = await db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!owner) return null;

  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.organizationId, owner.organizationId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, 'org_admin'),
      ),
    );

  return row?.role ?? null;
}

/**
 * The role `userId` effectively holds over `workspaceId`, considering both the direct
 * membership row and the organisation-level role, and returning the more permissive of the
 * two. `null` means no access at all, which routes must turn into a 404 — never a 403
 * (AUTH-04's IDOR rule).
 *
 * Resolved fresh on every call, no caching, so a role change takes effect on the very next
 * request (AUTH-05).
 */
export async function resolveEffectiveRole(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  const [direct] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));

  const organization = await resolveOrganizationRole(db, workspaceId, userId);
  return morePermissive(direct?.role ?? null, organization);
}
