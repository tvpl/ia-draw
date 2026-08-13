import { createHash, randomUUID } from 'node:crypto';
import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRateLimitPreHandler, InMemoryRateLimiter } from '../../core/rateLimit.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { JobQueue } from '../jobs/index.js';
import { materializeScene } from '../snapshot/scene.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import {
  resolveDiagramWorkspaceId,
  resolveProjectWorkspaceId,
  resolveWorkspaceRole,
} from '../workspace/index.js';
import { enqueueBulkWorkspaceBundle } from './bulkBundle.js';
import { buildDiagramBundle } from './bundle.js';
import { generateExports } from './generateExports.js';
import { confirmImport, previewImport } from './import.js';

export interface ExportModuleDeps {
  db: Db;
  storage: StorageClient;
  /** Injectable job queue (T28). Omitted = bulk workspace export (EXP-04) responds 503 instead of enqueuing — a legitimate degrade path, matching diagram-sync/snapshot's own optional-`jobs` convention (never a boot requirement). */
  jobs?: JobQueue;
  /**
   * Injectable, separately-configured rate limiter (SEC-02, T83) shared by
   * both `POST /diagrams/:id/exports` and `POST /diagrams/:id/bundle` —
   * stricter than `core/server.ts`'s default per-authenticated-route limit,
   * since generating exports (SVG/PNG/PDF rasterization, zip bundling) is
   * materially more expensive than an ordinary REST request. Defaults to a
   * fresh in-memory limiter, same convention as `ai-provider`'s
   * `testConnectionRateLimiter`.
   */
  exportRateLimiter?: InMemoryRateLimiter;
}

/** Download URL TTL for a generated export/bundle (seconds) — long enough for a client to fetch right after the response, short enough not to leak a durable public link. */
const EXPORT_URL_TTL_SECONDS = 3600;

/** Stricter than `core/server.ts`'s default (300/60s) — export generation is CPU/IO-heavy (rasterization, zip bundling). */
const DEFAULT_EXPORT_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

function serviceUnavailable(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 503 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const projectIdParamsSchema = z.object({ id: z.string().min(1) });
const workspaceIdParamsSchema = z.object({ id: z.string().min(1) });

const importBodySchema = z.object({
  fileContent: z.string().min(1),
  confirm: z.boolean().optional(),
  title: z.string().min(1).optional(),
});

type ExportFormatName = 'excalidraw' | 'svg' | 'png' | 'pdf';

const FORMAT_METADATA: Record<ExportFormatName, { extension: string; contentType: string }> = {
  excalidraw: { extension: 'excalidraw', contentType: 'application/json' },
  svg: { extension: 'svg', contentType: 'image/svg+xml' },
  png: { extension: 'png', contentType: 'image/png' },
  pdf: { extension: 'pdf', contentType: 'application/pdf' },
};

function exportObjectKey(
  diagramId: string,
  exportId: string,
  formatName: ExportFormatName,
): string {
  return `diagrams/${diagramId}/exports/${exportId}/scene.${FORMAT_METADATA[formatName].extension}`;
}

function bundleObjectKey(diagramId: string, bundleId: string): string {
  return `diagrams/${diagramId}/bundles/${bundleId}/bundle.zip`;
}

/** Registers the export module's routes: single-diagram export (EXP-01), `.zip` bundle (EXP-02), `.excalidraw` import preview/confirm (EXP-03), and bulk workspace export (EXP-04). */
export function registerExportModule(app: FastifyInstance, deps: ExportModuleDeps): void {
  const { db, storage, jobs } = deps;
  const exportRateLimiter =
    deps.exportRateLimiter ?? new InMemoryRateLimiter(DEFAULT_EXPORT_RATE_LIMIT);
  const exportRateLimited = createRateLimitPreHandler(
    exportRateLimiter,
    (request) => request.authContext?.user?.id ?? request.ip,
  );

  app.post(
    '/diagrams/:id/exports',
    { preHandler: [requireSession(db), exportRateLimited] },
    async (request) => {
      const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const decision = can({ role }, 'diagram:read', { workspaceId });
      if (!decision.allowed) notFound();

      const { scene, revision } = await materializeScene(db, diagramId);
      const formats = await generateExports(scene);
      const exportId = randomUUID();

      const results: Record<
        ExportFormatName,
        { url: string; checksum: string; sizeBytes: number; contentType: string }
      > = {} as never;

      for (const formatName of Object.keys(FORMAT_METADATA) as ExportFormatName[]) {
        const bytes = formats[formatName];
        const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        const objectKey = exportObjectKey(diagramId, exportId, formatName);
        const { contentType } = FORMAT_METADATA[formatName];

        await storage.putObject(EXPORT_BUCKET, objectKey, bytes, contentType);
        const url = await storage.getSignedUrl(EXPORT_BUCKET, objectKey, EXPORT_URL_TTL_SECONDS);

        results[formatName] = { url, checksum, sizeBytes: bytes.byteLength, contentType };
      }

      return { exportId, revision, formats: results };
    },
  );

  app.post(
    '/diagrams/:id/bundle',
    { preHandler: [requireSession(db), exportRateLimited] },
    async (request) => {
      const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const decision = can({ role }, 'diagram:read', { workspaceId });
      if (!decision.allowed) notFound();

      const { buffer, manifest } = await buildDiagramBundle(db, storage, diagramId);
      const bundleId = randomUUID();
      const objectKey = bundleObjectKey(diagramId, bundleId);

      await storage.putObject(EXPORT_BUCKET, objectKey, buffer, 'application/zip');
      const url = await storage.getSignedUrl(EXPORT_BUCKET, objectKey, EXPORT_URL_TTL_SECONDS);

      return { bundleId, url, sizeBytes: buffer.byteLength, manifest };
    },
  );

  // SPEC_DEVIATION: the task text names this route `/diagrams/{id}/import`, but also
  // says the diagram is NOT created at preview time — there is no diagram id yet to
  // scope the route under (a diagram only starts existing on confirm). This registers
  // it under the target project instead (`/projects/{id}/import`), which is what
  // `confirmImport` actually needs to create a diagram (`workspace/diagrams.ts`'s
  // `createDiagram` requires a `projectId`, never a pre-existing `diagramId`) — the
  // task text explicitly allows this choice ("sua escolha, documente").
  app.post('/projects/:id/import', { preHandler: requireSession(db) }, async (request, reply) => {
    const { id: projectId } = projectIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveProjectWorkspaceId(db, projectId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:write', { workspaceId });
    if (!decision.allowed) forbidden();

    const body = importBodySchema.parse(request.body);

    // InvalidImportError already carries `statusCode` (400) — core's generic error
    // handler renders it as problem+json directly, same as every other typed error
    // here, so it propagates unwrapped.
    const { preview } = previewImport(body.fileContent);

    if (!body.confirm) {
      return { preview };
    }

    if (!body.title) {
      throw Object.assign(new Error('title is required to confirm an import'), {
        statusCode: 400,
      });
    }

    const diagram = await confirmImport(db, {
      projectId,
      title: body.title,
      ownerId: user.id,
      fileContent: body.fileContent,
    });

    reply.code(201);
    return { preview, diagram };
  });

  app.post('/workspaces/:id/bundles', { preHandler: requireSession(db) }, async (request) => {
    const { id: workspaceId } = workspaceIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    // EXP-04: "only accessible to workspace_admin" — `workspace:manage_members` is
    // held exclusively by workspace_admin/org_admin among all 5 roles (packages/auth's
    // rbac.ts), the same action workspace member-management routes gate on.
    const decision = can({ role }, 'workspace:manage_members', { workspaceId });
    if (!decision.allowed) forbidden();

    if (!jobs) {
      serviceUnavailable('bulk workspace export is unavailable — job queue is not running');
    }

    const jobId = await enqueueBulkWorkspaceBundle(jobs, workspaceId);
    return { jobId, status: 'queued' as const };
  });
}
