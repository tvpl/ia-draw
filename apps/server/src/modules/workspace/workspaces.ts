import type { Role } from '@arch-canvas/auth';
import { withTx, workspaceMembers, workspaces } from '@arch-canvas/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { getOrCreateDefaultOrganization } from './organizations.js';

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  accessPolicy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A `Workspace` plus the caller's own effective role in it (NAV-13, NAV-17) — used by `listWorkspacesForUser`/`getWorkspaceById`, never by the create/update/delete paths, which have no "caller's role" concept of their own. */
export interface WorkspaceWithRole extends Workspace {
  role: Role;
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
}

/** Creates a workspace and its creator's `workspace_admin` membership atomically (T16). */
export async function createWorkspace(
  db: Db,
  creatorUserId: string,
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  return withTx(db, async (tx) => {
    const org = await getOrCreateDefaultOrganization(tx);
    const [workspace] = await tx
      .insert(workspaces)
      .values({ organizationId: org.id, name: input.name, slug: input.slug })
      .returning();
    if (!workspace) throw new Error('failed to create workspace');

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: creatorUserId,
      role: 'workspace_admin',
    });

    return workspace;
  });
}

/** Workspaces `userId` belongs to (any role), excluding soft-deleted ones — each item carries the caller's own `role` in that workspace (NAV-13, NAV-17). */
export async function listWorkspacesForUser(db: Db, userId: string): Promise<WorkspaceWithRole[]> {
  const rows = await db
    .select({
      id: workspaces.id,
      organizationId: workspaces.organizationId,
      name: workspaces.name,
      slug: workspaces.slug,
      accessPolicy: workspaces.accessPolicy,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)));
  return rows;
}

export async function getWorkspaceById(db: Db, workspaceId: string): Promise<Workspace | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
  return row ?? null;
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
}

export async function updateWorkspace(
  db: Db,
  workspaceId: string,
  input: UpdateWorkspaceInput,
): Promise<Workspace | null> {
  const [row] = await db
    .update(workspaces)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .returning();
  return row ?? null;
}

/** Soft-deletes the workspace (sets `deleted_at`); it drops out of listings/lookups immediately. */
export async function deleteWorkspace(db: Db, workspaceId: string): Promise<boolean> {
  const rows = await db
    .update(workspaces)
    .set({ deletedAt: new Date() })
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .returning({ id: workspaces.id });
  return rows.length > 0;
}
