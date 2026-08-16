import { createHash, randomUUID } from 'node:crypto';
import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import { ASSET_BUCKET, type StorageClient } from '../storage/index.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import {
  findReadyAssetByChecksum,
  getAssetById,
  insertPendingAsset,
  markAssetReady,
} from './assets.js';
import {
  ALLOWED_ASSET_MIME_TYPES,
  MAX_ASSET_SIZE_BYTES,
  UPLOAD_URL_TTL_SECONDS,
} from './constants.js';
import { sanitizeSvg } from './sanitizeSvg.js';

export interface AssetModuleDeps {
  db: Db;
  storage: StorageClient;
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
const assetParamsSchema = z.object({ id: z.string().min(1), assetId: z.string().min(1) });

const initiateBodySchema = z.object({
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

function objectKeyFor(diagramId: string, assetId: string): string {
  return `diagrams/${diagramId}/assets/${assetId}`;
}

/** OpenAPI schema map for this module's 2 routes (T7, API-01). */
export const routeSchemas: RouteSchemaMap = {
  'POST /diagrams/:id/assets:initiate': {
    params: diagramIdParamsSchema,
    body: initiateBodySchema,
  },
  'POST /diagrams/:id/assets/:assetId(^[^:]+):complete': { params: assetParamsSchema },
};

/** Registers the asset module's routes — two-phase upload (EDT-06). */
export function registerAssetModule(app: FastifyInstance, deps: AssetModuleDeps): void {
  const { db, storage } = deps;

  app.post(
    '/diagrams/:id/assets:initiate',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      // Adding an image asset feeds a canvas mutation (the referencing element) —
      // gated by the same diagram:mutate action operations:batch requires.
      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const body = initiateBodySchema.parse(request.body);
      if (!ALLOWED_ASSET_MIME_TYPES.has(body.mimeType)) {
        badRequest(`mimeType "${body.mimeType}" is not in the allowed list`);
      }
      if (body.sizeBytes > MAX_ASSET_SIZE_BYTES) {
        // 413, mirroring parseOperationEnvelope's convention for size-limit violations.
        throw Object.assign(
          new Error(`sizeBytes ${body.sizeBytes} exceeds the ${MAX_ASSET_SIZE_BYTES}-byte limit`),
          { statusCode: 413 },
        );
      }

      const assetId = randomUUID();
      const objectKey = objectKeyFor(diagramId, assetId);

      await insertPendingAsset(db, {
        id: assetId,
        workspaceId,
        diagramId,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        objectKey,
        createdBy: user.id,
      });

      const uploadUrl = await storage.putSignedUrl(
        ASSET_BUCKET,
        objectKey,
        body.mimeType,
        UPLOAD_URL_TTL_SECONDS,
      );

      reply.code(201);
      return {
        assetId,
        status: 'pending' as const,
        uploadUrl,
        objectKey,
        bucket: ASSET_BUCKET,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      };
    },
  );

  app.post(
    '/diagrams/:id/assets/:assetId(^[^:]+):complete',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: diagramId, assetId } = assetParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      const asset = await getAssetById(db, diagramId, assetId);
      if (!asset) notFound();

      // Idempotent: completing an already-ready asset again just re-reports it,
      // never re-processes (matches operations:batch's own idempotency pattern).
      if (asset.status === 'ready') {
        return {
          assetId: asset.id,
          status: asset.status,
          objectKey: asset.objectKey,
          checksum: asset.checksum,
          deduped: false,
        };
      }

      const head = await storage.headObject(ASSET_BUCKET, asset.objectKey);
      if (!head.exists) {
        throw Object.assign(
          new Error('upload not found — the object was never confirmed on storage'),
          { statusCode: 409 },
        );
      }

      let bytes = await storage.getObject(ASSET_BUCKET, asset.objectKey);
      let finalObjectKey = asset.objectKey;

      if (asset.mimeType === 'image/svg+xml') {
        const sanitized = sanitizeSvg(bytes);
        if (!sanitized.equals(bytes)) {
          await storage.putObject(ASSET_BUCKET, asset.objectKey, sanitized, asset.mimeType);
        }
        bytes = sanitized;
      }

      const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

      const dedupTarget = await findReadyAssetByChecksum(db, workspaceId, checksum, asset.id);
      const deduped = dedupTarget !== null;
      if (dedupTarget) {
        finalObjectKey = dedupTarget.objectKey;
      }

      const updated = await markAssetReady(db, asset.id, {
        checksum,
        sizeBytes: bytes.byteLength,
        objectKey: finalObjectKey,
      });

      return {
        assetId: updated.id,
        status: updated.status,
        objectKey: updated.objectKey,
        checksum: updated.checksum,
        deduped,
      };
    },
  );
}
