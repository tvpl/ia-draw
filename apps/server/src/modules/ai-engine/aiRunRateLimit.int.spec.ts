// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

import { encryptToken } from '@arch-canvas/ai-tools';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { InMemoryRateLimiter } from '../../core/rateLimit.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerAiEngineModule } from './routes.js';

const ENCRYPTION_KEY = 'test-encryption-master-key-for-ai-engine-rate-limit';
const TEST_TOKEN = 'sk-ai-engine-rate-limit-test-token';

function createFakeStorage(): StorageClient {
  return {
    async putSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async getSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async headObject() {
      return { exists: false };
    },
    async putObject() {},
    async getObject() {
      throw new Error('createFakeStorage: getObject not exercised by this test file');
    },
  };
}

/** Always fails the provider call fast (never reaches 429 through a slow real network call) — this file only cares about the rate-limit preHandler running BEFORE the pipeline, so the pipeline's own outcome (success or a structured failure) is irrelevant as long as it's never a 429. */
function alwaysErrorFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ error: 'provider down' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

/**
 * SEC-02/T83: proves `POST /diagrams/:id/ai/runs` carries its OWN,
 * separately-configured `InMemoryRateLimiter` — stricter than
 * `core/server.ts`'s default per-authenticated-route limit (300/60s) — by
 * injecting a tiny limiter and exceeding it with far fewer requests than the
 * default would ever require.
 */
describe('POST /diagrams/:id/ai/runs rate limiting (SEC-02, T83, closes AIC-04)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let authApp: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    authApp = buildServer(config);
    await registerAuthModule(authApp, { db, config });
    registerWorkspaceModule(authApp, { db });
    await authApp.ready();
  });

  afterAll(async () => {
    await authApp.close();
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

  async function seedDiagramAs(cookies: Record<string, string>, slug: string) {
    const createWs = await authApp.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: {
        name: `AI Rate Limit WS ${slug}`,
        slug: `ai-rl-ws-${slug}-${Date.now()}-${Math.random()}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await authApp.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `AI Rate Limit Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await authApp.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `AI Rate Limit Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  async function seedProviderConfig(scope: string) {
    const [config] = await db
      .insert(schema.aiProviderConfigs)
      .values({
        scope,
        baseUrl: 'http://127.0.0.1:9/unused',
        model: 'test-model',
        encryptedToken: encryptToken(TEST_TOKEN, ENCRYPTION_KEY),
      })
      .returning();
    if (!config) throw new Error('provider config insert failed');
    return config;
  }

  it('429s on the N+1-th call with a strict limit — far fewer requests than the 300/60s default would need', async () => {
    const owner = await seedUserWithSession('ai-rl-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'strict');
    await seedProviderConfig(workspaceId);

    const strictLimiter = new InMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(app, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(app, { db });
    registerAiEngineModule(app, {
      db,
      encryptionKey: ENCRYPTION_KEY,
      storage: createFakeStorage(),
      fetchImpl: alwaysErrorFetch(),
      aiRunRateLimiter: strictLimiter,
    });
    await app.ready();

    try {
      const first = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ai/runs`,
        cookies: owner.cookies,
        payload: { userRequest: 'Crie um diagrama' },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ai/runs`,
        cookies: owner.cookies,
        payload: { userRequest: 'Crie outro diagrama' },
      });
      const third = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ai/runs`,
        cookies: owner.cookies,
        payload: { userRequest: 'Mais um diagrama' },
      });

      expect(first.statusCode).not.toBe(429);
      expect(second.statusCode).not.toBe(429);
      expect(third.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('Verifier-added: the REAL, non-injected production default (20/60s) trips well before the 300/60s global default would — no aiRunRateLimiter override', async () => {
    const owner = await seedUserWithSession('ai-rl-real-default');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'real-default');
    await seedProviderConfig(workspaceId);

    // Deliberately NOT passing `aiRunRateLimiter` — this exercises the
    // actual `DEFAULT_AI_RUN_RATE_LIMIT` constant (`ai-engine/routes.ts`)
    // that ships to production, not an injected stand-in. If that constant
    // were ever widened to match (or exceed) `core/server.ts`'s global
    // default of 300/60s — silently re-opening the AIC-04 gap T83 closed —
    // this test is what would catch it; the test above only proves the
    // MECHANISM works with an arbitrary injected limit, never that the
    // shipped default is actually stricter than the global one.
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(app, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(app, { db });
    registerAiEngineModule(app, {
      db,
      encryptionKey: ENCRYPTION_KEY,
      storage: createFakeStorage(),
      fetchImpl: alwaysErrorFetch(),
    });
    await app.ready();

    try {
      const statusCodes: number[] = [];
      // 21 requests: the real default is 20/60s, so the 21st must 429 — and
      // 21 is far below the global default's own 300/60s ceiling, proving
      // the AI-run route's own limit is what actually trips, not the global
      // per-route default.
      for (let i = 0; i < 21; i++) {
        const response = await app.inject({
          method: 'POST',
          url: `/diagrams/${diagramId}/ai/runs`,
          cookies: owner.cookies,
          payload: { userRequest: `Crie um diagrama ${i}` },
        });
        statusCodes.push(response.statusCode);
      }

      expect(statusCodes.slice(0, 20).every((code) => code !== 429)).toBe(true);
      expect(statusCodes[20]).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('keys the AI-run limit by userId — a second user is never blocked by the first user exhausting theirs', async () => {
    const owner = await seedUserWithSession('ai-rl-owner-b');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'keyed');
    await seedProviderConfig(workspaceId);
    const other = await seedUserWithSession('ai-rl-other-b');
    await db.insert(schema.workspaceMembers).values({
      workspaceId,
      userId: other.user.id,
      role: 'editor',
    });

    const strictLimiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(app, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(app, { db });
    registerAiEngineModule(app, {
      db,
      encryptionKey: ENCRYPTION_KEY,
      storage: createFakeStorage(),
      fetchImpl: alwaysErrorFetch(),
      aiRunRateLimiter: strictLimiter,
    });
    await app.ready();

    try {
      const ownerFirst = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ai/runs`,
        cookies: owner.cookies,
        payload: { userRequest: 'Crie um diagrama' },
      });
      const ownerSecond = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ai/runs`,
        cookies: owner.cookies,
        payload: { userRequest: 'Crie outro diagrama' },
      });
      const otherFirst = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ai/runs`,
        cookies: other.cookies,
        payload: { userRequest: 'Crie um diagrama diferente' },
      });

      expect(ownerFirst.statusCode).not.toBe(429);
      expect(ownerSecond.statusCode).toBe(429);
      expect(otherFirst.statusCode).not.toBe(429);
    } finally {
      await app.close();
    }
  });
});
