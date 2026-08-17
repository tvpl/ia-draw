import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider.js';
// Initializes the shared i18next singleton `useTranslation()` reads from. Default
// language is pt-BR (`DEFAULT_LANGUAGE`), so assertions below query the pt-BR strings
// ("Enviar", "Aprovar", ...) unless a test explicitly switches locale (T8/CLIB-18).
import i18n from '../i18n/index.js';
import { DiagramEditorPage } from './DiagramEditorPage.js';

// The real `<Excalidraw/>` needs browser APIs jsdom doesn't implement — same mocking
// convention as `packages/editor-adapter/src/EditorSurface.spec.tsx`: only the
// `Excalidraw` export is replaced, everything else (`reconcileElements`, etc.) stays real
// since `applyRemote`/`EditorSurface` call into it.
let capturedOnChange: ((elements: unknown, appState: unknown) => void) | undefined;
let updateSceneSpy: ReturnType<typeof vi.fn>;

vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return {
    ...actual,
    Excalidraw: (props: {
      onChange?: (elements: unknown, appState: unknown) => void;
      excalidrawAPI?: (api: { updateScene: typeof updateSceneSpy }) => void;
    }) => {
      capturedOnChange = props.onChange;
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
    updateSceneSpy = vi.fn();
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    // Restores the default locale in case a test switched it (T8/CLIB-18) and failed
    // before switching back, so later tests aren't left asserting the wrong strings.
    await i18n.changeLanguage('pt-BR');
  });

  /** Shared happy-path bootstrap + empty-library fetch, reused by every T8 test below that doesn't need a more specific mock. */
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
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  it('the layout is a row with the canvas column and AiDock as siblings (unchanged flex:1/minHeight:0 canvas sizing)', async () => {
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
    // T8: the row's second child is now a sidebar column hosting AiDock plus the new
    // LibraryPanel/MetadataPanel panels (each collapsible via <details>), not AiDock
    // rendered bare — AiDock's own <details> is nested one level inside it.
    const sidebar = row.children[1] as HTMLElement;
    expect(sidebar.tagName).toBe('DIV');
    expect(sidebar.querySelectorAll('details')).toHaveLength(3);
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

  it('the dock is entirely absent when bootstrap reports mutatePermissions.allowed: false', async () => {
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
    // behavior from AiDock's own "vanish entirely" rule, DOCK-02).
    expect(screen.queryByText('Dock de IA')).toBeNull();
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
