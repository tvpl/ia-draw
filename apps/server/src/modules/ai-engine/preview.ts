import type { AbstractPatch, PatchOperation } from '@arch-canvas/ai-tools';
import { type StructuralDiffResult, structuralDiff } from '@arch-canvas/diagram-domain';
import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { Db } from '../auth/db.js';
import { loadDiagramScene } from '../diagram-sync/scene.js';
import { type AiRunRow, updateAiRunStatus } from './aiRuns.js';
import type { RunStore } from './runStore.js';

/**
 * Preview generation + explicit-approval thresholds (T54, product-spec.md
 * §8.4 steps 7-8, spec.md AIE-02). Continues T53's pipeline (`previewing →
 * awaiting_approval`) — reads the patch T53 already computed and stored in
 * `RunStore`, but computes everything here purely in memory against the
 * scene `loadDiagramScene` returns: NEVER inserts into `diagram_operations`,
 * NEVER calls `appendOperation` (that's T55's `:approve` alone).
 */

export interface PreviewSummary extends StructuralDiffResult {
  /** ElementIds touched by a `setMetadata` patch operation — semantic metadata lives outside the scene diff structuralDiff computes. */
  metadataChanged: string[];
}

/** Applies `patch` onto `scene` IN MEMORY (a plain JS object per id) — never persisted, purely to compute what the resulting scene WOULD look like for the preview diff. */
function applyPatchInMemory(scene: readonly SceneElement[], patch: AbstractPatch): SceneElement[] {
  const index = new Map<string, SceneElement>(
    scene.map((element) => [(element as { id: string }).id, element]),
  );
  for (const op of patch.operations) {
    if (op.op === 'upsertElement') {
      index.set(op.elementId, { ...(op.element as object), isDeleted: false } as SceneElement);
    } else if (op.op === 'deleteElement') {
      const existing = index.get(op.elementId);
      if (existing)
        index.set(op.elementId, { ...(existing as object), isDeleted: true } as SceneElement);
    }
    // 'setMetadata' never touches the scene itself (diagram_elements_meta is a separate table) — tracked in `metadataChanged` below instead.
  }
  return Array.from(index.values());
}

/** The structural preview (added/removed/moved/modified/metadataChanged) — the "resumo" design.md/product-spec.md §8.4 step 7 describes, computed without ever mutating the real scene. */
export function buildPreviewSummary(
  currentScene: readonly SceneElement[],
  patch: AbstractPatch,
): PreviewSummary {
  const hypotheticalScene = applyPatchInMemory(currentScene, patch);
  const diff = structuralDiff(currentScene, hypotheticalScene);
  const metadataChanged = [
    ...new Set(
      patch.operations
        .filter(
          (op): op is Extract<PatchOperation, { op: 'setMetadata' }> => op.op === 'setMetadata',
        )
        .map((op) => op.elementId),
    ),
  ];
  return { ...diff, metadataChanged };
}

export type ApprovalThresholdReason = 'removal' | 'element_count' | 'outside_selection';

export interface ApprovalThresholdResult {
  requiresExplicitApproval: boolean;
  reasons: ApprovalThresholdReason[];
  touchedElementCount: number;
}

export interface ComputeApprovalThresholdInput {
  patch: AbstractPatch;
  currentScene: readonly SceneElement[];
  /** ElementIds selected on the canvas when the run was created — empty means "no selection was declared", so the outside-selection rule never triggers (nothing to be "outside" of). */
  selection: readonly string[];
}

/**
 * The literal AIE-02 / product-spec.md §8.4 step 8 rule: explicit approval
 * is required when the patch (1) removes any element, (2) touches MORE
 * THAN 50 elements (exactly 50 does NOT trigger — the boundary is strict
 * `>`, not `>=`), or (3) modifies an existing element that was outside the
 * originally requested selection. A brand-new element (created by the
 * patch, not present in `currentScene`) never counts against rule 3 —
 * creating something adjacent to a selection is expected agent behavior,
 * not a scope violation; only touching a PRE-EXISTING element the user did
 * not select is.
 */
export function computeApprovalThreshold(
  input: ComputeApprovalThresholdInput,
): ApprovalThresholdResult {
  const removalCount = input.patch.operations.filter((op) => op.op === 'deleteElement').length;
  const touchedIds = new Set(input.patch.operations.map((op) => op.elementId));
  const touchedElementCount = touchedIds.size;

  const currentIds = new Set(input.currentScene.map((element) => (element as { id: string }).id));
  const selectionSet = new Set(input.selection);
  const outsideSelection =
    selectionSet.size > 0 &&
    [...touchedIds].some((id) => currentIds.has(id) && !selectionSet.has(id));

  const reasons: ApprovalThresholdReason[] = [];
  if (removalCount > 0) reasons.push('removal');
  if (touchedElementCount > 50) reasons.push('element_count');
  if (outsideSelection) reasons.push('outside_selection');

  return { requiresExplicitApproval: reasons.length > 0, reasons, touchedElementCount };
}

export interface AttachPreviewResult {
  run: AiRunRow;
  preview: PreviewSummary;
  requiresExplicitApproval: boolean;
  reasons: ApprovalThresholdReason[];
  touchedElementCount: number;
}

/**
 * Advances a `previewing` run to `awaiting_approval` (T54's half of the
 * T53→T55 pipeline): loads the CURRENT scene fresh (read-only —
 * `loadDiagramScene` folds `diagram_operations`, it writes nothing),
 * computes the preview summary and approval threshold against it, persists
 * the new status, and records `requiresExplicitApproval` back onto the
 * `RunStore` entry for T55's `:approve` to read. Returns `null` when the
 * run has no pending patch in `runStore` (e.g. T53 already failed it) — the
 * caller (routes.ts) leaves such a run's response untouched.
 */
export async function attachPreview(
  db: Db,
  runStore: RunStore,
  run: AiRunRow,
): Promise<AttachPreviewResult | null> {
  const entry = runStore.get(run.id);
  if (!entry) return null;

  const { scene } = await loadDiagramScene(db, run.diagramId);
  const preview = buildPreviewSummary(scene, entry.patch);
  const threshold = computeApprovalThreshold({
    patch: entry.patch,
    currentScene: scene,
    selection: entry.selection,
  });

  const updated = await updateAiRunStatus(db, run.id, 'awaiting_approval');
  runStore.update(run.id, { requiresExplicitApproval: threshold.requiresExplicitApproval });

  return {
    run: updated,
    preview,
    requiresExplicitApproval: threshold.requiresExplicitApproval,
    reasons: threshold.reasons,
    touchedElementCount: threshold.touchedElementCount,
  };
}
