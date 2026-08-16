import { randomUUID } from 'node:crypto';
import type { AbstractPatch } from '@arch-canvas/ai-tools';
import { can, type Role } from '@arch-canvas/auth';
import { decompile } from '@arch-canvas/diagram-ir';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import { applyMetadataOps, patchToDeltas } from '../ai-engine/applyPatch.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import { generateOpaqueToken, hashToken } from '../auth/tokens.js';
import '../auth/types.js';
import { appendOperation, type BatchResult } from '../diagram-sync/operations.js';
import { loadDiagramScene } from '../diagram-sync/scene.js';
import { listElementMetadata } from '../library/metadata.js';
import { isRoleWithinCeiling } from '../share/shareLinks.js';
import { createSnapshot } from '../snapshot/index.js';
import type { StorageClient } from '../storage/index.js';
import {
  type Diagram,
  listDiagramsForProject,
  listProjectsForWorkspace,
  resolveDiagramWorkspaceId,
  resolveWorkspaceRole,
} from '../workspace/index.js';
import { requireMcpToken } from './auth.js';
import { expandComponentRelations, findElementsByComponentKey } from './componentLookup.js';
import {
  createMcpToken,
  findMcpTokenByHash,
  findMcpTokenById,
  type McpTokenRow,
  revokeMcpToken,
} from './mcpTokens.js';

export interface McpModuleDeps {
  db: Db;
  /**
   * Required only when `MCP_WRITE_ENABLED=true` (MCP-07's `POST
   * /diagrams/:id/mcp-patch`, T14) — reused verbatim by `createSnapshot`,
   * exactly like `ai-engine`'s `approveAiRun`. Read-only deployments never
   * need it.
   */
  storage?: StorageClient;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

/** Same shape/statusCode convention as `ai-engine/errors.ts`'s `StaleRevisionError` — the revision moved between the caller's read and this write. */
function staleRevision(): never {
  throw Object.assign(new Error('Stale Revision'), { statusCode: 409 });
}

/**
 * Re-extracts the raw bearer token already validated by `requireMcpToken`'s
 * preHandler — mirrors `auth.ts`'s own private `bearerToken` helper exactly.
 * `POST /diagrams/:id/mcp-patch` (T14) needs the token row's `createdBy` (a
 * real `users.id`, FK-required by `createSnapshot`/`appendOperation`) which
 * `request.mcpContext` doesn't carry, so it re-resolves the same token by
 * hash instead of duplicating `mcp_tokens` lookup logic inline.
 */
function bearerTokenFromRequest(request: {
  headers: { authorization?: string };
}): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

const roleSchema = z.enum(['org_admin', 'workspace_admin', 'editor', 'reviewer', 'viewer']);
const workspaceIdParamsSchema = z.object({ id: z.string().min(1) });
const mcpTokenIdParamsSchema = z.object({ id: z.string().min(1) });
const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const componentParamsSchema = z.object({ id: z.string().min(1), stableKey: z.string().min(1) });
const createMcpTokenBodySchema = z.object({
  role: roleSchema,
  label: z.string().min(1),
  expiresAt: z.coerce.date().optional(),
});
/**
 * MCP-07: a single `setMetadata` op — the same shape `ai-tools`/
 * `applyPatch.ts` already applies. `sourceRevision` is the diagram revision
 * the caller read before proposing this patch (same staleness contract as
 * `AiRunRow.sourceRevision` in `approveAiRun`).
 */
const mcpPatchBodySchema = z.object({
  sourceRevision: z.number().int().nonnegative(),
  op: z.object({
    op: z.literal('setMetadata'),
    elementId: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  }),
});

/**
 * OpenAPI schema map for this module's routes (API-01 convention), wired
 * into `openapi/registry.ts` under the `mcp` key. `POST
 * /diagrams/:id/mcp-patch` is included even though it's only ever
 * registered when `MCP_WRITE_ENABLED=true` (T14) — the documented contract
 * covers the route's shape regardless of the flag; `checkOpenApiParity`
 * (F8, API-02) only cross-checks routes that exist in the current process's
 * registered set, so a doc entry for a flag-gated route is never flagged
 * as orphaned when the flag is off.
 */
export const routeSchemas: RouteSchemaMap = {
  'POST /workspaces/:id/mcp-tokens': {
    params: workspaceIdParamsSchema,
    body: createMcpTokenBodySchema,
  },
  'DELETE /mcp-tokens/:id': { params: mcpTokenIdParamsSchema },
  'GET /workspaces/:id/diagrams': { params: workspaceIdParamsSchema },
  'GET /diagrams/:id/ir': { params: diagramIdParamsSchema },
  'GET /diagrams/:id/components/:stableKey': { params: componentParamsSchema },
  'POST /diagrams/:id/mcp-patch': { params: diagramIdParamsSchema, body: mcpPatchBodySchema },
};

/** Never includes `tokenHash` — same one-shot-reveal discipline as `share/routes.ts`'s `toPublicShareLink`. */
function toPublicMcpToken(row: McpTokenRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    role: row.role,
    label: row.label,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

/** Loads the actor's role for `workspaceId`, or throws 404 when there is no membership row (AUTH-04: never reveal whether the workspace exists). */
async function requireMembership(db: Db, workspaceId: string, userId: string): Promise<Role> {
  const role = await resolveWorkspaceRole(db, workspaceId, userId);
  if (!role) notFound();
  return role;
}

/**
 * Registers MCP token issuance/revocation (MCP-04) — session-authenticated
 * (`requireSession`, never the MCP token itself: a logged-in human/admin
 * mints these tokens), admin-only (`workspace:manage_members`, the same
 * "admin-level" action `workspace/routes.ts`'s member management already
 * gates on) via `can()`. A non-admin write attempt is a plain 403 — the
 * AUTH-04 404-for-reads convention is for read paths (MCP-05's own
 * uniform-404 applies to `requireMcpToken`'s auth failures, not to this
 * session-authenticated write surface).
 *
 * The token's `role` is capped at the issuing actor's own ceiling
 * (`isRoleWithinCeiling`, reused from `share/shareLinks.ts` — the same
 * discipline share links already apply). The plaintext token is returned
 * exactly once, at creation — never recoverable afterward, mirroring
 * `share/routes.ts`'s one-shot reveal.
 */
export function registerMcpModule(app: FastifyInstance, deps: McpModuleDeps): void {
  const { db, storage } = deps;
  const mcpWriteEnabled = process.env.MCP_WRITE_ENABLED === 'true';
  if (mcpWriteEnabled && !storage) {
    throw new Error(
      'MCP_WRITE_ENABLED=true requires deps.storage to be provided to registerMcpModule',
    );
  }

  app.post(
    '/workspaces/:id/mcp-tokens',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: workspaceId } = workspaceIdParamsSchema.parse(request.params);
      const body = createMcpTokenBodySchema.parse(request.body);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const actorRole = await requireMembership(db, workspaceId, user.id);
      const decision = can({ role: actorRole }, 'workspace:manage_members', { workspaceId });
      if (!decision.allowed) forbidden();
      if (!isRoleWithinCeiling(actorRole, body.role)) forbidden();

      const token = generateOpaqueToken();
      const row = await createMcpToken(db, {
        workspaceId,
        role: body.role,
        label: body.label,
        createdBy: user.id,
        tokenHash: hashToken(token),
        expiresAt: body.expiresAt ?? null,
      });

      reply.code(201);
      return { mcpToken: toPublicMcpToken(row), token };
    },
  );

  app.delete('/mcp-tokens/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = mcpTokenIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const existing = await findMcpTokenById(db, id);
    if (!existing) notFound();

    const actorRole = await requireMembership(db, existing.workspaceId, user.id);
    const decision = can({ role: actorRole }, 'workspace:manage_members', {
      workspaceId: existing.workspaceId,
    });
    if (!decision.allowed) forbidden();

    const revoked = await revokeMcpToken(db, id);
    if (!revoked) notFound();
    return { mcpToken: toPublicMcpToken(revoked) };
  });

  // ---- MCP-01/02 read routes: token-authenticated, never session -------

  /**
   * SPEC_DEVIATION: tasks.md's Phase 3 (T5-T8) never lists a dedicated task
   * for "list diagrams in a workspace" as a REST route, even though MCP-01's
   * AC1 requires an agent to "buscar diagramas de um workspace" and T10's
   * `apps/mcp` client is specified to expose `listDiagrams(workspaceId)`.
   * No existing REST route covers this for a bearer-token caller (the only
   * precedent, `GET /diagrams?projectId=`, is `requireSession`-gated and
   * scoped per-project, not per-workspace). Reason: a genuine gap in the
   * task plan, resolved here per explicit orchestrator instruction — kept
   * intentionally small by aggregating over the existing per-project
   * primitives (`listProjectsForWorkspace` + `listDiagramsForProject`)
   * instead of adding a new SQL join.
   */
  async function listDiagramsForWorkspace(workspaceId: string): Promise<Diagram[]> {
    const workspaceProjects = await listProjectsForWorkspace(db, workspaceId);
    const perProject = await Promise.all(
      workspaceProjects.map((project) => listDiagramsForProject(db, project.id)),
    );
    return perProject.flat();
  }

  app.get('/workspaces/:id/diagrams', { preHandler: requireMcpToken(db) }, async (request) => {
    const { id: workspaceId } = workspaceIdParamsSchema.parse(request.params);
    const mcpContext = request.mcpContext;
    if (!mcpContext) notFound();

    // MCP-05/AUTH-04: a token scoped to a different workspace gets the exact
    // same 404 as a workspace id that doesn't exist at all — never a hint
    // that distinguishes the two.
    if (workspaceId !== mcpContext.workspaceId) notFound();

    const decision = can({ role: mcpContext.role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const items = await listDiagramsForWorkspace(workspaceId);
    return { items };
  });

  /**
   * MCP-01/02: returns the `diagram-ir/v1` representation of a saved
   * diagram — nodes, containers, edges, metadata — never a rendered image
   * (design.md's "Nova rota: GET /diagrams/:id/ir"). Same AUTH-04/MCP-05
   * 404-never-403 convention as every session-authenticated read route
   * (`diagram-sync/routes.ts`'s bootstrap), adapted to the MCP token's own
   * `mcpContext` instead of a resolved session role.
   */
  app.get('/diagrams/:id/ir', { preHandler: requireMcpToken(db) }, async (request) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const mcpContext = request.mcpContext;
    if (!mcpContext) notFound();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();
    if (workspaceId !== mcpContext.workspaceId) notFound();

    const decision = can({ role: mcpContext.role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const { scene } = await loadDiagramScene(db, diagramId);
    const metadata = await listElementMetadata(db, diagramId);
    return decompile(scene, metadata);
  });

  /**
   * MCP-03: resolves every diagram element carrying `stableKey` as its
   * `componentKey`, returning their semantic metadata plus the direct
   * in/out relations for each (T6's `findElementsByComponentKey` +
   * `expandComponentRelations`). A `stableKey` can legitimately match more
   * than one element in a diagram (the same library component placed
   * twice), so `metadata` is the full array of matches, never just the
   * first — `inbound`/`outbound` are the union of every matched element's
   * own relations. Same AUTH-04/MCP-05 uniform-404 convention as
   * `/diagrams/:id/ir` above, including for a `stableKey` with zero matches.
   */
  app.get(
    '/diagrams/:id/components/:stableKey',
    { preHandler: requireMcpToken(db) },
    async (request) => {
      const { id: diagramId, stableKey } = componentParamsSchema.parse(request.params);
      const mcpContext = request.mcpContext;
      if (!mcpContext) notFound();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();
      if (workspaceId !== mcpContext.workspaceId) notFound();

      const decision = can({ role: mcpContext.role }, 'diagram:read', { workspaceId });
      if (!decision.allowed) notFound();

      const metadata = await findElementsByComponentKey(db, diagramId, stableKey);
      if (metadata.length === 0) notFound();

      const { scene } = await loadDiagramScene(db, diagramId);
      const relations = metadata.map((row) => expandComponentRelations(scene, row.elementId));

      return {
        metadata,
        inbound: relations.flatMap((relation) => relation.inbound),
        outbound: relations.flatMap((relation) => relation.outbound),
      };
    },
  );

  // ---- MCP-07 write-behind-flag route: only registered when the server
  // boots with MCP_WRITE_ENABLED=true — with the flag off, this route never
  // exists (a request to it 404s the same way any unmatched route does,
  // never a route that exists and denies).
  if (mcpWriteEnabled && storage) {
    app.post('/diagrams/:id/mcp-patch', { preHandler: requireMcpToken(db) }, async (request) => {
      const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
      const body = mcpPatchBodySchema.parse(request.body);
      const mcpContext = request.mcpContext;
      if (!mcpContext) notFound();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();
      if (workspaceId !== mcpContext.workspaceId) notFound();

      const decision = can({ role: mcpContext.role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) notFound();

      const rawToken = bearerTokenFromRequest(request);
      if (!rawToken) notFound();
      const tokenRow = await findMcpTokenByHash(db, hashToken(rawToken));
      if (!tokenRow) notFound();
      const actorId = tokenRow.createdBy;

      const { scene, revision } = await loadDiagramScene(db, diagramId);
      if (revision !== body.sourceRevision) staleRevision();

      // The undo point: the scene exactly as it stood right before this
      // patch lands — same `pre_ai` kind/ordering as `approveAiRun`
      // (`ai-engine/applyPatch.ts`), reused verbatim, never duplicated.
      const snapshot = await createSnapshot(db, storage, {
        diagramId,
        kind: 'pre_ai',
        name: `pre-mcp-patch ${diagramId}`,
        createdBy: actorId,
      });

      const patch: AbstractPatch = { operations: [body.op] };
      const deltas = patchToDeltas(scene, patch);
      const batch: BatchResult =
        deltas.length > 0
          ? await appendOperation(db, diagramId, actorId, {
              clientMutationId: randomUUID(),
              baseRevision: revision,
              actorId,
              deltas,
            })
          : { acks: [], rejected: [], currentRevision: revision, missingOperations: [] };

      await applyMetadataOps(db, diagramId, patch, batch.currentRevision);

      return { snapshotId: snapshot.id, revision: batch.currentRevision };
    });
  }
}
