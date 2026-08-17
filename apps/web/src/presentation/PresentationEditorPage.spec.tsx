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
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

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
});
