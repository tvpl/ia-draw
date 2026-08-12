import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { StorageClient } from '../storage/index.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
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

/** Registers the snapshot module's on-demand routes (VER-01). Restore/diff land in T31. */
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
}
