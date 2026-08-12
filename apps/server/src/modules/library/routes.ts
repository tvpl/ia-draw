import { can } from '@arch-canvas/auth';
import { recordAuditEvent } from '@arch-canvas/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import { loadDiagramScene } from '../diagram-sync/scene.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import { buildInventory, toCsv } from './inventory.js';
import { listAuthorizedLibraries } from './libraries.js';
import { getElementMetadata, upsertElementMetadata } from './metadata.js';

export interface LibraryModuleDeps {
  db: Db;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const librariesQuerySchema = z.object({ workspaceId: z.string().min(1).optional() });
const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const elementParamsSchema = z.object({ id: z.string().min(1), elementId: z.string().min(1) });
const metadataBodySchema = z.object({
  semanticType: z.string().min(1).nullable().optional(),
  metadataJson: z.record(z.string(), z.unknown()).optional(),
});
const inventoryQuerySchema = z.object({ format: z.enum(['csv', 'json']).default('json') });

/**
 * Registers the library module's routes (T39): library listing, semantic
 * metadata read/write and inventory export. Metadata lives entirely in
 * `diagram_elements_meta`, linked only by `elementId` — this module never
 * reads or writes `diagram_operations`/scene content (LIB-02's boundary).
 */
export function registerLibraryModule(app: FastifyInstance, deps: LibraryModuleDeps): void {
  const { db } = deps;

  app.get('/libraries', { preHandler: requireSession(db) }, async (request) => {
    const { workspaceId } = librariesQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    if (workspaceId) {
      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();
      const decision = can({ role }, 'workspace:read', { workspaceId });
      if (!decision.allowed) notFound();
    }

    const items = await listAuthorizedLibraries(db, workspaceId ?? null);
    return { items };
  });

  app.get(
    '/diagrams/:id/elements/:elementId/metadata',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: diagramId, elementId } = elementParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();
      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();
      const decision = can({ role }, 'diagram:read', { workspaceId });
      if (!decision.allowed) notFound();

      const metadata = await getElementMetadata(db, diagramId, elementId);
      if (!metadata) notFound();
      return { metadata };
    },
  );

  app.patch(
    '/diagrams/:id/elements/:elementId/metadata',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: diagramId, elementId } = elementParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();
      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      // diagram:write, deliberately NOT diagram:mutate — editing a semantic
      // metadata field is not a canvas-geometry mutation, but reviewer still
      // holds neither action (T39 "Done when": reviewer gets 403 here).
      const decision = can({ role }, 'diagram:write', { workspaceId });
      if (!decision.allowed) forbidden();

      const body = metadataBodySchema.parse(request.body);
      // The diagram's current revision — the same source of truth diagram-sync
      // reports as `currentRevision` (max committed op-log sequence), not the
      // unused `diagrams.current_revision` column (T39 "vinculado à revisão corrente").
      const { revision } = await loadDiagramScene(db, diagramId);
      const metadata = await upsertElementMetadata(db, diagramId, elementId, body, revision);

      await recordAuditEvent(db, {
        actorId: user.id,
        action: 'diagram.element_metadata.updated',
        resourceType: 'diagram',
        resourceId: diagramId,
        metadataJson: { elementId, revision },
      });

      return { metadata };
    },
  );

  app.get('/diagrams/:id/inventory', { preHandler: requireSession(db) }, async (request, reply) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const { format } = inventoryQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();
    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();
    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const items = await buildInventory(db, diagramId);

    if (format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      return toCsv(items);
    }
    return { items };
  });
}
