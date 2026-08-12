import { projects } from '@arch-canvas/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: string;
  classification: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  description?: string;
  classification?: string;
  ownerId: string;
}

export async function createProject(db: Db, input: CreateProjectInput): Promise<Project> {
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      classification: input.classification,
      ownerId: input.ownerId,
    })
    .returning();
  if (!project) throw new Error('failed to create project');
  return project;
}

export async function listProjectsForWorkspace(db: Db, workspaceId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)));
}

export async function getProjectById(db: Db, projectId: string): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  return row ?? null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: string;
  classification?: string;
  ownerId?: string;
}

export async function updateProject(db: Db, projectId: string, input: UpdateProjectInput): Promise<Project | null> {
  const [row] = await db
    .update(projects)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .returning();
  return row ?? null;
}

export async function deleteProject(db: Db, projectId: string): Promise<boolean> {
  const rows = await db
    .update(projects)
    .set({ deletedAt: new Date() })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .returning({ id: projects.id });
  return rows.length > 0;
}
