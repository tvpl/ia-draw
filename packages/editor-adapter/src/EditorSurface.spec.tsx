import type { LibraryItem } from '@arch-canvas/library-content';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { act, createRef, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EditorSurface,
  type EditorSurfaceHandle,
  type EditorSurfaceProps,
  type RemoteCollaborator,
} from './EditorSurface.js';
import type { SceneElement } from './types.js';

// The real `<Excalidraw/>` renders a full interactive canvas (ResizeObserver, real
// DOM measurement, etc.) that jsdom doesn't support and no test in this codebase
// attempts to mount — see `apps/web/src/a11y/shell.a11y.spec.tsx`'s header comment.
// Only the `Excalidraw` export is replaced here; every other export
// (`reconcileElements`, `restoreElements`, `convertToExcalidrawElements`, ...) stays
// real, since `applyRemote.ts` and `EditorSurface.tsx` itself both call into them.
let capturedOnChange: ((elements: unknown, appState: unknown) => void) | undefined;
let capturedOnPointerUpdate: ((payload: { pointer: { x: number; y: number } }) => void) | undefined;
/** What `<Excalidraw/>` actually received for `viewModeEnabled` on its last render (SHR-18). */
let capturedViewModeEnabled: boolean | undefined;
let updateSceneSpy: ReturnType<typeof vi.fn>;
let addFilesSpy: ReturnType<typeof vi.fn>;
let getAppStateMock: ReturnType<typeof vi.fn>;

const DEFAULT_MOCK_APP_STATE = {
  scrollX: 0,
  scrollY: 0,
  width: 800,
  height: 600,
  zoom: { value: 1 },
};

vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return {
    ...actual,
    Excalidraw: (props: {
      onChange?: (elements: unknown, appState: unknown) => void;
      onPointerUpdate?: (payload: { pointer: { x: number; y: number } }) => void;
      viewModeEnabled?: boolean;
      excalidrawAPI?: (api: {
        updateScene: typeof updateSceneSpy;
        getAppState: typeof getAppStateMock;
        addFiles: typeof addFilesSpy;
      }) => void;
    }) => {
      capturedOnChange = props.onChange;
      capturedOnPointerUpdate = props.onPointerUpdate;
      capturedViewModeEnabled = props.viewModeEnabled;
      // Mirrors what the real Excalidraw does on mount: hands the caller its imperative API.
      props.excalidrawAPI?.({
        updateScene: updateSceneSpy,
        getAppState: getAppStateMock,
        addFiles: addFilesSpy,
      });
      return null;
    },
  };
});

function firstOf(elements: readonly SceneElement[]): SceneElement {
  const [first] = elements;
  if (!first) throw new Error('fixture must have at least one element');
  return first;
}

const base = firstOf(allFixtures.text as readonly SceneElement[]);

describe('EditorSurface (T94, DOCK-03)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    capturedOnChange = undefined;
    capturedOnPointerUpdate = undefined;
    capturedViewModeEnabled = undefined;
    updateSceneSpy = vi.fn();
    addFilesSpy = vi.fn();
    getAppStateMock = vi.fn(() => DEFAULT_MOCK_APP_STATE);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  function mount(props: EditorSurfaceProps, ref?: Ref<EditorSurfaceHandle>) {
    root = createRoot(container);
    act(() => {
      root.render(<EditorSurface ref={ref} {...props} />);
    });
  }

  it('calls onSelectionChange with the ids whose selectedElementIds[id] is truthy, on every onChange firing', () => {
    const onSelectionChange = vi.fn();
    mount({ onSelectionChange });

    act(() => {
      capturedOnChange?.([], {
        selectedElementIds: { 'el-1': true, 'el-2': false, 'el-3': true },
      });
    });

    expect(onSelectionChange).toHaveBeenCalledWith(['el-1', 'el-3']);
  });

  it('calls onSelectionChange with an empty array when nothing is selected', () => {
    const onSelectionChange = vi.fn();
    mount({ onSelectionChange });

    act(() => {
      capturedOnChange?.([], { selectedElementIds: {} });
    });

    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('propagates selection even when the change carries no element delta (selection-only change)', () => {
    const onDeltas = vi.fn();
    const onSelectionChange = vi.fn();
    const unchanged: SceneElement = { ...base, version: 1, versionNonce: 1 };
    mount({ initialElements: [unchanged], onDeltas, onSelectionChange });

    act(() => {
      // Same version/versionNonce as initialElements -> computeDiff produces no delta.
      capturedOnChange?.([unchanged], { selectedElementIds: { [unchanged.id]: true } });
    });

    expect(onDeltas).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith([unchanged.id]);
  });

  it('regression: onDeltas still fires with the correct upsert delta when an element changes', () => {
    const onDeltas = vi.fn();
    const original: SceneElement = { ...base, version: 1, versionNonce: 1 };
    const changed: SceneElement = { ...base, version: 2, versionNonce: 2 };
    mount({ initialElements: [original], onDeltas });

    act(() => {
      capturedOnChange?.([changed], { selectedElementIds: {} });
    });

    expect(onDeltas).toHaveBeenCalledWith([
      expect.objectContaining({ elementId: changed.id, kind: 'upsert', version: 2 }),
    ]);
  });

  it('applyRemoteScene (AD-010) merges the CURRENT local scene with a remote scene via LWW and pushes the result to updateScene', () => {
    const localElement: SceneElement = { ...base, id: 'el-conflict', version: 1, versionNonce: 1 };
    const ref = createRef<EditorSurfaceHandle>();
    mount({ initialElements: [localElement] }, ref);

    // A local edit after mount, strictly ahead of what the remote will carry below —
    // proves applyRemoteScene reads the CURRENT local scene (post-mount), not a stale
    // snapshot of `initialElements`.
    const locallyEdited: SceneElement = { ...localElement, version: 3, versionNonce: 999 };
    act(() => {
      capturedOnChange?.([locallyEdited], { selectedElementIds: {} });
    });

    const remoteConflicting: SceneElement = { ...localElement, version: 2, versionNonce: 1 };
    const remoteAdded: SceneElement = {
      ...base,
      id: 'el-remote-added',
      version: 1,
      versionNonce: 1,
    };

    act(() => {
      ref.current?.applyRemoteScene([remoteConflicting, remoteAdded]);
    });

    expect(updateSceneSpy).toHaveBeenCalledTimes(1);
    const [sceneData] = updateSceneSpy.mock.calls[0] as [{ elements: SceneElement[] }];
    const byId = new Map(sceneData.elements.map((element) => [element.id, element]));

    // Local wins the conflict: strictly newer version (3 > 2), LWW/AD-001.
    expect(byId.get('el-conflict')).toMatchObject({ version: 3, versionNonce: 999 });
    // A remote-only element is still present in the merged result (reconcileElements
    // normalizes its own version/versionNonce on merge, so only presence is asserted —
    // same convention as applyRemote.spec.ts's "local-only element" case).
    expect(byId.has('el-remote-added')).toBe(true);
  });

  it('applyCollaborators hands Excalidraw the exact collaborator map, entry by entry (LIVE-13, LIVE-14)', () => {
    const ref = createRef<EditorSurfaceHandle>();
    mount({ initialElements: [base] }, ref);

    const collaborators = new Map<string, RemoteCollaborator>([
      [
        'user-a',
        {
          id: 'user-a',
          username: 'Ana',
          pointer: { x: 12, y: 34, tool: 'pointer' },
          selectedElementIds: { 'el-7': true },
          color: { background: '#ff0000', stroke: '#aa0000' },
        },
      ],
      ['user-b', { id: 'user-b', username: 'Bruno', pointer: { x: 1, y: 2, tool: 'pointer' } }],
    ]);

    act(() => {
      ref.current?.applyCollaborators(collaborators);
    });

    expect(updateSceneSpy).toHaveBeenCalledTimes(1);
    const [sceneData] = updateSceneSpy.mock.calls[0] as [
      { collaborators: Map<string, RemoteCollaborator> },
    ];
    expect([...sceneData.collaborators.keys()]).toEqual(['user-a', 'user-b']);
    expect(sceneData.collaborators.get('user-a')).toEqual({
      id: 'user-a',
      username: 'Ana',
      pointer: { x: 12, y: 34, tool: 'pointer' },
      selectedElementIds: { 'el-7': true },
      color: { background: '#ff0000', stroke: '#aa0000' },
    });
    expect(sceneData.collaborators.get('user-b')?.username).toBe('Bruno');
  });

  it('applyCollaborators with an empty map clears the collaborators without touching elements (LIVE-23)', () => {
    const ref = createRef<EditorSurfaceHandle>();
    mount({ initialElements: [base] }, ref);

    act(() => {
      ref.current?.applyCollaborators(new Map());
    });

    const [sceneData] = updateSceneSpy.mock.calls[0] as [
      { collaborators: Map<string, RemoteCollaborator>; elements?: unknown },
    ];
    expect(sceneData.collaborators.size).toBe(0);
    expect(sceneData.elements).toBeUndefined();
  });

  it('forwards the scene-coordinate pointer from onPointerUpdate to onPointerMove (LIVE-09)', () => {
    const onPointerMove = vi.fn();
    mount({ onPointerMove });

    act(() => {
      capturedOnPointerUpdate?.({ pointer: { x: 42.5, y: -13 } });
    });

    expect(onPointerMove).toHaveBeenCalledWith({ x: 42.5, y: -13 });
  });

  const INLINE_ITEM: LibraryItem = {
    stableKey: 'generic.compute.server',
    name: 'Server',
    category: 'compute',
    aliases: ['host'],
    description: 'Generic compute host.',
    tags: ['compute'],
    color: '#4B5563',
    icon: {
      kind: 'inline',
      svg: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="6"/></svg>',
    },
    version: '1.0.0',
    license: 'CC0-1.0',
    attribution: 'Architecture Canvas project',
  };

  const EXTERNAL_ITEM: LibraryItem = {
    stableKey: 'aws.ec2',
    name: 'Amazon EC2',
    category: 'compute',
    aliases: ['ec2'],
    description: 'Amazon Elastic Compute Cloud.',
    tags: ['aws'],
    color: '#ED7100',
    icon: {
      kind: 'external',
      sourceUrl: 'https://aws.amazon.com/architecture/icons/',
      note: 'license note',
    },
    version: '2026.1',
    license: 'CC-BY-ND-2.0',
    attribution: '© Amazon Web Services, Inc.',
  };

  describe('insertLibraryItem (CLIB-03/04)', () => {
    it('icon.kind "inline": registers the SVG via addFiles and inserts an image element + a text element carrying item.name, centered on the viewport', () => {
      const ref = createRef<EditorSurfaceHandle>();
      mount({}, ref);

      act(() => {
        ref.current?.insertLibraryItem(INLINE_ITEM);
      });

      // Viewport center at scrollX/scrollY=0, width=800, height=600, zoom=1 -> (400, 300).
      expect(addFilesSpy).toHaveBeenCalledTimes(1);
      const [[files]] = addFilesSpy.mock.calls as [
        [{ id: string; dataURL: string; mimeType: string }[]],
      ];
      const [file] = files as [{ id: string; dataURL: string; mimeType: string }];
      expect(file.mimeType).toBe('image/svg+xml');
      expect(file.dataURL.startsWith('data:image/svg+xml;base64,')).toBe(true);

      expect(updateSceneSpy).toHaveBeenCalledTimes(1);
      const [sceneData] = updateSceneSpy.mock.calls[0] as [{ elements: SceneElement[] }];
      const imageElement = sceneData.elements.find(
        (el) => (el as unknown as { type: string }).type === 'image',
      ) as unknown as { fileId: string; x: number; y: number; width: number; height: number };
      const textElement = sceneData.elements.find(
        (el) => (el as unknown as { type: string }).type === 'text',
      ) as unknown as { text: string };

      expect(imageElement).toBeDefined();
      expect(imageElement.fileId).toBe(file.id);
      expect(textElement).toBeDefined();
      expect(textElement.text).toBe('Server');

      // Centered on the viewport (400, 300): the image's own center matches it exactly.
      expect(imageElement.x + imageElement.width / 2).toBe(400);
      expect(imageElement.y + imageElement.height / 2).toBe(300);
    });

    it('icon.kind "inline": never calls fetch — the SVG is embedded locally, no network request', () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const ref = createRef<EditorSurfaceHandle>();
      mount({}, ref);

      act(() => {
        ref.current?.insertLibraryItem(INLINE_ITEM);
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('icon.kind "external": never calls addFiles/fetch — inserts the rectangle+label fallback instead, centered on the viewport', () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const ref = createRef<EditorSurfaceHandle>();
      mount({}, ref);

      act(() => {
        ref.current?.insertLibraryItem(EXTERNAL_ITEM);
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(addFilesSpy).not.toHaveBeenCalled();

      expect(updateSceneSpy).toHaveBeenCalledTimes(1);
      const [sceneData] = updateSceneSpy.mock.calls[0] as [{ elements: SceneElement[] }];
      const rectangleElement = sceneData.elements.find(
        (el) => (el as unknown as { type: string }).type === 'rectangle',
      ) as unknown as {
        x: number;
        y: number;
        width: number;
        height: number;
        backgroundColor: string;
      };
      const textElement = sceneData.elements.find(
        (el) => (el as unknown as { type: string }).type === 'text',
      ) as unknown as { text: string };

      expect(rectangleElement).toBeDefined();
      expect(rectangleElement.backgroundColor).toBe('#ED7100');
      expect(textElement).toBeDefined();
      expect(textElement.text).toBe('Amazon EC2');
      expect(rectangleElement.x + rectangleElement.width / 2).toBe(400);
      expect(rectangleElement.y + rectangleElement.height / 2).toBe(300);

      vi.unstubAllGlobals();
    });

    it('positions the inserted item at the viewport center computed from a non-zero scroll/zoom appState', () => {
      getAppStateMock = vi.fn(() => ({
        scrollX: -100,
        scrollY: -50,
        width: 800,
        height: 600,
        zoom: { value: 2 },
      }));
      const ref = createRef<EditorSurfaceHandle>();
      mount({}, ref);

      act(() => {
        ref.current?.insertLibraryItem(EXTERNAL_ITEM);
      });

      // sceneX = width/(2*zoom) - scrollX = 800/4 - (-100) = 300; sceneY = 600/4 - (-50) = 200.
      const [sceneData] = updateSceneSpy.mock.calls[0] as [{ elements: SceneElement[] }];
      const rectangleElement = sceneData.elements.find(
        (el) => (el as unknown as { type: string }).type === 'rectangle',
      ) as unknown as { x: number; y: number; width: number; height: number };
      expect(rectangleElement.x + rectangleElement.width / 2).toBe(300);
      expect(rectangleElement.y + rectangleElement.height / 2).toBe(200);
    });
  });

  describe('viewModeEnabled (T2, SHR-18)', () => {
    it('passes viewModeEnabled=true straight through to <Excalidraw/>', () => {
      mount({ viewModeEnabled: true });

      expect(capturedViewModeEnabled).toBe(true);
    });

    it('passes viewModeEnabled=false straight through to <Excalidraw/>', () => {
      mount({ viewModeEnabled: false });

      expect(capturedViewModeEnabled).toBe(false);
    });

    it("omitting the prop leaves Excalidraw's own default in place (undefined), so existing consumers are unchanged", () => {
      mount({});

      expect(capturedViewModeEnabled).toBeUndefined();
    });
  });
});
