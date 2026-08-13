import { can, type Role } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import { generateOpaqueToken, hashToken } from '../auth/tokens.js';
import '../auth/types.js';
import { loadDiagramScene } from '../diagram-sync/scene.js';
import { type FrameRow, listFramesForPresentation } from '../presentation/frames.js';
import { getPresentationById, getPresentationDiagramId } from '../presentation/presentations.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import {
  createShareLink,
  getShareLinkById,
  getShareLinkByTokenHash,
  isRoleWithinCeiling,
  isShareLinkActive,
  revokeShareLinkById,
  type ShareLinkResourceType,
  type ShareLinkRow,
} from './shareLinks.js';

export interface ShareModuleDeps {
  db: Db;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const roleSchema = z.enum(['org_admin', 'workspace_admin', 'editor', 'reviewer', 'viewer']);
const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const presentationIdParamsSchema = z.object({ id: z.string().min(1) });
const shareLinkIdParamsSchema = z.object({ id: z.string().min(1) });
const tokenParamsSchema = z.object({ token: z.string().min(1) });
const createShareLinkBodySchema = z.object({
  role: roleSchema,
  expiresAt: z.coerce.date(),
});

/** Never includes `tokenHash` — the API surface never re-exposes it, mirroring `sessions`/`ws_tickets`' one-shot-reveal discipline. */
function toPublicShareLink(row: ShareLinkRow) {
  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    role: row.role,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/** Resolves the `workspaceId` a share link's underlying resource belongs to — `null` when the resource (or its diagram, for a presentation link) no longer resolves, which routes turn into the same 404 as every other IDOR-safe path in this codebase. */
async function resolveShareLinkWorkspaceId(db: Db, link: ShareLinkRow): Promise<string | null> {
  if (link.resourceType === 'diagram') {
    return resolveDiagramWorkspaceId(db, link.resourceId);
  }
  const diagramId = await getPresentationDiagramId(db, link.resourceId);
  if (!diagramId) return null;
  return resolveDiagramWorkspaceId(db, diagramId);
}

/** PRS-01/03's redaction rule (frame notes never leave the server for a non-editor view) applied here at the link's OWN capped role — never the requester's real role, since `GET /share/:token` never resolves a requester identity at all. */
function redactNotesUnlessEditor(frames: readonly FrameRow[], canEdit: boolean): FrameRow[] {
  if (canEdit) return frames as FrameRow[];
  return frames.map((frame) => ({ ...frame, notes: null }));
}

/**
 * Core create path shared by both thin REST endpoints below (T78, EXT-01).
 * `actorRole` is the actor's OWN effective role in the resource's
 * workspace — `body.role` (the role being GRANTED to the link) must never
 * exceed it (`isRoleWithinCeiling`). Requires `diagram:mutate` to create a
 * link at all (same bar as publishing a presentation, `publishRoutes.ts`) —
 * an `editor` can create links, a `reviewer`/`viewer` cannot.
 */
async function createShareLinkForResource(
  db: Db,
  params: {
    resourceType: ShareLinkResourceType;
    resourceId: string;
    workspaceId: string;
    actorRole: Role;
    actorId: string;
    grantedRole: Role;
    expiresAt: Date;
  },
): Promise<{ shareLink: ReturnType<typeof toPublicShareLink>; token: string }> {
  const decision = can({ role: params.actorRole }, 'diagram:mutate', {
    workspaceId: params.workspaceId,
  });
  if (!decision.allowed) forbidden();

  if (!isRoleWithinCeiling(params.actorRole, params.grantedRole)) forbidden();

  const token = generateOpaqueToken();
  const row = await createShareLink(db, {
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    role: params.grantedRole,
    expiresAt: params.expiresAt,
    createdBy: params.actorId,
    tokenHash: hashToken(token),
  });

  return { shareLink: toPublicShareLink(row), token };
}

/**
 * Registers the share module (T78, EXT-01) — capped-role, expiring public
 * share links for diagrams and presentations. `GET /share/:token` is the
 * ONLY unauthenticated route this module registers (no `requireSession`) —
 * every other route requires a session and resolves the actor's real
 * workspace role first.
 */
export function registerShareModule(app: FastifyInstance, deps: ShareModuleDeps): void {
  const { db } = deps;

  app.post(
    '/diagrams/:id/share-links',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
      const body = createShareLinkBodySchema.parse(request.body);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const actorRole = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!actorRole) notFound();

      const result = await createShareLinkForResource(db, {
        resourceType: 'diagram',
        resourceId: diagramId,
        workspaceId,
        actorRole,
        actorId: user.id,
        grantedRole: body.role,
        expiresAt: body.expiresAt,
      });
      reply.code(201);
      return result;
    },
  );

  app.post(
    '/presentations/:id/share-links',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: presentationId } = presentationIdParamsSchema.parse(request.params);
      const body = createShareLinkBodySchema.parse(request.body);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const diagramId = await getPresentationDiagramId(db, presentationId);
      if (!diagramId) notFound();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const actorRole = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!actorRole) notFound();

      const result = await createShareLinkForResource(db, {
        resourceType: 'presentation',
        resourceId: presentationId,
        workspaceId,
        actorRole,
        actorId: user.id,
        grantedRole: body.role,
        expiresAt: body.expiresAt,
      });
      reply.code(201);
      return result;
    },
  );

  // Public, unauthenticated — the whole point of a share link. Expired,
  // revoked, and nonexistent tokens are ALL a plain 404, indistinguishable
  // (same IDOR principle `presentation/publish.ts`'s `getPublishedPresentation`
  // already established for published-presentation reads).
  app.get('/share/:token', async (request) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const link = await getShareLinkByTokenHash(db, hashToken(token));
    if (!link) notFound();
    if (!isShareLinkActive(link)) notFound();

    const workspaceId = await resolveShareLinkWorkspaceId(db, link);
    if (!workspaceId) notFound();

    if (link.resourceType === 'diagram') {
      const { scene, revision } = await loadDiagramScene(db, link.resourceId);
      return { resourceType: 'diagram' as const, role: link.role, scene, revision };
    }

    const presentation = await getPresentationById(db, link.resourceId);
    if (!presentation) notFound();

    // The link's OWN role is the ceiling here — never the (nonexistent,
    // since this route is unauthenticated) requester's role, and never
    // above it even if the token leaked to a real workspace_admin.
    const canEdit = can({ role: link.role }, 'diagram:mutate', { workspaceId }).allowed;
    const frames = redactNotesUnlessEditor(
      await listFramesForPresentation(db, link.resourceId),
      canEdit,
    );
    return { resourceType: 'presentation' as const, role: link.role, presentation, frames };
  });

  app.post(
    '/share-links/:id(^[^:]+):revoke',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id } = shareLinkIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const link = await getShareLinkById(db, id);
      if (!link) notFound();

      const workspaceId = await resolveShareLinkWorkspaceId(db, link);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      // Same permission level as whoever created it, OR a workspace admin
      // (`workspace:manage_members` — granted only to workspace_admin/
      // org_admin — is used as the "admin-level" action check, same as
      // every other admin-only gate in this codebase).
      const isCreator = link.createdBy === user.id;
      const isAdmin = can({ role }, 'workspace:manage_members', { workspaceId }).allowed;
      if (!isCreator && !isAdmin) forbidden();

      const revoked = await revokeShareLinkById(db, id);
      if (!revoked) notFound();
      return { shareLink: toPublicShareLink(revoked) };
    },
  );
}
