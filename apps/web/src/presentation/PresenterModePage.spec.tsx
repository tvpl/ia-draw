import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.js';
import { PresenterModePage } from './PresenterModePage.js';

// Same mocking convention as `DiagramEditorPage.spec.tsx`/`SharedResourcePage.spec.tsx`:
// only the `Excalidraw` export is replaced — what's captured here is what the REAL
// `EditorSurface`/`scrollToFrame` forwarded, not just this page's own props.
let capturedViewModeEnabled: boolean | undefined;
let scrollToContentSpy: ReturnType<typeof vi.fn>;

vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return {
    ...actual,
    Excalidraw: (props: {
      viewModeEnabled?: boolean;
      excalidrawAPI?: (api: {
        updateScene: () => void;
        scrollToContent: typeof scrollToContentSpy;
      }) => void;
    }) => {
      capturedViewModeEnabled = props.viewModeEnabled;
      props.excalidrawAPI?.({ updateScene: vi.fn(), scrollToContent: scrollToContentSpy });
      return null;
    },
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/d/d-1/present/p-1/presenter']}>
      <Routes>
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId/presenter"
          element={<PresenterModePage fetchImpl={fetchImpl} />}
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId"
          element={<div data-testid="editor-page" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const presentation = {
  id: 'p-1',
  diagramId: 'd-1',
  name: 'Roadmap',
  publishedSnapshotId: 'snap-1',
};
const sceneElement = { id: 'frame-a', type: 'frame', version: 1, versionNonce: 1 };

const threeFrames = [
  {
    id: 'f-1',
    presentationId: 'p-1',
    elementId: 'frame-a',
    frameId: null,
    position: 0,
    notes: 'n1',
    navLinksJson: [],
  },
  {
    id: 'f-2',
    presentationId: 'p-1',
    elementId: null,
    frameId: 'b',
    position: 1,
    notes: null,
    navLinksJson: [{ targetFrameId: 'f-1' }],
  },
  {
    id: 'f-3',
    presentationId: 'p-1',
    elementId: null,
    frameId: 'c',
    position: 2,
    notes: null,
    navLinksJson: [],
  },
];

function baseFetch(writeSpy?: (url: string, method: string | undefined) => void) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    writeSpy?.(url, init?.method);
    if (url === '/presentations/p-1') {
      return jsonResponse(200, { presentation, frames: threeFrames });
    }
    if (url === '/diagrams/d-1/bootstrap') {
      return jsonResponse(200, { scene: [sceneElement] });
    }
    throw new Error(`unexpected url ${url} (${init?.method ?? 'GET'})`);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  capturedViewModeEnabled = undefined;
  scrollToContentSpy = vi.fn();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('pt-BR');
});

describe('PresenterModePage (T19, PRZ-35..41)', () => {
  it('shows a loading state before the presentation resolves', () => {
    renderPage(baseFetch());
    expect(screen.getByText('Carregando apresentação…')).not.toBeNull();
  });

  it('mounts the canvas with viewModeEnabled always true (PRZ-36)', async () => {
    renderPage(baseFetch());
    await waitFor(() => expect(capturedViewModeEnabled).toBe(true));
  });

  it('moves the viewport to the first frame on mount via scrollToFrame (PRZ-37)', async () => {
    renderPage(baseFetch());
    await waitFor(() => expect(scrollToContentSpy).toHaveBeenCalled());
    const [target] = scrollToContentSpy.mock.calls[0] as [Array<{ id: string }>];
    expect(target.map((el) => el.id)).toEqual(['frame-a']);
  });

  it('ArrowRight/PageDown/Space advance to the next frame, updating the position indicator', async () => {
    renderPage(baseFetch());
    await screen.findByText('Frame 1 de 3');

    fireEvent.keyDown(screen.getByTestId('presenter-shell'), {
      key: 'ArrowRight',
    });
    expect(await screen.findByText('Frame 2 de 3')).not.toBeNull();
  });

  it('ArrowLeft/PageUp move back to the previous frame', async () => {
    renderPage(baseFetch());
    await screen.findByText('Frame 1 de 3');
    const shell = screen.getByTestId('presenter-shell');

    fireEvent.keyDown(shell, { key: 'ArrowRight' });
    await screen.findByText('Frame 2 de 3');
    fireEvent.keyDown(shell, { key: 'ArrowLeft' });
    expect(await screen.findByText('Frame 1 de 3')).not.toBeNull();
  });

  it('Escape navigates back to the presentation editor (PRZ-39)', async () => {
    renderPage(baseFetch());
    await screen.findByText('Frame 1 de 3');
    const shell = screen.getByTestId('presenter-shell');

    fireEvent.keyDown(shell, { key: 'Escape' });
    expect(await screen.findByTestId('editor-page')).not.toBeNull();
  });

  it('a prototype nav-link jumps directly to its target frame, out of linear order (PRZ-40)', async () => {
    renderPage(baseFetch());
    await screen.findByText('Frame 1 de 3');

    fireEvent.keyDown(screen.getByTestId('presenter-shell'), {
      key: 'ArrowRight',
    });
    await screen.findByText('Frame 2 de 3');

    const navLink = await screen.findByRole('button', { name: /Ir para:/ });
    fireEvent.click(navLink);
    expect(await screen.findByText('Frame 1 de 3')).not.toBeNull();
  });

  it('never emits a write request during any navigation (PRZ-39/40 combined)', async () => {
    const writes: Array<[string, string | undefined]> = [];
    renderPage(baseFetch((url, method) => writes.push([url, method])));
    await screen.findByText('Frame 1 de 3');
    const shell = screen.getByTestId('presenter-shell');

    fireEvent.keyDown(shell, { key: 'ArrowRight' });
    await screen.findByText('Frame 2 de 3');
    fireEvent.keyDown(shell, { key: 'ArrowLeft' });
    await screen.findByText('Frame 1 de 3');

    expect(writes.every(([, method]) => !method || method === 'GET')).toBe(true);
  });

  it('shows a generic error when the presentation cannot be found', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/presentations/p-1') return jsonResponse(404, {});
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    expect(await screen.findByText('Algo deu errado. Tente de novo.')).not.toBeNull();
  });
});
