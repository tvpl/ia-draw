import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Also a side-effect import — initializes the shared i18next singleton. Default language is
// pt-BR, so assertions below use the pt-BR strings unless a test explicitly switches locale
// (NAV-26).
import i18n from '../i18n/index.js';
import { DiagramListPage } from './DiagramListPage.js';

beforeAll(() => {
  // Same jsdom `<dialog>` shim as the other nav *.spec.tsx files.
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

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  // Restores the default locale in case a test switched it (NAV-26) and failed before
  // switching back, so later tests in this file aren't left asserting the wrong strings.
  await i18n.changeLanguage('pt-BR');
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function projectDetailResponse(name = 'Project One') {
  return jsonResponse(200, { project: { id: 'p-1', workspaceId: 'ws-1', name } });
}

function workspaceDetailResponse(role: string) {
  return jsonResponse(200, { workspace: { id: 'ws-1', name: 'Acme Workspace', role } });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/w/ws-1/p/p-1']}>
      <LocationProbe />
      <Routes>
        <Route
          path="/w/:workspaceId/p/:projectId"
          element={<DiagramListPage fetchImpl={fetchImpl} />}
        />
        <Route path="/w/:workspaceId" element={<div data-testid="project-list-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockFetch(
  handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>,
): typeof fetch {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    return handler(init);
  }) as unknown as typeof fetch;
}

describe('DiagramListPage (NAV-03, NAV-04, NAV-12, empty-list edge case)', () => {
  it('resolves the project title and role, and lists diagrams linking to the editor route', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse('Project One'),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () =>
        jsonResponse(200, {
          items: [
            { id: 'd-1', projectId: 'p-1', title: 'Diagram One' },
            { id: 'd-2', projectId: 'p-1', title: 'Diagram Two' },
          ],
        }),
    });

    renderPage(fetchImpl);

    expect(await screen.findByText('Project One')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Diagram One' })).toHaveProperty(
      'href',
      expect.stringContaining('/w/ws-1/d/d-1'),
    );
    expect(screen.getByRole('link', { name: 'Diagram Two' })).toHaveProperty(
      'href',
      expect.stringContaining('/w/ws-1/d/d-2'),
    );
  });

  it('a 404 on either GET /projects/:id or GET /workspaces/:id shows the not-found message (NAV-04)', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => jsonResponse(404, {}),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
    });

    renderPage(fetchImpl);

    expect(
      await screen.findByText('Este item não existe ou você não tem acesso a ele.'),
    ).toBeTruthy();
  });

  it('shows create/rename/archive only when the resolved role grants diagram:write (editor vs viewer)', async () => {
    const editorFetch = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () =>
        jsonResponse(200, { items: [{ id: 'd-1', projectId: 'p-1', title: 'Diagram One' }] }),
    });
    renderPage(editorFetch);
    await screen.findByRole('link', { name: 'Diagram One' });
    expect(screen.getByRole('button', { name: 'Renomear' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arquivar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar diagrama' })).toBeTruthy();
    cleanup();

    const viewerFetch = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('viewer'),
      '/diagrams?projectId=p-1': () =>
        jsonResponse(200, { items: [{ id: 'd-1', projectId: 'p-1', title: 'Diagram One' }] }),
    });
    renderPage(viewerFetch);
    await screen.findByRole('link', { name: 'Diagram One' });
    expect(screen.queryByRole('button', { name: 'Renomear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arquivar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Criar diagrama' })).toBeNull();
  });

  it('an empty project renders a simple empty state with the create action, not an error (edge case)', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () => jsonResponse(200, { items: [] }),
    });

    renderPage(fetchImpl);

    expect(await screen.findByText('Este projeto ainda não tem diagramas.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar diagrama' })).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('back-navigation to /w/:workspaceId is present', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () => jsonResponse(200, { items: [] }),
    });

    renderPage(fetchImpl);
    await screen.findByText('Este projeto ainda não tem diagramas.');

    fireEvent.click(screen.getByRole('link', { name: 'Voltar' }));
    expect(screen.getByTestId('project-list-page')).toBeTruthy();
  });

  it('creating a diagram POSTs {projectId, title} and navigates straight into its editor on 201 (NAV-12)', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () => jsonResponse(200, { items: [] }),
      '/diagrams': (init) => {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init?.body as string)).toEqual({
          projectId: 'p-1',
          title: 'New Diagram',
        });
        return jsonResponse(201, {
          diagram: { id: 'd-new', projectId: 'p-1', title: 'New Diagram' },
        });
      },
    });

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Criar diagrama' });

    fireEvent.change(screen.getByLabelText('Título do diagrama'), {
      target: { value: 'New Diagram' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar diagrama' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/w/ws-1/d/d-new'));
  });

  it('rename: a 404 shows a failure message and keeps the previous title', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () =>
        jsonResponse(200, { items: [{ id: 'd-1', projectId: 'p-1', title: 'Diagram One' }] }),
      '/diagrams/d-1': (init) => {
        expect(init?.method).toBe('PATCH');
        return jsonResponse(404, {});
      },
    });

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Diagram One' });

    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }));
    const row = within(screen.getByRole('listitem'));
    fireEvent.change(row.getByLabelText('Título do diagrama'), { target: { value: 'Renamed' } });
    fireEvent.click(row.getByRole('button', { name: 'Salvar' }));

    expect(await row.findByText('Algo deu errado. Tente novamente.')).toBeTruthy();
    fireEvent.click(row.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('link', { name: 'Diagram One' })).toBeTruthy();
  });

  it('archive: confirming DELETEs and removes the diagram from the list', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () =>
        jsonResponse(200, { items: [{ id: 'd-1', projectId: 'p-1', title: 'Diagram One' }] }),
      '/diagrams/d-1': (init) => {
        expect(init?.method).toBe('DELETE');
        return jsonResponse(204, null);
      },
    });

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Diagram One' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Diagram One');
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Diagram One' })).toBeNull());
  });

  it('back link, diagram link, create/rename/archive-row, archive-current-project, and the confirm dialog button are all keyboard-focusable (NAV-24)', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () =>
        jsonResponse(200, { items: [{ id: 'd-1', projectId: 'p-1', title: 'Diagram One' }] }),
    });

    renderPage(fetchImpl);
    const backLink = await screen.findByRole('link', { name: 'Voltar' });
    backLink.focus();
    expect(document.activeElement).toBe(backLink);

    const diagramLink = screen.getByRole('link', { name: 'Diagram One' });
    diagramLink.focus();
    expect(document.activeElement).toBe(diagramLink);

    const createButton = screen.getByRole('button', { name: 'Criar diagrama' });
    createButton.focus();
    expect(document.activeElement).toBe(createButton);

    const renameButton = screen.getByRole('button', { name: 'Renomear' });
    renameButton.focus();
    expect(document.activeElement).toBe(renameButton);

    const archiveRowButton = screen.getByRole('button', { name: 'Arquivar' });
    archiveRowButton.focus();
    expect(document.activeElement).toBe(archiveRowButton);

    const archiveProjectButton = screen.getByRole('button', { name: 'Arquivar este projeto' });
    archiveProjectButton.focus();
    expect(document.activeElement).toBe(archiveProjectButton);

    fireEvent.click(archiveRowButton);
    const confirmButton = screen.getByTestId('confirm-archive-confirm');
    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);
  });

  it('offers "archive this project" only when the resolved role grants project:write (NAV-21)', async () => {
    const editorFetch = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () => jsonResponse(200, { items: [] }),
    });
    renderPage(editorFetch);
    expect(await screen.findByRole('button', { name: 'Arquivar este projeto' })).toBeTruthy();
    cleanup();

    const viewerFetch = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('viewer'),
      '/diagrams?projectId=p-1': () => jsonResponse(200, { items: [] }),
    });
    renderPage(viewerFetch);
    await screen.findByText('Este projeto ainda não tem diagramas.');
    expect(screen.queryByRole('button', { name: 'Arquivar este projeto' })).toBeNull();
  });

  it('archiving the current project DELETEs /projects/:id and navigates to /w/:workspaceId on 204 (NAV-21)', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': (init) => {
        if (init?.method === 'DELETE') return jsonResponse(204, null);
        return projectDetailResponse('Project One');
      },
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () => jsonResponse(200, { items: [] }),
    });

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Arquivar este projeto' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar este projeto' }));
    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Project One');
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/w/ws-1'));
  });

  it('archiving the current project on 403/404 announces failure and keeps the user on the page (NAV-21, NAV-20)', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': (init) => {
        if (init?.method === 'DELETE') return jsonResponse(404, {});
        return projectDetailResponse('Project One');
      },
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () => jsonResponse(200, { items: [] }),
    });

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Arquivar este projeto' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar este projeto' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('diagram-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.getByText('Este projeto ainda não tem diagramas.')).toBeTruthy();
  });

  it('renders in the en locale as well as pt-BR (NAV-26)', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () => jsonResponse(200, { items: [] }),
    });

    await i18n.changeLanguage('en');
    renderPage(fetchImpl);

    expect(await screen.findByText('This project has no diagrams yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create diagram' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive this project' })).toBeTruthy();
  });

  it('announces archive completion in an aria-live=polite region (NAV-25)', async () => {
    const fetchImpl = mockFetch({
      '/projects/p-1': () => projectDetailResponse(),
      '/workspaces/ws-1': () => workspaceDetailResponse('editor'),
      '/diagrams?projectId=p-1': () =>
        jsonResponse(200, { items: [{ id: 'd-1', projectId: 'p-1', title: 'Diagram One' }] }),
      '/diagrams/d-1': (init) => {
        expect(init?.method).toBe('DELETE');
        return jsonResponse(204, null);
      },
    });

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Diagram One' });

    const liveRegion = screen.getByTestId('diagram-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(liveRegion.textContent).toBe('Arquivar'));
  });
});
