import type { PersistableAppState, SceneElement } from '@arch-canvas/editor-adapter';

export interface ExportedScene {
  elements: readonly SceneElement[];
  appState: PersistableAppState;
}

const SCENE_FORMAT = 'architecture-canvas/scene';
const SCENE_FORMAT_VERSION = 1;

/**
 * SPEC_DEVIATION: T32's "Reuses" field names editor-adapter's `serializeScene`/
 * `parseScene` for `.excalidraw` export/import. Importing anything from the
 * `@arch-canvas/editor-adapter` package at runtime is blocked by a real packaging gap,
 * confirmed by reproduction (not assumed): the package's `index.ts` re-exports
 * `<EditorSurface/>` alongside `serializeScene`, and ES module imports evaluate a
 * package's ENTIRE module graph eagerly — so importing even just `serializeScene` from
 * `'@arch-canvas/editor-adapter'` also loads `EditorSurface.tsx`, which statically
 * imports `@excalidraw/excalidraw`. Under plain Node (not a bundler, not Vitest — see
 * below) that throws:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../roughjs/bin/rough' imported
 *   from '.../@excalidraw/excalidraw/dist/prod/index.js'
 *   Did you mean to import "roughjs/bin/rough.js"?
 *
 * `@excalidraw/excalidraw`'s own compiled ESM output imports `roughjs/bin/rough`
 * without the required `.js` extension — Node's ESM resolver (unlike a bundler's, or
 * CommonJS `require`'s) does not add it. This is the same family of real, verified
 * upstream-packaging gap `render/dom-environment.ts` and `render/svg.ts` already
 * document for `@excalidraw/utils` — it is why `apps/server`'s production entrypoint
 * (`node dist/index.js`) must never statically import `@arch-canvas/editor-adapter` at
 * runtime, only its exported *types* (zero runtime cost, used throughout this server —
 * see e.g. `snapshot/scene.ts`).
 *
 * There is no subpath around this: editor-adapter's `package.json#exports` declares
 * only the bare `"."` entry (see editor-adapter's own `types.ts` for the same
 * constraint from the other direction), and this batch's task boundary keeps
 * `packages/editor-adapter` out of scope for T32/T33 (export module only).
 *
 * This file re-implements the same tiny, pure (de)serialization contract locally —
 * intentionally byte-for-byte compatible with editor-adapter's own envelope (same
 * `type`/`version` tag, same "pass unknown fields through" guarantee) so a file this
 * module produces round-trips through editor-adapter's `parseScene` too, and a file
 * editor-adapter produces round-trips through this module's `parseScene`.
 */
export function serializeScene(
  elements: readonly SceneElement[],
  appState: PersistableAppState,
): string {
  return JSON.stringify({
    type: SCENE_FORMAT,
    version: SCENE_FORMAT_VERSION,
    elements,
    appState,
  });
}

/** Inverse of `serializeScene`, with the same pass-through guarantee. */
export function parseScene(json: string): ExportedScene {
  const parsed = JSON.parse(json) as {
    type?: unknown;
    elements: readonly SceneElement[];
    appState: PersistableAppState;
  };
  if (parsed.type !== SCENE_FORMAT) {
    throw new Error(
      `not a valid ${SCENE_FORMAT} file (found type: ${JSON.stringify(parsed.type)})`,
    );
  }
  return { elements: parsed.elements, appState: parsed.appState };
}
