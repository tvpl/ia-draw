import { createHash, randomUUID } from 'node:crypto';
import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import { materializeScene } from '../snapshot/scene.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import { generateExports } from './generateExports.js';

export interface ExportModuleDeps {
  db: Db;
  storage: StorageClient;
}

/** Download URL TTL for a generated export (seconds) — long enough for a client to fetch right after the response, short enough not to leak a durable public link. */
const EXPORT_URL_TTL_SECONDS = 3600;

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });

type ExportFormatName = 'excalidraw' | 'svg' | 'png' | 'pdf';

const FORMAT_METADATA: Record<ExportFormatName, { extension: string; contentType: string }> = {
  excalidraw: { extension: 'excalidraw', contentType: 'application/json' },
  svg: { extension: 'svg', contentType: 'image/svg+xml' },
  png: { extension: 'png', contentType: 'image/png' },
  pdf: { extension: 'pdf', contentType: 'application/pdf' },
};

function exportObjectKey(diagramId: string, exportId: string, formatName: ExportFormatName): string {
  return `diagrams/${diagramId}/exports/${exportId}/scene.${FORMAT_METADATA[formatName].extension}`;
}

/** Registers the export module's single-diagram export route (EXP-01). */
export function registerExportModule(app: FastifyInstance, deps: ExportModuleDeps): void {
  const { db, storage } = deps;

  app.post('/diagrams/:id/exports', { preHandler: requireSession(db) }, async (request) => {
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
  });
}
