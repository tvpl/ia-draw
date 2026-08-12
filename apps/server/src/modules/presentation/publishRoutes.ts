import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { StorageClient } from '../storage/index.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import { exportPresentationPdf } from './exportPdf.js';
import { getPresentationDiagramId } from './presentations.js';
import { getPublishedPresentation, publishPresentation } from './publish.js';

export interface PresentationPublishModuleDeps {
  db: Db;
  storage: StorageClient;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const presentationIdParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Registers the presentation module's publish/read-only-link/PDF-export
 * routes (T66, PRS-02/05) — a separate `register*Module` from T65's
 * `registerPresentationModule` because these routes need a `StorageClient`
 * T65's CRUD routes never touch; both are wired at the same call site in
 * `registerModules.ts` (L-008).
 */
export function registerPresentationPublishModule(
  app: FastifyInstance,
  deps: PresentationPublishModuleDeps,
): void {
  const { db, storage } = deps;

  app.post(
    '/presentations/:id(^[^:]+):publish',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: presentationId } = presentationIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const diagramId = await getPresentationDiagramId(db, presentationId);
      if (!diagramId) notFound();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const presentation = await publishPresentation(db, storage, {
        presentationId,
        diagramId,
        actorId: user.id,
      });
      return { presentation };
    },
  );

  app.get('/presentations/:id/published', { preHandler: requireSession(db) }, async (request) => {
    const { id: presentationId } = presentationIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const diagramId = await getPresentationDiagramId(db, presentationId);
    if (!diagramId) notFound();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    // PRS-02: "exige pelo menos papel viewer" — diagram:read is the action every
    // role from viewer up holds; reviewer/editor/admin all qualify too.
    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    // PresentationNotFoundError/PresentationExpiredError both carry statusCode 404,
    // propagated unwrapped through core's generic error handler.
    const view = await getPublishedPresentation(db, storage, presentationId);
    return view;
  });

  app.post(
    '/presentations/:id(^[^:]+):export-pdf',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: presentationId } = presentationIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const diagramId = await getPresentationDiagramId(db, presentationId);
      if (!diagramId) notFound();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const decision = can({ role }, 'diagram:read', { workspaceId });
      if (!decision.allowed) notFound();

      const result = await exportPresentationPdf(db, storage, presentationId);
      return result;
    },
  );
}
