import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.js';
import { PresentationListPage } from './PresentationListPage.js';

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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/d/d-1/present']}>
      <LocationProbe />
      <Routes>
        <Route
          path="/w/:workspaceId/d/:diagramId/present"
          element={<PresentationListPage fetchImpl={fetchImpl} />}
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId"
          element={<div data-testid="editor-page" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function routedFetch(canMutate: boolean, presentations: unknown[] = []) {
  return vi.fn(async (url: string) => {
    if (url.includes('/bootstrap')) {
      return jsonResponse(200, { mutatePermissions: { allowed: canMutate } });
    }
    if (url.startsWith('/presentations?diagramId=')) {
      return jsonResponse(200, { presentations });
    }
    if (url === '/presentations') {
      return jsonResponse(201, {
        presentation: { id: 'p-new', diagramId: 'd-1', name: 'New deck' },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

describe('PresentationListPage (PRZ-01..04)', () => {
  it('lists presentations for diagram:read, without the create form (PRZ-01/02)', async () => {
    const fetchImpl = routedFetch(false, [
      {
        presentation: { id: 'p-1', diagramId: 'd-1', name: 'Roadmap' },
        frames: [{ id: 'f-1' }, { id: 'f-2' }],
      },
    ]);
    renderPage(fetchImpl);

    expect(await screen.findByText('Roadmap')).toBeTruthy();
    expect(screen.queryByLabelText('Nome da apresentação')).toBeNull();
  });

  it('shows the create form only when canMutate is true (PRZ-02)', async () => {
    const fetchImpl = routedFetch(true, []);
    renderPage(fetchImpl);

    expect(await screen.findByLabelText('Nome da apresentação')).toBeTruthy();
  });

  it('creating navigates to the editor route of the new presentation on 201 (PRZ-03/04)', async () => {
    const fetchImpl = routedFetch(true, []);
    renderPage(fetchImpl);

    const input = await screen.findByLabelText('Nome da apresentação');
    fireEvent.change(input, { target: { value: 'New deck' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar apresentação' }));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/w/ws-1/d/d-1/present/p-new'),
    );
    expect(fetchImpl).toHaveBeenCalledWith('/presentations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diagramId: 'd-1', name: 'New deck' }),
    });
  });

  it('shows an empty-state message when there are no presentations', async () => {
    const fetchImpl = routedFetch(false, []);
    renderPage(fetchImpl);

    expect(await screen.findByText('Nenhuma apresentação ainda.')).toBeTruthy();
  });

  it('shows a generic error and no list on a listing failure', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/bootstrap'))
        return jsonResponse(200, { mutatePermissions: { allowed: false } });
      return jsonResponse(404, {});
    }) as unknown as typeof fetch;
    renderPage(fetchImpl);

    expect(await screen.findByText('Algo deu errado. Tente de novo.')).toBeTruthy();
  });
});
