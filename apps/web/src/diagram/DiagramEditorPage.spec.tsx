import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider.js';
// Initializes the shared i18next singleton `useTranslation()` reads from. Default
// language is pt-BR (`DEFAULT_LANGUAGE`), so assertions below query the pt-BR strings
// ("Enviar", "Aprovar", ...) unless a test explicitly switches locale (T8/CLIB-18/SNAP-16).
import i18n from '../i18n/index.js';
import { collaboratorColor } from '../presence/collaboratorColor.js';
import { FakeSocket } from '../presence/fakeSocket.js';
import { DiagramEditorPage } from './DiagramEditorPage.js';

// The real `<Excalidraw/>` needs browser APIs jsdom doesn't implement — same mocking
// convention as `packages/editor-adapter/src/EditorSurface.spec.tsx`: only the
// `Excalidraw` export is replaced, everything else (`reconcileElements`, etc.) stays real
// since `applyRemote`/`EditorSurface` call into it.
let capturedOnChange: ((elements: unknown, appState: unknown) => void) | undefined;
let capturedOnPointerUpdate: ((payload: { pointer: { x: number; y: number } }) => void) | undefined;
let updateSceneSpy: ReturnType<typeof vi.fn>;
/** What `<Excalidraw/>` actually received for `viewModeEnabled` on its last render (SHR-22). */
let capturedViewModeEnabled: boolean | undefined;

vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return {
    ...actual,
    Excalidraw: (props: {
      onChange?: (elements: unknown, appState: unknown) => void;
      onPointerUpdate?: (payload: { pointer: { x: number; y: number } }) => void;
      viewModeEnabled?: boolean;
      excalidrawAPI?: (api: { updateScene: typeof updateSceneSpy }) => void;
    }) => {
      capturedOnChange = props.onChange;
      capturedOnPointerUpdate = props.onPointerUpdate;
      capturedViewModeEnabled = props.viewModeEnabled;
      props.excalidrawAPI?.({ updateScene: updateSceneSpy });
      return null;
    },
  };
});

function firstOf(elements: readonly SceneElement[]): SceneElement {
  const [first] = elements;
  if (!first) throw new Error('fixture must have at least one element');
  return first;
}

const baseElement = firstOf(allFixtures.text as readonly SceneElement[]);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// T8: `DiagramEditorPage` no longer makes its own `/me` call — it reads the
// actor id from `AuthProvider`'s context, so every render here is wrapped in
// a real `AuthProvider` (still fed by the same stubbed global `fetch`/`/me`
// response each test already sets up below).
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/d/diagram-1']}>
      <AuthProvider>
        <Routes>
          <Route path="/w/:workspaceId/d/:diagramId" element={<DiagramEditorPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('DiagramEditorPage (T9, integration)', () => {
  beforeEach(() => {
    capturedOnChange = undefined;
    capturedViewModeEnabled = undefined;
    updateSceneSpy = vi.fn();
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    // Restores the default locale in case a test switched it (T8/CLIB-18) and failed
    // before switching back, so later tests aren't left asserting the wrong strings.
    await i18n.changeLanguage('pt-BR');
  });

  /** Shared happy-path bootstrap + empty-library + empty-comments fetch, reused by every T8 test below that doesn't need a more specific mock. */
  function basicFetchImpl(): typeof fetch {
    return vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === `/diagrams/diagram-1/elements/${baseElement.id}/metadata`) {
        return Promise.resolve(jsonResponse(404, {}));
      }
      // CMT2 (diagram-comments): CommentsSidebar always mounts inside EditorSidePanel now,
      // so it always fetches the comment list on mount, same as the library panel.
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  it('the layout is a row with the canvas column and the side column as siblings (unchanged flex:1/minHeight:0 canvas sizing)', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      // T8: LibraryPanel always fetches its list on mount now that it's wired in —
      // every test's fetchImpl needs to answer this URL too, not just the DOCK-specific
      // ones each test already exercises.
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    const { container } = renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    const row = container.firstElementChild as HTMLElement;
    expect(row.style.flexDirection).toBe('row');
    expect(row.children).toHaveLength(2);
    // The canvas column is the row's first child, and keeps the documented flex:1/
    // minHeight:0 sizing (unstyled ancestors otherwise collapse Excalidraw to 0 height).
    const canvasColumn = row.children[0] as HTMLElement;
    // jsdom normalizes the `flex: 1` shorthand into its three longhands.
    expect(canvasColumn.style.flex).toBe('1 1 0%');
    expect(canvasColumn.style.minHeight).toBe('0px');
    // T8/CMT2: the row's second child is a sidebar column hosting the tabbed AI/Comments
    // side panel plus the LibraryPanel/MetadataPanel panels (each collapsible via
    // <details>) — AiDock (still a <details> element) lives inside the tabbed panel's "IA"
    // tabpanel instead of being this column's direct child.
    const sidebar = row.children[1] as HTMLElement;
    expect(sidebar.tagName).toBe('DIV');
    expect(sidebar.querySelector('[role="tablist"]')).not.toBeNull();
    expect(sidebar.querySelector('#side-panel-ai details')).not.toBeNull();
    expect(sidebar.querySelector('#side-panel-comments')).not.toBeNull();
    // T12 (share-links): the library/metadata panels are joined by a third direct
    // <details> sibling — the share-link panel, gated on the same `canMutate` this
    // test's bootstrap grants — alongside (not inside) the tabbed panel.
    expect(sidebar.querySelectorAll(':scope > details')).toHaveLength(3);
    // A fourth `<details>` overall: AiDock's own internal one, inside the tabbed panel.
    expect(sidebar.querySelectorAll('details')).toHaveLength(4);
  });

  it('full flow: bootstrap -> ai run -> approve -> applyRemoteScene fires only after the approve response resolves (DOCK-13)', async () => {
    const freshElement: SceneElement = {
      ...baseElement,
      id: 'el-fresh',
      version: 1,
      versionNonce: 1,
    };

    let bootstrapCalls = 0;
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        bootstrapCalls += 1;
        const scene = bootstrapCalls === 1 ? [baseElement] : [freshElement];
        return Promise.resolve(
          jsonResponse(200, {
            scene,
            revision: bootstrapCalls,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-1', status: 'awaiting_approval' },
            patch: {},
            preview: {
              added: ['el-fresh'],
              removed: [],
              moved: [],
              modified: [],
              metadataChanged: [],
            },
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-1:approve') {
        return Promise.resolve(
          jsonResponse(200, {
            run: { id: 'run-1', status: 'applied' },
            snapshot: { id: 'snapshot-1' },
            batch: {},
          }),
        );
      }
      // T8: LibraryPanel always fetches its list on mount now that it's wired in —
      // every test's fetchImpl needs to answer this URL too, not just the DOCK-specific
      // ones each test already exercises.
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());
    expect(updateSceneSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Descreva o que você quer mudar'), {
      target: { value: 'draw one more service' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await Promise.resolve();
    });

    // The preview is showing (awaiting_approval) but nothing has reached the canvas yet.
    expect(screen.getByRole('button', { name: 'Aprovar' })).not.toBeNull();
    expect(updateSceneSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(updateSceneSpy).toHaveBeenCalledTimes(1));
    const [sceneData] = updateSceneSpy.mock.calls[0] as [{ elements: SceneElement[] }];
    expect(sceneData.elements.map((el) => el.id)).toContain('el-fresh');
    // The second bootstrap call is the post-approve refresh, not a duplicate initial load.
    expect(bootstrapCalls).toBe(2);
  });

  it('undo after approve: the canvas returns to the pre-apply content as a new, higher revision (DOCK-18)', async () => {
    const freshElement: SceneElement = {
      ...baseElement,
      id: 'el-fresh',
      version: 1,
      versionNonce: 1,
    };

    let bootstrapCalls = 0;
    const revisionsServed: number[] = [];
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        bootstrapCalls += 1;
        // Call 1: initial load. Call 2: post-approve refresh (AI-created element).
        // Call 3: post-undo refresh — content reverts, revision keeps climbing.
        const scene = bootstrapCalls === 2 ? [freshElement] : [baseElement];
        revisionsServed.push(bootstrapCalls);
        return Promise.resolve(
          jsonResponse(200, {
            scene,
            revision: bootstrapCalls,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-undo', status: 'awaiting_approval' },
            patch: {},
            preview: {
              added: ['el-fresh'],
              removed: [],
              moved: [],
              modified: [],
              metadataChanged: [],
            },
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-undo:approve') {
        return Promise.resolve(
          jsonResponse(200, {
            run: { id: 'run-undo', status: 'applied' },
            snapshot: { id: 'snapshot-undo' },
            batch: {},
          }),
        );
      }
      if (url === '/diagrams/diagram-1/snapshots/snapshot-undo:restore') {
        return Promise.resolve(jsonResponse(200, { currentRevision: 3 }));
      }
      // T8: LibraryPanel always fetches its list on mount now that it's wired in —
      // every test's fetchImpl needs to answer this URL too, not just the DOCK-specific
      // ones each test already exercises.
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    fireEvent.change(screen.getByLabelText('Descreva o que você quer mudar'), {
      target: { value: 'draw one more service' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(updateSceneSpy).toHaveBeenCalledTimes(1));
    const [appliedScene] = updateSceneSpy.mock.calls[0] as [{ elements: SceneElement[] }];
    expect(appliedScene.elements.map((el) => el.id)).toContain('el-fresh');
    const revisionAtApply = revisionsServed.at(-1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(updateSceneSpy).toHaveBeenCalledTimes(2));
    const [restoredScene] = updateSceneSpy.mock.calls[1] as [{ elements: SceneElement[] }];
    // The canvas is back to the pre-apply content.
    expect(restoredScene.elements.map((el) => el.id)).not.toContain('el-fresh');
    expect(restoredScene.elements.map((el) => el.id)).toContain(baseElement.id);
    // It got there via a fresh bootstrap call carrying a revision strictly greater
    // than the one the apply itself landed on, not a stale re-render of old data.
    expect(bootstrapCalls).toBe(3);
    const revisionAtUndo = revisionsServed.at(-1);
    expect(revisionAtApply).toBeDefined();
    expect(revisionAtUndo).toBeDefined();
    expect(revisionAtUndo as number).toBeGreaterThan(revisionAtApply as number);
  });

  it('while awaiting_approval, the canvas, the bootstrap revision, and the mutation queue stay untouched (DOCK-08)', async () => {
    let bootstrapCalls = 0;
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        bootstrapCalls += 1;
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-pending', status: 'awaiting_approval' },
            patch: {},
            preview: {
              added: ['el-fresh'],
              removed: [],
              moved: [],
              modified: [],
              metadataChanged: [],
            },
            requiresExplicitApproval: false,
          }),
        );
      }
      // T8: LibraryPanel always fetches its list on mount now that it's wired in —
      // every test's fetchImpl needs to answer this URL too, not just the DOCK-specific
      // ones each test already exercises.
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());
    expect(bootstrapCalls).toBe(1);

    fireEvent.change(screen.getByLabelText('Descreva o que você quer mudar'), {
      target: { value: 'draw one more service' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await Promise.resolve();
    });

    // awaiting_approval: preview on screen, nothing has touched the canvas or
    // triggered a revision-changing call (no second bootstrap, no batch send).
    expect(screen.getByRole('button', { name: 'Aprovar' })).not.toBeNull();
    expect(updateSceneSpy).not.toHaveBeenCalled();
    expect(bootstrapCalls).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      '/diagrams/diagram-1/operations:batch',
      expect.anything(),
    );
  });

  it('discard leaves the diagram at the pre-run revision — canvas untouched, no extra bootstrap (DOCK-14)', async () => {
    let bootstrapCalls = 0;
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        bootstrapCalls += 1;
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/ai/runs') {
        return Promise.resolve(
          jsonResponse(201, {
            run: { id: 'run-discard', status: 'awaiting_approval' },
            patch: {},
            preview: {
              added: ['el-fresh'],
              removed: [],
              moved: [],
              modified: [],
              metadataChanged: [],
            },
            requiresExplicitApproval: false,
          }),
        );
      }
      if (url === '/ai/runs/run-discard:cancel') {
        return Promise.resolve(jsonResponse(200, {}));
      }
      // T8: LibraryPanel always fetches its list on mount now that it's wired in —
      // every test's fetchImpl needs to answer this URL too, not just the DOCK-specific
      // ones each test already exercises.
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    fireEvent.change(screen.getByLabelText('Descreva o que você quer mudar'), {
      target: { value: 'draw one more service' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
      await Promise.resolve();
    });

    expect(fetchImpl).toHaveBeenCalledWith('/ai/runs/run-discard:cancel', { method: 'POST' });
    expect(updateSceneSpy).not.toHaveBeenCalled();
    // No refresh of any kind was triggered by a discard — the diagram stays on the
    // revision bootstrap already reported.
    expect(bootstrapCalls).toBe(1);
  });

  it('a role denied canvas mutation still gets the comments panel, with no AI tab at all (CMT2-02, CMT2-03, CMT2-11)', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(
          jsonResponse(200, {
            comments: [
              {
                id: 'c-1',
                diagramId: 'diagram-1',
                elementId: null,
                frameId: null,
                parentId: null,
                body: 'revisor comentou',
                status: 'open',
                authorId: 'user-1',
                createdAt: '2026-08-17T00:00:00.000Z',
                updatedAt: '2026-08-17T00:00:00.000Z',
                mentions: [],
              },
            ],
          }),
        );
      }
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: false, reason: 'role reviewer' },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    expect(screen.queryByRole('tab', { name: 'IA' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Comentários' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // The composer is reachable, and the diagram's threads are on screen.
    expect(await screen.findByText('revisor comentou')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeTruthy();
  });

  it('the dock is entirely absent when bootstrap reports mutatePermissions.allowed: false', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: false, reason: 'role viewer' },
          }),
        );
      }
      // T8: LibraryPanel always fetches its list on mount now that it's wired in —
      // every test's fetchImpl needs to answer this URL too, not just the DOCK-specific
      // ones each test already exercises.
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();

    await waitFor(() => expect(capturedOnChange).toBeDefined());
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    // AiDock itself (DOCK-02) is gone — this is the same "Dock de IA" summary text
    // it always renders when mounted (`AiDock.tsx`), no longer a generic <details>
    // lookup: LibraryPanel/MetadataPanel now render their own <details> too, still
    // read-only rather than absent (CLIB-05/CLIB-11 — a different, intentional
    // behavior from AiDock's own "vanish entirely" rule, DOCK-02). ExportMenu
    // (XPRT-01) is a third, unrelated `<details>` that stays mounted regardless of
    // mutatePermissions (export only needs diagram:read).
    expect(screen.queryByText('Dock de IA')).toBeNull();
  });

  it('ExportMenu and BundleButton mount in the toolbar, keyboard-focusable, and render in the en locale too (XPRT-01/05, T7)', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    await i18n.changeLanguage('en');
    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    const exportSummary = screen.getByText('Export');
    expect(exportSummary).not.toBeNull();
    const bundleButton = screen.getByRole('button', { name: 'Download bundle' });
    expect(bundleButton).not.toBeNull();

    // Keyboard-focusable (XPRT-16), same `.focus()` convention as NAV-24's own assertions.
    bundleButton.focus();
    expect(document.activeElement).toBe(bundleButton);
  });

  it('a bundle generation failure is announced in an aria-live=polite region (XPRT-06/17)', async () => {
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/bundle' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(500, { title: 'boom' }));
      }
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    const liveRegion = screen.getByTestId('bundle-button-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Baixar bundle' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(liveRegion.textContent).toBe('Não foi possível gerar o bundle. Tente novamente.'),
    );
  });

  it('T8: LibraryPanel/MetadataPanel are read-only (no insert/save buttons) but still rendered when mutatePermissions.allowed is false', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: false, reason: 'role viewer' },
          }),
        );
      }
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    // LibraryPanel is still present (CLIB-05: browse-only, never hidden outright).
    expect(await screen.findByText('Biblioteca de componentes')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Inserir' })).toBeNull();

    // MetadataPanel: no selection yet, but its own empty state renders (CLIB-12) —
    // canWrite=false only removes the SAVE form once something is selected, which
    // this test doesn't need to drive through EditorSurface's onChange to prove.
    expect(screen.getByText('Metadados do elemento')).not.toBeNull();
  });

  it('T8: an inventory link navigates to the inventory route, scoped to this workspace/diagram', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    const link = (await screen.findByRole('link', { name: 'Ver inventário' })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/w/ws-1/d/diagram-1/inventory');
  });

  it("T8: canvas selection propagates to MetadataPanel, which fetches that element's metadata (CLIB-08)", async () => {
    const fetchImpl = basicFetchImpl();
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    act(() => {
      capturedOnChange?.([baseElement], { selectedElementIds: { [baseElement.id]: true } });
    });

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        `/diagrams/diagram-1/elements/${baseElement.id}/metadata`,
      ),
    );
  });

  it('T8: renders the library/metadata panels and the inventory link in the en locale, switched mid-session (CLIB-18)', async () => {
    const fetchImpl = basicFetchImpl();
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());
    expect(screen.getByText('Biblioteca de componentes')).not.toBeNull();

    await i18n.changeLanguage('en');

    expect(await screen.findByText('Component library')).not.toBeNull();
    expect(screen.getByText('Element metadata')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'View inventory' })).not.toBeNull();
  });

  it('T8: the library search field and the inventory link are keyboard-focusable (CLIB-18)', async () => {
    const fetchImpl = basicFetchImpl();
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    const searchInput = screen.getByLabelText('Buscar componentes') as HTMLInputElement;
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    const inventoryLink = screen.getByRole('link', { name: 'Ver inventário' });
    inventoryLink.focus();
    expect(document.activeElement).toBe(inventoryLink);
  });
});

describe('DiagramEditorPage history integration (T6, SNAP-08/14/16)', () => {
  // jsdom 30.0.1's `HTMLDialogElement` has no `showModal()`/`close()` — same shim as
  // `ConfirmArchiveDialog.spec.tsx`/`RestoreConfirmDialog.spec.tsx`.
  beforeAll(() => {
    const proto = HTMLDialogElement.prototype as unknown as {
      showModal?: () => void;
      close?: () => void;
    };
    if (!proto.showModal) {
      proto.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
    }
    if (!proto.close) {
      proto.close = function close(this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  beforeEach(() => {
    capturedOnChange = undefined;
    updateSceneSpy = vi.fn();
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('pt-BR');
  });

  it('the history panel is collapsed by default and never renders inside the canvas row', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/snapshots') {
        return Promise.resolve(jsonResponse(200, { snapshots: [] }));
      }
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    const { container } = renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    // Collapsed: no history content mounted anywhere, and the canvas row itself is untouched
    // (still exactly the pre-existing 2 children: canvas column + AiDock).
    expect(screen.queryByTestId('history-item')).toBeNull();
    const row = container.firstElementChild as HTMLElement;
    expect(row.children).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));

    expect(
      await screen.findByText(
        'Nenhum snapshot ainda. Snapshots automáticos aparecem conforme você edita o diagrama.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Comparar revisões')).toBeTruthy();
    // Opening the history section still never touches the canvas row's own children.
    expect(row.children).toHaveLength(2);
  });

  it('SNAP-08: restoring a snapshot from the open history panel reflects on the canvas via applyRemoteScene', async () => {
    const restoredElement: SceneElement = {
      ...baseElement,
      id: 'el-restored',
      version: 1,
      versionNonce: 1,
    };
    let bootstrapCalls = 0;
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        bootstrapCalls += 1;
        const scene = bootstrapCalls === 1 ? [baseElement] : [restoredElement];
        return Promise.resolve(
          jsonResponse(200, {
            scene,
            revision: bootstrapCalls,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/snapshots') {
        return Promise.resolve(
          jsonResponse(200, {
            snapshots: [
              {
                id: 'snap-1',
                revision: 1,
                kind: 'named',
                name: 'checkpoint',
                createdAt: '2026-08-16T09:00:00.000Z',
              },
            ],
          }),
        );
      }
      if (url === '/diagrams/diagram-1/snapshots/snap-1:restore') {
        return Promise.resolve(
          jsonResponse(200, { currentRevision: 2, restoredFromSnapshotId: 'snap-1' }),
        );
      }
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());
    expect(updateSceneSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    await screen.findByText('checkpoint');

    fireEvent.click(screen.getByText('Restaurar'));
    fireEvent.click(await screen.findByTestId('restore-confirm-confirm'));

    await waitFor(() => expect(updateSceneSpy).toHaveBeenCalledTimes(1));
    const [sceneData] = updateSceneSpy.mock.calls[0] as [{ elements: SceneElement[] }];
    expect(sceneData.elements.map((el) => el.id)).toContain('el-restored');
    // The bootstrap call that fed applyRemoteScene is the post-restore refresh, not the
    // initial load — same reused flow AiDock's approve/undo already goes through.
    expect(bootstrapCalls).toBe(2);
  });

  it('SNAP-16: the history toggle and empty-state text switch to English mid-session', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/snapshots') {
        return Promise.resolve(jsonResponse(200, { snapshots: [] }));
      }
      if (url === '/diagrams/diagram-1/comments') {
        return Promise.resolve(jsonResponse(200, { comments: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    await i18n.changeLanguage('pt-BR');
    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());
    expect(screen.getByRole('button', { name: 'Histórico' })).not.toBeNull();
    cleanup();

    await i18n.changeLanguage('en');
    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());
    const toggle = screen.getByRole('button', { name: 'History' });
    fireEvent.click(toggle);
    expect(
      await screen.findByText(
        'No snapshots yet. Automatic snapshots appear as you edit the diagram.',
      ),
    ).toBeTruthy();
  });
});

describe('DiagramEditorPage realtime presence (T12, LIVE-06..14/24)', () => {
  beforeEach(() => {
    capturedOnChange = undefined;
    capturedOnPointerUpdate = undefined;
    updateSceneSpy = vi.fn();
    FakeSocket.reset();
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('pt-BR');
  });

  const SELF_ID = 'user-1';
  const PEER_ID = '1cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f73';
  const WS_DIAGRAM_ID = '4fa2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f70';

  function presenceFetchImpl(): typeof fetch {
    return vi.fn((url: string, init?: RequestInit) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: SELF_ID } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/ws-ticket' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(200, { ticket: 'ws-ticket-1', expiresAt: '2026-08-17T12:00:30.000Z' }),
        );
      }
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === `/diagrams/diagram-1/elements/${baseElement.id}/metadata`) {
        return Promise.resolve(jsonResponse(404, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  function peerPresenceFrame(payload: Record<string, unknown>): string {
    return JSON.stringify({
      protocolVersion: 1,
      diagramId: WS_DIAGRAM_ID,
      messageId: '7cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f71',
      sentAt: '2026-08-17T12:00:00.000Z',
      type: 'presence',
      payload,
    });
  }

  it('opens the ws route with a freshly minted ticket once bootstrap resolves (LIVE-06)', async () => {
    vi.stubGlobal('fetch', presenceFetchImpl());

    renderPage();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    expect(FakeSocket.last?.url).toBe(
      'ws://localhost:3000/ws/diagrams/diagram-1?ticket=ws-ticket-1',
    );
  });

  it('shows the connection status, moving from connecting to connected when the socket opens (LIVE-24)', async () => {
    vi.stubGlobal('fetch', presenceFetchImpl());

    renderPage();
    expect((await screen.findByTestId('presence-connection-status')).textContent).toBe(
      'Conectando à presença ao vivo…',
    );

    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => {
      FakeSocket.last?.open();
    });

    expect(screen.getByTestId('presence-connection-status').textContent).toBe(
      'Presença ao vivo conectada',
    );
  });

  it("puts a peer's cursor, name, colour and selection onto the canvas (LIVE-13, LIVE-14)", async () => {
    vi.stubGlobal('fetch', presenceFetchImpl());

    renderPage();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => {
      FakeSocket.last?.open();
    });
    updateSceneSpy.mockClear();

    act(() => {
      FakeSocket.last?.receive(
        peerPresenceFrame({
          senderId: PEER_ID,
          displayName: 'Ana',
          cursor: { x: 30, y: 40 },
          selection: ['el-9'],
          status: 'active',
        }),
      );
    });

    await waitFor(() => expect(updateSceneSpy).toHaveBeenCalled());
    const [sceneData] = updateSceneSpy.mock.calls.at(-1) as [
      { collaborators: Map<string, Record<string, unknown>> },
    ];
    expect(sceneData.collaborators.get(PEER_ID)).toEqual({
      id: PEER_ID,
      username: 'Ana',
      color: collaboratorColor(PEER_ID),
      pointer: { x: 30, y: 40, tool: 'pointer' },
      selectedElementIds: { 'el-9': true },
    });
  });

  it('broadcasts the local pointer in scene coordinates through the throttle (LIVE-09)', async () => {
    vi.stubGlobal('fetch', presenceFetchImpl());

    renderPage();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => {
      FakeSocket.last?.open();
    });

    // Excalidraw's own `onPointerUpdate` already reports scene coordinates — the
    // page never converts, so whatever it reports is what goes on the wire.
    act(() => {
      capturedOnPointerUpdate?.({ pointer: { x: 5, y: 6 } });
      capturedOnPointerUpdate?.({ pointer: { x: 7, y: 8 } });
    });

    await waitFor(() => {
      const payloads = (FakeSocket.last?.sent ?? []).map(
        (raw) => (JSON.parse(raw) as { payload: Record<string, unknown> }).payload,
      );
      expect(payloads).toContainEqual({ cursor: { x: 7, y: 8 }, status: 'active' });
      // The burst collapsed: the intermediate position never left this client.
      expect(payloads.filter((payload) => 'cursor' in payload)).toHaveLength(1);
    });
  });

  it('broadcasts the local selection reusing the existing onSelectionChange state (LIVE-10)', async () => {
    vi.stubGlobal('fetch', presenceFetchImpl());

    renderPage();
    await waitFor(() => expect(capturedOnChange).toBeDefined());
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => {
      FakeSocket.last?.open();
    });

    act(() => {
      capturedOnChange?.([baseElement], { selectedElementIds: { [baseElement.id]: true } });
    });

    await waitFor(() => {
      const payloads = (FakeSocket.last?.sent ?? []).map(
        (raw) => (JSON.parse(raw) as { payload: Record<string, unknown> }).payload,
      );
      expect(payloads).toContainEqual({ selection: [baseElement.id], status: 'active' });
    });
  });

  it('closes the socket when the editor unmounts (LIVE-08)', async () => {
    vi.stubGlobal('fetch', presenceFetchImpl());

    const { unmount } = renderPage();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => {
      FakeSocket.last?.open();
    });
    const socket = FakeSocket.last;

    unmount();

    expect(socket?.readyState).toBe(3);
  });
});

describe('DiagramEditorPage reconnect catch-up (T13, LIVE-20..22)', () => {
  beforeEach(() => {
    capturedOnChange = undefined;
    capturedOnPointerUpdate = undefined;
    updateSceneSpy = vi.fn();
    FakeSocket.reset();
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('pt-BR');
  });

  const freshElement: SceneElement = {
    ...baseElement,
    id: 'el-from-catch-up',
    version: 1,
    versionNonce: 1,
  };

  /**
   * `operations` answers whatever the test wants `GET .../operations?afterSequence=` to
   * report; `catchUpFails` turns that same route into a 500 instead.
   */
  function catchUpFetchImpl(options: {
    operations: Array<{ sequence: number; clientMutationId: string }>;
    catchUpFails?: boolean;
  }) {
    let bootstrapCalls = 0;
    const impl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        bootstrapCalls += 1;
        return Promise.resolve(
          jsonResponse(200, {
            scene: bootstrapCalls === 1 ? [baseElement] : [freshElement],
            revision: bootstrapCalls,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed: true, reason: '' },
          }),
        );
      }
      if (url === '/diagrams/diagram-1/ws-ticket' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(200, { ticket: 'ws-ticket-1', expiresAt: '2026-08-17T12:00:30.000Z' }),
        );
      }
      if (url.startsWith('/diagrams/diagram-1/operations?afterSequence=')) {
        if (options.catchUpFails) return Promise.resolve(jsonResponse(500, {}));
        return Promise.resolve(jsonResponse(200, { operations: options.operations }));
      }
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url === `/diagrams/diagram-1/elements/${baseElement.id}/metadata`) {
        return Promise.resolve(jsonResponse(404, {}));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    return { impl, bootstrapCallCount: () => bootstrapCalls };
  }

  /** Drops the open socket and drives the client through one full reconnect. */
  async function reconnect(): Promise<void> {
    const firstSocket = FakeSocket.last;
    act(() => {
      firstSocket?.emitClose(1006);
    });
    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(1), { timeout: 4000 });
    act(() => {
      FakeSocket.last?.open();
    });
  }

  async function renderConnected(fetchImpl: typeof fetch) {
    vi.stubGlobal('fetch', fetchImpl);
    renderPage();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => {
      FakeSocket.last?.open();
    });
  }

  it('calls catchUp on the sync client once the socket comes back (LIVE-20)', async () => {
    const { impl } = catchUpFetchImpl({ operations: [] });
    await renderConnected(impl);

    await reconnect();

    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith('/diagrams/diagram-1/operations?afterSequence=1'),
    );
  });

  it('repaints the canvas through applyRemoteScene when catch-up reports missed operations (LIVE-21)', async () => {
    const { impl, bootstrapCallCount } = catchUpFetchImpl({
      operations: [{ sequence: 2, clientMutationId: 'cm-1' }],
    });
    await renderConnected(impl);
    updateSceneSpy.mockClear();

    await reconnect();

    await waitFor(() => expect(bootstrapCallCount()).toBe(2));
    await waitFor(() => {
      const sceneCall = updateSceneSpy.mock.calls.find(
        (call) => (call[0] as { elements?: unknown[] }).elements !== undefined,
      );
      if (!sceneCall) throw new Error('expected an updateScene call carrying elements');
      const { elements } = sceneCall[0] as { elements: SceneElement[] };
      expect(elements.some((element) => element.id === freshElement.id)).toBe(true);
    });
  });

  it('leaves the canvas alone when catch-up reports nothing was missed (LIVE-22)', async () => {
    const { impl, bootstrapCallCount } = catchUpFetchImpl({ operations: [] });
    await renderConnected(impl);
    updateSceneSpy.mockClear();

    await reconnect();
    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith('/diagrams/diagram-1/operations?afterSequence=1'),
    );

    expect(bootstrapCallCount()).toBe(1);
    expect(
      updateSceneSpy.mock.calls.filter(
        (call) => (call[0] as { elements?: unknown[] }).elements !== undefined,
      ),
    ).toEqual([]);
  });

  it('survives a failing catch-up without touching the canvas or the connection (LIVE-20)', async () => {
    const { impl, bootstrapCallCount } = catchUpFetchImpl({ operations: [], catchUpFails: true });
    await renderConnected(impl);
    updateSceneSpy.mockClear();

    await reconnect();
    await waitFor(() =>
      expect(impl).toHaveBeenCalledWith('/diagrams/diagram-1/operations?afterSequence=1'),
    );

    expect(bootstrapCallCount()).toBe(1);
    expect(screen.getByTestId('presence-connection-status').textContent).toBe(
      'Presença ao vivo conectada',
    );
  });
});

/**
 * Top-level, with its own setup: `capturedViewModeEnabled` must be reset per test
 * here, otherwise a stale value left by an earlier test could make an assertion
 * pass without the component ever rendering.
 */
describe('T11 (share-links): the canvas honours the role (SHR-22)', () => {
  beforeEach(() => {
    capturedOnChange = undefined;
    capturedViewModeEnabled = undefined;
    updateSceneSpy = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function bootstrapWithMutate(allowed: boolean): typeof fetch {
    return vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: { id: 'user-1' } }));
      if (url === '/diagrams/diagram-1/bootstrap') {
        return Promise.resolve(
          jsonResponse(200, {
            scene: [baseElement],
            revision: 1,
            assets: [],
            permissions: { allowed: true, reason: '' },
            mutatePermissions: { allowed, reason: allowed ? '' : 'role' },
          }),
        );
      }
      if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  it('mounts the canvas with viewModeEnabled=true when the role cannot mutate', async () => {
    vi.stubGlobal('fetch', bootstrapWithMutate(false));

    renderPage();

    await waitFor(() => expect(capturedViewModeEnabled).toBe(true));
  });

  it('mounts the canvas with viewModeEnabled=false when the role can mutate', async () => {
    vi.stubGlobal('fetch', bootstrapWithMutate(true));

    renderPage();

    await waitFor(() => expect(capturedViewModeEnabled).toBe(false));
  });

  it('mounts the share-link panel when the role can mutate (T12, SHR-01)', async () => {
    vi.stubGlobal('fetch', bootstrapWithMutate(true));

    renderPage();

    expect(await screen.findByText('Link de compartilhamento')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar link' })).toBeTruthy();
  });

  it('renders no share-link panel at all when the role cannot mutate (T12, SHR-01)', async () => {
    vi.stubGlobal('fetch', bootstrapWithMutate(false));

    renderPage();

    await waitFor(() => expect(capturedViewModeEnabled).toBe(true));
    expect(screen.queryByText('Link de compartilhamento')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Criar link' })).toBeNull();
  });
});
