import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import { loadDiagramScene } from './scene.js';

export interface DiagramSyncModuleDeps {
  db: Db;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });

/** Registers the diagram-sync module's routes — the server-first persistence core (T21). */
export function registerDiagramSyncModule(app: FastifyInstance, deps: DiagramSyncModuleDeps): void {
  const { db } = deps;

  app.get('/diagrams/:id/bootstrap', { preHandler: requireSession(db) }, async (request) => {
    const { id } = diagramIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    // IDOR pattern (AUTH-04, mirrored from the workspace module): a diagram
    // outside the actor's workspace, or one that doesn't exist, is 404 —
    // never 403, which would reveal that the resource exists.
    const workspaceId = await resolveDiagramWorkspaceId(db, id);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const { scene, revision } = await loadDiagramScene(db, id);

    return {
      scene,
      revision,
      // No asset references exist yet — the asset module (EDT-06) is F1c.
      assets: [],
      permissions: decision,
    };
  });
}
