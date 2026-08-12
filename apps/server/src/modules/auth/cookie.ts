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
