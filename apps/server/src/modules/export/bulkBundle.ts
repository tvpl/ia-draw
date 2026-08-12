import { diagrams, projects } from '@arch-canvas/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { defineJob, enqueue, type JobQueue } from '../jobs/index.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import { buildDiagramBundle } from './bundle.js';

export const BULK_WORKSPACE_BUNDLE_JOB = 'bulk-workspace-bundle';

/** All non-deleted diagram ids belonging to `workspaceId`, via `projects.workspace_id`. */
async function listDiagramIdsForWorkspace(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ id: diagrams.id })
    .from(diagrams)
    .innerJoin(projects, eq(diagrams.projectId, projects.id))
    .where(
      and(eq(projects.workspaceId, workspaceId), isNull(diagrams.deletedAt), isNull(projects.deletedAt)),
    );
  return rows.map((row) => row.id);
}

function bulkBundleObjectKey(workspaceId: string, diagramId: string): string {
  return `workspaces/${workspaceId}/bulk-bundles/${diagramId}.zip`;
}

/**
 * Builds and stores a `.zip` bundle (T33's `buildDiagramBundle`) for every diagram in
 * `workspaceId`, one object per diagram under a workspace-scoped prefix in
 * `EXPORT_BUCKET`. Exported directly (not only via `registerBulkBundleJob`'s worker)
 * so it can be unit/integration tested without going through pg-boss.
 */
export async function runBulkWorkspaceBundle(
  db: Db,
  storage: StorageClient,
  workspaceId: string,
): Promise<string[]> {
  const diagramIds = await listDiagramIdsForWorkspace(db, workspaceId);
  const objectKeys: string[] = [];

  for (const diagramId of diagramIds) {
    const { buffer } = await buildDiagramBundle(db, storage, diagramId);
    const objectKey = bulkBundleObjectKey(workspaceId, diagramId);
    await storage.putObject(EXPORT_BUCKET, objectKey, buffer, 'application/zip');
    objectKeys.push(objectKey);
  }

  return objectKeys;
}

/** Registers the `bulk-workspace-bundle` pg-boss worker (T28), for `POST /workspaces/{id}/bundles` (EXP-04) to enqueue against. */
export async function registerBulkBundleJob(
  jobs: JobQueue,
  db: Db,
  storage: StorageClient,
): Promise<void> {
  await defineJob(jobs, BULK_WORKSPACE_BUNDLE_JOB, async (payload: { workspaceId: string }) => {
    await runBulkWorkspaceBundle(db, storage, payload.workspaceId);
  });
}

/** Enqueues a bulk bundle job for `workspaceId` (EXP-04: "asynchronous job"). */
export async function enqueueBulkWorkspaceBundle(
  jobs: JobQueue,
  workspaceId: string,
): Promise<string | null> {
  return enqueue(jobs, BULK_WORKSPACE_BUNDLE_JOB, { workspaceId });
}
