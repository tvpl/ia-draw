import type { Role } from '@arch-canvas/auth';
import { ROLES } from '@arch-canvas/auth';
import { shareLinks } from '@arch-canvas/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export type ShareLinkResourceType = 'diagram' | 'presentation';

export interface ShareLinkRow {
  id: string;
  resourceType: ShareLinkResourceType;
  resourceId: string;
  tokenHash: string;
  role: Role;
  expiresAt: Date;
  revokedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

export interface CreateShareLinkInput {
  resourceType: ShareLinkResourceType;
  resourceId: string;
  role: Role;
  expiresAt: Date;
  createdBy: string;
  tokenHash: string;
}

/**
 * Role-ceiling check (T78, EXT-01): `grantedRole` must never sit ABOVE
 * `actorRole` on `packages/auth`'s privilege ordering (`ROLES`, highest
 * first — index 0 is the most privileged). An `editor` (index 2) may
 * create a share link granting `editor`/`reviewer`/`viewer` (index >= 2)
 * but never `workspace_admin`/`org_admin` (index < 2) — a link can only
 * ever hand out AT MOST the creating actor's own effective privilege,
 * never more.
 */
export function isRoleWithinCeiling(actorRole: Role, grantedRole: Role): boolean {
  return ROLES.indexOf(grantedRole) >= ROLES.indexOf(actorRole);
}

/** Inserts a new share link row — `tokenHash` is the ONLY persisted form of the token; the plaintext token itself is never stored anywhere (T78's one-shot-reveal requirement). */
export async function createShareLink(db: Db, input: CreateShareLinkInput): Promise<ShareLinkRow> {
  const [row] = await db
    .insert(shareLinks)
    .values({
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      tokenHash: input.tokenHash,
      role: input.role,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error('failed to insert share link');
  return row as ShareLinkRow;
}

/** Resolves a share link by its token's hash — the only lookup path `GET /share/:token` (public, unauthenticated) uses; a hash miss and an existing-but-invalid link are BOTH surfaced as `null` by the ROUTE layer's subsequent revoked/expired checks, never distinguished here. */
export async function getShareLinkByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<ShareLinkRow | null> {
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.tokenHash, tokenHash));
  return (row as ShareLinkRow) ?? null;
}

export async function getShareLinkById(db: Db, id: string): Promise<ShareLinkRow | null> {
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, id));
  return (row as ShareLinkRow) ?? null;
}

/** Sets `revokedAt` to now — idempotent: revoking an already-revoked link just re-confirms it's revoked rather than erroring. Returns `null` only if `id` doesn't exist at all. */
export async function revokeShareLinkById(db: Db, id: string): Promise<ShareLinkRow | null> {
  const [row] = await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, id), isNull(shareLinks.revokedAt)))
    .returning();
  if (row) return row as ShareLinkRow;
  // Already revoked (or never existed) — re-read to disambiguate without erroring on the idempotent case.
  return getShareLinkById(db, id);
}

/** True when `link` is usable right now — neither revoked nor past its `expiresAt`. `GET /share/:token` (T78) folds a `false` here into the same 404 as "token doesn't exist" (IDOR-safe, three indistinguishable causes). */
export function isShareLinkActive(link: ShareLinkRow, now: Date = new Date()): boolean {
  if (link.revokedAt !== null) return false;
  return link.expiresAt.getTime() >= now.getTime();
}
