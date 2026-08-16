import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/d/diagram-1']}>
      <Routes>
        <Route path="/w/:workspaceId/d/:diagramId" element={<DiagramEditorPage />} />
      </Routes>
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
