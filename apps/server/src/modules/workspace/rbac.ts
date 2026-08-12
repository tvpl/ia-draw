import type { Role } from '@arch-canvas/auth';
import { workspaceMembers } from '@arch-canvas/database';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

/**
 * Resolves `userId`'s role for `workspaceId` fresh from `workspace_members`
 * on every call — no caching — so a role change is enforced on the very
 * next request (AUTH-05 / T18). Returns `null` when there is no membership
 * row, which routes must turn into a 404 (never 403 — AUTH-04 IDOR rule).
 */
export async function resolveWorkspaceRole(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row?.role ?? null;
}

/** True when `error` is a Postgres unique-constraint violation (23505). */
export function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code === '23505';
}
