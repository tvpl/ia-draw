import type { CookieSerializeOptions } from '@fastify/cookie';
import type { AppConfig } from '../../core/config.js';
import { SESSION_TTL_MS } from './session.js';

export const SESSION_COOKIE_NAME = 'session';

/** `Secure` is only safe to omit on non-HTTPS localhost dev; production always runs behind HTTPS (config.publicUrl). */
function isHttpsPublicUrl(publicUrl: string): boolean {
  try {
    return new URL(publicUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/** HttpOnly; SameSite=Lax always. Secure follows config.publicUrl's scheme (AUTH-01). */
export function sessionCookieOptions(config: AppConfig): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsPublicUrl(config.publicUrl),
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** Options for the Set-Cookie that clears the session on logout. */
export function clearedSessionCookieOptions(config: AppConfig): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsPublicUrl(config.publicUrl),
    path: '/',
    maxAge: 0,
  };
}

/** T87 (OIDC-01) — carries the PKCE `code_verifier`/`state`/`nonce` from `/auth/oidc/login` to `/auth/oidc/callback`. */
export const OIDC_PKCE_COOKIE_NAME = 'oidc_pkce';

/**
 * `SameSite=Lax` (not `Strict`) is required here specifically: the browser
 * arrives at `/auth/oidc/callback` via a top-level GET navigation
 * cross-site (redirected FROM the IdP's origin), and `Lax` is the
 * narrowest setting that still attaches the cookie on that navigation —
 * `Strict` would silently drop it and break every OIDC login. Short-lived
 * (5 min — generous for a real user completing an IdP login screen, but
 * never long enough to matter if abandoned) and scoped to `/auth/oidc` only
 * (never sent on unrelated requests).
 */
export function oidcPkceCookieOptions(config: AppConfig): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsPublicUrl(config.publicUrl),
    path: '/auth/oidc',
    maxAge: 300,
  };
}

/** Options for the Set-Cookie that clears the PKCE cookie once the callback has consumed it. */
export function clearedOidcPkceCookieOptions(config: AppConfig): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsPublicUrl(config.publicUrl),
    path: '/auth/oidc',
    maxAge: 0,
  };
}
