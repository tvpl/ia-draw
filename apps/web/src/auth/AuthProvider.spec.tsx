import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthUser, useAuth, useLogout } from './AuthProvider.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Renders `useAuth()`'s live state as text so assertions can read it without a testing-library hooks package. */
function Probe(): JSX.Element {
  const { user, status } = useAuth();
  const logout = useLogout();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user ? JSON.stringify(user) : 'null'}</span>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

const SERVER_USER = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  // Extra field the response body might carry that the client must never
  // surface — proves `toAuthUser` strips down to exactly {id, email, displayName}.
  role: 'admin',
};

afterEach(() => {
  cleanup();
});

describe('AuthProvider / useAuth (T3, SSO-13..17)', () => {
  it('loading -> authenticated when GET /me responds 200 on the first try', async () => {
    const fetchImpl = vi.fn((url: string) => {
      expect(url).toBe('/me');
      return Promise.resolve(jsonResponse(200, { user: SERVER_USER }));
    }) as unknown as typeof fetch;

    render(
      <AuthProvider fetchImpl={fetchImpl}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status').textContent).toBe('loading');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    const user = JSON.parse(screen.getByTestId('user').textContent ?? 'null') as AuthUser;
    expect(user).toEqual({ id: 'user-1', email: 'alice@example.com', displayName: 'Alice' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('loading -> authenticated when /me is 401, /auth/refresh succeeds, and the retried /me succeeds', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      if (url === '/me' && calls.filter((c) => c === '/me').length === 1) {
        return Promise.resolve(jsonResponse(401, {}));
      }
      if (url === '/auth/refresh') {
        return Promise.resolve(jsonResponse(200, {}));
      }
      return Promise.resolve(jsonResponse(200, { user: SERVER_USER }));
    }) as unknown as typeof fetch;

    render(
      <AuthProvider fetchImpl={fetchImpl}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(calls).toEqual(['/me', '/auth/refresh', '/me']);
    const user = JSON.parse(screen.getByTestId('user').textContent ?? 'null') as AuthUser;
    expect(user).toEqual({ id: 'user-1', email: 'alice@example.com', displayName: 'Alice' });
  });

  it('loading -> anonymous when /me is 401 and /auth/refresh also fails', async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/me') return Promise.resolve(jsonResponse(401, {}));
      if (url === '/auth/refresh') return Promise.resolve(jsonResponse(401, {}));
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <AuthProvider fetchImpl={fetchImpl}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('loading -> anonymous when /me is 401, /auth/refresh succeeds, but the retried /me still fails', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      if (url === '/me') return Promise.resolve(jsonResponse(401, {}));
      if (url === '/auth/refresh') return Promise.resolve(jsonResponse(200, {}));
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <AuthProvider fetchImpl={fetchImpl}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(calls).toEqual(['/me', '/auth/refresh', '/me']);
    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('useLogout() calls POST /auth/logout and resets status to anonymous, user to null', async () => {
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/me') return Promise.resolve(jsonResponse(200, { user: SERVER_USER }));
      if (url === '/auth/logout' && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(
      <AuthProvider fetchImpl={fetchImpl}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    await act(async () => {
      screen.getByRole('button', { name: 'logout' }).click();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('user').textContent).toBe('null');
  });

  it('useAuth() throws when called outside an AuthProvider', () => {
    // Swallow React's expected "error boundary" console.error noise for this one assertion.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useAuth must be used within an AuthProvider');
    consoleError.mockRestore();
  });
});
