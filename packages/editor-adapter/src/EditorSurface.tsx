import type { LibraryItem } from '@arch-canvas/library-content';
import { convertToExcalidrawElements, Excalidraw } from '@excalidraw/excalidraw';
import { forwardRef, type JSX, useImperativeHandle, useMemo, useRef } from 'react';
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
  /**
   * Passed straight through to `<Excalidraw viewModeEnabled/>` (SHR-18): `true`
   * disables local editing entirely — no drawing, dragging or deleting on the
   * canvas. Omit it to keep Excalidraw's own default (editable), which is what
   * every consumer predating this prop gets.
   *
   * Only the USER's interaction is disabled. The programmatic paths
   * (`applyRemoteScene`, `insertLibraryItem`) still work; a caller that wants a
   * strictly read-only surface simply does not call them.
   */
  viewModeEnabled?: boolean;
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
  /**
   * Selects `elementId` and centers/zooms the viewport on it (ALNT-08/09/10) — the "jump to
   * element" action the lint panel (and any future consumer) drives through this single handle,
   * never a second path onto the canvas (AD-010/EDT-07). Looks the id up in the CURRENT local
   * scene (`previousSceneRef`, the same source `applyRemoteScene`/`insertLibraryItem` already
   * read); when the id isn't there (the element was deleted since the caller last saw the scene),
   * this is a no-op that returns `false` — it never throws and never touches `elements`, only
   * `appState.selectedElementIds` (selection) and the viewport (via `scrollToContent`).
   */
  focusElement: (elementId: string) => boolean;
  /**
   * presentation-mode/T2 (AD-010, PRZ-37): moves the viewport to fit the
   * elements belonging to one canvas frame, for the presenter mode's
   * frame-by-frame navigation. `elementId` is matched against the CURRENT
   * local scene by the same rule
   * `apps/server/src/modules/presentation/exportPdf.ts`'s `sceneForFrame`
   * uses server-side (kept in sync by cross-reference comment in both
   * files): every element whose `frameId` equals `elementId`, plus the
   * frame element itself. `elementId: null` (a purely logical frame with no
   * real canvas backing) is a true no-op — there is nothing to scroll to.
   * A real `elementId` that matches nothing in the current scene (its frame
   * was deleted since) falls back to fitting the WHOLE local scene — same
   * "show everything rather than an empty crop" heuristic the server
   * documents and `cropSceneForFrame.ts` already implements client-side, so
   * the presenter never gets stuck on a stale viewport pointed at nothing.
   */
  scrollToFrame: (elementId: string | null) => void;
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
    appState?: { selectedElementIds?: Record<string, true> };
  }) => void;
  getAppState: () => ExcalidrawViewportAppState;
  addFiles: (files: ExcalidrawBinaryFile[]) => void;
  /**
   * Real, public Excalidraw imperative-API method (`ExcalidrawImperativeAPI.
   * scrollToContent`), declared here structurally like every other method on
   * this interface (EDT-07/AD-008: no internal subpath import). Accepts a
   * single element (ALNT-08/09/10's `focusElement`) or an array
   * (presentation-mode/T2's `scrollToFrame`) — mirrors the real upstream
   * signature, which takes either. Optional — a mocked-in-test API that
   * omits it is a legitimate degrade, never a crash (both callers below use
   * it defensively).
   */
  scrollToContent?: (
    target: SceneElement | readonly SceneElement[],
    opts?: { fitToViewport?: boolean; animate?: boolean; duration?: number },
  ) => void;
}

/** Mirrors `apps/server/src/modules/presentation/exportPdf.ts`'s `sceneForFrame` —
 * keep the two in sync; this copy decides viewport only, never what gets exported. */
function elementsForFrame(
  scene: readonly SceneElement[],
  elementId: string,
): readonly SceneElement[] {
  return scene.filter((el) => el.frameId === elementId || el.id === elementId);
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
    {
      initialElements = [],
      onDeltas,
      onSelectionChange,
      onPointerMove,
      viewModeEnabled,
    }: EditorSurfaceProps,
    ref,
  ): JSX.Element {
    const previousSceneRef = useRef(buildSceneIndex(initialElements));
    // ESTB-01: the last selection already handed to `onSelectionChange`, as an
    // order-independent key. `null` means "nothing emitted yet", which is distinct
    // from the empty selection (`''`) — the first change always propagates, even
    // when nothing is selected.
    const emittedSelectionRef = useRef<string | null>(null);
    const apiRef = useRef<ExcalidrawSceneApi | null>(null);
    // ESTB-04: a fresh object literal per render is churn React has to diff for nothing.
    // Memoized on `initialElements` purely for referential stability across re-renders of
    // the SAME mount — this has no effect on what the real `<Excalidraw/>` renders, because
    // `initialData` is read once at mount and never again (upstream, not this package's
    // choice). A caller that needs a new initial scene after mount (e.g.
    // `SharedResourcePage.tsx` navigating between presentation frames, SRF-01/02) MUST force
    // an actual remount via a stable `key` — changing this prop alone is a no-op on an
    // already-mounted instance.
    const initialData = useMemo(
      // biome-ignore lint/suspicious/noExplicitAny: same bridging as the cast below — Excalidraw's ExcalidrawInitialDataState is branded and only importable via an internal subpath.
      () => ({ elements: initialElements as any }),
      [initialElements],
    );

    // ESTB-03: every method below reads `previousSceneRef`/`apiRef`, never a captured
    // prop, so the handle has nothing per-render to close over. An empty dependency list
    // stops React from tearing the ref down and re-attaching it on every render.
    useImperativeHandle(
      ref,
      () => ({
        applyRemoteScene(remote: readonly SceneElement[]) {
          const local = Array.from(previousSceneRef.current.values());
          const merged = applyRemote(local, remote);
          apiRef.current?.updateScene({ elements: merged });
        },
        applyCollaborators(collaborators: ReadonlyMap<string, RemoteCollaborator>) {
          apiRef.current?.updateScene({ collaborators });
        },
        focusElement(elementId: string): boolean {
          const api = apiRef.current;
          if (!api) return false;
          const element = previousSceneRef.current.get(elementId);
          // Excalidraw keeps deleted elements as tombstones in its own elements array — a
          // tombstone is exactly the "already removed from the scene" case this method must
          // treat as absent (spec.md's Assumptions: "não existe mais na cena").
          if (!element || (element as { isDeleted?: boolean }).isDeleted) return false;
          api.updateScene({ appState: { selectedElementIds: { [elementId]: true } } });
          api.scrollToContent?.(element, { animate: true });
          return true;
        },
        scrollToFrame(elementId: string | null) {
          if (!elementId) return;
          const local = Array.from(previousSceneRef.current.values());
          const target = elementsForFrame(local, elementId);
          apiRef.current?.scrollToContent?.(target.length > 0 ? target : local, {
            fitToViewport: true,
            animate: true,
          });
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
      }),
      [],
    );

    return (
      <Excalidraw
        viewModeEnabled={viewModeEnabled}
        initialData={initialData}
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
          // DOCK-03: selection propagates on every change of the SELECTION, including
          // selection-only changes that produce no element delta (the `if` above gates
          // `onDeltas`, never this call).
          //
          // ESTB-01/06: an unchanged selection is never re-emitted. Emitting a fresh
          // array on every `onChange` made a consumer that lifts it into state
          // (`DiagramEditorPage`) re-render, which re-rendered `<Excalidraw/>`, which
          // fired `onChange` again — the render loop that aborted the editor route with
          // React error #185.
          const selectedElementIds = (appState?.selectedElementIds ?? {}) as Record<
            string,
            boolean
          >;
          const selectedIds = Object.keys(selectedElementIds).filter(
            (id) => selectedElementIds[id],
          );
          // Compared sorted so a reordered `selectedElementIds` is not a change; emitted
          // unsorted so the order callers already receive is unchanged.
          const selectionKey = [...selectedIds].sort().join('\u0000');
          if (selectionKey !== emittedSelectionRef.current) {
            emittedSelectionRef.current = selectionKey;
            onSelectionChange?.(selectedIds);
          }
        }}
      />
    );
  },
);
