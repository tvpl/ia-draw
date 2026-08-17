import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
}

interface AuthContextInternal extends AuthContextValue {
  logout: () => Promise<void>;
}

interface MeResponseBody {
  user: AuthUser;
}

/** Strips a `GET /me`/`POST /auth/login` response down to exactly `{id, email, displayName}` — never more (design.md's `AuthUser`). */
function toAuthUser(user: AuthUser): AuthUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

const AuthContext = createContext<AuthContextInternal | undefined>(undefined);

export interface AuthProviderProps {
  children: ReactNode;
  /** Injectable for tests; defaults to the global fetch (same pattern as `DiagramSyncClient`'s `fetchImpl`). */
  fetchImpl?: typeof fetch;
}

/**
 * Single source of truth for session state in `apps/web` (AD-011). Resolves
 * `GET /me` on mount; a `401` triggers exactly one `POST /auth/refresh`
 * retry before settling on `anonymous` — see design.md's sequence diagram.
 */
export function AuthProvider({ children, fetchImpl }: AuthProviderProps): JSX.Element {
  const doFetch = useMemo(() => fetchImpl ?? fetch.bind(globalThis), [fetchImpl]);
  const [state, setState] = useState<AuthContextValue>({ user: null, status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function resolveSession(): Promise<void> {
      const first = await doFetch('/me');
      if (first.ok) {
        const body = (await first.json()) as MeResponseBody;
        if (!cancelled) setState({ user: toAuthUser(body.user), status: 'authenticated' });
        return;
      }

      const refreshed = await doFetch('/auth/refresh', { method: 'POST' });
      if (refreshed.ok) {
        const retry = await doFetch('/me');
        if (retry.ok) {
          const body = (await retry.json()) as MeResponseBody;
          if (!cancelled) setState({ user: toAuthUser(body.user), status: 'authenticated' });
          return;
        }
      }

      if (!cancelled) setState({ user: null, status: 'anonymous' });
    }

    void resolveSession();

    return () => {
      cancelled = true;
    };
  }, [doFetch]);

  const logout = useCallback(async () => {
    await doFetch('/auth/logout', { method: 'POST' });
    setState({ user: null, status: 'anonymous' });
  }, [doFetch]);

  const value = useMemo<AuthContextInternal>(
    () => ({ user: state.user, status: state.status, logout }),
    [state, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuthContext(hookName: string): AuthContextInternal {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error(`${hookName} must be used within an AuthProvider`);
  return ctx;
}

/** Reads session state — `{user, status}` — from the nearest `AuthProvider`. */
export function useAuth(): AuthContextValue {
  const ctx = useAuthContext('useAuth');
  return { user: ctx.user, status: ctx.status };
}

/** Calls `POST /auth/logout`, then resets the context to `anonymous`/`null`. */
export function useLogout(): () => Promise<void> {
  return useAuthContext('useLogout').logout;
}
