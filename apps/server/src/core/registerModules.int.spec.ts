// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI uses real Postgres via GitHub Actions services (see packages/database/src/migrate.int.spec.ts for the established pattern this mirrors).

import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalAccount } from '../modules/auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../modules/auth/cookie.js';
import { createSession } from '../modules/auth/session.js';
import { loadConfig } from './config.js';
import { registerAllModules } from './registerModules.js';
import { buildServer } from './server.js';

// Proves the SAME wiring function apps/server/src/index.ts uses at real boot
// (registerAllModules) makes every module's routes reachable end-to-end — not
// just each module registered by hand in its own isolated test file. Before
// this task, index.ts never called registerAllModules (or anything like it),
// so a real `docker compose up` server would 404 on every route below.
describe('registerAllModules — production wiring is actually reachable', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config, {
      dependencyChecks: [{ name: 'postgres', check: async () => true }],
    });
    await registerAllModules(app, db, config);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  it('reaches auth, workspace and diagram-sync routes through the one shared wiring path', async () => {
    const user = await createLocalAccount(db, {
      email: `wiring-${Date.now()}-${Math.random()}@example.com`,
      displayName: 'Wiring Test',
      password: 'wiring-password',
    });
    const session = await createSession(db, user.id);
    const cookies = { [SESSION_COOKIE_NAME]: session.token };

    // auth module
    const me = await app.inject({ method: 'GET', url: '/me', cookies });
    expect(me.statusCode).toBe(200);

    // workspace module
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: 'Wiring Workspace', slug: `wiring-ws-${Date.now()}` },
    });
    expect(createWs.statusCode).toBe(201);
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: 'Wiring Project' },
    });
    expect(createProject.statusCode).toBe(201);
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: 'Wiring Diagram' },
    });
    expect(createDiagram.statusCode).toBe(201);
    const diagramId = createDiagram.json().diagram.id as string;

    // diagram-sync module — the wave this fix was discovered in
    const bootstrap = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/bootstrap`,
      cookies,
    });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({ scene: [], revision: 0 });
  });

  it('reaches the asset module route through the same wiring path (T29) — 401 without a session, never 404', async () => {
    // No session cookie: requireSession's preHandler rejects before the route body (and
    // therefore before any real storage call) ever runs — proves the route is registered
    // and reachable, not merely that storage happens to be unreachable in this sandbox.
    const response = await app.inject({
      method: 'POST',
      url: '/diagrams/some-diagram-id/assets:initiate',
      payload: { mimeType: 'image/png', sizeBytes: 100 },
    });
    expect(response.statusCode).toBe(401);
  });

  it('reaches the snapshot module route through the same wiring path (T30) — 401 without a session, never 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/diagrams/some-diagram-id/snapshots',
    });
    expect(response.statusCode).toBe(401);
  });

  it('reaches the export module routes through the same wiring path (T32/T33) — 401 without a session, never 404', async () => {
    const exportsResponse = await app.inject({
      method: 'POST',
      url: '/diagrams/some-diagram-id/exports',
    });
    expect(exportsResponse.statusCode).toBe(401);

    const bundleResponse = await app.inject({
      method: 'POST',
      url: '/diagrams/some-diagram-id/bundle',
    });
    expect(bundleResponse.statusCode).toBe(401);

    const importResponse = await app.inject({
      method: 'POST',
      url: '/projects/some-project-id/import',
      payload: { fileContent: '{}' },
    });
    expect(importResponse.statusCode).toBe(401);

    const bulkResponse = await app.inject({
      method: 'POST',
      url: '/workspaces/some-workspace-id/bundles',
    });
    expect(bulkResponse.statusCode).toBe(401);
  });

  it('reaches the library module routes through the same wiring path (T39) — 401 without a session, never 404', async () => {
    const librariesResponse = await app.inject({ method: 'GET', url: '/libraries' });
    expect(librariesResponse.statusCode).toBe(401);

    const metadataResponse = await app.inject({
      method: 'GET',
      url: '/diagrams/some-diagram-id/elements/some-element-id/metadata',
    });
    expect(metadataResponse.statusCode).toBe(401);

    const inventoryResponse = await app.inject({
      method: 'GET',
      url: '/diagrams/some-diagram-id/inventory',
    });
    expect(inventoryResponse.statusCode).toBe(401);
  });

  it('reaches the ai-provider module routes through the same wiring path (T42) — 401 without a session, never 404', async () => {
    const listResponse = await app.inject({ method: 'GET', url: '/admin/ai-providers' });
    expect(listResponse.statusCode).toBe(401);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/admin/ai-providers',
      payload: { scope: 'global', baseUrl: 'https://api.openai.com/v1', model: 'gpt', token: 'x' },
    });
    expect(createResponse.statusCode).toBe(401);

    const testResponse = await app.inject({
      method: 'POST',
      url: '/admin/ai-providers/some-config-id:test',
    });
    expect(testResponse.statusCode).toBe(401);
  });

  it('reaches the share module routes through the same wiring path (T78, T81) — 401 without a session, never 404', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/diagrams/some-diagram-id/share-links',
      payload: { role: 'viewer', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(createResponse.statusCode).toBe(401);
  });

  it('reaches the webhook module routes through the same wiring path (T79, T81) — 401 without a session, never 404', async () => {
    const listResponse = await app.inject({
      method: 'GET',
      url: '/workspaces/some-workspace-id/webhooks',
    });
    expect(listResponse.statusCode).toBe(401);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/workspaces/some-workspace-id/webhooks',
      payload: { url: 'https://example.com/hook', events: ['diagram.created'] },
    });
    expect(createResponse.statusCode).toBe(401);
  });

  it('reports readiness up when the injected postgres check passes', async () => {
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      dependencies: [{ name: 'postgres', status: 'up' }],
    });
  });
});
