import { createHash, randomBytes } from 'node:crypto';

/** 256 bits of entropy, URL-safe — used as the opaque session/ticket token. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Only the hash of a token is ever persisted (sessions.token_hash,
 * ws_tickets.token_hash) — a DB read alone never yields a usable token.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
