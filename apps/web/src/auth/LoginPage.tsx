import { type FormEvent, type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';
import * as css from '../styles/classNames.js';
import { useAuth } from './AuthProvider.js';
import { FirstRunPage } from './FirstRunPage.js';
import { createFirstRunClient, type FirstRunClient } from './firstRunClient.js';

const DEFAULT_TARGET = '/';

/**
 * Edge Case guard (spec.md): `next` must be a same-origin relative path —
 * never an absolute/protocol-relative URL from the query string — or a
 * successful login/already-authenticated visit would open-redirect.
 */
function sanitizeNext(raw: string | null): string {
  if (!raw) return DEFAULT_TARGET;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) {
    return DEFAULT_TARGET;
  }
  return raw;
}

interface OidcStatusResponse {
  configured: boolean;
}

/**
 * The login screen (T6, SSO-01..08/10/12): local email/password form, a
 * conditional SSO link, and `?error=oidc_failed` handling. No props — reads
 * `next`/`error` from the URL and `useAuth()` for the already-authenticated
 * short-circuit (design.md).
 */
export interface LoginPageProps {
  /** Injectable for tests; defaults to the global fetch, same convention as the other pages. */
  firstRunClient?: FirstRunClient;
}

export function LoginPage({ firstRunClient }: LoginPageProps = {}): JSX.Element | null {
  const { t } = useTranslation();
  const { status } = useAuth();
  const [searchParams] = useSearchParams();
  const next = sanitizeNext(searchParams.get('next'));
  const oidcFailed = searchParams.get('error') === 'oidc_failed';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    oidcFailed ? t('auth.ssoFailed') : null,
  );
  const [ssoConfigured, setSsoConfigured] = useState(false);
  // BOOT-12: starts `false`, not `null`. Blocking the render until the answer arrives would
  // hold back the credentials form on every normal sign-in — the overwhelmingly common case —
  // to spare a fresh instance one frame. An instance that has accounts is the default.
  const [firstRunAvailable, setFirstRunAvailable] = useState(false);
  const resolvedFirstRunClient = useMemo(
    () => firstRunClient ?? createFirstRunClient(),
    [firstRunClient],
  );

  // BOOT-12: which form this route shows is decided by the server, not by configuration —
  // an instance with no account gets the first-run form, everything else gets credentials.
  useEffect(() => {
    let cancelled = false;
    void resolvedFirstRunClient.checkAvailability().then(({ available }) => {
      if (!cancelled) setFirstRunAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedFirstRunClient]);

  // SSO-09..11: the SSO link only ever appears after a successful
  // `{configured: true}` — any non-200 or network failure is treated as
  // "not configured" so the login screen never offers a link that always
  // ends in a 503.
  useEffect(() => {
    let cancelled = false;
    fetch('/auth/oidc/status')
      .then((response) => (response.ok ? (response.json() as Promise<OidcStatusResponse>) : null))
      .then((body) => {
        if (!cancelled) setSsoConfigured(body?.configured === true);
      })
      .catch(() => {
        if (!cancelled) setSsoConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // SSO-02: a valid session short-circuits straight to `next`, no form flash.
  if (status === 'authenticated') {
    return <Navigate to={next} replace />;
  }

  // Avoid rendering the form before we know whether a session already
  // exists — mirrors `ProtectedRoute`'s "render nothing while loading".
  if (status !== 'anonymous') {
    return null;
  }

  // BOOT-15: `onAlreadyInitialized` is how the first-run form hands the route back when the
  // instance stopped being empty between the check and the submit.
  if (firstRunAvailable) {
    return (
      <FirstRunPage
        client={resolvedFirstRunClient}
        onAlreadyInitialized={() => setFirstRunAvailable(false)}
      />
    );
  }

  const canSubmit = email.trim().length > 0 && password.trim().length > 0 && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // A hard navigation, not client-side routing: `AuthProvider` only
        // resolves its session once, on mount — a real navigation is what
        // makes it re-mount and pick up the cookie this call just set.
        window.location.assign(next);
        return;
      }

      // 401/400 both render as the same generic message (SSO-05/06) —
      // never distinguishing "no such user" from "wrong password".
      setPassword('');
      setErrorMessage(t('auth.invalidCredentials'));
      setSubmitting(false);
    } catch {
      setPassword('');
      setErrorMessage(t('auth.invalidCredentials'));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className={`${css.pageTitle} mb-6 text-center`}>{t('app.title')}</h1>

        <form
          className={`${css.panelPadded} flex flex-col gap-4`}
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div aria-live="polite" className={errorMessage ? css.errorBox : css.helpText}>
            {submitting ? t('auth.submitting') : errorMessage}
          </div>

          <div className={css.field}>
            <label className={css.label} htmlFor="login-email">
              {t('auth.emailLabel')}
            </label>
            <input
              className={css.input}
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className={css.field}>
            <label className={css.label} htmlFor="login-password">
              {t('auth.passwordLabel')}
            </label>
            <input
              className={css.input}
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <button className={css.buttonPrimary} type="submit" disabled={!canSubmit}>
            {t('auth.submit')}
          </button>
        </form>

        {ssoConfigured && (
          <p className="mt-4 text-center">
            <a className={css.link} href="/auth/oidc/login">
              {t('auth.ssoButton')}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
