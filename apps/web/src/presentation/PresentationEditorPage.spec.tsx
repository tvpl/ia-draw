import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.js';
import { PresentationEditorPage } from './PresentationEditorPage.js';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('pt-BR');
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/d/d-1/present/p-1']}>
      <Routes>
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId"
          element={<PresentationEditorPage fetchImpl={fetchImpl} />}
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/present"
          element={<div data-testid="list-page" />}
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId/presenter"
          element={<div data-testid="presenter-page" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const presentation = { id: 'p-1', diagramId: 'd-1', name: 'Roadmap', publishedSnapshotId: null };

function baseFetch({
  canMutate = true,
  frames = [] as unknown[],
  scene = [] as unknown[],
}: {
  canMutate?: boolean;
  frames?: unknown[];
  scene?: unknown[];
} = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/presentations/p-1') return jsonResponse(200, { presentation, frames });
    if (url === '/diagrams/d-1/bootstrap') {
      return jsonResponse(200, { scene, mutatePermissions: { allowed: canMutate } });
    }
    if (url === '/presentations/p-1/frames' && init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      return jsonResponse(201, {
        frame: { id: 'f-new', presentationId: 'p-1', notes: null, navLinksJson: [], ...body },
      });
    }
    if (url === '/presentations/p-1/frames' && init?.method === 'PATCH') {
      const { frames: updates } = JSON.parse(init.body as string) as {
        frames: { id: string; position: number }[];
      };
      const byId = new Map((frames as { id: string }[]).map((f) => [f.id, f]));
      const reordered = updates
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((u) => ({ ...byId.get(u.id), position: u.position }));
      return jsonResponse(200, { frames: reordered });
    }
    if (url.startsWith('/presentations/p-1/frames/') && init?.method === 'PATCH') {
      const frameId = url.split('/').pop();
      const body = JSON.parse(init.body as string);
      return jsonResponse(200, {
        frame: { id: frameId, presentationId: 'p-1', navLinksJson: [], ...body },
      });
    }
    if (url.startsWith('/presentations/p-1/frames/') && init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (url === '/presentations/p-1:publish' && init?.method === 'POST') {
      return jsonResponse(200, {
        presentation: { ...presentation, publishedSnapshotId: 'snap-1' },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

const threeFrames = [
  {
    id: 'f-1',
    presentationId: 'p-1',
    elementId: null,
    frameId: 'a',
    position: 0,
    notes: null,
    navLinksJson: [],
  },
  {
    id: 'f-2',
    presentationId: 'p-1',
    elementId: null,
    frameId: 'b',
    position: 1,
    notes: null,
    navLinksJson: [],
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

const editableFrame = {
  id: 'f-1',
  presentationId: 'p-1',
  elementId: null,
  frameId: 'intro',
  position: 0,
  notes: 'speaker note',
  navLinksJson: [],
};

describe('PresentationEditorPage — load and list (PRZ-05)', () => {
  it('lists frames in the order the server returned them', async () => {
    const fetchImpl = baseFetch({
      frames: [
        {
          id: 'f-1',
          presentationId: 'p-1',
          elementId: null,
          frameId: 'intro',
          position: 0,
          notes: null,
          navLinksJson: [],
        },
        {
          id: 'f-2',
          presentationId: 'p-1',
          elementId: null,
          frameId: 'outro',
          position: 1,
          notes: null,
          navLinksJson: [],
        },
      ],
    });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    const rows = screen.getAllByTestId(/^frame-row-/);
    expect(rows.map((row) => row.dataset.testid)).toEqual(['frame-row-f-1', 'frame-row-f-2']);
  });

  it('renders a not-found message when the presentation cannot be loaded', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    renderPage(fetchImpl);

    expect(await screen.findByText('Algo deu errado. Tente de novo.')).toBeTruthy();
  });

  it('never renders a notes field for a frame whose notes came back null (redacted or empty)', async () => {
    const fetchImpl = baseFetch({
      frames: [
        {
          id: 'f-1',
          presentationId: 'p-1',
          elementId: null,
          frameId: null,
          position: 0,
          notes: null,
          navLinksJson: [],
        },
      ],
    });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    expect(screen.queryByTestId('frame-notes-f-1')).toBeNull();
  });
});

describe('PresentationEditorPage — add frame (PRZ-06..08, PRZ-11)', () => {
  it('offers the add-frame form only for canMutate', async () => {
    const fetchImpl = baseFetch({ canMutate: false });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByText('Frames')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Adicionar frame' })).toBeNull();
  });

  it('lists live canvas frame elements as elementId options', async () => {
    const fetchImpl = baseFetch({
      scene: [
        { id: 'frame-el-1', type: 'frame', name: 'Overview' },
        { id: 'rect-1', type: 'rectangle' },
      ],
    });
    renderPage(fetchImpl);

    const select = await screen.findByLabelText('Frame do canvas');
    expect(within(select).getByText('Overview')).toBeTruthy();
  });

  it('blocks submit with neither a canvas frame nor a logical label chosen (PRZ-07)', async () => {
    const fetchImpl = baseFetch();
    renderPage(fetchImpl);

    await screen.findByRole('button', { name: 'Adicionar frame' });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar frame' }));

    expect(
      await screen.findByText('Escolha um frame do canvas ou digite um rótulo lógico.'),
    ).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalledWith(
      '/presentations/p-1/frames',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('a logical label POSTs {frameId, position} and appends the frame at the end on 201', async () => {
    const fetchImpl = baseFetch({
      frames: [
        {
          id: 'f-1',
          presentationId: 'p-1',
          elementId: null,
          frameId: 'first',
          position: 0,
          notes: null,
          navLinksJson: [],
        },
      ],
    });
    renderPage(fetchImpl);

    const input = await screen.findByLabelText('Ou um rótulo lógico (sem frame no canvas)');
    fireEvent.change(input, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar frame' }));

    await waitFor(() => expect(screen.getByTestId('frame-row-f-new')).toBeTruthy());
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ elementId: null, frameId: 'second', position: 1 }),
    });
  });

  it('a 400 (invalid nav link on create) shows a specific error and does not append a frame', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/presentations/p-1') return jsonResponse(200, { presentation, frames: [] });
      if (url === '/diagrams/d-1/bootstrap') {
        return jsonResponse(200, { scene: [], mutatePermissions: { allowed: true } });
      }
      if (url === '/presentations/p-1/frames' && init?.method === 'POST') {
        return jsonResponse(400, {});
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    renderPage(fetchImpl);

    const input = await screen.findByLabelText('Ou um rótulo lógico (sem frame no canvas)');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar frame' }));

    expect(
      await screen.findByText('Um dos links aponta para um frame que não existe mais.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('frame-list')).toBeNull();
  });

  it('a second submit while the first add-frame request is in flight never emits a second POST (edge case, G2)', async () => {
    let postCount = 0;
    let resolveFirst: (response: Response) => void = () => {
      throw new Error('resolveFirst called before the promise executor ran');
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/presentations/p-1') return jsonResponse(200, { presentation, frames: [] });
      if (url === '/diagrams/d-1/bootstrap') {
        return jsonResponse(200, { scene: [], mutatePermissions: { allowed: true } });
      }
      if (url === '/presentations/p-1/frames' && init?.method === 'POST') {
        postCount += 1;
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    renderPage(fetchImpl);

    const input = await screen.findByLabelText('Ou um rótulo lógico (sem frame no canvas)');
    fireEvent.change(input, { target: { value: 'x' } });
    const submit = screen.getByRole('button', { name: 'Adicionar frame' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(postCount).toBe(1);
    resolveFirst(
      jsonResponse(201, {
        frame: { id: 'f-new', presentationId: 'p-1', frameId: 'x', notes: null, navLinksJson: [] },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('frame-row-f-new')).toBeTruthy());
    expect(postCount).toBe(1);
  });
});

describe('PresentationEditorPage — edit notes and delete frame (PRZ-09..12)', () => {
  it('shows the notes edit control only for canMutate, never a raw edit-notes control otherwise', async () => {
    const fetchImpl = baseFetch({ frames: [editableFrame], canMutate: false });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Editar notas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover frame' })).toBeNull();
  });

  it('saving edited notes PATCHes {notes} and updates the frame in place', async () => {
    const fetchImpl = baseFetch({ frames: [editableFrame] });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Editar notas' }));
    const textarea = screen.getByLabelText('Notas do apresentador (privadas)');
    fireEvent.change(textarea, { target: { value: 'updated note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar notas' }));

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames/f-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: 'updated note' }),
      }),
    );
  });

  it('deleting a frame, after confirming, DELETEs and removes it from the list only on 204', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchImpl = baseFetch({ frames: [editableFrame] });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-row-f-1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remover frame' }));

    await waitFor(() => expect(screen.queryByTestId('frame-row-f-1')).toBeNull());
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames/f-1', { method: 'DELETE' });
    confirmSpy.mockRestore();
  });

  it('declining the confirmation never emits a DELETE request', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchImpl = baseFetch({ frames: [editableFrame] });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-row-f-1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remover frame' }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('frame-row-f-1')).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalledWith(
      '/presentations/p-1/frames/f-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    confirmSpy.mockRestore();
  });
});

describe('PresentationEditorPage — reorder frames (PRZ-13..17)', () => {
  it('the first row has "move up" disabled and the last row has "move down" disabled', async () => {
    const fetchImpl = baseFetch({ frames: threeFrames });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    const rows = screen.getAllByTestId(/^frame-row-/);
    const upFirst = within(rows[0] as HTMLElement).getByRole('button', {
      name: 'Mover para cima',
    }) as HTMLButtonElement;
    const downLast = within(rows[2] as HTMLElement).getByRole('button', {
      name: 'Mover para baixo',
    }) as HTMLButtonElement;
    const upMiddle = within(rows[1] as HTMLElement).getByRole('button', {
      name: 'Mover para cima',
    }) as HTMLButtonElement;
    expect(upFirst.disabled).toBe(true);
    expect(downLast.disabled).toBe(true);
    expect(upMiddle.disabled).toBe(false);
  });

  it('moving the last frame to the top PATCHes ALL 3 recalculated positions, not just the moved one', async () => {
    const fetchImpl = baseFetch({ frames: threeFrames });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    const lastRow = screen.getByTestId('frame-row-f-3');
    fireEvent.click(within(lastRow).getByRole('button', { name: 'Mover para cima' }));

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          frames: [
            { id: 'f-1', position: 0 },
            { id: 'f-3', position: 1 },
            { id: 'f-2', position: 2 },
          ],
        }),
      }),
    );

    const rowsAfter = screen.getAllByTestId(/^frame-row-/);
    expect(rowsAfter.map((r) => r.dataset.testid)).toEqual([
      'frame-row-f-1',
      'frame-row-f-3',
      'frame-row-f-2',
    ]);
  });

  it('reverts the displayed order when the reorder request fails', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/presentations/p-1') {
        return jsonResponse(200, { presentation, frames: threeFrames });
      }
      if (url === '/diagrams/d-1/bootstrap') {
        return jsonResponse(200, { scene: [], mutatePermissions: { allowed: true } });
      }
      if (url === '/presentations/p-1/frames' && init?.method === 'PATCH') {
        return jsonResponse(404, {});
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    const lastRow = screen.getByTestId('frame-row-f-3');
    fireEvent.click(within(lastRow).getByRole('button', { name: 'Mover para cima' }));

    await waitFor(() =>
      expect(screen.getAllByText('Algo deu errado. Tente de novo.').length).toBeGreaterThan(0),
    );
    const rows = screen.getAllByTestId(/^frame-row-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'frame-row-f-1',
      'frame-row-f-2',
      'frame-row-f-3',
    ]);
  });
});

describe('PresentationEditorPage — prototype navigation links (PRZ-18..21)', () => {
  it('the target picker never offers the frame being edited itself', async () => {
    const fetchImpl = baseFetch({ frames: threeFrames });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    const firstRow = screen.getByTestId('frame-row-f-1');
    fireEvent.click(
      within(firstRow).getByRole('button', { name: 'Links de navegação (protótipo)' }),
    );

    const select = within(firstRow).getByLabelText('Ir para o frame') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((option) => option.value);
    expect(optionValues).toEqual(['f-2', 'f-3']);
  });

  it('saving selected targets PATCHes {navLinksJson}', async () => {
    const fetchImpl = baseFetch({ frames: threeFrames });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    const firstRow = screen.getByTestId('frame-row-f-1');
    fireEvent.click(
      within(firstRow).getByRole('button', { name: 'Links de navegação (protótipo)' }),
    );

    const select = within(firstRow).getByLabelText('Ir para o frame') as HTMLSelectElement;
    const targetOption = Array.from(select.options).find((o) => o.value === 'f-3');
    if (targetOption) targetOption.selected = true;
    fireEvent.change(select);
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Salvar links' }));

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames/f-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ navLinksJson: [{ targetFrameId: 'f-3' }] }),
      }),
    );
  });

  it('a 400 (target frame no longer exists) shows an error and keeps the previously-saved links displayed', async () => {
    const withLink = [
      { ...threeFrames[0], navLinksJson: [{ targetFrameId: 'f-2' }] },
      threeFrames[1],
      threeFrames[2],
    ];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/presentations/p-1')
        return jsonResponse(200, { presentation, frames: withLink });
      if (url === '/diagrams/d-1/bootstrap') {
        return jsonResponse(200, { scene: [], mutatePermissions: { allowed: true } });
      }
      if (url === '/presentations/p-1/frames/f-1' && init?.method === 'PATCH') {
        return jsonResponse(400, {});
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByTestId('frame-list')).toBeTruthy());
    const firstRow = screen.getByTestId('frame-row-f-1');
    fireEvent.click(
      within(firstRow).getByRole('button', { name: 'Links de navegação (protótipo)' }),
    );
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Salvar links' }));

    expect(
      await screen.findByText('Um dos links aponta para um frame que não existe mais.'),
    ).toBeTruthy();
    // The frame list itself was never touched — still whatever the last successful load held.
    expect(screen.getByTestId('frame-row-f-1')).toBeTruthy();
  });
});

describe('PresentationEditorPage — publish/republish (PRZ-22..25)', () => {
  it('the publish control is absent without canMutate', async () => {
    const fetchImpl = baseFetch({ canMutate: false });
    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByText('Frames')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
  });

  it('publishing an unpublished presentation POSTs :publish with no confirmation, and flips to "republicar" on 200', async () => {
    const fetchImpl = baseFetch({ frames: [] });
    renderPage(fetchImpl);

    const publishButton = await screen.findByRole('button', { name: 'Publicar' });
    fireEvent.click(publishButton);

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1:publish', { method: 'POST' }),
    );
    expect(await screen.findByRole('button', { name: 'Republicar' })).toBeTruthy();
    expect(screen.getByText('Publicada')).toBeTruthy();
  });

  it('republishing an already-published presentation asks for confirmation first, with the swap-warning copy', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const publishedPresentation = { ...presentation, publishedSnapshotId: 'snap-existing' };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/presentations/p-1') {
        return jsonResponse(200, { presentation: publishedPresentation, frames: [] });
      }
      if (url === '/diagrams/d-1/bootstrap') {
        return jsonResponse(200, { scene: [], mutatePermissions: { allowed: true } });
      }
      if (url === '/presentations/p-1:publish' && init?.method === 'POST') {
        return jsonResponse(200, {
          presentation: { ...publishedPresentation, publishedSnapshotId: 'snap-new' },
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    renderPage(fetchImpl);

    const republishButton = await screen.findByRole('button', { name: 'Republicar' });
    expect(screen.getByText(/Republicar substitui o conteúdo/)).toBeTruthy();
    fireEvent.click(republishButton);

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    confirmSpy.mockRestore();
  });

  it('declining the republish confirmation never emits :publish', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const publishedPresentation = { ...presentation, publishedSnapshotId: 'snap-existing' };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/presentations/p-1') {
        return jsonResponse(200, { presentation: publishedPresentation, frames: [] });
      }
      if (url === '/diagrams/d-1/bootstrap') {
        return jsonResponse(200, { scene: [], mutatePermissions: { allowed: true } });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    renderPage(fetchImpl);

    const republishButton = await screen.findByRole('button', { name: 'Republicar' });
    fireEvent.click(republishButton);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).not.toHaveBeenCalledWith('/presentations/p-1:publish', expect.anything());
    confirmSpy.mockRestore();
  });
});

describe('PresentationEditorPage — "Apresentar" launcher (T20, PRZ-35, PRZ-41)', () => {
  it('is disabled with an explanatory reason when the presentation has 0 frames', async () => {
    renderPage(baseFetch({ frames: [] }));

    const presentButton = await screen.findByRole('button', { name: 'Apresentar' });
    expect(presentButton).toHaveProperty('disabled', true);
    expect(screen.getByText('Adicione ao menos um frame para apresentar.')).toBeTruthy();
  });

  it('is enabled and navigates to the presenter route when the presentation has frames', async () => {
    renderPage(baseFetch({ frames: threeFrames }));

    const presentButton = await screen.findByRole('button', { name: 'Apresentar' });
    expect(presentButton).toHaveProperty('disabled', false);
    expect(screen.queryByText('Adicione ao menos um frame para apresentar.')).toBeNull();

    fireEvent.click(presentButton);
    expect(await screen.findByTestId('presenter-page')).toBeTruthy();
  });
});

const publishedPresentation = { ...presentation, publishedSnapshotId: 'snap-1' };

function exportFetch({
  frames = threeFrames as unknown[],
  exportResponse,
}: {
  frames?: unknown[];
  exportResponse: () => Response;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/presentations/p-1') {
      return jsonResponse(200, { presentation: publishedPresentation, frames });
    }
    if (url === '/diagrams/d-1/bootstrap') {
      return jsonResponse(200, { scene: [], mutatePermissions: { allowed: true } });
    }
    if (url === '/presentations/p-1:export-pdf' && init?.method === 'POST') {
      return exportResponse();
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

describe('PresentationEditorPage — export PDF (T24, PRZ-42..45)', () => {
  it('is disabled with a reason when the presentation is not published', async () => {
    renderPage(baseFetch({ frames: threeFrames }));

    const exportButton = await screen.findByRole('button', { name: 'Exportar PDF' });
    expect(exportButton).toHaveProperty('disabled', true);
    expect(screen.getByText('Publique a apresentação antes de exportar.')).toBeTruthy();
  });

  it('is disabled with a reason when published but has 0 frames', async () => {
    renderPage(exportFetch({ frames: [], exportResponse: () => jsonResponse(400, {}) }));

    const exportButton = await screen.findByRole('button', { name: 'Exportar PDF' });
    expect(exportButton).toHaveProperty('disabled', true);
    expect(screen.getByText('Adicione ao menos um frame para exportar.')).toBeTruthy();
  });

  it('confirming emits POST :export-pdf and shows a loading state until it resolves', async () => {
    let resolveExport: (response: Response) => void = () => {
      throw new Error('resolveExport called before the promise executor ran');
    };
    const pending = new Promise<Response>((resolve) => {
      resolveExport = resolve;
    });
    const fetchImpl = exportFetch({ exportResponse: () => pending as unknown as Response });
    renderPage(fetchImpl);

    const exportButton = await screen.findByRole('button', { name: 'Exportar PDF' });
    expect(exportButton).toHaveProperty('disabled', false);
    fireEvent.click(exportButton);

    expect(await screen.findByRole('button', { name: 'Gerando PDF…' })).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1:export-pdf', { method: 'POST' });

    resolveExport(jsonResponse(200, { url: '/exports/p-1.pdf', sizeBytes: 1024, pageCount: 3 }));
    expect(await screen.findByRole('button', { name: 'Exportar PDF' })).toBeTruthy();
  });

  it('200 shows a link to url (opens in a new tab) with pageCount, no automatic download', async () => {
    renderPage(
      exportFetch({
        exportResponse: () =>
          jsonResponse(200, { url: '/exports/p-1.pdf', sizeBytes: 2048, pageCount: 3 }),
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Exportar PDF' }));

    const link = (await screen.findByRole('link', {
      name: 'Abrir PDF (3 página(s))',
    })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/exports/p-1.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('400/404/error responses show distinct messages, never leaving the control stuck loading', async () => {
    const { unmount } = renderPage(exportFetch({ exportResponse: () => jsonResponse(400, {}) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar PDF' }));
    expect(await screen.findByText('Esta apresentação não tem frames para exportar.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar PDF' })).toHaveProperty('disabled', false);
    unmount();

    const { unmount: unmount2 } = renderPage(
      exportFetch({ exportResponse: () => jsonResponse(404, {}) }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar PDF' }));
    expect(await screen.findByText('Publique a apresentação antes de exportar.')).toBeTruthy();
    unmount2();

    renderPage(exportFetch({ exportResponse: () => jsonResponse(500, {}) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar PDF' }));
    // The generic error text also appears in the aria-live announcement region, so
    // this asserts at least one — not exactly one — match (a11y region and the
    // inline error legitimately share the same string, unlike the two other cases).
    await waitFor(() =>
      expect(screen.getAllByText('Algo deu errado. Tente de novo.').length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('button', { name: 'Exportar PDF' })).toHaveProperty('disabled', false);
  });
});
