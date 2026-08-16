import type { Role } from '@arch-canvas/auth';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../auth/db.js';
import { hashToken } from '../auth/tokens.js';
import { findMcpTokenByHash, isMcpTokenActive } from './mcpTokens.js';

export interface McpContext {
  workspaceId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    mcpContext?: McpContext;
  }
}

/**
 * Same uniform-deny shape design.md's MCP-04/05 section specifies: a
 * missing, malformed, unknown, revoked, or expired token ALL surface as
 * this identical 404 — never a 401/403, never a message that lets a caller
 * tell "no token" apart from "token exists but is revoked" (AUTH-04's
 * IDOR-safe convention, extended here to the MCP token itself, not just
 * the resource it grants access to).
 */
function mcpTokenDenied(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Reusable MCP-token-auth preHandler (MCP-04), parallel to
 * `auth/middleware.ts`'s `requireSession` but for the `Authorization:
 * Bearer <token>` header instead of a session cookie. Populates
 * `request.mcpContext = { workspaceId, role }` on success; every route in
 * the `mcp` module runs `can({ role }, action, { workspaceId })` on top of
 * this — this middleware only resolves identity, never a permission
 * decision of its own (MCP-04's "never a parallel check" requirement).
 */
export function requireMcpToken(db: Db) {
  return async function requireMcpTokenPreHandler(request: FastifyRequest): Promise<void> {
    const token = bearerToken(request);
    if (!token) mcpTokenDenied();

    const row = await findMcpTokenByHash(db, hashToken(token));
    if (!row) mcpTokenDenied();
    if (!isMcpTokenActive(row)) mcpTokenDenied();

    request.mcpContext = { workspaceId: row.workspaceId, role: row.role };
  };
}
