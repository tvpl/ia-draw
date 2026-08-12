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

  it('reports readiness up when the injected postgres check passes', async () => {
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      dependencies: [{ name: 'postgres', status: 'up' }],
    });
  });
});
