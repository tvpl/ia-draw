import type { Role } from '@arch-canvas/auth';
import { mcpTokens } from '@arch-canvas/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface McpTokenRow {
  id: string;
  workspaceId: string;
  tokenHash: string;
  role: Role;
  label: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface CreateMcpTokenInput {
  workspaceId: string;
  role: Role;
  label: string;
  createdBy: string;
  tokenHash: string;
  expiresAt?: Date | null;
}

/** Inserts a new MCP token row — `tokenHash` is the ONLY persisted form of the token, same one-shot-reveal discipline as `share/shareLinks.ts`'s `createShareLink`. */
export async function createMcpToken(db: Db, input: CreateMcpTokenInput): Promise<McpTokenRow> {
  const [row] = await db
    .insert(mcpTokens)
    .values({
      workspaceId: input.workspaceId,
      tokenHash: input.tokenHash,
      role: input.role,
      label: input.label,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!row) throw new Error('failed to insert mcp token');
  return row as McpTokenRow;
}

/** Resolves an MCP token by its hash — the only lookup `requireMcpToken` (`auth.ts`) uses; a hash miss and an existing-but-invalid token are BOTH surfaced as `null`/inactive by the caller, never distinguished here. */
export async function findMcpTokenByHash(db: Db, tokenHash: string): Promise<McpTokenRow | null> {
  const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, tokenHash));
  return (row as McpTokenRow) ?? null;
}

export async function findMcpTokenById(db: Db, id: string): Promise<McpTokenRow | null> {
  const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.id, id));
  return (row as McpTokenRow) ?? null;
}

/** Sets `revokedAt` to now — idempotent, same pattern as `share/shareLinks.ts`'s `revokeShareLinkById`. Returns `null` only if `id` doesn't exist at all. */
export async function revokeMcpToken(db: Db, id: string): Promise<McpTokenRow | null> {
  const [row] = await db
    .update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.id, id), isNull(mcpTokens.revokedAt)))
    .returning();
  if (row) return row as McpTokenRow;
  // Already revoked (or never existed) — re-read to disambiguate without erroring on the idempotent case.
  return findMcpTokenById(db, id);
}

/**
 * True when `token` is usable right now — neither revoked nor past its
 * `expiresAt`. Mirrors `share/shareLinks.ts`'s `isShareLinkActive`, except
 * `expiresAt` is nullable here (an MCP token may never expire) — a `null`
 * `expiresAt` never fails this check.
 */
export function isMcpTokenActive(token: McpTokenRow, now: Date = new Date()): boolean {
  if (token.revokedAt !== null) return false;
  if (token.expiresAt === null) return true;
  return token.expiresAt.getTime() >= now.getTime();
}
