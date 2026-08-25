import {
  organizations,
  recordAuditEvent,
  users,
  workspaceMembers,
  workspaces,
} from '@arch-canvas/database';
import * as argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import type { Db } from './db.js';

/**
 * BOOT-01..09: the one path that creates the first account on a fresh instance.
 *
 * Before this, `createLocalAccount` had no production caller at all — only tests and the
 * e2e harness — so a freshly deployed instance showed a login form and had no account to
 * log in with. The documented way out was `make shell-postgres` and an Argon2 hash typed
 * by hand.
 *
 * The whole surface is gated on one predicate: the `users` table being empty. That
 * predicate is checked inside the same transaction that writes, under an advisory lock, so
 * two requests arriving together cannot both see an empty instance and both create an
 * administrator. The guard has to live in the database because two `apps/server` processes
 * can serve the two requests (AD-003 keeps one process today, but nothing in this route
 * may depend on that).
 */

/** Arbitrary but fixed key for the advisory lock that serialises bootstrap attempts. */
const BOOTSTRAP_LOCK_KEY = 4_073_916_921;

export const MIN_PASSWORD_LENGTH = 12;

export interface BootstrapInput {
  email: string;
  displayName: string;
  password: string;
  workspaceName: string;
}

export interface BootstrapResult {
  user: { id: string; email: string; displayName: string };
  organizationId: string;
  workspaceId: string;
}

/** BOOT-01/02: whether the instance still has no account at all. */
export async function isInstanceUninitialized(db: Db): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return row === undefined;
}

/** Thrown when another request initialized the instance first (BOOT-08). */
export class InstanceAlreadyInitializedError extends Error {
  constructor() {
    super('This instance already has an account');
    this.name = 'InstanceAlreadyInitializedError';
  }
}

/** Normalizes an email the same way for storage and for later login lookups. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Derives a URL-safe slug from a display name, with a stable fallback for input that has no usable characters. */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : fallback;
}

/**
 * BOOT-03/07/08: creates the account, its organization, its first workspace and the
 * `org_admin` membership, in one transaction. Throws `InstanceAlreadyInitializedError`
 * when the instance stopped being empty — including when that happened between this
 * caller's own availability check and this call.
 */
export async function bootstrapInstance(db: Db, input: BootstrapInput): Promise<BootstrapResult> {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const email = normalizeEmail(input.email);

  return db.transaction(async (tx) => {
    // Serialises concurrent bootstrap attempts. Held until this transaction ends, so the
    // count below and the insert that follows are one atomic decision.
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);

    const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing) throw new InstanceAlreadyInitializedError();

    const [user] = await tx
      .insert(users)
      .values({ email, displayName: input.displayName, passwordHash })
      .returning();
    if (!user) throw new Error('failed to create the first account');

    const [organization] = await tx
      .insert(organizations)
      .values({ name: input.workspaceName, slug: slugify(input.workspaceName, 'organization') })
      .returning();
    if (!organization) throw new Error('failed to create the first organization');

    const [workspace] = await tx
      .insert(workspaces)
      .values({
        organizationId: organization.id,
        name: input.workspaceName,
        slug: slugify(input.workspaceName, 'workspace'),
      })
      .returning();
    if (!workspace) throw new Error('failed to create the first workspace');

    // BOOT-10: never read from the request. The first account is always org_admin.
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: 'org_admin' });

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      organizationId: organization.id,
      workspaceId: workspace.id,
    };
  });
}

/** BOOT-07: records that this instance was initialized, and by which account. */
export async function recordBootstrapAudit(
  db: Db,
  result: BootstrapResult,
  ipHash: string,
): Promise<void> {
  await recordAuditEvent(db, {
    actorId: result.user.id,
    action: 'instance.bootstrapped',
    resourceType: 'user',
    resourceId: result.user.id,
    ipHash,
    metadataJson: {
      organizationId: result.organizationId,
      workspaceId: result.workspaceId,
    },
  });
}
