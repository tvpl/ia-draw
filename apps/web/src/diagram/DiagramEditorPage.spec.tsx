import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider.js';
import { DiagramEditorPage } from './DiagramEditorPage.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from. Default language is pt-BR (`DEFAULT_LANGUAGE`), so assertions below query the
// pt-BR strings ("Enviar", "Aprovar", ...).
import '../i18n/index.js';

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

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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
    // AiDock (a <details> element) is the row's second child.
    expect((row.children[1] as HTMLElement).tagName).toBe('DETAILS');
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
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    renderPage();

    await waitFor(() => expect(capturedOnChange).toBeDefined());
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    expect(document.querySelector('details')).toBeNull();
  });
});
