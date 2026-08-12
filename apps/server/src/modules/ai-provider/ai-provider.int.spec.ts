// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { InMemoryRateLimiter } from './rateLimit.js';
import { registerAiProviderModule } from './routes.js';

const TEST_TOKEN = 'sk-this-is-the-secret-provider-token-xyz789';
const ENCRYPTION_KEY = 'test-encryption-master-key';

/** Deterministic provider double — never a real network call (T42 "Done when"). */
function mockFetch(): typeof fetch {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: String(url), headers });
    return new Response(
      JSON.stringify({
        choices: [{ message: { tool_calls: [{ id: 'call_1', function: { name: 'ping' } }] } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  (impl as unknown as { calls: typeof calls }).calls = calls;
  return impl;
}

describe('ai-provider admin module (T42, AIC-01/02/03/04)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;
  let fetchDouble: ReturnType<typeof mockFetch>;
  let rateLimiter: InMemoryRateLimiter;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    fetchDouble = mockFetch();
    rateLimiter = new InMemoryRateLimiter({ limit: 2, windowMs: 60_000 });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerAiProviderModule(app, {
      db,
      encryptionKey: ENCRYPTION_KEY,
      fetchImpl: fetchDouble,
      testConnectionRateLimiter: rateLimiter,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  async function seedUserWithSession(emailPrefix: string) {
    const user = await createLocalAccount(db, {
      email: `${emailPrefix}-${Date.now()}-${Math.random()}@example.com`,
      displayName: emailPrefix,
      password: `${emailPrefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  async function seedWorkspaceWithRole(role: string) {
    const owner = await seedUserWithSession(`ws-owner-${role}`);
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies: owner.cookies,
      payload: { name: `AI WS ${role}`, slug: `ai-ws-${role}-${Date.now()}-${Math.random()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const member = await seedUserWithSession(`ai-${role}`);
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: member.user.id, role: role as never });
    return { workspaceId, member };
  }

  function createConfig(cookies: Record<string, string>, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/admin/ai-providers',
      cookies,
      payload: body,
    });
  }

  describe('authorization', () => {
    it('rejects an unauthenticated request with 401 on every route', async () => {
      const list = await app.inject({ method: 'GET', url: '/admin/ai-providers' });
      expect(list.statusCode).toBe(401);

      const create = await app.inject({
        method: 'POST',
        url: '/admin/ai-providers',
        payload: {
          scope: 'global',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt',
          token: 'x',
        },
      });
      expect(create.statusCode).toBe(401);
    });

    it('a non-admin (editor) is denied 403 on every route of this module', async () => {
      const { workspaceId, member: editor } = await seedWorkspaceWithRole('editor');

      const list = await app.inject({
        method: 'GET',
        url: `/admin/ai-providers?scope=${workspaceId}`,
        cookies: editor.cookies,
      });
      expect(list.statusCode).toBe(403);

      const create = await createConfig(editor.cookies, {
        scope: workspaceId,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        token: TEST_TOKEN,
      });
      expect(create.statusCode).toBe(403);

      // Seed a config as an admin so PATCH/:test have a real target to be denied on.
      const { member: admin } = await seedWorkspaceWithRole('workspace_admin');
      // reuse the same workspace as editor's by creating directly for editor's workspace via a workspace_admin in it
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId, userId: admin.user.id, role: 'workspace_admin' });
      const created = await createConfig(admin.cookies, {
        scope: workspaceId,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        token: TEST_TOKEN,
      });
      const configId = created.json().config.id as string;

      const patch = await app.inject({
        method: 'PATCH',
        url: `/admin/ai-providers/${configId}`,
        cookies: editor.cookies,
        payload: { model: 'gpt-4o' },
      });
      expect(patch.statusCode).toBe(403);

      const test = await app.inject({
        method: 'POST',
        url: `/admin/ai-providers/${configId}:test`,
        cookies: editor.cookies,
      });
      expect(test.statusCode).toBe(403);
    });

    it('workspace_admin CAN create a workspace-scoped config; org_admin CAN create a global config', async () => {
      const { workspaceId, member: admin } = await seedWorkspaceWithRole('workspace_admin');
      const scoped = await createConfig(admin.cookies, {
        scope: workspaceId,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        token: TEST_TOKEN,
      });
      expect(scoped.statusCode).toBe(201);

      const { member: orgAdmin } = await seedWorkspaceWithRole('org_admin');
      const global = await createConfig(orgAdmin.cookies, {
        scope: 'global',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        token: TEST_TOKEN,
      });
      expect(global.statusCode).toBe(201);
    });
  });

  describe('SSRF protection on the route', () => {
    it('rejects a baseUrl that resolves to a blocked range (T41 applied at the route)', async () => {
      const { member: orgAdmin } = await seedWorkspaceWithRole('org_admin');
      const response = await createConfig(orgAdmin.cookies, {
        scope: 'global',
        baseUrl: 'http://169.254.169.254/v1',
        model: 'gpt-4o-mini',
        token: TEST_TOKEN,
      });
      expect(response.statusCode).toBe(400);

      const rows = await db.select().from(schema.aiProviderConfigs);
      expect(rows.find((r) => r.baseUrl === 'http://169.254.169.254/v1')).toBeUndefined();
    });
  });

  describe('token never appears in any response', () => {
    it('GET/POST/PATCH responses never contain the token in any form', async () => {
      const { member: orgAdmin } = await seedWorkspaceWithRole('org_admin');

      const created = await createConfig(orgAdmin.cookies, {
        scope: 'global',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        token: TEST_TOKEN,
      });
      expect(created.statusCode).toBe(201);
      expect(JSON.stringify(created.json())).not.toContain(TEST_TOKEN);
      expect(created.body).not.toContain(TEST_TOKEN);
      const configId = created.json().config.id as string;

      const listResponse = await app.inject({
        method: 'GET',
        url: '/admin/ai-providers?scope=global',
        cookies: orgAdmin.cookies,
      });
      expect(listResponse.statusCode).toBe(200);
      expect(JSON.stringify(listResponse.json())).not.toContain(TEST_TOKEN);

      const patched = await app.inject({
        method: 'PATCH',
        url: `/admin/ai-providers/${configId}`,
        cookies: orgAdmin.cookies,
        payload: { token: `${TEST_TOKEN}-rotated` },
      });
      expect(patched.statusCode).toBe(200);
      expect(JSON.stringify(patched.json())).not.toContain(TEST_TOKEN);
      expect(JSON.stringify(patched.json())).not.toContain(`${TEST_TOKEN}-rotated`);

      // The persisted row itself only ever carries ciphertext.
      const [row] = await db
        .select()
        .from(schema.aiProviderConfigs)
        .where(eq(schema.aiProviderConfigs.id, configId));
      expect(row?.encryptedToken).toBeDefined();
      expect(row?.encryptedToken).not.toContain(TEST_TOKEN);
      expect(row?.encryptedToken).not.toContain(`${TEST_TOKEN}-rotated`);
    });
  });

  describe('"Testar conexão"', () => {
    it('confirms tool-calling against the mock provider and leaves no token in the audit log', async () => {
      const { member: orgAdmin } = await seedWorkspaceWithRole('org_admin');
      const created = await createConfig(orgAdmin.cookies, {
        scope: 'global',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        token: TEST_TOKEN,
      });
      const configId = created.json().config.id as string;

      const response = await app.inject({
        method: 'POST',
        url: `/admin/ai-providers/${configId}:test`,
        cookies: orgAdmin.cookies,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        success: true,
        modelAvailable: true,
        toolCallingSupported: true,
      });
      expect(JSON.stringify(body)).not.toContain(TEST_TOKEN);

      // The mock actually received the decrypted token as the Authorization header —
      // proves the real decrypt-and-call path ran, not a stub that skipped it.
      const calls = (
        fetchDouble as unknown as { calls: Array<{ headers: Record<string, string> }> }
      ).calls;
      expect(calls.some((c) => c.headers.authorization === `Bearer ${TEST_TOKEN}`)).toBe(true);

      // The durable audit trail for this action never carries the token.
      const auditRows = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, 'ai_provider_config.tested'));
      expect(auditRows.length).toBeGreaterThan(0);
      expect(JSON.stringify(auditRows)).not.toContain(TEST_TOKEN);
    });
  });

  describe('rate limit middleware', () => {
    it('rejects the N+1-th :test call within the configured window (limit=2)', async () => {
      const { member: orgAdmin } = await seedWorkspaceWithRole('org_admin');
      const created = await createConfig(orgAdmin.cookies, {
        scope: 'global',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        token: TEST_TOKEN,
      });
      const configId = created.json().config.id as string;

      const call = () =>
        app.inject({
          method: 'POST',
          url: `/admin/ai-providers/${configId}:test`,
          cookies: orgAdmin.cookies,
        });

      const first = await call();
      const second = await call();
      const third = await call();

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(third.statusCode).toBe(429);
    });
  });
});
