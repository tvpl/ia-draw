import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initializes the shared i18next singleton `useTranslation()` reads from. Default
// language is pt-BR (`DEFAULT_LANGUAGE`), so the assertions below query pt-BR strings.
import '../i18n/index.js';
import { SharedResourcePage } from './SharedResourcePage.js';

// Same mocking convention as `DiagramEditorPage.spec.tsx` / `EditorSurface.spec.tsx`:
// only the `Excalidraw` export is replaced (jsdom cannot mount the real canvas), so
// what is captured here is what the REAL `EditorSurface` forwarded — the whole chain
// page -> EditorSurface -> Excalidraw, not just the page's own props.
let capturedViewModeEnabled: boolean | undefined;
let capturedInitialElements: readonly unknown[] | undefined;
let excalidrawRenders = 0;

vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return {
    ...actual,
    Excalidraw: (props: {
      viewModeEnabled?: boolean;
      initialData?: { elements?: readonly unknown[] };
    }) => {
      excalidrawRenders += 1;
      capturedViewModeEnabled = props.viewModeEnabled;
      capturedInitialElements = props.initialData?.elements;
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

function renderPage(fetchImpl: typeof fetch, token = 'tok-1') {
  return render(
    <MemoryRouter initialEntries={[`/share/${token}`]}>
      <Routes>
        <Route path="/share/:token" element={<SharedResourcePage fetchImpl={fetchImpl} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SCENE = [{ id: 'el-1', type: 'rectangle', version: 1, versionNonce: 1 }];

beforeEach(() => {
  capturedViewModeEnabled = undefined;
  capturedInitialElements = undefined;
  excalidrawRenders = 0;
});

afterEach(cleanup);

describe('SharedResourcePage (T6, SHR-14..16, SHR-19..21, SHR-27, SHR-28)', () => {
  it('requests GET /share/:token exactly once on mount (SHR-14)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse(200, { resourceType: 'diagram', role: 'viewer', scene: [], revision: 1 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(excalidrawRenders).toBeGreaterThan(0));
    expect(calls).toEqual(['/share/tok-1']);
  });

  it('renders the resolved scene on the canvas for a diagram link (SHR-15)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { resourceType: 'diagram', role: 'viewer', scene: SCENE, revision: 3 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(capturedInitialElements).toEqual(SCENE));
  });

  it('mounts the canvas with viewModeEnabled=true (SHR-19)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { resourceType: 'diagram', role: 'viewer', scene: SCENE, revision: 3 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(capturedViewModeEnabled).toBe(true));
  });

  it('keeps viewModeEnabled=true even when the link grants the editor role (SHR-20)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { resourceType: 'diagram', role: 'editor', scene: SCENE, revision: 3 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(capturedViewModeEnabled).toBe(true));
  });

  it('emits no request other than the resolve call — no bootstrap, no operations batch (SHR-21)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse(200, {
        resourceType: 'diagram',
        role: 'editor',
        scene: SCENE,
        revision: 3,
      });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(capturedViewModeEnabled).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['/share/tok-1']);
  });

  it('renders one invalid-link message on 404, with no canvas and no reason given (SHR-16)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByText('Este link é inválido, expirou ou foi revogado.')).toBeTruthy();
    expect(excalidrawRenders).toBe(0);
  });

  it('renders the same failure message when the request itself fails, without retrying', async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      throw new Error('network down');
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByText('Este link é inválido, expirou ou foi revogado.')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attempts).toBe(1);
  });

  it('renders an empty canvas for an empty scene, never the invalid-link message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { resourceType: 'diagram', role: 'viewer', scene: [], revision: 1 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(capturedInitialElements).toEqual([]));
    expect(screen.queryByText('Este link é inválido, expirou ou foi revogado.')).toBeNull();
  });

  it('renders the presentation placeholder with its name, and never a frame note (SHR-27, SHR-28)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        resourceType: 'presentation',
        role: 'editor',
        presentation: { id: 'p-1', name: 'Roadmap' },
        frames: [
          { id: 'f-1', position: 0, notes: 'private speaker note', navLinksJson: [] },
          { id: 'f-2', position: 1, notes: null, navLinksJson: [] },
        ],
      }),
    ) as unknown as typeof fetch;

    const { container } = renderPage(fetchImpl);

    expect(await screen.findByRole('heading', { name: 'Apresentação: Roadmap' })).toBeTruthy();
    expect(
      screen.getByText(
        'A visualização de apresentação ainda não está disponível. Este link aponta para uma apresentação com 2 frame(s), que uma versão futura vai conseguir exibir.',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain('private speaker note');
    expect(excalidrawRenders).toBe(0);
  });
});

describe('SharedResourcePage — published presentation frame viewer (T22, PRZ-29..34)', () => {
  const publishedScene = [
    { id: 'frame-a', type: 'frame', version: 1, versionNonce: 1 },
    { id: 'child-a', type: 'rectangle', frameId: 'frame-a', version: 1, versionNonce: 1 },
    { id: 'frame-b', type: 'frame', version: 1, versionNonce: 1 },
    { id: 'child-b', type: 'rectangle', frameId: 'frame-b', version: 1, versionNonce: 1 },
  ];
  const publishedFrames = [
    {
      id: 'f-1',
      position: 0,
      elementId: 'frame-a',
      frameId: null,
      notes: null,
      navLinksJson: [{ targetFrameId: 'f-2' }],
    },
    { id: 'f-2', position: 1, elementId: 'frame-b', frameId: null, notes: null, navLinksJson: [] },
  ];

  function publishedFetch(callLog?: string[]): typeof fetch {
    return vi.fn(async (url: string) => {
      callLog?.push(url);
      return jsonResponse(200, {
        resourceType: 'presentation',
        role: 'viewer',
        presentation: { id: 'p-1', name: 'Roadmap' },
        frames: publishedFrames,
        scene: publishedScene,
        published: true,
      });
    }) as unknown as typeof fetch;
  }

  it('renders the FrameViewer with frame 1 first, canvas cropped to that frame (PRZ-29, PRZ-31)', async () => {
    renderPage(publishedFetch());

    expect(await screen.findByRole('heading', { name: 'Apresentação: Roadmap' })).toBeTruthy();
    expect(await screen.findByText('Frame 1 de 2')).toBeTruthy();
    await waitFor(() =>
      expect(capturedInitialElements?.map((el) => (el as { id: string }).id).sort()).toEqual([
        'child-a',
        'frame-a',
      ]),
    );
  });

  it('never renders notes, even though scene is present (PRZ-32)', async () => {
    const { container } = renderPage(publishedFetch());
    await screen.findByText('Frame 1 de 2');
    expect(container.textContent).not.toContain('private speaker note');
  });

  it('a prototype nav link jumps to its target frame, cropping the canvas to the new frame (PRZ-33)', async () => {
    renderPage(publishedFetch());
    await screen.findByText('Frame 1 de 2');

    fireEvent.click(screen.getByRole('button', { name: /Ir para:/ }));

    expect(await screen.findByText('Frame 2 de 2')).toBeTruthy();
    await waitFor(() =>
      expect(capturedInitialElements?.map((el) => (el as { id: string }).id).sort()).toEqual([
        'child-b',
        'frame-b',
      ]),
    );
  });

  it('navigating frames never emits a second request beyond the initial resolve (PRZ-34)', async () => {
    const calls: string[] = [];
    renderPage(publishedFetch(calls));
    await screen.findByText('Frame 1 de 2');

    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    await screen.findByText('Frame 2 de 2');
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByText('Frame 1 de 2');

    expect(calls).toEqual(['/share/tok-1']);
  });

  it('falls back to the whole scene when a frame elementId no longer matches anything (edge case, G1-equivalent)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        resourceType: 'presentation',
        role: 'viewer',
        presentation: { id: 'p-1', name: 'Roadmap' },
        frames: [
          {
            id: 'f-1',
            position: 0,
            elementId: 'deleted-frame',
            frameId: null,
            notes: null,
            navLinksJson: [],
          },
        ],
        scene: publishedScene,
        published: true,
      }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByText('Frame 1 de 1');

    await waitFor(() =>
      expect(capturedInitialElements?.map((el) => (el as { id: string }).id).sort()).toEqual([
        'child-a',
        'child-b',
        'frame-a',
        'frame-b',
      ]),
    );
  });

  it('an empty published scene renders an empty canvas, never the invalid-link message (edge case)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        resourceType: 'presentation',
        role: 'viewer',
        presentation: { id: 'p-1', name: 'Roadmap' },
        frames: [
          {
            id: 'f-1',
            position: 0,
            elementId: null,
            frameId: 'logical',
            notes: null,
            navLinksJson: [],
          },
        ],
        scene: [],
        published: true,
      }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByText('Frame 1 de 1');

    await waitFor(() => expect(capturedInitialElements).toEqual([]));
    expect(screen.queryByText('Este link é inválido, expirou ou foi revogado.')).toBeNull();
  });
});
