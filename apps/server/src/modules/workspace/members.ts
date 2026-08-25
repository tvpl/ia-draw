import type { Role } from '@arch-canvas/auth';
import { users, workspaceMembers } from '@arch-canvas/database';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { withLastAdminGuard } from './lastAdmin.js';

export interface WorkspaceMember {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
  displayName: string;
}

export async function listWorkspaceMembers(
  db: Db,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  return db
    .select({
      userId: workspaceMembers.userId,
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      email: users.email,
      displayName: users.displayName,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
}

export async function addWorkspaceMember(
  db: Db,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<WorkspaceMember> {
  const [inserted] = await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role })
    .returning();
  if (!inserted) throw new Error('failed to add workspace member');

  const [user] = await db
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error('added member has no user row');

  return { userId, workspaceId, role, email: user.email, displayName: user.displayName };
}

/**
 * RBAC-11: the role the member held before the change, so the audit event can record what
 * it was and not only what it became. Read before the guard runs.
 */
export async function readMemberRole(
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

/** RBAC-08/09: guarded and transactional — throws `LastAdminError` rather than leaving the workspace unadministered. */
export async function updateWorkspaceMemberRole(
  db: Db,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<boolean> {
  return withLastAdminGuard(db, workspaceId, userId, role, async (tx) => {
    const rows = await tx
      .update(workspaceMembers)
      .set({ role, updatedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .returning({ userId: workspaceMembers.userId });
    return rows.length > 0;
  });
}

/** RBAC-08/12: guarded and transactional — see `updateWorkspaceMemberRole`. */
export async function removeWorkspaceMember(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  return withLastAdminGuard(db, workspaceId, userId, null, async (tx) => {
    const rows = await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .returning({ userId: workspaceMembers.userId });
    return rows.length > 0;
  });
}
