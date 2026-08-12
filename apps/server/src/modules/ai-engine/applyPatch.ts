import { randomUUID } from 'node:crypto';
import type { AbstractPatch, PatchOperation } from '@arch-canvas/ai-tools';
import type { ElementDelta, SceneElement } from '@arch-canvas/editor-adapter';
import type { Db } from '../auth/db.js';
import { appendOperation, type BatchResult } from '../diagram-sync/operations.js';
import { loadDiagramScene } from '../diagram-sync/scene.js';
import { upsertElementMetadata } from '../library/index.js';
import { createSnapshot, type SnapshotRow } from '../snapshot/index.js';
import type { StorageClient } from '../storage/index.js';
import {
  type AiRunRow,
  type AiRunStatus,
  getAiRunById,
  markToolCallsApproved,
  updateAiRunStatus,
} from './aiRuns.js';
import {
  AiRunNotFoundError,
  InvalidRunStateError,
  PatchNotFoundError,
  StaleRevisionError,
} from './errors.js';
import type { RunStore } from './runStore.js';

/**
 * Atomic apply + pre-ai snapshot + undo (T55, AIG-05/AIE-03). Applying an
 * approved run's patch reuses `operations:batch`'s OWN commit path
 * (`appendOperation`, F1b) directly — the exact same pattern
 * `snapshot/restore.ts`'s `restoreSnapshot` already established for
 * "reconstruct deltas, call appendOperation, done" — never a second,
 * parallel transactional-write implementation.
 */

function freshVersionNonce(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Converts a T53/T54-computed `AbstractPatch` into `ElementDelta[]` ready
 * for `appendOperation`, bumping every touched element's `version` strictly
 * above whatever `currentScene` already holds for that id — so it always
 * wins `mergeScene`'s LWW tie-break (AD-001), mirroring `restore.ts`'s
 * `buildRestoreDeltas` exactly. A brand-new element (not present in
 * `currentScene`) keeps the version the write tool already assigned it
 * (normally 1). `setMetadata` operations produce no delta here — semantic
 * metadata lives in `diagram_elements_meta`, applied separately by
 * `applyMetadataOps` below.
 */
export function patchToDeltas(
  currentScene: readonly SceneElement[],
  patch: AbstractPatch,
): ElementDelta[] {
  const index = new Map(
    currentScene.map((element) => [(element as { id: string }).id, element as { version: number }]),
  );
  const deltas: ElementDelta[] = [];

  for (const op of patch.operations) {
    if (op.op === 'upsertElement') {
      const existing = index.get(op.elementId);
      const proposedVersion = (op.element as { version?: number }).version ?? 1;
      const version = existing ? Math.max(existing.version + 1, proposedVersion) : proposedVersion;
      const versionNonce = freshVersionNonce();
      deltas.push({
        elementId: op.elementId,
        kind: 'upsert',
        element: {
          ...(op.element as object),
          version,
          versionNonce,
          isDeleted: false,
        } as SceneElement,
        version,
        versionNonce,
      });
    } else if (op.op === 'deleteElement') {
      const existing = index.get(op.elementId);
      const version = (existing?.version ?? 0) + 1;
      deltas.push({
        elementId: op.elementId,
        kind: 'delete',
        version,
        versionNonce: freshVersionNonce(),
      });
    }
  }

  return deltas;
}

async function applyMetadataOps(
  db: Db,
  diagramId: string,
  patch: AbstractPatch,
  revision: number,
): Promise<void> {
  const metadataOps = patch.operations.filter(
    (op): op is Extract<PatchOperation, { op: 'setMetadata' }> => op.op === 'setMetadata',
  );
  for (const op of metadataOps) {
    await upsertElementMetadata(
      db,
      diagramId,
      op.elementId,
      { metadataJson: op.metadata },
      revision,
    );
  }
}

export interface ApproveAiRunDeps {
  db: Db;
  storage: StorageClient;
  runStore: RunStore;
}

export interface ApproveAiRunResult {
  run: AiRunRow;
  snapshot: SnapshotRow;
  batch: BatchResult;
}

/**
 * `POST /ai/runs/{id}:approve`. Order of operations, all against the SAME
 * freshly-loaded scene: (1) staleness check against `run.source_revision`
 * — AIE-03, never applies over a newer change, returns 409 instead
 * (`StaleRevisionError`) rather than silently recomputing; (2) `pre_ai`
 * snapshot (F1c) BEFORE the patch lands, so it captures exactly the state
 * the AI's diff was computed against — the full undo point; (3) the patch
 * itself, via `appendOperation` (F1b) — the same commit path
 * `operations:batch`'s own route calls, reused, not duplicated.
 */
export async function approveAiRun(
  deps: ApproveAiRunDeps,
  runId: string,
  actorId: string,
): Promise<ApproveAiRunResult> {
  const { db, storage, runStore } = deps;

  const run = await getAiRunById(db, runId);
  if (!run) throw new AiRunNotFoundError();
  if (run.status !== 'awaiting_approval') throw new InvalidRunStateError('approve', run.status);

  const entry = runStore.get(runId);
  if (!entry) throw new PatchNotFoundError();

  const { scene, revision } = await loadDiagramScene(db, run.diagramId);
  if (revision !== run.sourceRevision) throw new StaleRevisionError();

  await updateAiRunStatus(db, run.id, 'applying');

  // The undo point: the scene exactly as it stood right before the AI's
  // patch lands (immutable — `kind: 'pre_ai'` is in `snapshot.ts`'s
  // IMMUTABLE_KINDS set).
  const snapshot = await createSnapshot(db, storage, {
    diagramId: run.diagramId,
    kind: 'pre_ai',
    name: `pre-ai ${run.id}`,
    createdBy: actorId,
  });

  const deltas = patchToDeltas(scene, entry.patch);
  const batch: BatchResult =
    deltas.length > 0
      ? await appendOperation(db, run.diagramId, actorId, {
          clientMutationId: randomUUID(),
          baseRevision: revision,
          actorId,
          deltas,
        })
      : { acks: [], rejected: [], currentRevision: revision, missingOperations: [] };

  await applyMetadataOps(db, run.diagramId, entry.patch, batch.currentRevision);
  await markToolCallsApproved(db, run.id);

  const applied = await updateAiRunStatus(db, run.id, 'applied');
  runStore.delete(run.id);

  return { run: applied, snapshot, batch };
}

/** Non-terminal states a run may still be cancelled from — the same set `:approve` requires reaching `awaiting_approval` through, plus every earlier in-flight state (a run mid-pipeline can also be cancelled). */
const CANCELLABLE_STATUSES: readonly AiRunStatus[] = [
  'queued',
  'building_context',
  'calling_model',
  'validating',
  'previewing',
  'awaiting_approval',
];

/**
 * `POST /ai/runs/{id}:cancel` — transitions to `cancelled` and drops the
 * pending patch from `RunStore`. Never calls `appendOperation`/
 * `createSnapshot`/anything that touches the real scene — a cancelled run
 * leaves zero trace in `diagram_operations`/`diagram_snapshots`.
 */
export async function cancelAiRun(db: Db, runStore: RunStore, runId: string): Promise<AiRunRow> {
  const run = await getAiRunById(db, runId);
  if (!run) throw new AiRunNotFoundError();
  if (!CANCELLABLE_STATUSES.includes(run.status)) {
    throw new InvalidRunStateError('cancel', run.status);
  }

  const cancelled = await updateAiRunStatus(db, run.id, 'cancelled');
  runStore.delete(run.id);
  return cancelled;
}
