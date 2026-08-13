import { users } from '@arch-canvas/database';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { Db } from './db.js';

export interface CreateLocalAccountInput {
  email: string;
  displayName: string;
  password: string;
}

export interface LocalUser {
  id: string;
  email: string;
  displayName: string;
}

/** Hashes `password` with Argon2id and inserts a new local account (AUTH-01). */
export async function createLocalAccount(
  db: Db,
  input: CreateLocalAccountInput,
): Promise<LocalUser> {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
    })
    .returning();
  if (!user) throw new Error('failed to create local account');
  return { id: user.id, email: user.email, displayName: user.displayName };
}

/**
 * Verifies `password` against the stored Argon2id hash for `email`.
 * Returns the user on success, `null` on any failure (unknown email,
 * OIDC-only user with no password hash, or a wrong password) — the
 * caller must not distinguish these cases in its response (AUTH-01).
 */
export async function verifyLocalPassword(
  db: Db,
  email: string,
  password: string,
): Promise<LocalUser | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user?.passwordHash) return null;

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) return null;

  return { id: user.id, email: user.email, displayName: user.displayName };
}
