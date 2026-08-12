import { diagramOperations } from '@arch-canvas/database';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { defineJob, enqueue, type JobQueue } from '../jobs/index.js';
import type { StorageClient } from '../storage/index.js';
import { createSnapshot, getDiagramOwnerId, getLatestSnapshot } from './snapshots.js';

export const COMPACT_DIAGRAM_JOB = 'compact-diagram';

export interface CompactionThresholds {
  /** Max operations accumulated since the last snapshot before compacting. */
  maxOperations: number;
  /** Max time (ms) since the last snapshot before compacting. */
  maxAgeMs: number;
  /** Max accumulated delta bytes since the last snapshot before compacting. */
  maxBytes: number;
}

/** VER-01: "100 operations, 5 minutes or 1 MB of accumulated operations, whichever first." */
export const DEFAULT_COMPACTION_THRESHOLDS: CompactionThresholds = {
  maxOperations: 100,
  maxAgeMs: 5 * 60 * 1000,
  maxBytes: 1024 * 1024,
};

/**
 * Whether `diagramId` has crossed a compaction threshold since its latest
 * snapshot (or since the diagram was created, if it has none yet).
 * Called from diagram-sync's `operations:batch` route (T22) at the end of
 * every successful batch — checking is cheap (a handful of rows in the
 * common case); the actual compaction work is deferred to the job queue so
 * a threshold crossing never blocks the ack.
 */
export async function shouldCompact(
  db: Db,
  diagramId: string,
  thresholds: CompactionThresholds = DEFAULT_COMPACTION_THRESHOLDS,
): Promise<boolean> {
  const latest = await getLatestSnapshot(db, diagramId);
  const sinceSequence = latest?.revision ?? 0;
  const sinceTime = latest?.createdAt ?? new Date(0);

  const rows = await db
    .select({ elementsDeltaJson: diagramOperations.elementsDeltaJson })
    .from(diagramOperations)
    .where(
      and(
        eq(diagramOperations.diagramId, diagramId),
        gt(diagramOperations.sequence, sinceSequence),
      ),
    )
    .orderBy(asc(diagramOperations.sequence));

  if (rows.length >= thresholds.maxOperations) return true;
  if (Date.now() - sinceTime.getTime() >= thresholds.maxAgeMs) return true;

  const totalBytes = rows.reduce(
    (sum, row) => sum + Buffer.byteLength(JSON.stringify(row.elementsDeltaJson)),
    0,
  );
  return totalBytes >= thresholds.maxBytes;
}

/**
 * Compacts `diagramId`'s op-log into a fresh `auto` snapshot. `createdBy`
 * has no acting user for a system-triggered compaction, so it uses the
 * diagram's own `ownerId` as a documented stand-in.
 */
export async function compactDiagram(
  db: Db,
  storage: StorageClient,
  diagramId: string,
): Promise<void> {
  const ownerId = await getDiagramOwnerId(db, diagramId);
  if (!ownerId) return; // diagram was deleted between enqueue and processing — nothing to compact.

  await createSnapshot(db, storage, { diagramId, kind: 'auto', createdBy: ownerId });
}

/** Registers the `compact-diagram` worker on `jobs` (T28's pg-boss wiring). */
export async function registerCompactionJob(
  jobs: JobQueue,
  db: Db,
  storage: StorageClient,
): Promise<void> {
  await defineJob(jobs, COMPACT_DIAGRAM_JOB, async (payload: { diagramId: string }) => {
    await compactDiagram(db, storage, payload.diagramId);
  });
}

/** Enqueues a compaction job for `diagramId` (called after a threshold crossing). */
export async function enqueueCompaction(jobs: JobQueue, diagramId: string): Promise<void> {
  await enqueue(jobs, COMPACT_DIAGRAM_JOB, { diagramId });
}
