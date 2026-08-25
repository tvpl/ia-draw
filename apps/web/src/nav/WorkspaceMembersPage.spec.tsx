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
