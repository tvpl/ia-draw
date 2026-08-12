import { diagramAssets } from '@arch-canvas/database';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export type AssetStatus = 'pending' | 'ready';

export interface AssetRow {
  id: string;
  workspaceId: string;
  diagramId: string;
  status: AssetStatus;
  mimeType: string;
  sizeBytes: number | null;
  objectKey: string;
  checksum: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertPendingAssetInput {
  id: string;
  workspaceId: string;
  diagramId: string;
  mimeType: string;
  sizeBytes: number;
  objectKey: string;
  createdBy: string;
}

export async function insertPendingAsset(db: Db, input: InsertPendingAssetInput): Promise<AssetRow> {
  const [row] = await db
    .insert(diagramAssets)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      diagramId: input.diagramId,
      status: 'pending',
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      objectKey: input.objectKey,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error('failed to insert pending asset');
  return row;
}

export async function getAssetById(
  db: Db,
  diagramId: string,
  assetId: string,
): Promise<AssetRow | null> {
  const [row] = await db
    .select()
    .from(diagramAssets)
    .where(and(eq(diagramAssets.id, assetId), eq(diagramAssets.diagramId, diagramId)));
  return row ?? null;
}

/** A `ready` asset in the same workspace already holding `checksum`, excluding `excludeId` itself — the dedup lookup (design.md asset module: "dedup por checksum no tenant"). */
export async function findReadyAssetByChecksum(
  db: Db,
  workspaceId: string,
  checksum: string,
  excludeId: string,
): Promise<AssetRow | null> {
  const [row] = await db
    .select()
    .from(diagramAssets)
    .where(
      and(
        eq(diagramAssets.workspaceId, workspaceId),
        eq(diagramAssets.checksum, checksum),
        eq(diagramAssets.status, 'ready'),
        ne(diagramAssets.id, excludeId),
      ),
    );
  return row ?? null;
}

export interface MarkAssetReadyInput {
  checksum: string;
  sizeBytes: number;
  objectKey: string;
}

export async function markAssetReady(
  db: Db,
  assetId: string,
  input: MarkAssetReadyInput,
): Promise<AssetRow> {
  const [row] = await db
    .update(diagramAssets)
    .set({
      status: 'ready',
      checksum: input.checksum,
      sizeBytes: input.sizeBytes,
      objectKey: input.objectKey,
      updatedAt: new Date(),
    })
    .where(eq(diagramAssets.id, assetId))
    .returning();
  if (!row) throw new Error('failed to mark asset ready');
  return row;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Used by diagram-sync's `operations:batch` route (T22) surgical check
 * (EDT-06): given the set of asset ids an incoming batch's image elements
 * reference, returns the subset that do NOT resolve to a `ready` asset in
 * `workspaceId` — either because no such row exists, it is still `pending`,
 * or it isn't a well-formed id at all (never queried as a uuid literal,
 * which Postgres would reject outright; treated as non-ready directly).
 */
export async function findNonReadyAssetIds(
  db: Db,
  workspaceId: string,
  candidateIds: readonly string[],
): Promise<string[]> {
  const wellFormedIds = candidateIds.filter((id) => UUID_PATTERN.test(id));
  const malformedIds = candidateIds.filter((id) => !UUID_PATTERN.test(id));

  if (wellFormedIds.length === 0) return malformedIds;

  const rows = await db
    .select({ id: diagramAssets.id, status: diagramAssets.status })
    .from(diagramAssets)
    .where(and(eq(diagramAssets.workspaceId, workspaceId), inArray(diagramAssets.id, wellFormedIds)));

  const readyIds = new Set(rows.filter((row) => row.status === 'ready').map((row) => row.id));
  const nonReadyWellFormed = wellFormedIds.filter((id) => !readyIds.has(id));

  return [...malformedIds, ...nonReadyWellFormed];
}
