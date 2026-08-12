import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { StorageClient } from '../storage/index.js';
import {
  getDiagramById,
  resolveDiagramWorkspaceId,
  resolveWorkspaceRole,
} from '../workspace/index.js';
import { generateSpecDocument, listSpecDocuments } from './generate.js';

export interface DocgenModuleDeps {
  db: Db;
  storage: StorageClient;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

/**
 * Registers the docgen module's routes (DOC-01/02): structured Markdown spec
 * generation from the live scene, and cursor-paginated version listing.
 * Single-section regeneration (DOC-04) is wired separately by
 * `registerRegenerateSectionRoute` (T63, `regenerateSection.ts`) — called
 * from the same `registerDocgenModule` entrypoint so production wiring
 * (L-008) still happens in one place.
 */
export function registerDocgenModule(app: FastifyInstance, deps: DocgenModuleDeps): void {
  const { db, storage } = deps;

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
}
