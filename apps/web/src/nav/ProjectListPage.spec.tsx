import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Also a side-effect import — initializes the shared i18next singleton. Default language is
// pt-BR, so assertions below use the pt-BR strings unless a test explicitly switches locale
// (NAV-26).
import i18n from '../i18n/index.js';
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

  it('shows a "Membros" link to /w/:workspaceId/members for a viewer, who gets none of the write actions above (MEM-02, T6)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('viewer');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    const membersLink = await screen.findByRole('link', { name: 'Membros' });
    expect(membersLink).toHaveProperty('href', expect.stringContaining('/w/ws-1/members'));
  });

  it('shows a "Webhooks" link to /w/:workspaceId/webhooks for a workspace_admin (WHK-02, T6)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('workspace_admin');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    const webhooksLink = await screen.findByRole('link', { name: 'Webhooks' });
    expect(webhooksLink).toHaveProperty('href', expect.stringContaining('/w/ws-1/webhooks'));
  });

  it('hides the "Webhooks" link from an editor, who lacks workspace:manage_members (WHK-02, T6)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    // The members link is universal, so its presence proves the page finished loading before
    // the absence below is asserted.
    await screen.findByRole('link', { name: 'Membros' });
    expect(screen.queryByRole('link', { name: 'Webhooks' })).toBeNull();
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

  it('back link, project link, create/rename/archive-row, archive-current-workspace, and the confirm dialog button are all keyboard-focusable (NAV-24)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('workspace_admin');
      if (url === '/projects?workspaceId=ws-1')
        return jsonResponse(200, {
          items: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Project One' }],
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const backLink = await screen.findByRole('link', { name: 'Voltar' });
    backLink.focus();
    expect(document.activeElement).toBe(backLink);

    const projectLink = screen.getByRole('link', { name: 'Project One' });
    projectLink.focus();
    expect(document.activeElement).toBe(projectLink);

    const createButton = screen.getByRole('button', { name: 'Criar projeto' });
    createButton.focus();
    expect(document.activeElement).toBe(createButton);

    const renameButton = screen.getByRole('button', { name: 'Renomear' });
    renameButton.focus();
    expect(document.activeElement).toBe(renameButton);

    const archiveRowButton = screen.getByRole('button', { name: 'Arquivar' });
    archiveRowButton.focus();
    expect(document.activeElement).toBe(archiveRowButton);

    const archiveWorkspaceButton = screen.getByRole('button', { name: 'Arquivar este workspace' });
    archiveWorkspaceButton.focus();
    expect(document.activeElement).toBe(archiveWorkspaceButton);

    fireEvent.click(archiveRowButton);
    const confirmButton = screen.getByTestId('confirm-archive-confirm');
    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);
  });

  it('offers "archive this workspace" only when the resolved role grants workspace:write (NAV-21)', async () => {
    const adminFetch = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('workspace_admin');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    renderPage(adminFetch);
    expect(await screen.findByRole('button', { name: 'Arquivar este workspace' })).toBeTruthy();
    cleanup();

    // editor grants project:write but not workspace:write — the archive-current-workspace
    // action must not appear for it, even though row-level project archive does.
    const editorFetch = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    renderPage(editorFetch);
    await screen.findByText('Este workspace ainda não tem projetos.');
    expect(screen.queryByRole('button', { name: 'Arquivar este workspace' })).toBeNull();
  });

  it('archiving the current workspace DELETEs /workspaces/:id and navigates to / on 204 (NAV-21)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces/ws-1' && !init) return workspaceDetailResponse('workspace_admin');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      if (url === '/workspaces/ws-1' && init?.method === 'DELETE') return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Arquivar este workspace' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar este workspace' }));
    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Acme Workspace');
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(screen.getByTestId('workspace-list-page')).toBeTruthy());
  });

  it('archiving the current workspace on 403/404 announces failure and keeps the user on the page (NAV-21, NAV-20)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces/ws-1' && !init) return workspaceDetailResponse('workspace_admin');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      if (url === '/workspaces/ws-1' && init?.method === 'DELETE') return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Arquivar este workspace' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar este workspace' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('project-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.getByText('Este workspace ainda não tem projetos.')).toBeTruthy();
  });

  it('renders in the en locale as well as pt-BR (NAV-26)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('workspace_admin');
      if (url === '/projects?workspaceId=ws-1')
        return jsonResponse(200, {
          items: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Project One' }],
        });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await i18n.changeLanguage('en');
    renderPage(fetchImpl);

    expect(await screen.findByRole('link', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive this workspace' })).toBeTruthy();
  });

  it('announces archive completion in an aria-live=polite region (NAV-25)', async () => {
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

    const liveRegion = screen.getByTestId('project-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(liveRegion.textContent).toBe('Arquivar'));
  });

  it('never submits POST /projects for an empty or whitespace-only name (edge case)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Criar projeto' });

    fireEvent.change(screen.getByLabelText('Nome do projeto'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar projeto' }));

    // Only the initial GET /workspaces/:id + GET /projects calls, never a POST.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('the "import diagram" action is reachable per project row when the role grants diagram:write (XPRT-12/T7)', async () => {
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

    const trigger = screen.getByRole('button', { name: 'Importar diagrama' });
    expect(trigger).toBeTruthy();
    // Keyboard-focusable (XPRT-16), same convention as NAV-24's own focus assertions.
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });

  it('the "import diagram" action is absent when the role lacks diagram:write (viewer, XPRT-12)', async () => {
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
    expect(screen.queryByRole('button', { name: 'Importar diagrama' })).toBeNull();
  });

  it('a failed import confirmation is announced in an aria-live=polite region, in the en locale too (XPRT-17/18)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse('editor');
      if (url === '/projects?workspaceId=ws-1')
        return jsonResponse(200, {
          items: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Project One' }],
        });
      if (url === '/projects/p-1/import' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        if (body.confirm) {
          // Confirm fails even though the preview already succeeded (e.g. the file changed
          // server-side between preview and confirm) — the announcement still needs to fire.
          return jsonResponse(400, { title: 'title is required to confirm an import' });
        }
        return jsonResponse(200, { preview: { elementCount: 2, appState: {} } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    // NAV-26 pattern: switch locale mid-test.
    await i18n.changeLanguage('en');
    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Project One' });

    fireEvent.click(screen.getByRole('button', { name: 'Import diagram' }));
    const file = new File(['{"elements":[{},{}],"appState":{}}'], 'scene.excalidraw', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    await screen.findByText('2 elements will be imported');

    const liveRegion = screen.getByTestId('import-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    fireEvent.change(screen.getByLabelText('Diagram title'), { target: { value: 'Imported' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));

    await waitFor(() =>
      expect(liveRegion.textContent).toBe('title is required to confirm an import'),
    );
  });
});

describe('ProjectListPage — workspace AI provider admin link (PROV-07)', () => {
  function fetchWithRole(role: string) {
    return vi.fn(async (url: string) => {
      if (url === '/workspaces/ws-1') return workspaceDetailResponse(role);
      if (url === '/projects?workspaceId=ws-1') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  it('shows the link for a role granting workspace:manage_members (PROV-07)', async () => {
    renderPage(fetchWithRole('workspace_admin'));
    await screen.findByRole('heading', { name: 'Acme Workspace' });

    expect(screen.getByRole('link', { name: 'Providers de IA' })).toHaveProperty(
      'href',
      expect.stringContaining('/w/ws-1/admin/ai-providers'),
    );
  });

  it('omits the link for a role that does not grant it (PROV-07)', async () => {
    renderPage(fetchWithRole('editor'));
    await screen.findByRole('heading', { name: 'Acme Workspace' });

    expect(screen.queryByRole('link', { name: 'Providers de IA' })).toBeNull();
  });
});
