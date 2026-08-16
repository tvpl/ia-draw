import { Excalidraw } from '@excalidraw/excalidraw';
import { forwardRef, type JSX, useImperativeHandle, useRef } from 'react';
import { applyRemote } from './applyRemote.js';
import { buildSceneIndex, computeDiff } from './computeDiff.js';
import type { ElementDelta, SceneElement } from './types.js';

export interface EditorSurfaceProps {
  /** Elements to seed the canvas with (e.g. the bootstrapped scene, EDT-01). */
  initialElements?: readonly SceneElement[];
  /** Called with the structured deltas (`ElementDelta[]`) since the last change, whenever the canvas mutates. */
  onDeltas?: (deltas: ElementDelta[]) => void;
  /** Called with the ids of the currently-selected elements on every canvas change, including selection-only changes that produce no element delta. */
  onSelectionChange?: (ids: string[]) => void;
}

/**
 * The imperative handle exposed via `ref` (AD-010) — the only way a caller
 * (e.g. `AiDock`'s approve/undo flow) reflects a remote scene onto the
 * canvas without discarding whatever the user is mid-edit on locally.
 */
export interface EditorSurfaceHandle {
  /** Fuses `remote` with the current local scene via `applyRemote` (LWW per element, AD-001) and pushes the result to Excalidraw's own `updateScene`. */
  applyRemoteScene: (remote: readonly SceneElement[]) => void;
}

/**
 * The minimal structural slice of Excalidraw's `ExcalidrawImperativeAPI` this
 * component actually calls. Named locally instead of importing the real
 * (internal-subpath-only) type, for the same reason `SceneElement` et al. are
 * derived structurally in `types.ts` rather than imported from a subpath.
 */
interface ExcalidrawSceneApi {
  updateScene: (sceneData: { elements: readonly SceneElement[] }) => void;
}

/**
 * The single component in this codebase that renders `<Excalidraw/>`
 * (EDT-07: Excalidraw is integrated exclusively through editor-adapter,
 * never an internal upstream path — this is the boundary design.md
 * describes). Wraps `onChange` to emit structured `ElementDelta[]` (via
 * `computeDiff`, the same diff this package already exposes) instead of
 * handing callers raw Excalidraw elements/appState.
 *
 * `initialData`/`onChange` element arrays are cast, not re-typed, for the
 * same reason `applyRemote.ts` casts into `reconcileElements`'s branded
 * parameter types: `SceneElement` is structurally compatible but not
 * nominally identical to Excalidraw's internal branded element types, and
 * this package deliberately never imports an internal `@excalidraw/excalidraw/*`
 * subpath just to name that brand (see `types.ts`).
 *
 * Consumers must import `@excalidraw/excalidraw/index.css` once in their own
 * app entry point (not re-exported here) — this package's own source only
 * ever imports the bare "." specifier, enforced by `no-internal-import.spec.ts`.
 *
 * `forwardRef` here is backward compatible with every existing consumer that
 * renders `<EditorSurface .../>` without a `ref` — the imperative handle
 * (`EditorSurfaceHandle`) is purely additive, `initialElements`/`onDeltas`/
 * `onSelectionChange` behavior is unchanged.
 */
export const EditorSurface = forwardRef<EditorSurfaceHandle, EditorSurfaceProps>(
  function EditorSurface(
    { initialElements = [], onDeltas, onSelectionChange }: EditorSurfaceProps,
    ref,
  ): JSX.Element {
    const previousSceneRef = useRef(buildSceneIndex(initialElements));
    const apiRef = useRef<ExcalidrawSceneApi | null>(null);

    useImperativeHandle(ref, () => ({
      applyRemoteScene(remote: readonly SceneElement[]) {
        const local = Array.from(previousSceneRef.current.values());
        const merged = applyRemote(local, remote);
        apiRef.current?.updateScene({ elements: merged });
      },
    }));

    return (
      <Excalidraw
        // biome-ignore lint/suspicious/noExplicitAny: bridging SceneElement (this package's structural type) into Excalidraw's branded ExcalidrawInitialDataState without an internal subpath import — see the doc comment above.
        initialData={{ elements: initialElements as any }}
        // biome-ignore lint/suspicious/noExplicitAny: same bridging as initialData above — Excalidraw's own imperative API type is branded and only importable via an internal subpath.
        excalidrawAPI={(api: any) => {
          apiRef.current = api as ExcalidrawSceneApi;
        }}
        // biome-ignore lint/suspicious/noExplicitAny: same bridging as initialData above — Excalidraw's own onChange element/appState types are branded and only importable via an internal subpath.
        onChange={(elements: any, appState: any) => {
          const next = elements as unknown as readonly SceneElement[];
          const deltas = computeDiff(previousSceneRef.current, next);
          if (deltas.length > 0) {
            previousSceneRef.current = buildSceneIndex(next);
            onDeltas?.(deltas);
          }
          // DOCK-03: selection propagates on every change, including selection-only
          // changes that produce no element delta (the `if` above gates `onDeltas`,
          // never this call).
          const selectedElementIds = (appState?.selectedElementIds ?? {}) as Record<
            string,
            boolean
          >;
          onSelectionChange?.(
            Object.keys(selectedElementIds).filter((id) => selectedElementIds[id]),
          );
        }}
      />
    );
  },
);
