import type { Role } from '@arch-canvas/auth';
import type { Db } from '../auth/db.js';
import { resolveEffectiveRole } from './effectiveRole.js';

/**
 * Resolves `userId`'s role for `workspaceId` fresh on every call — no caching — so a role
 * change is enforced on the very next request (AUTH-05 / T18). Returns `null` when the
 * person has no access, which routes must turn into a 404 (never 403 — AUTH-04 IDOR rule).
 *
 * RBAC-05 (AD-016): delegates to `resolveEffectiveRole`, which considers the direct
 * membership row AND the organisation-level role. Every route already funnels through this
 * function, so none of them needs to change — and none of them may grow a role lookup of
 * its own: a second path is how `org_admin` ended up with no effect in the first place.
 */
export async function resolveWorkspaceRole(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  return resolveEffectiveRole(db, workspaceId, userId);
}

/** True when `error` is a Postgres unique-constraint violation (23505). */
export function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code === '23505';
}
