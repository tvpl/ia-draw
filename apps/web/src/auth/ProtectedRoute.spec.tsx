import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute.js';

const useAuthMock = vi.fn();

// `ProtectedRoute` only ever calls `useAuth()` — mocking the whole module
// keeps this test from needing a real `AuthProvider` (and the `fetch` calls
// it would make) just to drive the 3 states this guard reacts to.
vi.mock('./AuthProvider.js', () => ({
  useAuth: () => useAuthMock(),
}));

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
});

function LoginProbe(): JSX.Element {
  const [params] = useSearchParams();
  return <div>Login page (next={params.get('next') ?? ''})</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/w/:workspaceId"
          element={
            <ProtectedRoute>
              <div>Protected content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute (T4, SSO-13/16)', () => {
  it('renders nothing (not children, not a redirect) while status is loading', () => {
    useAuthMock.mockReturnValue({ user: null, status: 'loading' });
    const { container } = renderAt('/w/ws-1');
    expect(container.textContent).toBe('');
  });

  it('renders children when status is authenticated', () => {
    useAuthMock.mockReturnValue({
      user: { id: '1', email: 'a@b.com', displayName: 'A' },
      status: 'authenticated',
    });
    renderAt('/w/ws-1');
    expect(screen.getByText('Protected content')).toBeTruthy();
  });

  it('redirects to /login?next=<url-encoded current path+search> when status is anonymous', () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    renderAt('/w/ws-1?foo=bar');
    // `URLSearchParams.get` decodes automatically — this round-trips through
    // the exact `encodeURIComponent` this component applies, proving `next`
    // carries the full original path+search rather than just the path.
    expect(screen.getByText('Login page (next=/w/ws-1?foo=bar)')).toBeTruthy();
  });
});
