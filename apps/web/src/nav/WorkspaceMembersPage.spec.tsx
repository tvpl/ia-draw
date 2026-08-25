import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider.js';
// Side-effect import — initializes the shared i18next singleton, same convention as
// ProjectListPage.spec.tsx. Default language is pt-BR.
import '../i18n/index.js';
import { WorkspaceMembersPage } from './WorkspaceMembersPage.js';

beforeAll(() => {
  // Same jsdom <dialog> shim as ProjectListPage.spec.tsx / ConfirmArchiveDialog.spec.tsx.
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

/** The session `AuthProvider` resolves in every test below — the logged-in actor. */
const ME = { id: 'user-1', email: 'me@example.com', displayName: 'Me' };

function meResponse(): Response {
  return jsonResponse(200, { user: ME });
}

function membersResponse(items: unknown[]): Response {
  return jsonResponse(200, { items });
}

function renderPage(fetchImpl: typeof fetch, workspaceId = 'ws-1') {
  return render(
    <MemoryRouter initialEntries={[`/w/${workspaceId}/members`]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <Routes>
          <Route
            path="/w/:workspaceId/members"
            element={<WorkspaceMembersPage fetchImpl={fetchImpl} />}
          />
          <Route path="/w/:workspaceId" element={<div data-testid="project-list-page" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('WorkspaceMembersPage — P1: Ver membros (MEM-01, MEM-03)', () => {
  it('lists members with email, display name, and role, read-only for a role without manage_members (MEM-01, MEM-04, MEM-10, MEM-14)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members')
        return membersResponse([
          {
            userId: 'user-1',
            workspaceId: 'ws-1',
            role: 'viewer',
            email: 'me@example.com',
            displayName: 'Me',
          },
          {
            userId: 'user-2',
            workspaceId: 'ws-1',
            role: 'editor',
            email: 'bob@example.com',
            displayName: 'Bob',
          },
        ]);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByText('bob@example.com')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Editor')).toBeTruthy();
    expect(screen.getByText('Visualizador')).toBeTruthy();

    // MEM-04/10/14: a `viewer` never grants workspace:manage_members — no invite form, no
    // per-row role select, no remove button.
    expect(screen.queryByRole('button', { name: 'Convidar' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull();
  });

  it('a 404 on GET /workspaces/:id/members shows the shared not-found message (MEM-03)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return jsonResponse(404, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(
      await screen.findByText('Este item não existe ou você não tem acesso a ele.'),
    ).toBeTruthy();
  });
});

describe('WorkspaceMembersPage — retry on load failure (LRA-04)', () => {
  it('shows a retry button on the not-found screen, and clicking it re-fetches the same GET /workspaces/:id/members call', async () => {
    let listCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') {
        listCalls += 1;
        if (listCalls === 1) return jsonResponse(404, {});
        return membersResponse([
          {
            userId: 'user-1',
            workspaceId: 'ws-1',
            role: 'viewer',
            email: 'me@example.com',
            displayName: 'Me',
          },
        ]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(
      await screen.findByText('Este item não existe ou você não tem acesso a ele.'),
    ).toBeTruthy();
    const retryButton = screen.getByRole('button', { name: 'Tentar novamente' });

    fireEvent.click(retryButton);

    expect(await screen.findByText('Me')).toBeTruthy();
    expect(screen.queryByText('Este item não existe ou você não tem acesso a ele.')).toBeNull();
    expect(listCalls).toBe(2);
  });

  it('a repeated failure on retry keeps the same not-found message, without revealing the cause (MEM-03)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await screen.findByText('Este item não existe ou você não tem acesso a ele.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() =>
      expect(
        screen.getAllByText('Este item não existe ou você não tem acesso a ele.'),
      ).toHaveLength(1),
    );
    expect(screen.getAllByRole('button', { name: 'Tentar novamente' })).toHaveLength(1);
  });
});

describe('WorkspaceMembersPage — P1: Convidar (MEM-04..09)', () => {
  function adminMembers() {
    return [
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: 'workspace_admin',
        email: 'me@example.com',
        displayName: 'Me',
      },
      {
        userId: 'user-2',
        workspaceId: 'ws-1',
        role: 'workspace_admin',
        email: 'ann@example.com',
        displayName: 'Ann',
      },
    ];
  }

  it('shows the invite form when the effective role grants manage_members (MEM-04)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(adminMembers());
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByRole('button', { name: 'Convidar' })).toBeTruthy();
    expect(screen.getByLabelText('E-mail')).toBeTruthy();
  });

  it('submitting an unknown email emits GET /users:lookup first; a 404 shows "not found" and never emits POST (MEM-05, MEM-06)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(adminMembers());
      if (url === '/users:lookup?email=nobody%40example.com') return jsonResponse(404, {});
      if (init?.method === 'POST') throw new Error('unexpected POST');
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Convidar' });

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nobody@example.com' } });
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));

    await waitFor(() =>
      expect(screen.getByTestId('members-announcement').textContent).toBe(
        'Nenhuma conta encontrada com esse e-mail.',
      ),
    );
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining('/members'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('a found email that is not yet a member emits POST {userId, role}; 201 adds it to the list with no reload (MEM-07, MEM-09)', async () => {
    const rawFetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(adminMembers());
      if (url === '/users:lookup?email=carol%40example.com')
        return jsonResponse(200, {
          user: { id: 'user-3', email: 'carol@example.com', displayName: 'Carol' },
        });
      if (url === '/workspaces/ws-1/members' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({ userId: 'user-3', role: 'reviewer' });
        return jsonResponse(201, {
          member: {
            userId: 'user-3',
            workspaceId: 'ws-1',
            role: 'reviewer',
            email: 'carol@example.com',
            displayName: 'Carol',
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const fetchImpl = rawFetchImpl as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Convidar' });

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'carol@example.com' } });
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'reviewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));

    expect(await screen.findByText('Carol')).toBeTruthy();
    // Exactly one GET /workspaces/ws-1/members call (the initial load) — no reload afterward.
    expect(
      rawFetchImpl.mock.calls.filter(([url, init]) => url === '/workspaces/ws-1/members' && !init)
        .length,
    ).toBe(1);
  });

  it('POST 409 (already a member) shows the conflict message and never adds a duplicate (MEM-08)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(adminMembers());
      if (url === '/users:lookup?email=dupe%40example.com')
        return jsonResponse(200, {
          user: { id: 'user-9', email: 'dupe@example.com', displayName: 'Dupe' },
        });
      if (url === '/workspaces/ws-1/members' && init?.method === 'POST')
        return jsonResponse(409, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Convidar' });

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'dupe@example.com' } });
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));

    await waitFor(() =>
      expect(screen.getByTestId('members-announcement').textContent).toBe(
        'Essa pessoa já é membro deste workspace.',
      ),
    );
    expect(screen.queryByText('Dupe')).toBeNull();
  });

  it('a found email already in the loaded member list is flagged before any POST is emitted (edge case)', async () => {
    const members = adminMembers();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(members);
      if (url === '/users:lookup?email=ann%40example.com')
        return jsonResponse(200, {
          user: { id: 'user-2', email: 'ann@example.com', displayName: 'Ann' },
        });
      if (init?.method === 'POST') throw new Error('unexpected POST for an already-loaded member');
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Convidar' });

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ann@example.com' } });
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));

    await waitFor(() =>
      expect(screen.getByTestId('members-announcement').textContent).toBe(
        'Essa pessoa já é membro deste workspace.',
      ),
    );
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining('/members'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('a second submit while a lookup is still in flight never emits a second lookup request (edge case)', async () => {
    let resolveLookup: ((response: Response) => void) | undefined;
    const rawFetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(adminMembers());
      if (url === '/users:lookup?email=slow%40example.com') {
        return new Promise<Response>((resolve) => {
          resolveLookup = resolve;
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const fetchImpl = rawFetchImpl as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Convidar' });

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'slow@example.com' } });
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));

    await waitFor(() =>
      expect(
        rawFetchImpl.mock.calls.filter(([url]) => url === '/users:lookup?email=slow%40example.com'),
      ).toHaveLength(1),
    );

    resolveLookup?.(jsonResponse(404, {}));
    await waitFor(() =>
      expect(screen.getByTestId('members-announcement').textContent).toBe(
        'Nenhuma conta encontrada com esse e-mail.',
      ),
    );
  });
});

describe('WorkspaceMembersPage — P1: Trocar papel (MEM-10..13)', () => {
  function twoAdminsAndAnEditor() {
    return [
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: 'workspace_admin',
        email: 'me@example.com',
        displayName: 'Me',
      },
      {
        userId: 'user-2',
        workspaceId: 'ws-1',
        role: 'workspace_admin',
        email: 'ann@example.com',
        displayName: 'Ann',
      },
      {
        userId: 'user-3',
        workspaceId: 'ws-1',
        role: 'editor',
        email: 'eve@example.com',
        displayName: 'Eve',
      },
    ];
  }

  it("changing another member's role PATCHes {role} and reflects it only after 200 (MEM-11)", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init)
        return membersResponse(twoAdminsAndAnEditor());
      if (url === '/workspaces/ws-1/members/user-3' && init?.method === 'PATCH') {
        expect(JSON.parse(init.body as string)).toEqual({ role: 'reviewer' });
        return jsonResponse(200, { ok: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const eveRow = (await screen.findByText('Eve')).closest('li') as HTMLElement;

    fireEvent.change(within(eveRow).getByRole('combobox'), { target: { value: 'reviewer' } });

    await waitFor(() =>
      expect((within(eveRow).getByRole('combobox') as HTMLSelectElement).value).toBe('reviewer'),
    );
  });

  it('changing a member role that returns 403 announces failure and keeps the previous role selected (MEM-13)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init)
        return membersResponse(twoAdminsAndAnEditor());
      if (url === '/workspaces/ws-1/members/user-3' && init?.method === 'PATCH')
        return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const eveRow = (await screen.findByText('Eve')).closest('li') as HTMLElement;

    fireEvent.change(within(eveRow).getByRole('combobox'), { target: { value: 'reviewer' } });

    await waitFor(() =>
      expect(screen.getByTestId('members-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect((within(eveRow).getByRole('combobox') as HTMLSelectElement).value).toBe('editor');
  });

  it('blocks a self role change to a non-admin role when the caller is the sole admin, before any request is sent (MEM-12)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init)
        return membersResponse([
          {
            userId: 'user-1',
            workspaceId: 'ws-1',
            role: 'workspace_admin',
            email: 'me@example.com',
            displayName: 'Me',
          },
          {
            userId: 'user-3',
            workspaceId: 'ws-1',
            role: 'editor',
            email: 'eve@example.com',
            displayName: 'Eve',
          },
        ]);
      if (init?.method === 'PATCH')
        throw new Error('unexpected PATCH — self-downgrade must be blocked client-side');
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const meRow = (await screen.findByText('Me')).closest('li') as HTMLElement;

    fireEvent.change(within(meRow).getByRole('combobox'), { target: { value: 'viewer' } });

    await waitFor(() =>
      expect(screen.getByTestId('members-announcement').textContent).toBe(
        'Você não pode trocar seu próprio papel — você é o único admin deste workspace.',
      ),
    );
    // The select must have reverted — no optimistic update, no server round-trip happened.
    expect((within(meRow).getByRole('combobox') as HTMLSelectElement).value).toBe(
      'workspace_admin',
    );
  });
});

describe('WorkspaceMembersPage — P1: Remover (MEM-14..18)', () => {
  function twoAdmins() {
    return [
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: 'workspace_admin',
        email: 'me@example.com',
        displayName: 'Me',
      },
      {
        userId: 'user-2',
        workspaceId: 'ws-1',
        role: 'org_admin',
        email: 'ann@example.com',
        displayName: 'Ann',
      },
    ];
  }

  it('remove requires ConfirmArchiveDialog confirmation naming the member, then DELETEs and removes them with no reload (MEM-15, MEM-17)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(twoAdmins());
      if (url === '/workspaces/ws-1/members/user-2' && init?.method === 'DELETE')
        return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const annRow = (await screen.findByText('Ann')).closest('li') as HTMLElement;

    fireEvent.click(within(annRow).getByRole('button', { name: 'Remover' }));
    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Ann');

    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(screen.queryByText('Ann')).toBeNull());
  });

  it('a DELETE that returns 403 announces failure and keeps the member in the list (MEM-18)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(twoAdmins());
      if (url === '/workspaces/ws-1/members/user-2' && init?.method === 'DELETE')
        return jsonResponse(403, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const annRow = (await screen.findByText('Ann')).closest('li') as HTMLElement;

    fireEvent.click(within(annRow).getByRole('button', { name: 'Remover' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('members-announcement').textContent).toBe(
        'Algo deu errado. Tente novamente.',
      ),
    );
    expect(screen.getByText('Ann')).toBeTruthy();
  });

  it('blocks self-removal when the caller is the sole admin, before the confirm dialog ever opens (MEM-16)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init)
        return membersResponse([
          {
            userId: 'user-1',
            workspaceId: 'ws-1',
            role: 'workspace_admin',
            email: 'me@example.com',
            displayName: 'Me',
          },
          {
            userId: 'user-3',
            workspaceId: 'ws-1',
            role: 'editor',
            email: 'eve@example.com',
            displayName: 'Eve',
          },
        ]);
      if (init?.method === 'DELETE')
        throw new Error('unexpected DELETE — self-removal must be blocked client-side');
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const meRow = (await screen.findByText('Me')).closest('li') as HTMLElement;

    fireEvent.click(within(meRow).getByRole('button', { name: 'Remover' }));

    await waitFor(() =>
      expect(screen.getByTestId('members-announcement').textContent).toBe(
        'Você não pode se remover — você é o único admin deste workspace.',
      ),
    );
    expect(screen.queryByTestId('confirm-archive-confirm')).toBeNull();
  });

  it("a second admin can remove the first admin successfully — the sole-admin guard is scoped to the caller's own row, not any admin removal (independent test, P1 Remover)", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      // Logged-in actor is user-2 (the second admin) removing user-1 (the first admin).
      if (url === '/me')
        return jsonResponse(200, {
          user: { id: 'user-2', email: 'ann@example.com', displayName: 'Ann' },
        });
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(twoAdmins());
      if (url === '/workspaces/ws-1/members/user-1' && init?.method === 'DELETE')
        return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const meRow = (await screen.findByText('Me')).closest('li') as HTMLElement;

    fireEvent.click(within(meRow).getByRole('button', { name: 'Remover' }));
    // Not blocked — the dialog opens normally, since the acting user (Ann) isn't the target.
    expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Me');
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(screen.queryByText('Me')).toBeNull());
  });
});

describe('WorkspaceMembersPage — effective role on screen (RBAC-13, RBAC-14)', () => {
  function stub(role: string): typeof fetch {
    return vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') {
        return membersResponse([{ userId: ME.id, displayName: 'Me', email: ME.email, role }]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  it('shows the signed-in person their own effective role in this workspace', async () => {
    renderPage(stub('workspace_admin'));

    expect(await screen.findByText(/Seu papel:/)).toBeDefined();
    expect(screen.getByText(/Seu papel: Admin do workspace/)).toBeDefined();
  });

  it('states the reason instead of leaving a role without permission to guess', async () => {
    renderPage(stub('viewer'));

    expect(
      await screen.findByText('Você não tem permissão para isto neste workspace.'),
    ).toBeDefined();
  });

  it('shows the role that came back, not a fixed one', async () => {
    renderPage(stub('reviewer'));

    expect(await screen.findByText(/Seu papel: Revisor/)).toBeDefined();
  });
});

describe('WorkspaceMembersPage — P1: Administradores da organização (ORG-05..11)', () => {
  function orgAdminMembers() {
    return [
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: 'org_admin',
        email: 'me@example.com',
        displayName: 'Me',
      },
    ];
  }

  function workspaceAdminMembers() {
    return [
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: 'workspace_admin',
        email: 'me@example.com',
        displayName: 'Me',
      },
    ];
  }

  function orgAdminsResponse(items: unknown[]): Response {
    return jsonResponse(200, { items });
  }

  it("shows the section (list + form) only when the caller's effective role in this workspace is org_admin (ORG-11)", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(orgAdminMembers());
      if (url === '/workspaces/ws-1/organization-admins') return orgAdminsResponse([]);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByText('Administradores da organização')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeTruthy();
  });

  it('never shows the section, and never fetches its list, for a workspace_admin who is not org_admin (ORG-11)', async () => {
    const rawFetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(workspaceAdminMembers());
      if (url === '/workspaces/ws-1/organization-admins')
        throw new Error('unexpected fetch of the organization-admins list');
      throw new Error(`unexpected fetch: ${url}`);
    });
    const fetchImpl = rawFetchImpl as unknown as typeof fetch;

    renderPage(fetchImpl);

    await screen.findByRole('button', { name: 'Convidar' });
    expect(screen.queryByText('Administradores da organização')).toBeNull();
    expect(
      rawFetchImpl.mock.calls.some(([url]) => url === '/workspaces/ws-1/organization-admins'),
    ).toBe(false);
  });

  it('lists the organization administrators for an org_admin caller (ORG-05)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(orgAdminMembers());
      if (url === '/workspaces/ws-1/organization-admins')
        return orgAdminsResponse([
          { userId: 'user-1', email: 'me@example.com', displayName: 'Me' },
          { userId: 'user-2', email: 'ann@example.com', displayName: 'Ann' },
        ]);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(await screen.findByText('ann@example.com')).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
  });

  it('the empty state message shows when the organization has no administrators listed (edge case)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(orgAdminMembers());
      if (url === '/workspaces/ws-1/organization-admins') return orgAdminsResponse([]);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    expect(
      await screen.findByText('Esta organização ainda não tem administradores listados.'),
    ).toBeTruthy();
  });

  it('granting an existing email POSTs {email} and reloads the list so the new admin appears, with no page navigation (ORG-06)', async () => {
    let listCalls = 0;
    const rawFetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(orgAdminMembers());
      if (url === '/workspaces/ws-1/organization-admins' && (!init || init.method === undefined)) {
        listCalls += 1;
        if (listCalls === 1) return orgAdminsResponse([]);
        return orgAdminsResponse([
          { userId: 'user-2', email: 'carol@example.com', displayName: 'Carol' },
        ]);
      }
      if (url === '/workspaces/ws-1/organization-admins' && init?.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({ email: 'carol@example.com' });
        return jsonResponse(201, { ok: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const fetchImpl = rawFetchImpl as unknown as typeof fetch;

    renderPage(fetchImpl);
    const sectionTitle = await screen.findByText('Administradores da organização');
    const orgAdminsSection = sectionTitle.closest('div') as HTMLElement;

    fireEvent.change(within(orgAdminsSection).getByLabelText('E-mail'), {
      target: { value: 'carol@example.com' },
    });
    fireEvent.click(within(orgAdminsSection).getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Carol')).toBeTruthy();
    expect(listCalls).toBe(2);
  });

  it('granting an email matching no existing user shows a clear message and adds nobody (ORG-07)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(orgAdminMembers());
      if (url === '/workspaces/ws-1/organization-admins' && !init) return orgAdminsResponse([]);
      if (url === '/workspaces/ws-1/organization-admins' && init?.method === 'POST')
        return jsonResponse(404, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const sectionTitle = await screen.findByText('Administradores da organização');
    const orgAdminsSection = sectionTitle.closest('div') as HTMLElement;

    fireEvent.change(within(orgAdminsSection).getByLabelText('E-mail'), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.click(within(orgAdminsSection).getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Nenhuma conta encontrada com esse e-mail.')).toBeTruthy();
  });

  it('revoking removes the admin from the visible list on success (ORG-08)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(orgAdminMembers());
      if (url === '/workspaces/ws-1/organization-admins' && !init)
        return orgAdminsResponse([
          { userId: 'user-1', email: 'me@example.com', displayName: 'Me' },
          { userId: 'user-2', email: 'ann@example.com', displayName: 'Ann' },
        ]);
      if (url === '/workspaces/ws-1/organization-admins/user-2' && init?.method === 'DELETE')
        return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const annRow = (await screen.findByText('Ann')).closest('li') as HTMLElement;

    fireEvent.click(within(annRow).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(screen.queryByText('Ann')).toBeNull());
  });

  it('a revoke that would leave the organization without an administrator shows the reason and keeps the admin listed (ORG-09)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(orgAdminMembers());
      if (url === '/workspaces/ws-1/organization-admins' && !init)
        return orgAdminsResponse([
          { userId: 'user-1', email: 'me@example.com', displayName: 'Me' },
        ]);
      if (url === '/workspaces/ws-1/organization-admins/user-1' && init?.method === 'DELETE')
        return jsonResponse(409, {});
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const sectionTitle = await screen.findByText('Administradores da organização');
    const orgAdminsSection = sectionTitle.closest('div') as HTMLElement;
    const meRow = within(orgAdminsSection).getByText('me@example.com').closest('li') as HTMLElement;

    fireEvent.click(within(meRow).getByRole('button', { name: 'Remover' }));

    expect(
      await screen.findByText('Isso deixaria a organização sem nenhum administrador.'),
    ).toBeTruthy();
    // Refused server-side — the row must still be visible.
    expect(within(orgAdminsSection).getByText('me@example.com')).toBeTruthy();
  });
});

describe('WorkspaceMembersPage — P2: seletor de papel sem org_admin (ORG-12, ORG-13, ORG-14)', () => {
  function twoWorkspaceAdmins() {
    return [
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: 'workspace_admin',
        email: 'me@example.com',
        displayName: 'Me',
      },
      {
        userId: 'user-2',
        workspaceId: 'ws-1',
        role: 'editor',
        email: 'eve@example.com',
        displayName: 'Eve',
      },
    ];
  }

  function optionLabels(select: HTMLElement): string[] {
    return Array.from(select.querySelectorAll('option')).map((option) => option.textContent ?? '');
  }

  it('the invite role selector offers exactly the four workspace-scoped roles, never Admin da organização (ORG-12)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(twoWorkspaceAdmins());
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Convidar' });

    const inviteSelect = screen.getByLabelText('Papel');
    // The placeholder option plus exactly the four assignable roles — never a fifth.
    expect(optionLabels(inviteSelect)).toEqual([
      'Escolha um papel',
      'Admin do workspace',
      'Editor',
      'Revisor',
      'Visualizador',
    ]);
  });

  it("a member row's role-change selector offers the same four roles, never Admin da organização (ORG-13)", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(twoWorkspaceAdmins());
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const eveRow = (await screen.findByText('Eve')).closest('li') as HTMLElement;

    const roleSelect = within(eveRow).getByRole('combobox');
    expect(optionLabels(roleSelect)).toEqual([
      'Admin do workspace',
      'Editor',
      'Revisor',
      'Visualizador',
    ]);
  });

  it('a legacy row with role org_admin still displays that label with fidelity, unable to be reassigned to it via the selector (ORG-14)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members')
        return membersResponse([
          {
            userId: 'user-1',
            workspaceId: 'ws-1',
            role: 'viewer',
            email: 'me@example.com',
            displayName: 'Me',
          },
          {
            userId: 'user-2',
            workspaceId: 'ws-1',
            role: 'org_admin',
            email: 'ann@example.com',
            displayName: 'Ann',
          },
        ]);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    // The caller (a viewer) can't manage members, so Ann's role renders as the read-only badge
    // driven by ROLE_KEY — unchanged for org_admin, and no <select> is offered for her row at all.
    const annRow = (await screen.findByText('Ann')).closest('li') as HTMLElement;
    expect(within(annRow).getByText('Admin da organização')).toBeTruthy();
    expect(within(annRow).queryByRole('combobox')).toBeNull();
  });

  it('a legacy row with role org_admin still displays that label with fidelity even when the caller can manage members (ORG-14)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members')
        return membersResponse([
          {
            userId: 'user-1',
            workspaceId: 'ws-1',
            role: 'workspace_admin',
            email: 'me@example.com',
            displayName: 'Me',
          },
          {
            userId: 'user-2',
            workspaceId: 'ws-1',
            role: 'org_admin',
            email: 'ann@example.com',
            displayName: 'Ann',
          },
        ]);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    // The caller (a workspace_admin) CAN manage members, so every other row renders a <select> —
    // but Ann's legacy org_admin role has no matching option in ASSIGNABLE_ROLE_VALUES, so her
    // row must still fall back to the read-only badge instead of a <select> with no selected value.
    const annRow = (await screen.findByText('Ann')).closest('li') as HTMLElement;
    expect(within(annRow).getByText('Admin da organização')).toBeTruthy();
    expect(within(annRow).queryByRole('combobox')).toBeNull();
    // Her row still offers the remove action, since manageability isn't role-selector-specific.
    expect(within(annRow).getByRole('button', { name: 'Remover' })).toBeTruthy();
  });
});
