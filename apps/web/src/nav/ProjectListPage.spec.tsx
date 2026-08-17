import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton. Default language is
// pt-BR, so assertions below use the pt-BR strings.
import '../i18n/index.js';
import { ProjectListPage } from './ProjectListPage.js';

beforeAll(() => {
  // Same jsdom `<dialog>` shim as WorkspaceListPage.spec.tsx / ConfirmArchiveDialog.spec.tsx.
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function workspaceDetailResponse(role: string, name = 'Acme Workspace') {
  return jsonResponse(200, { workspace: { id: 'ws-1', name, role } });
}

function renderPage(fetchImpl: typeof fetch, workspaceId = 'ws-1') {
  return render(
    <MemoryRouter initialEntries={[`/w/${workspaceId}`]}>
      <Routes>
        <Route path="/w/:workspaceId" element={<ProjectListPage fetchImpl={fetchImpl} />} />
        <Route path="/" element={<div data-testid="workspace-list-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProjectListPage (NAV-02, NAV-04, NAV-09..11)', () => {
  it('resolves and displays the workspace name, and lists projects linking to /w/:workspaceId/p/:projectId', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor', 'Acme Workspace');
      if (url === '/projects?workspaceId=ws-1')
        return jsonResponse(200, {
          items: [
            { id: 'p-1', workspaceId: 'ws-1', name: 'Project One' },
            { id: 'p-2', workspaceId: 'ws-1', name: 'Project Two' },
          ],
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByText('Acme Workspace')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Project One' })).toHaveProperty(
      'href',
      expect.stringContaining('/w/ws-1/p/p-1'),
    );
    expect(screen.getByRole('link', { name: 'Project Two' })).toHaveProperty(
      'href',
      expect.stringContaining('/w/ws-1/p/p-2'),
    );
  });

  it('a 404 on GET /workspaces/:id shows the not-found message, without fetching the project list (NAV-04)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return jsonResponse(404, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(
      await screen.findByText('Este item não existe ou você não tem acesso a ele.'),
    ).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shows create/rename/archive when the resolved role grants project:write (editor)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1')
        return jsonResponse(200, {
          items: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Project One' }],
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await screen.findByRole('link', { name: 'Project One' });
    expect(screen.getByRole('button', { name: 'Renomear' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arquivar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar projeto' })).toBeTruthy();
  });

  it('hides create/rename/archive when the resolved role lacks project:write (viewer)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('viewer');
      if (url === '/projects?workspaceId=ws-1')
        return jsonResponse(200, {
          items: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Project One' }],
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await screen.findByRole('link', { name: 'Project One' });
    expect(screen.queryByRole('button', { name: 'Renomear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arquivar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Criar projeto' })).toBeNull();
  });

  it('an empty project list renders a simple empty message, not an error', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByText('Este workspace ainda não tem projetos.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('back-navigation to / is present', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByText('Este workspace ainda não tem projetos.');

    fireEvent.click(screen.getByRole('link', { name: 'Voltar' }));
    expect(screen.getByTestId('workspace-list-page')).toBeTruthy();
  });

  it('creating a project POSTs {workspaceId, name} and adds it to the list without navigating away (NAV-10)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1' && !init) return jsonResponse(200, { items: [] });
      if (url === '/projects' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({
          workspaceId: 'ws-1',
          name: 'New Project',
        });
        return jsonResponse(201, {
          project: { id: 'p-new', workspaceId: 'ws-1', name: 'New Project' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Criar projeto' });

    fireEvent.change(screen.getByLabelText('Nome do projeto'), {
      target: { value: 'New Project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar projeto' }));

    expect(await screen.findByRole('link', { name: 'New Project' })).toBeTruthy();
  });

  it('rename: a 403 shows a failure message and keeps the previous value (NAV-16)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1' && !init)
        return jsonResponse(200, {
          items: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Project One' }],
        });
      if (url === '/projects/p-1' && init?.method === 'PATCH') return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Project One' });

    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }));
    const row = within(screen.getByRole('listitem'));
    fireEvent.change(row.getByLabelText('Nome do projeto'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(row.getByRole('button', { name: 'Salvar' }));

    expect(await row.findByText('Algo deu errado. Tente novamente.')).toBeTruthy();
    fireEvent.click(row.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('link', { name: 'Project One' })).toBeTruthy();
  });

  it('archive: confirming DELETEs and removes the project from the list', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1' && !init)
        return jsonResponse(200, {
          items: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Project One' }],
        });
      if (url === '/projects/p-1' && init?.method === 'DELETE') return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Project One' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Project One');
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Project One' })).toBeNull());
  });
});
