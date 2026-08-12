import type { ElementDelta, SceneElement, SceneIndex } from './types.js';

/** Builds a `SceneIndex` from a full element array — helper for callers and tests. */
export function buildSceneIndex(elements: readonly SceneElement[]): SceneIndex {
  return new Map(elements.map((element) => [element.id, element]));
}

/**
 * Computes what changed between a previously known scene (`prev`, indexed by id) and a
 * fresh element array from the editor (`next`), comparing `version`/`versionNonce` per
 * element id — the same identity Excalidraw's own `reconcileElements` uses (AD-001).
 *
 * Only actual changes are returned:
 * - a new element (absent from `prev`) → `upsert`
 * - a changed element (`version` or `versionNonce` differs) → `upsert`
 * - an element removed from `next`, or flipped to `isDeleted: true` → `delete`
 * - an element present in both with identical `version`/`versionNonce` → no delta (no-op)
 */
export function computeDiff(prev: SceneIndex, next: readonly SceneElement[]): ElementDelta[] {
  const deltas: ElementDelta[] = [];
  const seen = new Set<string>();

  for (const element of next) {
    seen.add(element.id);
    const prior = prev.get(element.id);

    if (element.isDeleted) {
      if (prior && !prior.isDeleted) {
        deltas.push({
          elementId: element.id,
          kind: 'delete',
          version: element.version,
          versionNonce: element.versionNonce,
        });
      }
      continue;
    }

    if (!prior) {
      deltas.push({
        elementId: element.id,
        kind: 'upsert',
        element,
        version: element.version,
        versionNonce: element.versionNonce,
      });
      continue;
    }

    if (prior.version !== element.version || prior.versionNonce !== element.versionNonce) {
      deltas.push({
        elementId: element.id,
        kind: 'upsert',
        element,
        version: element.version,
        versionNonce: element.versionNonce,
      });
    }
  }

  for (const [id, prior] of prev) {
    if (!seen.has(id) && !prior.isDeleted) {
      deltas.push({
        elementId: id,
        kind: 'delete',
        version: prior.version,
        versionNonce: prior.versionNonce,
      });
    }
  }

  return deltas;
}
