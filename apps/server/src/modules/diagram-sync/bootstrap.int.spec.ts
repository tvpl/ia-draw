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

describe('GET /diagrams/:id/bootstrap (T21, EDT-01)', () => {
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
      payload: { name: `Bootstrap WS ${slug}`, slug: `bootstrap-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Bootstrap Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Bootstrap Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  it('a brand-new diagram bootstraps with an empty scene, revision 0, and correct permissions for the actor role', async () => {
    const owner = await seedUserWithSession('bootstrap-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'new');

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/bootstrap`,
      cookies: owner.cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.scene).toEqual([]);
    expect(body.revision).toBe(0);
    expect(body.assets).toEqual([]);
    // Owner auto-became workspace_admin on workspace creation — diagram:read is granted.
    expect(body.permissions).toMatchObject({ allowed: true });
    // workspace_admin also grants diagram:mutate (DOCK-02) — the mutate-capable case.
    expect(body.mutatePermissions).toMatchObject({ allowed: true });
  });

  it("a viewer's bootstrap also succeeds (diagram:read) with permissions reflecting the role", async () => {
    const owner = await seedUserWithSession('bootstrap-viewer-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'viewer');

    const viewer = await seedUserWithSession('bootstrap-viewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: viewer.user.id, role: 'viewer' });

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/bootstrap`,
      cookies: viewer.cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.permissions).toMatchObject({ allowed: true });
    // viewer never holds diagram:mutate (AUTH-03) — DOCK-02's non-render signal.
    expect(body.mutatePermissions).toMatchObject({ allowed: false });
  });

  it('a user outside the diagram workspace receives 404, never 403 (IDOR, AUTH-04)', async () => {
    const owner = await seedUserWithSession('bootstrap-idor-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idor');

    const outsider = await seedUserWithSession('bootstrap-idor-outsider');

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/bootstrap`,
      cookies: outsider.cookies,
    });

    expect(response.statusCode).toBe(404);
  });

  it('bootstrapping a non-existent diagram id also returns 404', async () => {
    const owner = await seedUserWithSession('bootstrap-missing');

    const response = await app.inject({
      method: 'GET',
      url: '/diagrams/00000000-0000-0000-0000-000000000000/bootstrap',
      cookies: owner.cookies,
    });

    expect(response.statusCode).toBe(404);
  });

  it('bootstrapping without a session cookie returns 401', async () => {
    const owner = await seedUserWithSession('bootstrap-unauth');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'unauth');

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/bootstrap`,
    });

    expect(response.statusCode).toBe(401);
  });

  it('folds committed operations from the op-log into the bootstrapped scene and revision', async () => {
    const owner = await seedUserWithSession('bootstrap-with-ops');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'with-ops');

    await db.insert(schema.diagramOperations).values({
      diagramId,
      sequence: 1,
      clientMutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      actorId: owner.user.id,
      baseRevision: 0,
      elementsDeltaJson: [
        {
          elementId: 'el-1',
          kind: 'upsert',
          element: { id: 'el-1', type: 'rectangle', version: 1, versionNonce: 111 },
          version: 1,
          versionNonce: 111,
        },
      ],
      operationSummaryJson: { upserts: 1, deletes: 0, elementIds: ['el-1'] },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/bootstrap`,
      cookies: owner.cookies,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.revision).toBe(1);
    expect(body.scene).toHaveLength(1);
    expect(body.scene[0]).toMatchObject({ id: 'el-1' });
  });
});
