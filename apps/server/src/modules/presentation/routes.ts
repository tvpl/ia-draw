import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import {
  bulkReorderFrames,
  createFrame,
  deleteFrame,
  type FrameRow,
  listFramesForPresentation,
  updateFrame,
} from './frames.js';
import {
  createPresentation,
  getPresentationById,
  getPresentationDiagramId,
  listPresentationsForDiagram,
  updatePresentation,
} from './presentations.js';

export interface PresentationModuleDeps {
  db: Db;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const navLinkSchema = z.object({ targetFrameId: z.string().min(1) });

const createPresentationBodySchema = z.object({
  diagramId: z.string().min(1),
  name: z.string().min(1),
});
const listQuerySchema = z.object({ diagramId: z.string().min(1) });
const presentationIdParamsSchema = z.object({ id: z.string().min(1) });
const updatePresentationBodySchema = z.object({
  name: z.string().min(1).optional(),
  settingsJson: z.record(z.string(), z.unknown()).optional(),
});
const createFrameBodySchema = z.object({
  elementId: z.string().min(1).nullable().optional(),
  frameId: z.string().min(1).nullable().optional(),
  position: z.number().int(),
  notes: z.string().nullable().optional(),
  navLinksJson: z.array(navLinkSchema).optional(),
});
const bulkReorderBodySchema = z.object({
  frames: z.array(z.object({ id: z.string().min(1), position: z.number().int() })).min(1),
});
const frameParamsSchema = z.object({ id: z.string().min(1), frameId: z.string().min(1) });
const updateFrameBodySchema = z.object({
  elementId: z.string().min(1).nullable().optional(),
  frameId: z.string().min(1).nullable().optional(),
  position: z.number().int().optional(),
  notes: z.string().nullable().optional(),
  navLinksJson: z.array(navLinkSchema).optional(),
});

/** OpenAPI schema map for this module's 8 routes (T17, API-01). */
export const routeSchemas: RouteSchemaMap = {
  'POST /presentations': { body: createPresentationBodySchema },
  'GET /presentations': { query: listQuerySchema },
  'GET /presentations/:id': { params: presentationIdParamsSchema },
  'PATCH /presentations/:id': {
    params: presentationIdParamsSchema,
    body: updatePresentationBodySchema,
  },
  'POST /presentations/:id/frames': {
    params: presentationIdParamsSchema,
    body: createFrameBodySchema,
  },
  'PATCH /presentations/:id/frames': {
    params: presentationIdParamsSchema,
    body: bulkReorderBodySchema,
  },
  'PATCH /presentations/:id/frames/:frameId': {
    params: frameParamsSchema,
    body: updateFrameBodySchema,
  },
  'DELETE /presentations/:id/frames/:frameId': { params: frameParamsSchema },
};

/** PRS-01/03: private per T59's schema comment — a viewer/reviewer (anyone without `diagram:mutate`) never receives frame notes over the wire, even on an otherwise-successful read. */
function redactNotesUnlessEditor(frames: readonly FrameRow[], canEdit: boolean): FrameRow[] {
  if (canEdit) return frames as FrameRow[];
  return frames.map((frame) => ({ ...frame, notes: null }));
}

interface PresentationContext {
  diagramId: string;
  workspaceId: string;
  role: NonNullable<Awaited<ReturnType<typeof resolveWorkspaceRole>>>;
}

/** Resolves presentation -> diagram -> workspace -> role for `:id`-scoped routes, IDOR-safe (404, never 403, on anything unresolvable). */
async function resolvePresentationContext(
  db: Db,
  presentationId: string,
  userId: string,
): Promise<PresentationContext> {
  const diagramId = await getPresentationDiagramId(db, presentationId);
  if (!diagramId) notFound();

  const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
  if (!workspaceId) notFound();

  const role = await resolveWorkspaceRole(db, workspaceId, userId);
  if (!role) notFound();

  return { diagramId, workspaceId, role };
}

/**
 * Registers the presentation module's CRUD routes (T65, PRS-01/03): create/
 * list/update a presentation, and create/reorder/update/delete its frames.
 * Publish/read-only-link/PDF-export (PRS-02/05) are `publish.ts`'s routes
 * (T66), registered separately by the same `registerModules.ts` call site.
 */
export function registerPresentationModule(
  app: FastifyInstance,
  deps: PresentationModuleDeps,
): void {
  const { db } = deps;

  app.post('/presentations', { preHandler: requireSession(db) }, async (request, reply) => {
    const body = createPresentationBodySchema.parse(request.body);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, body.diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:mutate', { workspaceId });
    if (!decision.allowed) forbidden();

    const presentation = await createPresentation(db, {
      diagramId: body.diagramId,
      name: body.name,
    });
    reply.code(201);
    return { presentation, frames: [] };
  });

  app.get('/presentations', { preHandler: requireSession(db) }, async (request) => {
    const { diagramId } = listQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const canEdit = can({ role }, 'diagram:mutate', { workspaceId }).allowed;
    const presentations = await listPresentationsForDiagram(db, diagramId);
    const withFrames = await Promise.all(
      presentations.map(async (presentation) => ({
        presentation,
        frames: redactNotesUnlessEditor(
          await listFramesForPresentation(db, presentation.id),
          canEdit,
        ),
      })),
    );
    return { presentations: withFrames };
  });

  app.get('/presentations/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = presentationIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const { role, workspaceId } = await resolvePresentationContext(db, id, user.id);
    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const presentation = await getPresentationById(db, id);
    if (!presentation) notFound();

    const canEdit = can({ role }, 'diagram:mutate', { workspaceId }).allowed;
    const frames = redactNotesUnlessEditor(await listFramesForPresentation(db, id), canEdit);
    return { presentation, frames };
  });

  app.patch('/presentations/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = presentationIdParamsSchema.parse(request.params);
    const body = updatePresentationBodySchema.parse(request.body);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const { role, workspaceId } = await resolvePresentationContext(db, id, user.id);
    const decision = can({ role }, 'diagram:mutate', { workspaceId });
    if (!decision.allowed) forbidden();

    const presentation = await updatePresentation(db, id, body);
    if (!presentation) notFound();
    return { presentation };
  });

  app.post(
    '/presentations/:id/frames',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id } = presentationIdParamsSchema.parse(request.params);
      const body = createFrameBodySchema.parse(request.body);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const { role, workspaceId } = await resolvePresentationContext(db, id, user.id);
      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      // InvalidNavLinkError carries its own statusCode (400), propagated unwrapped
      // through core's generic error handler, same convention as every typed error here.
      const frame = await createFrame(db, id, body);
      reply.code(201);
      return { frame };
    },
  );

  app.patch('/presentations/:id/frames', { preHandler: requireSession(db) }, async (request) => {
    const { id } = presentationIdParamsSchema.parse(request.params);
    const { frames: updates } = bulkReorderBodySchema.parse(request.body);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const { role, workspaceId } = await resolvePresentationContext(db, id, user.id);
    const decision = can({ role }, 'diagram:mutate', { workspaceId });
    if (!decision.allowed) forbidden();

    const frames = await bulkReorderFrames(db, id, updates);
    return { frames };
  });

  app.patch(
    '/presentations/:id/frames/:frameId',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id, frameId } = frameParamsSchema.parse(request.params);
      const body = updateFrameBodySchema.parse(request.body);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const { role, workspaceId } = await resolvePresentationContext(db, id, user.id);
      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const frame = await updateFrame(db, id, frameId, body);
      if (!frame) notFound();
      return { frame };
    },
  );

  app.delete(
    '/presentations/:id/frames/:frameId',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id, frameId } = frameParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const { role, workspaceId } = await resolvePresentationContext(db, id, user.id);
      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const deleted = await deleteFrame(db, id, frameId);
      if (!deleted) notFound();
      reply.code(204);
    },
  );
}
