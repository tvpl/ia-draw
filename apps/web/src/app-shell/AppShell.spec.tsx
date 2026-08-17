import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthProvider.js';
// Side-effect import — initializes the shared i18next singleton `useTranslation()` reads
// from. Default language is pt-BR; pinned to `en` in `beforeAll` for a stable "Sign out"
// assertion, same convention as `LoginPage.spec.tsx`.
import i18n from '../i18n/index.js';
import { AppShell } from './AppShell.js';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Renders `useAuth()`'s live status as text so the click -> anonymous transition is observable. */
function StatusProbe() {
  const { status } = useAuth();
  return <span data-testid="status">{status}</span>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppShell logout (T9)', () => {
  it('renders a keyboard-reachable logout button labeled with auth.logout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me')
          return Promise.resolve(
            jsonResponse(200, { user: { id: 'u1', email: 'a@b.com', displayName: 'A' } }),
          );
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    render(
      <AuthProvider>
        <AppShell />
      </AuthProvider>,
    );

    const button = screen.getByRole('button', { name: 'Sign out' });
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('clicking logout calls POST /auth/logout and flips AuthProvider status to anonymous', async () => {
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/me') {
        return Promise.resolve(
          jsonResponse(200, { user: { id: 'u1', email: 'a@b.com', displayName: 'A' } }),
        );
      }
      if (url === '/auth/logout' && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    render(
      <AuthProvider>
        <StatusProbe />
        <AppShell />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(fetchImpl).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
  });
});
