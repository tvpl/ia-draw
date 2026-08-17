import type { LibraryItem } from '@arch-canvas/library-content';
import { convertToExcalidrawElements, Excalidraw } from '@excalidraw/excalidraw';
import { forwardRef, type JSX, useImperativeHandle, useRef } from 'react';
import { applyRemote } from './applyRemote.js';
import { buildSceneIndex, computeDiff } from './computeDiff.js';
import type { ElementDelta, SceneElement } from './types.js';

/** Half-width/height of the inline-icon image element inserted by `insertLibraryItem` (CLIB-03). */
const ICON_SIZE = 80;
/** Width/height of the fallback rectangle inserted for `icon.kind === 'external'` items (CLIB-04). */
const FALLBACK_RECT_WIDTH = 140;
const FALLBACK_RECT_HEIGHT = 70;

/** Base64-encodes a UTF-8 string for a `data:` URL — `btoa` alone mangles non-Latin1 characters (item SVGs are hand-authored ASCII today, but this stays correct if that ever changes). */
function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface EditorSurfaceProps {
  /** Elements to seed the canvas with (e.g. the bootstrapped scene, EDT-01). */
  initialElements?: readonly SceneElement[];
  /** Called with the structured deltas (`ElementDelta[]`) since the last change, whenever the canvas mutates. */
  onDeltas?: (deltas: ElementDelta[]) => void;
  /** Called with the ids of the currently-selected elements on every canvas change, including selection-only changes that produce no element delta. */
  onSelectionChange?: (ids: string[]) => void;
  /**
   * Called with the local pointer position in SCENE coordinates whenever it moves
   * over the canvas (LIVE-09). Wired to Excalidraw's own `onPointerUpdate`, which
   * already reports scene coordinates — the caller must never do its own
   * client-to-scene conversion, since scroll and zoom live inside this component.
   */
  onPointerMove?: (pointer: { x: number; y: number }) => void;
}

/**
 * The slice of Excalidraw's own `Collaborator` type this project actually
 * populates (LIVE-13/14). Declared structurally here, for the same reason
 * `SceneElement` is derived structurally in `types.ts` rather than imported:
 * naming the upstream type would require an internal-subpath import
 * (`@excalidraw/excalidraw/types`), which `no-internal-import.spec.ts`
 * forbids (EDT-07/AD-008). `updateScene({collaborators})` itself is public API.
 */
export interface RemoteCollaborator {
  /** Excalidraw renders both the cursor and the `username` label at this point. `tool` is required upstream; this project only ever sends `'pointer'` (laser is out of scope). */
  pointer?: { x: number; y: number; tool: 'pointer' };
  selectedElementIds?: Record<string, true>;
  username?: string;
  color?: { background: string; stroke: string };
  id?: string;
}

/**
 * The imperative handle exposed via `ref` (AD-010) — the only way a caller
 * (e.g. `AiDock`'s approve/undo flow) reflects a remote scene onto the
 * canvas without discarding whatever the user is mid-edit on locally.
 */
export interface EditorSurfaceHandle {
  /** Fuses `remote` with the current local scene via `applyRemote` (LWW per element, AD-001) and pushes the result to Excalidraw's own `updateScene`. */
  applyRemoteScene: (remote: readonly SceneElement[]) => void;
  /**
   * Inserts a library item into the canvas as a real, editable element (CLIB-03/04, design.md
   * "Approach A"), centered on the current visible viewport. `icon.kind === 'inline'` registers
   * the item's SVG as a binary file (`addFiles`) and inserts an `image` element referencing it,
   * plus a separate (grouped, not container-bound — images don't support bound text) text
   * element carrying `item.name`. `icon.kind === 'external'` never touches `icon.sourceUrl` —
   * it inserts the same rectangle+bound-label fallback `compile()` produces for every item
   * today (spec.md Assumptions: no client-side fetch of external icon artwork, ever).
   */
  insertLibraryItem: (item: LibraryItem) => void;
  /**
   * Pushes the current set of remote collaborators to Excalidraw's own
   * cursor/selection rendering (`updateScene({collaborators})`, LIVE-13/14).
   * Imperative rather than a reactive prop on purpose: a prop would re-render
   * `<Excalidraw/>` on every remote cursor move, and this is the same handle
   * AD-010 already established for remote-origin canvas updates. `elements` is
   * deliberately omitted — this call never touches scene content.
   */
  applyCollaborators: (collaborators: ReadonlyMap<string, RemoteCollaborator>) => void;
}

/**
 * The minimal structural slice of Excalidraw's `ExcalidrawImperativeAPI` this
 * component actually calls. Named locally instead of importing the real
 * (internal-subpath-only) type, for the same reason `SceneElement` et al. are
 * derived structurally in `types.ts` rather than imported from a subpath.
 */
interface ExcalidrawViewportAppState {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  zoom: { value: number };
}

interface ExcalidrawBinaryFile {
  id: string;
  dataURL: string;
  mimeType: string;
  created: number;
}

interface ExcalidrawSceneApi {
  updateScene: (sceneData: {
    elements?: readonly SceneElement[];
    collaborators?: ReadonlyMap<string, RemoteCollaborator>;
  }) => void;
  getAppState: () => ExcalidrawViewportAppState;
  addFiles: (files: ExcalidrawBinaryFile[]) => void;
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
    { initialElements = [], onDeltas, onSelectionChange, onPointerMove }: EditorSurfaceProps,
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
      applyCollaborators(collaborators: ReadonlyMap<string, RemoteCollaborator>) {
        apiRef.current?.updateScene({ collaborators });
      },
      insertLibraryItem(item: LibraryItem) {
        const api = apiRef.current;
        if (!api) return;

        // Center of the visible viewport in scene coordinates — same formula as the
        // real (unmocked-in-tests) `viewportCoordsToSceneCoords` uses internally for a
        // client point at the middle of the container: sceneX = clientX/zoom - scrollX,
        // with clientX - offsetLeft = width/2 at the container's own center.
        const appState = api.getAppState();
        const zoomValue = appState.zoom.value;
        const centerX = appState.width / (2 * zoomValue) - appState.scrollX;
        const centerY = appState.height / (2 * zoomValue) - appState.scrollY;

        // Bridges plain skeleton objects into Excalidraw's branded `ExcalidrawElementSkeleton`
        // union without an internal subpath import — same rationale as `initialData`/`onChange`.
        // biome-ignore lint/suspicious/noExplicitAny: see comment above
        let skeleton: any[];

        if (item.icon.kind === 'inline') {
          const fileId = `library-${item.stableKey}-${crypto.randomUUID()}`;
          const groupId = crypto.randomUUID();
          api.addFiles([
            {
              id: fileId,
              dataURL: `data:image/svg+xml;base64,${utf8ToBase64(item.icon.svg)}`,
              mimeType: 'image/svg+xml',
              created: Date.now(),
            },
          ]);
          skeleton = [
            {
              type: 'image',
              fileId,
              x: centerX - ICON_SIZE / 2,
              y: centerY - ICON_SIZE / 2,
              width: ICON_SIZE,
              height: ICON_SIZE,
              groupIds: [groupId],
            },
            {
              type: 'text',
              text: item.name,
              x: centerX - ICON_SIZE / 2,
              y: centerY + ICON_SIZE / 2 + 4,
              groupIds: [groupId],
            },
          ];
        } else {
          // CLIB-04: `icon.kind === 'external'` never fetches `icon.sourceUrl` — same
          // rectangle + bound-label fallback `compile()` already produces server-side.
          skeleton = [
            {
              type: 'rectangle',
              x: centerX - FALLBACK_RECT_WIDTH / 2,
              y: centerY - FALLBACK_RECT_HEIGHT / 2,
              width: FALLBACK_RECT_WIDTH,
              height: FALLBACK_RECT_HEIGHT,
              backgroundColor: item.color,
              label: { text: item.name },
            },
          ];
        }

        const inserted = convertToExcalidrawElements(
          skeleton,
        ) as unknown as readonly SceneElement[];
        const local = Array.from(previousSceneRef.current.values());
        api.updateScene({ elements: [...local, ...inserted] });
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
        // LIVE-09: `pointer` is already in scene coordinates — this is the same
        // hook Excalidraw's own collaboration integration uses, so no
        // client-to-scene conversion is duplicated here or in any caller.
        onPointerUpdate={(payload: { pointer: { x: number; y: number } }) => {
          onPointerMove?.({ x: payload.pointer.x, y: payload.pointer.y });
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
