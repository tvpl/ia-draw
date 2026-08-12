import type { Role } from '@arch-canvas/auth';
import { users, workspaceMembers } from '@arch-canvas/database';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface WorkspaceMember {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
  displayName: string;
}

export async function listWorkspaceMembers(db: Db, workspaceId: string): Promise<WorkspaceMember[]> {
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

export async function addWorkspaceMember(db: Db, workspaceId: string, userId: string, role: Role): Promise<WorkspaceMember> {
  const [inserted] = await db.insert(workspaceMembers).values({ workspaceId, userId, role }).returning();
  if (!inserted) throw new Error('failed to add workspace member');

  const [user] = await db.select({ email: users.email, displayName: users.displayName }).from(users).where(eq(users.id, userId));
  if (!user) throw new Error('added member has no user row');

  return { userId, workspaceId, role, email: user.email, displayName: user.displayName };
}

export async function updateWorkspaceMemberRole(db: Db, workspaceId: string, userId: string, role: Role): Promise<boolean> {
  const rows = await db
    .update(workspaceMembers)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .returning({ userId: workspaceMembers.userId });
  return rows.length > 0;
}

export async function removeWorkspaceMember(db: Db, workspaceId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .returning({ userId: workspaceMembers.userId });
  return rows.length > 0;
}
