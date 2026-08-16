import { can, type Role } from '@arch-canvas/auth';
import { decompile } from '@arch-canvas/diagram-ir';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import { generateOpaqueToken, hashToken } from '../auth/tokens.js';
import '../auth/types.js';
import { loadDiagramScene } from '../diagram-sync/scene.js';
import { listElementMetadata } from '../library/metadata.js';
import { isRoleWithinCeiling } from '../share/shareLinks.js';
import {
  type Diagram,
  listDiagramsForProject,
  listProjectsForWorkspace,
  resolveDiagramWorkspaceId,
  resolveWorkspaceRole,
} from '../workspace/index.js';
import { requireMcpToken } from './auth.js';
import { createMcpToken, findMcpTokenById, type McpTokenRow, revokeMcpToken } from './mcpTokens.js';

export interface McpModuleDeps {
  db: Db;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const roleSchema = z.enum(['org_admin', 'workspace_admin', 'editor', 'reviewer', 'viewer']);
const workspaceIdParamsSchema = z.object({ id: z.string().min(1) });
const mcpTokenIdParamsSchema = z.object({ id: z.string().min(1) });
const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const createMcpTokenBodySchema = z.object({
  role: roleSchema,
  label: z.string().min(1),
  expiresAt: z.coerce.date().optional(),
});

/**
 * OpenAPI schema map for this module's routes (API-01 convention) — not
 * yet wired into `openapi/registry.ts` (T8's job, along with registering
 * this module in `registerAllModules`; this batch only builds the module
 * itself, not its wiring).
 */
export const routeSchemas: RouteSchemaMap = {
  'POST /workspaces/:id/mcp-tokens': {
    params: workspaceIdParamsSchema,
    body: createMcpTokenBodySchema,
  },
  'DELETE /mcp-tokens/:id': { params: mcpTokenIdParamsSchema },
  'GET /workspaces/:id/diagrams': { params: workspaceIdParamsSchema },
  'GET /diagrams/:id/ir': { params: diagramIdParamsSchema },
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
  const { db } = deps;

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
}
