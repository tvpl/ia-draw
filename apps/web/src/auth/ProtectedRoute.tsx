import type { JSX, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider.js';

export interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Route guard (T4, SSO-13/16) — the only place in `apps/web` that turns
 * `AuthProvider`'s `status` into an actual navigation: `anonymous` redirects
 * to `/login?next=<current path+search>`, `authenticated` renders
 * `children`, `loading` renders nothing (never `children`, never a redirect)
 * until the session resolves one way or the other.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps): JSX.Element | null {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return null;

  if (status === 'anonymous') {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}
