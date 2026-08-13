// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI uses real Postgres via GitHub Actions services (AD-007).

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
import { registerExportModule } from './routes.js';

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

/**
 * SEC-02/T83: `POST /diagrams/:id/exports` and `POST /diagrams/:id/bundle`
 * share ONE `InMemoryRateLimiter` (both routes count against the same
 * budget, per the task's own "das rotas de export" wording), stricter than
 * `core/server.ts`'s default per-authenticated-route limit (300/60s).
 */
describe('export routes rate limiting (SEC-02, T83)', () => {
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
        name: `Export Rate Limit WS ${slug}`,
        slug: `export-rl-ws-${slug}-${Date.now()}-${Math.random()}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await authApp.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Export Rate Limit Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await authApp.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Export Rate Limit Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  it('429s on the N+1-th export call with a strict limit — far fewer requests than the 300/60s default would need', async () => {
    const owner = await seedUserWithSession('export-rl-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'strict');

    const strictLimiter = new InMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(app, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(app, { db });
    registerExportModule(app, {
      db,
      storage: createFakeStorage(),
      exportRateLimiter: strictLimiter,
    });
    await app.ready();

    try {
      const first = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/exports`,
        cookies: owner.cookies,
      });
      const second = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/exports`,
        cookies: owner.cookies,
      });
      const third = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/exports`,
        cookies: owner.cookies,
      });

      expect(first.statusCode).not.toBe(429);
      expect(second.statusCode).not.toBe(429);
      expect(third.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('Verifier-added: the REAL, non-injected production default (30/60s) trips well before the 300/60s global default would — no exportRateLimiter override', async () => {
    const owner = await seedUserWithSession('export-rl-real-default');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'real-default');

    // Deliberately NOT passing `exportRateLimiter` — exercises the actual
    // `DEFAULT_EXPORT_RATE_LIMIT` constant (`export/routes.ts`) that ships to
    // production, not an injected stand-in (same rationale as ai-engine's
    // equivalent Verifier-added test — every other test in this file injects
    // its own limiter, so none of them would catch that constant being
    // silently widened to match the 300/60s global default).
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(app, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(app, { db });
    registerExportModule(app, { db, storage: createFakeStorage() });
    await app.ready();

    try {
      const statusCodes: number[] = [];
      // 31 requests: the real default is 30/60s, so the 31st must 429 — and
      // 31 is far below the global default's own 300/60s ceiling.
      for (let i = 0; i < 31; i++) {
        const response = await app.inject({
          method: 'POST',
          url: `/diagrams/${diagramId}/exports`,
          cookies: owner.cookies,
        });
        statusCodes.push(response.statusCode);
      }

      expect(statusCodes.slice(0, 30).every((code) => code !== 429)).toBe(true);
      expect(statusCodes[30]).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('shares the same limiter budget across /exports and /bundle', async () => {
    const owner = await seedUserWithSession('export-rl-shared');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'shared');

    const strictLimiter = new InMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(app, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(app, { db });
    registerExportModule(app, {
      db,
      storage: createFakeStorage(),
      exportRateLimiter: strictLimiter,
    });
    await app.ready();

    try {
      const exportsCall = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/exports`,
        cookies: owner.cookies,
      });
      const bundleCall = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/bundle`,
        cookies: owner.cookies,
      });
      const secondBundleCall = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/bundle`,
        cookies: owner.cookies,
      });

      expect(exportsCall.statusCode).not.toBe(429);
      expect(bundleCall.statusCode).not.toBe(429);
      // Third call total against the shared limit of 2 — regardless of which route it hits.
      expect(secondBundleCall.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('keys the export limit by userId — a second user is never blocked by the first user exhausting theirs', async () => {
    const owner = await seedUserWithSession('export-rl-owner-b');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'keyed');
    const other = await seedUserWithSession('export-rl-other-b');
    await db.insert(schema.workspaceMembers).values({
      workspaceId,
      userId: other.user.id,
      role: 'editor',
    });

    const strictLimiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    const app = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(app, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(app, { db });
    registerExportModule(app, {
      db,
      storage: createFakeStorage(),
      exportRateLimiter: strictLimiter,
    });
    await app.ready();

    try {
      const ownerFirst = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/exports`,
        cookies: owner.cookies,
      });
      const ownerSecond = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/exports`,
        cookies: owner.cookies,
      });
      const otherFirst = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/exports`,
        cookies: other.cookies,
      });

      expect(ownerFirst.statusCode).not.toBe(429);
      expect(ownerSecond.statusCode).toBe(429);
      expect(otherFirst.statusCode).not.toBe(429);
    } finally {
      await app.close();
    }
  });
});
