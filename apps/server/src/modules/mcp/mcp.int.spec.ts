// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { requireMcpToken } from './auth.js';
import { registerMcpModule } from './routes.js';

describe('mcp token issuance/revocation routes (MCP-04)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerMcpModule(app, { db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  async function seedUserWithSession(prefix: string) {
    const user = await createLocalAccount(db, {
      email: `${prefix}-${Date.now()}-${Math.random()}@example.com`,
      displayName: prefix,
      password: `${prefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  async function seedWorkspaceAs(cookies: Record<string, string>, slug: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: {
        name: `MCP ${slug}`,
        slug: `mcp-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    return response.json().workspace.id as string;
  }

  it('a workspace admin can create an MCP token', async () => {
    const owner = await seedUserWithSession('create-admin-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'create-admin');

    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/mcp-tokens`,
      cookies: owner.cookies,
      payload: { role: 'editor', label: 'CI agent' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.mcpToken.workspaceId).toBe(workspaceId);
    expect(body.mcpToken.role).toBe('editor');
    expect(body.mcpToken.label).toBe('CI agent');
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(20);
  });

  it('a non-admin member (editor, no workspace:manage_members) is rejected with 403', async () => {
    const owner = await seedUserWithSession('non-admin-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'non-admin');
    const editor = await seedUserWithSession('non-admin-editor');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: editor.user.id, role: 'editor' });

    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/mcp-tokens`,
      cookies: editor.cookies,
      payload: { role: 'viewer', label: 'Should be rejected' },
    });

    expect(response.statusCode).toBe(403);
    const rows = await db
      .select()
      .from(schema.mcpTokens)
      .where(eq(schema.mcpTokens.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });

  it('the plaintext token is returned only at creation — never recoverable again, not even on revoke', async () => {
    const owner = await seedUserWithSession('one-shot-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'one-shot');

    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/mcp-tokens`,
      cookies: owner.cookies,
      payload: { role: 'viewer', label: 'One shot' },
    });
    const { token, mcpToken } = create.json();

    const [row] = await db
      .select()
      .from(schema.mcpTokens)
      .where(eq(schema.mcpTokens.id, mcpToken.id));
    expect(row?.tokenHash).toBeDefined();
    expect(row?.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(mcpToken.tokenHash).toBeUndefined();

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/mcp-tokens/${mcpToken.id}`,
      cookies: owner.cookies,
    });
    expect(revoke.statusCode).toBe(200);
    expect(JSON.stringify(revoke.json())).not.toContain(token);
  });

  it('DELETE /mcp-tokens/:id revokes the token — requireMcpToken denies it immediately afterward', async () => {
    const owner = await seedUserWithSession('revoke-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'revoke');

    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/mcp-tokens`,
      cookies: owner.cookies,
      payload: { role: 'viewer', label: 'To be revoked' },
    });
    const { token, mcpToken } = create.json();

    const fakeRequest = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as FastifyRequest;
    await requireMcpToken(db)(fakeRequest);
    expect(fakeRequest.mcpContext).toEqual({ workspaceId, role: 'viewer' });

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/mcp-tokens/${mcpToken.id}`,
      cookies: owner.cookies,
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().mcpToken.revokedAt).not.toBeNull();

    const requestAfterRevoke = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as FastifyRequest;
    await expect(requireMcpToken(db)(requestAfterRevoke)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('a token minted for one workspace only ever resolves that workspace, never another', async () => {
    const ownerA = await seedUserWithSession('scope-a-owner');
    const workspaceA = await seedWorkspaceAs(ownerA.cookies, 'scope-a');
    const ownerB = await seedUserWithSession('scope-b-owner');
    const workspaceB = await seedWorkspaceAs(ownerB.cookies, 'scope-b');

    const createA = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceA}/mcp-tokens`,
      cookies: ownerA.cookies,
      payload: { role: 'viewer', label: 'Workspace A token' },
    });
    const createB = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceB}/mcp-tokens`,
      cookies: ownerB.cookies,
      payload: { role: 'viewer', label: 'Workspace B token' },
    });
    const tokenA = createA.json().token as string;
    const tokenB = createB.json().token as string;

    const requestA = {
      headers: { authorization: `Bearer ${tokenA}` },
    } as unknown as FastifyRequest;
    await requireMcpToken(db)(requestA);
    expect(requestA.mcpContext?.workspaceId).toBe(workspaceA);
    expect(requestA.mcpContext?.workspaceId).not.toBe(workspaceB);

    const requestB = {
      headers: { authorization: `Bearer ${tokenB}` },
    } as unknown as FastifyRequest;
    await requireMcpToken(db)(requestB);
    expect(requestB.mcpContext?.workspaceId).toBe(workspaceB);
    expect(requestB.mcpContext?.workspaceId).not.toBe(workspaceA);
  });
});
