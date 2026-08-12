import { can } from '@arch-canvas/auth';
import { diagramStatus, recordAuditEvent } from '@arch-canvas/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import {
  createDiagram,
  deleteDiagram,
  getDiagramById,
  listDiagramsForProject,
  resolveDiagramWorkspaceId,
  resolveProjectWorkspaceId,
  updateDiagram,
} from './diagrams.js';
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjectsForWorkspace,
  updateProject,
} from './projects.js';
import { resolveWorkspaceRole } from './rbac.js';

export interface ProjectDiagramModuleDeps {
  db: Db;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

// Cast keeps the zod schema's literal union in sync with the Diagram/UpdateDiagramInput
// status type, while runtime values are still read from the canonical Drizzle enum.
const diagramStatusSchema = z.enum(
  diagramStatus.enumValues as ['draft', 'in_review', 'approved', 'archived'],
);

const workspaceIdQuerySchema = z.object({ workspaceId: z.string().min(1) });
const projectIdQuerySchema = z.object({ projectId: z.string().min(1) });
const idParamsSchema = z.object({ id: z.string().min(1) });

const createProjectBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  classification: z.string().optional(),
});
const updateProjectBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.string().min(1).optional(),
  classification: z.string().optional(),
  ownerId: z.string().min(1).optional(),
});

const createDiagramBodySchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
});
const updateDiagramBodySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: diagramStatusSchema.optional(),
  ownerId: z.string().min(1).optional(),
});

/** Registers project + diagram metadata CRUD, RBAC-gated and workspace-scoped (T17). */
export function registerProjectAndDiagramRoutes(
  app: FastifyInstance,
  deps: ProjectDiagramModuleDeps,
): void {
  const { db } = deps;

  // ---- projects -----------------------------------------------------

  app.get('/projects', { preHandler: requireSession(db) }, async (request) => {
    const { workspaceId } = workspaceIdQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();
    if (!can({ role }, 'project:read', { workspaceId }).allowed) notFound();

    const items = await listProjectsForWorkspace(db, workspaceId);
    return { items };
  });

  app.post('/projects', { preHandler: requireSession(db) }, async (request, reply) => {
    const body = createProjectBodySchema.parse(request.body);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const role = await resolveWorkspaceRole(db, body.workspaceId, user.id);
    if (!role) notFound();
    if (!can({ role }, 'project:write', { workspaceId: body.workspaceId }).allowed) forbidden();

    const project = await createProject(db, { ...body, ownerId: user.id });

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'project.created',
      resourceType: 'project',
      resourceId: project.id,
    });

    reply.code(201);
    return { project };
  });

  app.get('/projects/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const project = await getProjectById(db, id);
    if (!project) notFound();

    const role = await resolveWorkspaceRole(db, project.workspaceId, user.id);
    if (!role || !can({ role }, 'project:read', { workspaceId: project.workspaceId }).allowed)
      notFound();

    return { project };
  });

  app.patch('/projects/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const existing = await getProjectById(db, id);
    if (!existing) notFound();

    const role = await resolveWorkspaceRole(db, existing.workspaceId, user.id);
    if (!role) notFound();
    if (!can({ role }, 'project:write', { workspaceId: existing.workspaceId }).allowed) forbidden();

    const body = updateProjectBodySchema.parse(request.body);
    const project = await updateProject(db, id, body);
    if (!project) notFound();

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'project.updated',
      resourceType: 'project',
      resourceId: id,
    });

    return { project };
  });

  app.delete('/projects/:id', { preHandler: requireSession(db) }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const existing = await getProjectById(db, id);
    if (!existing) notFound();

    const role = await resolveWorkspaceRole(db, existing.workspaceId, user.id);
    if (!role) notFound();
    if (!can({ role }, 'project:write', { workspaceId: existing.workspaceId }).allowed) forbidden();

    const deleted = await deleteProject(db, id);
    if (!deleted) notFound();

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'project.deleted',
      resourceType: 'project',
      resourceId: id,
    });

    reply.code(204);
    return null;
  });

  // ---- diagrams (metadata only — canvas content is F1b) --------------

  app.get('/diagrams', { preHandler: requireSession(db) }, async (request) => {
    const { projectId } = projectIdQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveProjectWorkspaceId(db, projectId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role || !can({ role }, 'diagram:read', { workspaceId }).allowed) notFound();

    const items = await listDiagramsForProject(db, projectId);
    return { items };
  });

  app.post('/diagrams', { preHandler: requireSession(db) }, async (request, reply) => {
    const body = createDiagramBodySchema.parse(request.body);
    const user = request.authContext?.user;
    if (!user) forbidden();

    // workspace_id is resolved server-side from the project — the request
    // body has no workspaceId field to accept in the first place.
    const workspaceId = await resolveProjectWorkspaceId(db, body.projectId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();
    if (!can({ role }, 'diagram:write', { workspaceId }).allowed) forbidden();

    const diagram = await createDiagram(db, { ...body, ownerId: user.id });

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'diagram.created',
      resourceType: 'diagram',
      resourceId: diagram.id,
    });

    reply.code(201);
    return { diagram };
  });

  app.get('/diagrams/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const diagram = await getDiagramById(db, id);
    if (!diagram) notFound();

    const workspaceId = await resolveDiagramWorkspaceId(db, id);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role || !can({ role }, 'diagram:read', { workspaceId }).allowed) notFound();

    return { diagram };
  });

  app.patch('/diagrams/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, id);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();
    if (!can({ role }, 'diagram:write', { workspaceId }).allowed) forbidden();

    const body = updateDiagramBodySchema.parse(request.body);
    const diagram = await updateDiagram(db, id, body);
    if (!diagram) notFound();

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'diagram.updated',
      resourceType: 'diagram',
      resourceId: id,
    });

    return { diagram };
  });

  app.delete('/diagrams/:id', { preHandler: requireSession(db) }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, id);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();
    if (!can({ role }, 'diagram:write', { workspaceId }).allowed) forbidden();

    const deleted = await deleteDiagram(db, id);
    if (!deleted) notFound();

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'diagram.deleted',
      resourceType: 'diagram',
      resourceId: id,
    });

    reply.code(204);
    return null;
  });
}
