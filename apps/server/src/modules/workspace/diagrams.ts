import { diagrams, projects } from '@arch-canvas/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface Diagram {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: 'draft' | 'in_review' | 'approved' | 'archived';
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDiagramInput {
  projectId: string;
  title: string;
  description?: string;
  ownerId: string;
}

/**
 * `workspace_id` is never accepted from the caller — it only ever flows
 * from `projects.workspace_id` via `projectId`'s join, resolved by the
 * caller (routes.ts) before this insert (T17 "Done when").
 */
export async function createDiagram(db: Db, input: CreateDiagramInput): Promise<Diagram> {
  const [diagram] = await db
    .insert(diagrams)
    .values({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      ownerId: input.ownerId,
    })
    .returning();
  if (!diagram) throw new Error('failed to create diagram');
  return diagram;
}

export async function listDiagramsForProject(db: Db, projectId: string): Promise<Diagram[]> {
  return db
    .select()
    .from(diagrams)
    .where(and(eq(diagrams.projectId, projectId), isNull(diagrams.deletedAt)));
}

export async function getDiagramById(db: Db, diagramId: string): Promise<Diagram | null> {
  const [row] = await db
    .select()
    .from(diagrams)
    .where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt)));
  return row ?? null;
}

export interface UpdateDiagramInput {
  title?: string;
  description?: string;
  status?: 'draft' | 'in_review' | 'approved' | 'archived';
  ownerId?: string;
}

export async function updateDiagram(db: Db, diagramId: string, input: UpdateDiagramInput): Promise<Diagram | null> {
  const [row] = await db
    .update(diagrams)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt)))
    .returning();
  return row ?? null;
}

export async function deleteDiagram(db: Db, diagramId: string): Promise<boolean> {
  const rows = await db
    .update(diagrams)
    .set({ deletedAt: new Date() })
    .where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt)))
    .returning({ id: diagrams.id });
  return rows.length > 0;
}

/** Resolves the `workspace_id` that owns `projectId`, or `null` if the project doesn't exist. */
export async function resolveProjectWorkspaceId(db: Db, projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  return row?.workspaceId ?? null;
}

/** Resolves the `workspace_id` that owns `diagramId` via its project, or `null` if either doesn't exist. */
export async function resolveDiagramWorkspaceId(db: Db, diagramId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(diagrams)
    .innerJoin(projects, eq(diagrams.projectId, projects.id))
    .where(and(eq(diagrams.id, diagramId), isNull(diagrams.deletedAt), isNull(projects.deletedAt)));
  return row?.workspaceId ?? null;
}
