import type { SceneElement, SceneIndex } from '@arch-canvas/editor-adapter';

/**
 * SPEC_DEVIATION: local, dependency-free reimplementation of the LWW tie-break
 * `packages/editor-adapter/src/applyRemote.ts` gets from the real upstream
 * `reconcileElements`, instead of importing `applyRemote` itself.
 *
 * Reason: `@arch-canvas/editor-adapter`'s package entry re-exports `applyRemote`,
 * whose module top-level does `import { reconcileElements } from '@excalidraw/excalidraw'`.
 * That's a real *value* import (not `import type`), so anything that imports the
 * editor-adapter package at runtime — even for an unrelated named export — forces
 * Node to load and evaluate that module first. `@excalidraw/excalidraw`'s published
 * bundle imports `roughjs/bin/rough` without a `.js` extension, which plain Node's
 * ESM resolver rejects outright (`ERR_MODULE_NOT_FOUND`) — it only resolves under a
 * bundler's lenient resolution (Vite, webpack), never under `node dist/index.js`.
 * Confirmed directly: `apps/server`'s production entrypoint crashes at boot the
 * moment anything on its import graph pulls in editor-adapter's `applyRemote`.
 *
 * This matches design.md's own stated boundary for this package ("sem dependência
 * ... do pacote Excalidraw") — diagram-domain is server-side domain logic and must
 * never depend on a browser-oriented rendering package at runtime. Only `import type`
 * is used from editor-adapter here (erased at compile time, zero runtime footprint) to
 * keep a single source of truth for the element shape without re-coupling to its code.
 *
 * The tie-break rule below is copied verbatim from `applyRemote.ts`'s own docstring,
 * itself read directly from upstream's `shouldDiscardRemoteElement` — reproduced
 * exactly, not reinvented: when versions differ, the higher `version` wins outright;
 * at equal `version`, the LOWER `versionNonce` wins, on whichever side it is.
 */

export function buildSceneIndex(elements: readonly SceneElement[]): SceneIndex {
  return new Map(elements.map((element) => [element.id, element]));
}

function remoteWins(local: SceneElement, remote: SceneElement): boolean {
  if (remote.version !== local.version) return remote.version > local.version;
  return remote.versionNonce < local.versionNonce;
}

/** Merges `remote` elements onto `local` by id, applying the LWW tie-break per id. */
export function mergeScene(
  local: readonly SceneElement[],
  remote: readonly SceneElement[],
): SceneElement[] {
  const merged = new Map<string, SceneElement>(local.map((element) => [element.id, element]));

  for (const remoteElement of remote) {
    const localElement = merged.get(remoteElement.id);
    if (!localElement || remoteWins(localElement, remoteElement)) {
      merged.set(remoteElement.id, remoteElement);
    }
  }

  return Array.from(merged.values());
}
