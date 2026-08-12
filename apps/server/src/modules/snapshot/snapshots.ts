import { createHash, randomUUID } from 'node:crypto';
import { diagramSnapshots, diagrams } from '@arch-canvas/database';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import { materializeScene } from './scene.js';

export type SnapshotKind = 'auto' | 'named' | 'published' | 'pre_ai' | 'restore_point';

export interface SnapshotRow {
  id: string;
  diagramId: string;
  revision: number;
  kind: SnapshotKind;
  name: string | null;
  sceneJsonKey: string;
  checksum: string;
  createdBy: string;
  immutable: boolean;
  createdAt: Date;
}

/** Kinds that are immutable once created (design.md Data Models: "published/pre_ai = true"). */
const IMMUTABLE_KINDS: ReadonlySet<SnapshotKind> = new Set(['published', 'pre_ai']);

export interface CreateSnapshotInput {
  diagramId: string;
  kind: SnapshotKind;
  name?: string | null;
  createdBy: string;
}

function sceneObjectKey(diagramId: string, snapshotId: string): string {
  return `diagrams/${diagramId}/snapshots/${snapshotId}.json`;
}

/**
 * Materializes the diagram's current scene, writes the canonical scene JSON
 * to object storage (`EXPORT_BUCKET` — the "assets/exports/backups" bucket
 * triad from minio-init/T6 has no dedicated snapshots bucket, and a
 * generated versioned artifact fits the exports bucket's purpose), and
 * inserts the `diagram_snapshots` row (VER-01).
 */
export async function createSnapshot(
  db: Db,
  storage: StorageClient,
  input: CreateSnapshotInput,
): Promise<SnapshotRow> {
  const { scene, revision } = await materializeScene(db, input.diagramId);
  const sceneJson = JSON.stringify(scene);
  const checksum = `sha256:${createHash('sha256').update(sceneJson).digest('hex')}`;
  const snapshotId = randomUUID();
  const sceneJsonKey = sceneObjectKey(input.diagramId, snapshotId);

  await storage.putObject(EXPORT_BUCKET, sceneJsonKey, sceneJson, 'application/json');

  const [row] = await db
    .insert(diagramSnapshots)
    .values({
      id: snapshotId,
      diagramId: input.diagramId,
      revision,
      kind: input.kind,
      name: input.name ?? null,
      sceneJsonKey,
      checksum,
      createdBy: input.createdBy,
      immutable: IMMUTABLE_KINDS.has(input.kind),
    })
    .returning();
  if (!row) throw new Error('failed to insert diagram snapshot');
  return row;
}

export async function listSnapshots(db: Db, diagramId: string): Promise<SnapshotRow[]> {
  return db
    .select()
    .from(diagramSnapshots)
    .where(eq(diagramSnapshots.diagramId, diagramId))
    .orderBy(desc(diagramSnapshots.revision));
}

export async function getSnapshotById(
  db: Db,
  diagramId: string,
  snapshotId: string,
): Promise<SnapshotRow | null> {
  const [row] = await db
    .select()
    .from(diagramSnapshots)
    .where(and(eq(diagramSnapshots.id, snapshotId), eq(diagramSnapshots.diagramId, diagramId)));
  return row ?? null;
}

/** Latest snapshot (by revision) for `diagramId`, or `null` if none exists yet. */
export async function getLatestSnapshot(db: Db, diagramId: string): Promise<SnapshotRow | null> {
  const [row] = await db
    .select()
    .from(diagramSnapshots)
    .where(eq(diagramSnapshots.diagramId, diagramId))
    .orderBy(desc(diagramSnapshots.revision))
    .limit(1);
  return row ?? null;
}

/** The diagram's `ownerId` — used as `createdBy` for system-triggered (`auto`) snapshots, which have no acting user. */
export async function getDiagramOwnerId(db: Db, diagramId: string): Promise<string | null> {
  const [row] = await db
    .select({ ownerId: diagrams.ownerId })
    .from(diagrams)
    .where(eq(diagrams.id, diagramId));
  return row?.ownerId ?? null;
}
