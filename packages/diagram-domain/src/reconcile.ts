import type { ElementDelta, SceneElement, SceneIndex } from '@arch-canvas/editor-adapter';
import { buildSceneIndex, mergeScene } from './mergeScene.js';

export interface ReconcileOperationResult {
  scene: SceneIndex;
  /** The subset of `deltas` that actually fed the reconcile (excludes true no-ops, e.g. deleting an element the server never had). */
  applied: ElementDelta[];
}

/**
 * Applies `deltas` to the server's authoritative `currentScene`, using
 * `mergeScene`'s local LWW tie-break (see mergeScene.ts's SPEC_DEVIATION
 * docstring for why this package cannot import editor-adapter's `applyRemote`
 * at runtime — the semantics are identical, only the import path changed).
 *
 * `deltas` don't carry a full element payload for `kind: 'delete'` (see
 * editor-adapter's `computeDiff`), so a delete is turned into a tombstone by
 * merging the delta's `version`/`versionNonce` onto the currently known
 * element for that id. A delete for an id the server has never seen is a
 * true no-op and is dropped from `applied`.
 */
export function reconcileOperation(
  currentScene: SceneIndex,
  deltas: readonly ElementDelta[],
): ReconcileOperationResult {
  const localElements = Array.from(currentScene.values());
  const remoteElements: SceneElement[] = [];
  const applied: ElementDelta[] = [];

  for (const delta of deltas) {
    if (delta.kind === 'upsert') {
      if (!delta.element) continue;
      remoteElements.push(delta.element);
      applied.push(delta);
      continue;
    }

    const existing = currentScene.get(delta.elementId);
    if (!existing) continue;
    remoteElements.push({
      ...existing,
      isDeleted: true,
      version: delta.version,
      versionNonce: delta.versionNonce,
    });
    applied.push(delta);
  }

  const reconciled = mergeScene(localElements, remoteElements);
  return { scene: buildSceneIndex(reconciled), applied };
}
