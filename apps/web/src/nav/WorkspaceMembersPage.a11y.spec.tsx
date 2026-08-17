import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider.js';
// Side-effect import — initializes the shared i18next singleton, same convention as
// shell.a11y.spec.tsx / ProjectListPage.a11y.spec.tsx. Default language is pt-BR.
import i18n from '../i18n/index.js';
import { WorkspaceMembersPage } from './WorkspaceMembersPage.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as shell.a11y.spec.tsx (read its header comment for the full
// Knowledge Verification Chain) — duplicated here rather than imported, matching every other
// *.a11y.spec.tsx file's convention in this codebase.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

beforeAll(() => {
  // Same jsdom <dialog> shim as ConfirmArchiveDialog.a11y.spec.tsx / WorkspaceMembersPage.spec.tsx.
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
  // Restores the default locale in case the MEM-21 test below switched it and failed before
  // switching back, so later tests in this file aren't left asserting the wrong strings.
  await i18n.changeLanguage('pt-BR');
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ME = { id: 'user-1', email: 'me@example.com', displayName: 'Me' };

function meResponse(): Response {
  return jsonResponse(200, { user: ME });
}

function membersResponse(items: unknown[]): Response {
  return jsonResponse(200, { items });
}

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
      role: 'editor',
      email: 'bob@example.com',
      displayName: 'Bob',
    },
  ];
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
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('WorkspaceMembersPage (T5, MEM-19..21)', () => {
  it('the read-only populated-list state (a role without manage_members) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me')
        return jsonResponse(200, {
          user: { id: 'user-1', email: 'me@example.com', displayName: 'Me' },
        });
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

    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws-1/members']}>
        <AuthProvider fetchImpl={fetchImpl}>
          <Routes>
            <Route
              path="/w/:workspaceId/members"
              element={<WorkspaceMembersPage fetchImpl={fetchImpl} />}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByText('bob@example.com');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the invite-form-open state (a role granting manage_members, with per-row role selects and remove buttons) has zero serious/critical axe violations', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(adminMembers());
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const { container } = renderPage(fetchImpl);

    await screen.findByRole('button', { name: 'Convidar' });

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('every interactive control (back link, per-row role select and remove, invite email/role/submit) is keyboard-focusable (MEM-19)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(adminMembers());
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    await screen.findByRole('button', { name: 'Convidar' });

    const backLink = screen.getByRole('link', { name: 'Voltar' });
    backLink.focus();
    expect(document.activeElement).toBe(backLink);

    const bobRow = screen.getByText('Bob').closest('li') as HTMLElement;
    const roleSelect = within(bobRow).getByRole('combobox');
    roleSelect.focus();
    expect(document.activeElement).toBe(roleSelect);

    const removeButton = within(bobRow).getByRole('button', { name: 'Remover' });
    removeButton.focus();
    expect(document.activeElement).toBe(removeButton);

    const emailInput = screen.getByLabelText('E-mail');
    emailInput.focus();
    expect(document.activeElement).toBe(emailInput);

    const inviteRoleSelect = screen.getByLabelText('Papel');
    inviteRoleSelect.focus();
    expect(document.activeElement).toBe(inviteRoleSelect);

    const inviteButton = screen.getByRole('button', { name: 'Convidar' });
    inviteButton.focus();
    expect(document.activeElement).toBe(inviteButton);

    fireEvent.click(removeButton);
    const confirmButton = screen.getByTestId('confirm-archive-confirm');
    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);
  });

  it('the outcome region is aria-live="polite" and announces a completed action (MEM-20)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members' && !init) return membersResponse(adminMembers());
      if (url === '/workspaces/ws-1/members/user-2' && init?.method === 'DELETE')
        return jsonResponse(204, null);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);
    const bobRow = (await screen.findByText('Bob')).closest('li') as HTMLElement;

    const liveRegion = screen.getByTestId('members-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(within(bobRow).getByRole('button', { name: 'Remover' }));
    fireEvent.click(screen.getByTestId('confirm-archive-confirm'));

    await waitFor(() => expect(liveRegion.textContent).toBe('Membro removido.'));
  });

  it('renders in the en locale as well as pt-BR (MEM-21)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/me') return meResponse();
      if (url === '/workspaces/ws-1/members') return membersResponse(adminMembers());
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await i18n.changeLanguage('en');
    renderPage(fetchImpl);

    expect(await screen.findByRole('heading', { name: 'Members' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThan(0);
  });
});
