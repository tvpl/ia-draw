import type { SceneElement } from '@arch-canvas/editor-adapter';
import { buildSceneIndex } from './mergeScene.js';

export interface StructuralDiffResult {
  added: string[];
  removed: string[];
  moved: string[];
  modified: string[];
}

/** Bookkeeping fields excluded from the content comparison — every edit bumps `version`/`versionNonce`/`updated` regardless of whether anything visible changed, and position is compared separately (see `moved` below). */
const IGNORED_FIELDS = new Set(['version', 'versionNonce', 'updated', 'x', 'y']);

function contentSignature(element: SceneElement): string {
  const record = element as unknown as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (!IGNORED_FIELDS.has(key)) filtered[key] = record[key];
  }
  return JSON.stringify(filtered);
}

/**
 * Structural diff between two scenes (VER-04), by element id. Categorizes
 * every id present (non-deleted, at some point) in either scene into
 * exactly one bucket:
 *
 * - `added`: present (non-deleted) in `to`, absent or deleted in `from`.
 * - `removed`: present (non-deleted) in `from`, absent or deleted in `to`.
 * - `moved`: present, non-deleted, in both — only `x`/`y` differ, every
 *   other content field is identical.
 * - `modified`: present, non-deleted, in both — any non-position content
 *   field differs (position may or may not also differ; `modified` takes
 *   precedence over `moved` when both are true, since "what changed"
 *   matters more than "did it also move"). This precedence rule is a
 *   documented interpretation — the spec (VER-04) lists the four
 *   categories but does not define how an element that is both moved and
 *   otherwise modified should be bucketed.
 *
 * An element unchanged between `from` and `to` (identical content and
 * position) appears in none of the four buckets.
 */
export function structuralDiff(
  from: readonly SceneElement[],
  to: readonly SceneElement[],
): StructuralDiffResult {
  const fromIndex = buildSceneIndex(from);
  const toIndex = buildSceneIndex(to);

  const added = new Set<string>();
  const removed = new Set<string>();
  const moved: string[] = [];
  const modified: string[] = [];

  const allIds = new Set([...fromIndex.keys(), ...toIndex.keys()]);

  for (const id of allIds) {
    const fromEl = fromIndex.get(id);
    const toEl = toIndex.get(id);
    const fromPresent = fromEl !== undefined && !fromEl.isDeleted;
    const toPresent = toEl !== undefined && !toEl.isDeleted;

    if (toPresent && !fromPresent) {
      added.add(id);
      continue;
    }
    if (!toPresent && fromPresent) {
      removed.add(id);
      continue;
    }
    if (!fromPresent || !toPresent || !fromEl || !toEl) continue; // both absent/deleted — no change

    const positionChanged = fromEl.x !== toEl.x || fromEl.y !== toEl.y;
    const contentChanged = contentSignature(fromEl) !== contentSignature(toEl);

    if (contentChanged) {
      modified.push(id);
    } else if (positionChanged) {
      moved.push(id);
    }
  }

  return { added: [...added], removed: [...removed], moved, modified };
}
