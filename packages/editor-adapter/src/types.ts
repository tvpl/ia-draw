import type { reconcileElements, restoreElements } from '@excalidraw/excalidraw';

/**
 * Every type below is derived structurally from the two public runtime exports this
 * package actually calls (`reconcileElements`, `restoreElements`) via `Parameters` /
 * `ReturnType`, instead of importing an internal type path such as
 * `@excalidraw/excalidraw/element/types`.
 *
 * This is a deliberate constraint, confirmed while building this spike: the package's
 * own `package.json#exports` map declares `"./*"` with only a `"types"` condition and
 * no runtime condition (`import`/`default`), so any subpath specifier type-checks but
 * fails to resolve at runtime in Node/Vitest. The bare `"."` entry is the only
 * specifier that resolves both at type-check time and at runtime, so it is the only
 * one this whole package ever imports — enforced by `no-internal-import.spec.ts`.
 */

/** A single element as produced by `restoreElements` — ordered, fully populated. */
export type SceneElement = ReturnType<typeof restoreElements>[number];

/** The exact `localAppState` shape `reconcileElements` takes as its 3rd argument. */
export type ReconcileAppState = Parameters<typeof reconcileElements>[2];

/**
 * Index of a previously known scene, keyed by element id. `computeDiff` compares a
 * fresh element array against this to produce only what changed.
 */
export type SceneIndex = ReadonlyMap<string, SceneElement>;

/**
 * Mirrors `packages/diagram-domain`'s `ElementDelta` shape (design.md "Data Models"):
 * `{ elementId, kind: 'upsert' | 'delete', element?, version, versionNonce }`. Only
 * elements that actually changed since the previous `SceneIndex` produce a delta — an
 * unchanged element (identical `version`/`versionNonce`) produces none.
 */
export interface ElementDelta {
  elementId: string;
  kind: 'upsert' | 'delete';
  element?: SceneElement;
  version: number;
  versionNonce: number;
}

/**
 * The subset of `AppState` that is part of the persisted document itself, not
 * interaction/session state. See `sanitizeAppState.ts` for the full field-by-field
 * rationale.
 */
export interface PersistableAppState {
  viewBackgroundColor: string;
  gridSize: number;
  gridStep: number;
  gridModeEnabled: boolean;
  zenModeEnabled: boolean;
  theme: ReconcileAppState['theme'];
  name: string | null;
}
