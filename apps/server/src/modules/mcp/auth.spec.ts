// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../auth/tokens.js';
import { requireMcpToken } from './auth.js';
import { createMcpToken } from './mcpTokens.js';

function requestWithAuthHeader(authorization?: string): FastifyRequest {
  return { headers: { authorization } } as unknown as FastifyRequest;
}

async function expectDenied(promise: Promise<void>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ statusCode: 404 });
}

describe('requireMcpToken (MCP-04, MCP-05)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Org', slug: `org-auth-${Date.now()}` })
      .returning();
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org?.id ?? '', name: 'WS', slug: `ws-auth-${Date.now()}` })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: `mcp-auth-${Date.now()}@example.com`, displayName: 'MCP auth tester' })
      .returning();
    workspaceId = workspace?.id ?? '';
    userId = user?.id ?? '';
  });

  afterAll(async () => {
    await client.close();
  });

  it('a valid, active token populates request.mcpContext with the token workspace/role', async () => {
    const token = 'valid-token';
    await createMcpToken(db, {
      workspaceId,
      role: 'editor',
      label: 'Valid',
      createdBy: userId,
      tokenHash: hashToken(token),
    });

    const request = requestWithAuthHeader(`Bearer ${token}`);
    await requireMcpToken(db)(request);

    expect(request.mcpContext).toEqual({ workspaceId, role: 'editor' });
  });

  it('a missing Authorization header is denied with the uniform 404', async () => {
    await expectDenied(requireMcpToken(db)(requestWithAuthHeader(undefined)));
  });

  it('an unknown/invalid token is denied with the same uniform 404', async () => {
    await expectDenied(requireMcpToken(db)(requestWithAuthHeader('Bearer not-a-real-token')));
  });

  it('a revoked token is denied identically, indistinguishable from unknown', async () => {
    const token = 'revoked-token';
    const created = await createMcpToken(db, {
      workspaceId,
      role: 'viewer',
      label: 'Revoked',
      createdBy: userId,
      tokenHash: hashToken(token),
    });
    await db
      .update(schema.mcpTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.mcpTokens.id, created.id));

    await expectDenied(requireMcpToken(db)(requestWithAuthHeader(`Bearer ${token}`)));
  });

  it('an expired token is denied identically, indistinguishable from unknown', async () => {
    const token = 'expired-token';
    const created = await createMcpToken(db, {
      workspaceId,
      role: 'viewer',
      label: 'Expired',
      createdBy: userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .update(schema.mcpTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.mcpTokens.id, created.id));

    await expectDenied(requireMcpToken(db)(requestWithAuthHeader(`Bearer ${token}`)));
  });
});
