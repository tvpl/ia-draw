import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { JobQueue } from '../jobs/index.js';
import { listElementMetadata } from '../library/metadata.js';
import { materializeScene } from '../snapshot/scene.js';
import type { StorageClient } from '../storage/index.js';
import {
  resolveDiagramWorkspaceId,
  resolveProjectWorkspaceId,
  resolveWorkspaceRole,
} from '../workspace/index.js';
import { exportDslFromScene } from './exportDsl.js';
import { type InteropFormat, importDiagramFromDsl } from './importDsl.js';

export interface InteropModuleDeps {
  db: Db;
  /** Not read by any route here today — kept for signature parity with the task spec and every other module's optional-dependency convention (`export`/`docgen`/`presentation-publish` all accept `storage`/`jobs` they don't unconditionally use). */
  storage?: StorageClient;
  jobs?: JobQueue;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const importParamsSchema = z.object({ id: z.string().min(1), format: z.string().min(1) });
const exportParamsSchema = z.object({ id: z.string().min(1), format: z.string().min(1) });
const importBodySchema = z.object({
  dsl: z.string().min(1),
  title: z.string().min(1).optional(),
});

/**
 * Fastify/find-my-way parses a bare `:name` ANYWHERE inside a path segment
 * as a parameter declaration, not literal text — `/import:mermaid` and
 * `/import:structurizr` registered as two separate routes therefore collide
 * (both define a parameter at the same trie position, just under different
 * names: `FST_ERR_DUPLICATED_ROUTE`, confirmed empirically while writing
 * this route). The fix used throughout this codebase for a literal
 * `:suffix` (`/diagrams/:id/specs:generate`, `/presentations/:id(^[^:]+)
 * :publish`) only ever has ONE such suffix per path, so it never hits this;
 * two SIBLING suffixes need a different fix: register a single route with
 * one real `:format` parameter and branch on its value in the handler.
 * find-my-way's capture for `.../import:mermaid` includes the leading
 * colon verbatim (`params.format === ':mermaid'`) — `parseFormatParam`
 * strips it before matching against the two supported literal formats.
 */
function parseFormatParam(raw: string): InteropFormat {
  const value = raw.startsWith(':') ? raw.slice(1) : raw;
  if (value === 'mermaid' || value === 'structurizr') return value;
  throw Object.assign(
    new Error(`unsupported interop format "${value}" — must be mermaid or structurizr`),
    {
      statusCode: 400,
    },
  );
}

/** OpenAPI schema map for this module's 2 routes (T14, API-01). */
export const routeSchemas: RouteSchemaMap = {
  'POST /projects/:id/import:format': { params: importParamsSchema, body: importBodySchema },
  'POST /diagrams/:id/export:format': { params: exportParamsSchema },
};

/**
 * Registers the interop module's routes (T68, AAC-01/02): Mermaid/
 * Structurizr import (creates a brand-new diagram, `importDsl.ts`) and
 * export (DSL from a diagram's current scene, `exportDsl.ts`).
 *
 * SPEC_DEVIATION (same reasoning `export/routes.ts` already documents for
 * the `.excalidraw` import route): the task text names the import routes
 * `/diagrams/{id}/import:mermaid`/`:structurizr`, but the task's own body
 * says import "cria um novo diagrama" — there is no diagram id yet to scope
 * under at request time, only a target project id (`createDiagram` requires
 * `projectId`, never a pre-existing `diagramId`). Import is registered
 * under `/projects/:id/import:mermaid`/`:structurizr` instead, exactly
 * mirroring the established `/projects/:id/import` precedent. Export
 * genuinely reads an EXISTING diagram's scene, so it is scoped under
 * `/diagrams/:id/export:mermaid`/`:structurizr` as the task text says.
 */
export function registerInteropModule(app: FastifyInstance, deps: InteropModuleDeps): void {
  const { db } = deps;

  app.post(
    '/projects/:id/import:format',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: projectId, format: rawFormat } = importParamsSchema.parse(request.params);
      const format = parseFormatParam(rawFormat);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveProjectWorkspaceId(db, projectId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      // Import creates a new diagram (a write) — same `diagram:write` gate
      // `.excalidraw` import already uses (`export/routes.ts`'s
      // `/projects/:id/import`), never `diagram:mutate` (that action is
      // reserved for canvas-content mutation of an EXISTING diagram).
      const decision = can({ role }, 'diagram:write', { workspaceId });
      if (!decision.allowed) forbidden();

      const body = importBodySchema.parse(request.body);
      const { diagram, limitations } = await importDiagramFromDsl(db, format, {
        projectId,
        title: body.title,
        ownerId: user.id,
        dsl: body.dsl,
      });

      reply.code(201);
      return { diagramId: diagram.id, diagram, limitations };
    },
  );

  app.post('/diagrams/:id/export:format', { preHandler: requireSession(db) }, async (request) => {
    const { id: diagramId, format: rawFormat } = exportParamsSchema.parse(request.params);
    const format = parseFormatParam(rawFormat);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    // AAC-02 "RBAC leitura: diagram:view" — this codebase's read action is
    // named `diagram:read` (there is no separate `diagram:view` throughout
    // `packages/auth`'s action set); IDOR-safe 404 (not 403) when the role
    // lacks it, same pattern every other read route here follows.
    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const [{ scene }, elementsMeta] = await Promise.all([
      materializeScene(db, diagramId),
      listElementMetadata(db, diagramId),
    ]);

    const { dsl, limitations } = exportDslFromScene(format, scene, elementsMeta);
    return { dsl, limitations };
  });
}
