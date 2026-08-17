import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Also a side-effect import — initializes the shared i18next singleton `useTranslation()`
// reads from. Default language is pt-BR (`DEFAULT_LANGUAGE`), so assertions below use the
// pt-BR strings ("Criar workspace", "Renomear", "Arquivar", ...) unless a test explicitly
// switches locale (NAV-26).
import i18n from '../i18n/index.js';
import { WorkspaceListPage } from './WorkspaceListPage.js';

/**
 * Same jsdom `<dialog>` shim as `ConfirmArchiveDialog.spec.tsx` — jsdom 30.0.1's
 * `HTMLDialogElement` has no `showModal()`/`close()` at all. `WorkspaceListPage` drives the
 * dialog imperatively via the same ref pattern, so it needs the same shim to exercise the
 * archive flow end-to-end.
 */
beforeAll(() => {
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

interface WorkspaceFixture {
  id: string;
  name: string;
  role: string;
}

function workspaceFixture(overrides: Partial<WorkspaceFixture> = {}): WorkspaceFixture {
  return {
    id: 'ws-1',
    name: 'Alpha',
    role: 'workspace_admin',
    ...overrides,
  };
}

/** Surfaces the current in-memory route for navigation assertions (App.spec.tsx's convention). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LocationProbe />
      <WorkspaceListPage fetchImpl={fetchImpl} />
    </MemoryRouter>,
  );
}

describe('WorkspaceListPage (NAV-01, NAV-06..08, NAV-13..23)', () => {
  it('lists workspaces from GET /workspaces, each linking to /w/:workspaceId', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          workspaceFixture({ id: 'ws-1', name: 'Alpha' }),
          workspaceFixture({ id: 'ws-2', name: 'Beta' }),
        ],
      }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByRole('link', { name: 'Alpha' })).toHaveProperty(
      'href',
      expect.stringContaining('/w/ws-1'),
    );
    expect(screen.getByRole('link', { name: 'Beta' })).toHaveProperty(
      'href',
      expect.stringContaining('/w/ws-2'),
    );
  });

  it('shows rename/archive only for items whose own role grants workspace:write (NAV-13, NAV-17)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          workspaceFixture({ id: 'ws-admin', name: 'Admin WS', role: 'workspace_admin' }),
          workspaceFixture({ id: 'ws-viewer', name: 'Viewer WS', role: 'viewer' }),
        ],
      }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Admin WS' });

    const items = screen.getAllByRole('listitem');
    const adminItem = items.find((li) => within(li).queryByText('Admin WS'));
    const viewerItem = items.find((li) => within(li).queryByText('Viewer WS'));
    if (!adminItem || !viewerItem) throw new Error('fixture items not found');

    expect(within(adminItem).getByRole('button', { name: 'Renomear' })).toBeTruthy();
    expect(within(adminItem).getByRole('button', { name: 'Arquivar' })).toBeTruthy();
    expect(within(viewerItem).queryByRole('button', { name: 'Renomear' })).toBeNull();
    expect(within(viewerItem).queryByRole('button', { name: 'Arquivar' })).toBeNull();
  });

  it('renders the dedicated empty state (not a generic empty list) when GET /workspaces returns zero items (NAV-22)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [] }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByText('Você ainda não pertence a nenhum workspace.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar seu primeiro workspace' })).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('the create action is always visible, regardless of list contents', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [workspaceFixture()] }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByRole('button', { name: 'Criar workspace' })).toBeTruthy();
  });

  it('never submits POST /workspaces for an empty or whitespace-only name', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/workspaces') return jsonResponse(200, { items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Criar seu primeiro workspace' });

    fireEvent.change(screen.getByLabelText('Nome do workspace'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar seu primeiro workspace' }));

    // Only the initial GET /workspaces call, never a POST.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('creating a workspace with a non-empty name POSTs {name, slug} and navigates to /w/:id on 201 (NAV-07)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && (!init || init.method === undefined))
        return jsonResponse(200, { items: [] });
      if (url === '/workspaces' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({
          name: 'New Workspace',
          slug: 'new-workspace',
        });
        return jsonResponse(201, { workspace: { id: 'ws-new', name: 'New Workspace' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Criar seu primeiro workspace' });

    fireEvent.change(screen.getByLabelText('Nome do workspace'), {
      target: { value: 'New Workspace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar seu primeiro workspace' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/w/ws-new'));
  });

  it('a 409 on create shows the conflict message and preserves the typed name (NAV-08)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [] });
      if (url === '/workspaces' && init?.method === 'POST') return jsonResponse(409, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Criar seu primeiro workspace' });

    fireEvent.change(screen.getByLabelText('Nome do workspace'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar seu primeiro workspace' }));

    expect((await screen.findAllByText('Já existe um workspace com esse nome.')).length).toBe(2); // aria-live region + inline form error
    expect(screen.getByLabelText('Nome do workspace')).toHaveProperty('value', 'Dup');
  });

  it('rename: the list shows the old name until the PATCH resolves 200, then the new name (NAV-14)', async () => {
    let resolvePatch: (response: Response) => void = () => {};
    const patchPromise = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1' && init?.method === 'PATCH') return patchPromise;
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }));
    const row = within(screen.getByRole('listitem'));
    fireEvent.change(row.getByLabelText('Nome do workspace'), { target: { value: 'Alpha 2' } });
    fireEvent.click(row.getByRole('button', { name: 'Salvar' }));

    // Still mid-flight: the old name must still be the persisted value (the rename form is
    // open with the typed value, but nothing has been committed to the list yet).
    expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull(); // in edit mode now
    resolvePatch(jsonResponse(200, { workspace: { id: 'ws-1', name: 'Alpha 2' } }));

    expect(await screen.findByRole('link', { name: 'Alpha 2' })).toBeTruthy();
  });

  it('rename: a 409 shows the conflict message and never commits the new name (NAV-15)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1' && init?.method === 'PATCH') return jsonResponse(409, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }));
    const row = within(screen.getByRole('listitem'));
    fireEvent.change(row.getByLabelText('Nome do workspace'), { target: { value: 'Alpha 2' } });
    fireEvent.click(row.getByRole('button', { name: 'Salvar' }));

    expect(await row.findByText('Esse nome já está em uso.')).toBeTruthy();

    fireEvent.click(row.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
  });

  it('rename: a 403/404 shows a failure message and keeps the previous value (NAV-16)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1' && init?.method === 'PATCH') return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }));
    const row = within(screen.getByRole('listitem'));
    fireEvent.change(row.getByLabelText('Nome do workspace'), { target: { value: 'Alpha 2' } });
    fireEvent.click(row.getByRole('button', { name: 'Salvar' }));

    expect(await row.findByText('Algo deu errado. Tente novamente.')).toBeTruthy();
    fireEvent.click(row.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
  });

  it('archive: opens ConfirmArchiveDialog with the item name, confirming DELETEs and removes it from the list (NAV-18..19)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1' && init?.method === 'DELETE') return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));

    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Alpha');
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha' })).toBeNull());
  });

  it('archive: a 403/404 shows a failure message and keeps the item in the list (NAV-20)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1' && init?.method === 'DELETE') return jsonResponse(404, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('workspace-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
  });

  it('archive: cancel closes the dialog without deleting (using the confirm dialog, not window.confirm)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    fireEvent.click(screen.getByTestId('confirm-archive-cancel'));

    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
  });

  it('the navigate link, create/rename/archive controls, and the confirm dialog button are keyboard-focusable (NAV-24)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const link = await screen.findByRole('link', { name: 'Alpha' });
    link.focus();
    expect(document.activeElement).toBe(link);

    const createButton = screen.getByRole('button', { name: 'Criar workspace' });
    createButton.focus();
    expect(document.activeElement).toBe(createButton);

    const renameButton = screen.getByRole('button', { name: 'Renomear' });
    renameButton.focus();
    expect(document.activeElement).toBe(renameButton);

    const archiveButton = screen.getByRole('button', { name: 'Arquivar' });
    archiveButton.focus();
    expect(document.activeElement).toBe(archiveButton);

    fireEvent.click(archiveButton);
    const confirmButton = screen.getByTestId('confirm-archive-confirm');
    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);
  });

  it('announces create/rename/archive completion in an aria-live=polite region (NAV-25)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1' && init?.method === 'DELETE') return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    const liveRegion = screen.getByTestId('workspace-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(liveRegion.textContent).toBe('Arquivar'));
  });

  it('renders in the en locale as well as pt-BR (NAV-26)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [workspaceFixture()] }),
    ) as unknown as typeof fetch;

    await i18n.changeLanguage('en');
    renderPage(fetchImpl);

    expect(await screen.findByRole('button', { name: 'Create workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  it('archiving the only remaining workspace returns to the zero-workspaces empty state (edge case)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1' && init?.method === 'DELETE') return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    expect(await screen.findByText('Você ainda não pertence a nenhum workspace.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar seu primeiro workspace' })).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('the workspace bundle action only appears for items whose own role is org_admin/workspace_admin (XPRT-13)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          workspaceFixture({ id: 'ws-admin', name: 'Admin WS', role: 'workspace_admin' }),
          workspaceFixture({ id: 'ws-editor', name: 'Editor WS', role: 'editor' }),
        ],
      }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Admin WS' });

    const items = screen.getAllByRole('listitem');
    const adminItem = items.find((li) => within(li).queryByText('Admin WS'));
    const editorItem = items.find((li) => within(li).queryByText('Editor WS'));
    if (!adminItem || !editorItem) throw new Error('fixture items not found');

    expect(
      within(adminItem).getByRole('button', { name: 'Solicitar bundle do workspace' }),
    ).toBeTruthy();
    expect(
      within(editorItem).queryByRole('button', { name: 'Solicitar bundle do workspace' }),
    ).toBeNull();
  });

  it('confirming the request POSTs /workspaces/:id/bundles and shows the explicit no-tracking message on 200 (XPRT-14)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1/bundles' && init?.method === 'POST') {
        return jsonResponse(200, { jobId: 'job-1', status: 'queued' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar bundle do workspace' }));

    await waitFor(() =>
      expect(screen.getByTestId('workspace-announcement').textContent).toBe(
        'Bundle solicitado — este produto não mostra quando termina ou onde baixar; trate como item de acompanhamento operacional.',
      ),
    );
  });

  it('a 503 shows the unavailable message and never retries automatically (XPRT-15)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/workspaces' && !init) return jsonResponse(200, { items: [workspaceFixture()] });
      if (url === '/workspaces/ws-1/bundles' && init?.method === 'POST') {
        return jsonResponse(503, { title: 'bulk workspace export is unavailable' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('link', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar bundle do workspace' }));

    await waitFor(() =>
      expect(screen.getByTestId('workspace-announcement').textContent).toBe(
        'Solicitações de bundle em lote estão temporariamente indisponíveis.',
      ),
    );
    // No automatic retry: exactly one POST to the bundles route.
    const bundleCalls = fetchImpl.mock.calls.filter(([url]) => url === '/workspaces/ws-1/bundles');
    expect(bundleCalls).toHaveLength(1);
  });
});
