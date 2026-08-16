import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { JobQueue } from '../jobs/index.js';
import type { StorageClient } from '../storage/index.js';
import { enqueueWebhookEvent } from '../webhook/deliver.js';
import {
  getDiagramById,
  resolveDiagramWorkspaceId,
  resolveWorkspaceRole,
} from '../workspace/index.js';
import { generateSpecDocument, listSpecDocuments } from './generate.js';
import { isSectionName, regenerateSpecSection } from './regenerateSection.js';

export interface DocgenModuleDeps {
  db: Db;
  storage: StorageClient;
  /** Threaded to T80's `spec.generated` webhook wiring below — same optional degrade as every other job consumer. */
  jobs?: JobQueue;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
const regenerateParamsSchema = z.object({
  id: z.string().min(1),
  version: z.coerce.number().int().positive(),
});
const regenerateBodySchema = z.object({ section: z.string().min(1) });

/** OpenAPI schema map for this module's 3 routes (T13, API-01). */
export const routeSchemas: RouteSchemaMap = {
  'POST /diagrams/:id/specs:generate': { params: diagramIdParamsSchema },
  'GET /diagrams/:id/specs': { params: diagramIdParamsSchema, query: listQuerySchema },
  'POST /diagrams/:id/specs/:version(^[^:]+):regenerate-section': {
    params: regenerateParamsSchema,
    body: regenerateBodySchema,
  },
};

/**
 * Registers the docgen module's routes: structured Markdown spec generation
 * from the live scene and cursor-paginated version listing (T62, DOC-01/02),
 * plus single-section regeneration (T63, DOC-04, `regenerateSection.ts`).
 */
export function registerDocgenModule(app: FastifyInstance, deps: DocgenModuleDeps): void {
  const { db, storage, jobs } = deps;

  app.post(
    '/diagrams/:id/specs:generate',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      // Generating writes a new spec_documents row — same `diagram:mutate`
      // gate as export/snapshot creation (T62 "What": "gerar É uma escrita").
      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const diagram = await getDiagramById(db, diagramId);
      if (!diagram) notFound();

      const spec = await generateSpecDocument(db, storage, {
        diagramId,
        diagramTitle: diagram.title,
        diagramDescription: diagram.description,
        generatedBy: user.id,
      });

      // EXT-02 (T80): one `spec.generated` webhook event per generated spec document.
      await enqueueWebhookEvent(db, jobs, workspaceId, 'spec.generated', {
        diagramId,
        workspaceId,
        specId: spec.id,
        version: spec.version,
        actorId: user.id,
      });

      reply.code(201);
      return { spec };
    },
  );

  app.get('/diagrams/:id/specs', { preHandler: requireSession(db) }, async (request) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const { cursor, limit } = listQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const result = await listSpecDocuments(db, diagramId, { cursor, limit });
    return result;
  });

  app.post(
    '/diagrams/:id/specs/:version(^[^:]+):regenerate-section',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: diagramId, version } = regenerateParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const { section } = regenerateBodySchema.parse(request.body);
      if (!isSectionName(section)) {
        badRequest(
          `unknown section '${section}' — must be one of: overview, components, flows, decisions`,
        );
      }

      const diagram = await getDiagramById(db, diagramId);
      if (!diagram) notFound();

      const spec = await regenerateSpecSection(db, storage, {
        diagramId,
        diagramTitle: diagram.title,
        diagramDescription: diagram.description,
        baseVersion: version,
        section,
        generatedBy: user.id,
      });

      reply.code(201);
      return { spec };
    },
  );
}
