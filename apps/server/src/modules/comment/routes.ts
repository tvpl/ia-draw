import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { JobQueue } from '../jobs/index.js';
import { enqueueWebhookEvent } from '../webhook/deliver.js';
import {
  listWorkspaceMembers,
  resolveDiagramWorkspaceId,
  resolveWorkspaceRole,
} from '../workspace/index.js';
import { createComment, getCommentById, listComments, updateComment } from './comments.js';
import { resolveMentions } from './mentions.js';

export interface CommentModuleDeps {
  db: Db;
  /** Threaded to T80's `comment.mentioned` webhook wiring below — same optional degrade as every other job consumer. */
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
const commentIdParamsSchema = z.object({ id: z.string().min(1), commentId: z.string().min(1) });

const createBodySchema = z.object({
  body: z.string().min(1),
  elementId: z.string().min(1).optional(),
  frameId: z.string().min(1).optional(),
  parentId: z.string().min(1).optional(),
});

const patchBodySchema = z
  .object({
    status: z.enum(['open', 'resolved']).optional(),
    body: z.string().min(1).optional(),
  })
  .refine((value) => value.status !== undefined || value.body !== undefined, {
    message: 'at least one of "status" or "body" must be provided',
  });

/** OpenAPI schema map for this module's 3 routes (T11, API-01). */
export const routeSchemas: RouteSchemaMap = {
  'POST /diagrams/:id/comments': { params: diagramIdParamsSchema, body: createBodySchema },
  'GET /diagrams/:id/comments': { params: diagramIdParamsSchema },
  'PATCH /diagrams/:id/comments/:commentId': {
    params: commentIdParamsSchema,
    body: patchBodySchema,
  },
};

/**
 * Registers the comment module's routes (T69, CMT-01/02): threaded
 * comments (`POST`/`GET /diagrams/:id/comments`) with `@userId`/`@email`
 * mentions (`mentions.ts`), and edit/resolve (`PATCH
 * /diagrams/:id/comments/:commentId`).
 *
 * RBAC: `comment:create`/`comment:resolve` (`packages/auth`) are granted to
 * every role including `reviewer` (CMT-02) — `diagram:mutate` stays denied
 * to reviewer independently, proven both in `packages/auth`'s own isolated
 * matrix test and end-to-end here. Editing an existing comment's `body` is
 * additionally gated by AUTHORSHIP (only the original author may edit their
 * own text), since `comment:create`/`comment:resolve` are uniformly granted
 * to all 5 roles and cannot by themselves distinguish "may edit MY
 * comment" from "may edit ANYONE's comment".
 */
export function registerCommentModule(app: FastifyInstance, deps: CommentModuleDeps): void {
  const { db, jobs } = deps;

  app.post('/diagrams/:id/comments', { preHandler: requireSession(db) }, async (request, reply) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'comment:create', { workspaceId });
    if (!decision.allowed) forbidden();

    const body = createBodySchema.parse(request.body);

    if (body.parentId) {
      const parent = await getCommentById(db, body.parentId);
      if (!parent || parent.diagramId !== diagramId) {
        badRequest('parentId does not reference an existing comment on this diagram');
      }
    }

    const members = await listWorkspaceMembers(db, workspaceId);
    const mentions = resolveMentions(body.body, members);

    const comment = await createComment(db, {
      diagramId,
      authorId: user.id,
      body: body.body,
      elementId: body.elementId ?? null,
      frameId: body.frameId ?? null,
      parentId: body.parentId ?? null,
    });

    // EXT-02 (T80): one `comment.mentioned` webhook event per comment that
    // resolves at least one mention — all mentioned userIds bundled into a
    // single event rather than firing one event per mentioned user, since
    // they were all mentioned by the same comment at the same instant.
    if (mentions.length > 0) {
      await enqueueWebhookEvent(db, jobs, workspaceId, 'comment.mentioned', {
        diagramId,
        workspaceId,
        commentId: comment.id,
        mentions,
        actorId: user.id,
      });
    }

    reply.code(201);
    return { comment, mentions };
  });

  app.get('/diagrams/:id/comments', { preHandler: requireSession(db) }, async (request) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const [rows, members] = await Promise.all([
      listComments(db, diagramId),
      listWorkspaceMembers(db, workspaceId),
    ]);

    // Flat list, oldest first, each row carrying its own `parentId` — thread
    // reconstruction is left to the caller (documented on `listComments`).
    const comments = rows.map((row) => ({ ...row, mentions: resolveMentions(row.body, members) }));
    return { comments };
  });

  app.patch(
    '/diagrams/:id/comments/:commentId',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: diagramId, commentId } = commentIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const existing = await getCommentById(db, commentId);
      if (!existing || existing.diagramId !== diagramId) notFound();

      const patch = patchBodySchema.parse(request.body);

      if (patch.status !== undefined) {
        const decision = can({ role }, 'comment:resolve', { workspaceId });
        if (!decision.allowed) forbidden();
      }
      if (patch.body !== undefined && existing.authorId !== user.id) {
        forbidden();
      }

      const updated = await updateComment(db, commentId, patch);
      return { comment: updated };
    },
  );
}
