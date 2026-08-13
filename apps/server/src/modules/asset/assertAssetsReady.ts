import type { ElementDelta } from '@arch-canvas/editor-adapter';
import type { Db } from '../auth/db.js';
import { findNonReadyAssetIds } from './assets.js';

/**
 * Thrown by `assertDeltaAssetsReady` — carries `statusCode` so core's
 * generic error handler (apps/server/src/core/server.ts) renders it as
 * problem+json, mirroring the `OperationEnvelopeError`/`notFound()` pattern
 * diagram-sync already uses.
 */
export class AssetNotReadyError extends Error {
  readonly statusCode = 409;
  readonly assetIds: readonly string[];

  constructor(assetIds: readonly string[]) {
    super(`operation references asset(s) not ready: ${assetIds.join(', ')}`);
    this.name = 'AssetNotReadyError';
    this.assetIds = assetIds;
  }
}

/**
 * EDT-06 invariant: "an image element is never ACKed with a broken asset
 * reference." An Excalidraw image element (`type: 'image'`) carries its
 * binary reference in the standard upstream `fileId` field — this platform
 * binds that value directly to a `diagram_assets.id` (no extra indirection
 * table), so `fileId` doubles as the asset id for this check.
 *
 * Scans `deltas` for upsert deltas whose element is an image, collects the
 * referenced asset ids, and throws `AssetNotReadyError` if any of them is
 * missing or still `pending` in `workspaceId`. Deltas with no image element
 * (the overwhelming majority) never touch the database here.
 */
export async function assertDeltaAssetsReady(
  db: Db,
  workspaceId: string,
  deltas: readonly ElementDelta[],
): Promise<void> {
  const candidateIds = new Set<string>();

  for (const delta of deltas) {
    if (delta.kind !== 'upsert' || !delta.element) continue;
    const element = delta.element as { type?: unknown; fileId?: unknown };
    if (element.type === 'image' && typeof element.fileId === 'string') {
      candidateIds.add(element.fileId);
    }
  }

  if (candidateIds.size === 0) return;

  const nonReady = await findNonReadyAssetIds(db, workspaceId, [...candidateIds]);
  if (nonReady.length > 0) {
    throw new AssetNotReadyError(nonReady);
  }
}
