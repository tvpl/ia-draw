// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
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
import { registerDiagramSyncModule } from './routes.js';

describe('GET /diagrams/:id/operations?afterSequence= (T23, REC-04)', () => {
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
    registerDiagramSyncModule(app, { db });
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

  async function seedDiagramAs(cookies: Record<string, string>, slug: string) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: `Catchup WS ${slug}`, slug: `catchup-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Catchup Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Catchup Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  function batchPayload(actorId: string, elementId: string) {
    return {
      clientMutationId: crypto.randomUUID(),
      baseRevision: 0,
      actorId,
      deltas: [
        {
          elementId,
          kind: 'upsert' as const,
          element: { id: elementId, type: 'rectangle', version: 1, versionNonce: 1 },
          version: 1,
          versionNonce: 1,
        },
      ],
    };
  }

  it('returns exactly the operations with sequence > afterSequence, in order', async () => {
    const owner = await seedUserWithSession('catchup-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');

    for (const elementId of ['el-1', 'el-2', 'el-3']) {
      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/operations:batch`,
        cookies: owner.cookies,
        payload: batchPayload(owner.user.id, elementId),
      });
      expect(response.statusCode).toBe(200);
    }

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/operations?afterSequence=1`,
      cookies: owner.cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.operations).toHaveLength(2);
    expect(body.operations.map((op: { sequence: number }) => op.sequence)).toEqual([2, 3]);
  });

  it('returns an empty list when the client is already caught up', async () => {
    const owner = await seedUserWithSession('catchup-uptodate');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'uptodate');

    await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: batchPayload(owner.user.id, 'el-1'),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/operations?afterSequence=1`,
      cookies: owner.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().operations).toEqual([]);
  });

  it('an actor outside the diagram workspace receives 404, never 403 (IDOR)', async () => {
    const owner = await seedUserWithSession('catchup-idor-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idor');

    const outsider = await seedUserWithSession('catchup-idor-outsider');
    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/operations?afterSequence=0`,
      cookies: outsider.cookies,
    });

    expect(response.statusCode).toBe(404);
  });

  it('a viewer (holds diagram:read) can catch up', async () => {
    const owner = await seedUserWithSession('catchup-viewer-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'viewer');

    const viewer = await seedUserWithSession('catchup-viewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: viewer.user.id, role: 'viewer' });

    await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: batchPayload(owner.user.id, 'el-1'),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/operations?afterSequence=0`,
      cookies: viewer.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().operations).toHaveLength(1);
  });

  it('requires an authenticated session (401 without a cookie)', async () => {
    const owner = await seedUserWithSession('catchup-unauth');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'unauth');

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/operations?afterSequence=0`,
    });

    expect(response.statusCode).toBe(401);
  });
});
