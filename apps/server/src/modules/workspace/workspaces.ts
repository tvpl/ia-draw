import type { Role } from '@arch-canvas/auth';
import { organizationMembers, withTx, workspaceMembers, workspaces } from '@arch-canvas/database';
import { and, eq, inArray, isNull } from 'drizzle-orm';
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

/**
 * Workspaces `userId` can reach, excluding soft-deleted ones — each item carries the
 * caller's own effective `role` (NAV-13, NAV-17).
 *
 * RBAC-01/05 (AD-016): "can reach" is no longer "has a membership row". Someone administering
 * an organisation (ORG-01/03: a row in `organization_members`) reaches all of its workspaces,
 * so those appear here too, carrying `org_admin`. A direct membership on the same workspace
 * never lowers that — the more permissive of the two wins.
 */
export async function listWorkspacesForUser(db: Db, userId: string): Promise<WorkspaceWithRole[]> {
  const columns = {
    id: workspaces.id,
    organizationId: workspaces.organizationId,
    name: workspaces.name,
    slug: workspaces.slug,
    accessPolicy: workspaces.accessPolicy,
    createdAt: workspaces.createdAt,
    updatedAt: workspaces.updatedAt,
  };

  const direct = await db
    .select({ ...columns, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)));

  const administeredOrgs = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));

  if (administeredOrgs.length === 0) return direct;

  const orgIds = administeredOrgs.map((row) => row.organizationId);
  const administered = await db
    .select(columns)
    .from(workspaces)
    .where(and(inArray(workspaces.organizationId, orgIds), isNull(workspaces.deletedAt)));

  const byId = new Map<string, WorkspaceWithRole>();
  for (const row of direct) byId.set(row.id, row);
  for (const row of administered) {
    const existing = byId.get(row.id);
    // `org_admin` is the most permissive role there is, so it always wins here.
    if (!existing || existing.role !== 'org_admin') {
      byId.set(row.id, { ...row, role: 'org_admin' });
    }
  }
  return [...byId.values()];
}

/**
 * Single workspace by id, carrying the `role` the CALLER already resolved (NAV-09..12).
 *
 * RBAC-05 (AD-016): this used to join `workspace_members` itself, which was a second
 * role-resolution path — and it is why granting `org_admin` had no effect on `GET
 * /workspaces/:id` even after the resolver learned about organisations: the route said yes
 * and this query said no. Access is decided once, by the caller, before this runs.
 * Returns `null` only when the workspace does not exist or is soft-deleted; the caller
 * turns that into a 404, never a 403 (AUTH-04).
 */
export async function getWorkspaceById(
  db: Db,
  workspaceId: string,
  role: Role,
): Promise<WorkspaceWithRole | null> {
  const [row] = await db
    .select({
      id: workspaces.id,
      organizationId: workspaces.organizationId,
      name: workspaces.name,
      slug: workspaces.slug,
      accessPolicy: workspaces.accessPolicy,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
  return row ? { ...row, role } : null;
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
