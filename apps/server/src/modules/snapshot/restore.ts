import type { ElementDelta, SceneElement } from '@arch-canvas/editor-adapter';
import type { Db } from '../auth/db.js';
import { appendOperation, type BatchResult } from '../diagram-sync/operations.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import { materializeScene } from './scene.js';
import { getSnapshotById } from './snapshots.js';

export class SnapshotNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('snapshot not found');
    this.name = 'SnapshotNotFoundError';
  }
}

/** A version-space integer no delta will ever legitimately collide with, used to draw a fresh versionNonce per restored element. */
function freshVersionNonce(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Builds the deltas that bring `currentScene` to exactly `targetScene`'s
 * content: every element from the target is re-upserted with a version
 * bumped strictly above whatever the current scene holds for that id (so it
 * always LWW-wins reconciliation — AD-001's tie-break, packages/diagram-
 * domain's `mergeScene`), and every element present in the current scene
 * but absent from the target is tombstoned (`kind: 'delete'`).
 */
export function buildRestoreDeltas(
  currentScene: readonly SceneElement[],
  targetScene: readonly SceneElement[],
): ElementDelta[] {
  const currentIndex = new Map(currentScene.map((element) => [element.id, element]));
  const targetIndex = new Map(targetScene.map((element) => [element.id, element]));
  const deltas: ElementDelta[] = [];

  for (const [id, targetElement] of targetIndex) {
    const currentElement = currentIndex.get(id);
    const version = (currentElement?.version ?? targetElement.version) + 1;
    const versionNonce = freshVersionNonce();
    deltas.push({
      elementId: id,
      kind: 'upsert',
      element: { ...targetElement, version, versionNonce, isDeleted: false },
      version,
      versionNonce,
    });
  }

  for (const [id, currentElement] of currentIndex) {
    if (targetIndex.has(id) || currentElement.isDeleted) continue;
    deltas.push({
      elementId: id,
      kind: 'delete',
      version: currentElement.version + 1,
      versionNonce: freshVersionNonce(),
    });
  }

  return deltas;
}

export interface RestoreResult {
  batch: BatchResult;
  restoredFromSnapshotId: string;
}

/**
 * Restores `snapshotId`'s scene as a NEW revision (VER-02) by appending one
 * operation through diagram-sync's own `appendOperation` (T22) — the same
 * idempotent, sequence-safe write path every other mutation uses, reused
 * unmodified rather than duplicated. Never edits or deletes any existing
 * `diagram_operations`/`diagram_snapshots` row, so later revisions and
 * snapshots (including this very `snapshotId`, however old) stay fully
 * queryable, and an immutable (`published`/`pre_ai`) snapshot's own bytes
 * are never touched — structurally, not just by convention, since nothing
 * here ever issues an UPDATE against `diagram_snapshots`.
 */
export async function restoreSnapshot(
  db: Db,
  storage: StorageClient,
  diagramId: string,
  snapshotId: string,
  actorId: string,
  clientMutationId: string,
): Promise<RestoreResult> {
  const snapshot = await getSnapshotById(db, diagramId, snapshotId);
  if (!snapshot) throw new SnapshotNotFoundError();

  const targetBytes = await storage.getObject(EXPORT_BUCKET, snapshot.sceneJsonKey);
  const targetScene = JSON.parse(targetBytes.toString('utf8')) as SceneElement[];

  const { scene: currentScene, revision: currentRevision } = await materializeScene(db, diagramId);
  const deltas = buildRestoreDeltas(currentScene, targetScene);

  const batch = await appendOperation(db, diagramId, actorId, {
    clientMutationId,
    baseRevision: currentRevision,
    actorId,
    deltas,
  });

  return { batch, restoredFromSnapshotId: snapshotId };
}
