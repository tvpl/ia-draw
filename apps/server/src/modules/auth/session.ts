import { sessions, users, withTx } from '@arch-canvas/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { LocalUser } from './accounts.js';
import type { Db } from './db.js';
import { generateOpaqueToken, hashToken } from './tokens.js';

/** Engineering default — not spec-mandated; sessions are opaque and immediately revocable regardless of TTL. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionIssue {
  token: string;
  userId: string;
  expiresAt: Date;
}

async function insertSession(db: Db, userId: string): Promise<SessionIssue> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return { token, userId, expiresAt };
}

/** Issues a brand-new session for `userId` (used by login). */
export function createSession(db: Db, userId: string): Promise<SessionIssue> {
  return insertSession(db, userId);
}

/**
 * Verifies `token` against `sessions` and returns the authenticated user,
 * or `null` if the token is unknown, revoked, or expired.
 */
export async function verifySession(
  db: Db,
  token: string,
): Promise<{ user: LocalUser; sessionId: string } | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash));

  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  return {
    sessionId: row.sessionId,
    user: { id: row.userId, email: row.email, displayName: row.displayName },
  };
}

/**
 * Rotates a valid session: the old token is revoked and a new one issued
 * for the same user, inside one transaction. Returns `null` (no rotation
 * performed) when `oldToken` is unknown, already revoked, or expired — the
 * old token never functions again once this call returns non-null (T14).
 */
export async function rotateSession(db: Db, oldToken: string): Promise<SessionIssue | null> {
  const oldTokenHash = hashToken(oldToken);

  return withTx(db, async (tx) => {
    const [row] = await tx
      .select({
        id: sessions.id,
        userId: sessions.userId,
        revokedAt: sessions.revokedAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(eq(sessions.tokenHash, oldTokenHash));

    if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.id));

    return insertSession(tx, row.userId);
  });
}

/** Revokes the session for `token`, if any. Idempotent — revoking twice is a no-op. */
export async function revokeSession(db: Db, token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}
