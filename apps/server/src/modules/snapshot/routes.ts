import { randomUUID } from 'node:crypto';
import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { StorageClient } from '../storage/index.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import { diffDiagram } from './diff.js';
import { restoreSnapshot } from './restore.js';
import { createSnapshot, listSnapshots } from './snapshots.js';

export interface SnapshotModuleDeps {
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
const createSnapshotBodySchema = z.object({ name: z.string().min(1).optional() });
const restoreParamsSchema = z.object({ id: z.string().min(1), snapshotId: z.string().min(1) });
const restoreBodySchema = z.object({ clientMutationId: z.uuid().optional() });
const diffQuerySchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

/** OpenAPI schema map for this module's 4 routes (T8, API-01). */
export const routeSchemas: RouteSchemaMap = {
  'POST /diagrams/:id/snapshots': { params: diagramIdParamsSchema, body: createSnapshotBodySchema },
  'GET /diagrams/:id/snapshots': { params: diagramIdParamsSchema },
  'POST /diagrams/:id/snapshots/:snapshotId(^[^:]+):restore': {
    params: restoreParamsSchema,
    body: restoreBodySchema,
  },
  'GET /diagrams/:id/diff': { params: diagramIdParamsSchema, query: diffQuerySchema },
};

/** Registers the snapshot module's routes: on-demand creation + listing (VER-01), restore-as-new-revision (VER-02/03) and structural diff (VER-04). */
export function registerSnapshotModule(app: FastifyInstance, deps: SnapshotModuleDeps): void {
  const { db, storage } = deps;

  app.post(
    '/diagrams/:id/snapshots',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const body = createSnapshotBodySchema.parse(request.body ?? {});

      const snapshot = await createSnapshot(db, storage, {
        diagramId,
        kind: 'named',
        name: body.name ?? null,
        createdBy: user.id,
      });

      reply.code(201);
      return { snapshot };
    },
  );

  app.get('/diagrams/:id/snapshots', { preHandler: requireSession(db) }, async (request) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const snapshots = await listSnapshots(db, diagramId);
    return { snapshots };
  });

  app.post(
    '/diagrams/:id/snapshots/:snapshotId(^[^:]+):restore',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: diagramId, snapshotId } = restoreParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const body = restoreBodySchema.parse(request.body ?? {});

      // SnapshotNotFoundError carries its own statusCode (404) — core's generic error
      // handler renders it as problem+json, same as every other typed error here.
      const result = await restoreSnapshot(
        db,
        storage,
        diagramId,
        snapshotId,
        user.id,
        body.clientMutationId ?? randomUUID(),
      );

      return {
        currentRevision: result.batch.currentRevision,
        restoredFromSnapshotId: result.restoredFromSnapshotId,
      };
    },
  );

  app.get('/diagrams/:id/diff', { preHandler: requireSession(db) }, async (request) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const { from, to } = diffQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const diff = await diffDiagram(db, diagramId, from, to);
    return { from, to, ...diff };
  });
}
