// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (see packages/database/src/migrate.int.spec.ts for the established pattern this mirrors).

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
import { registerWorkspaceModule } from './routes.js';

describe('project + diagram metadata CRUD (T17, EDT-01 partial)', () => {
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

  /** Seeds a workspace (creator = workspace_admin) and adds `actor` with `role`. */
  async function seedWorkspaceWithActorRole(role: 'editor' | 'reviewer' | 'viewer') {
    const admin = await seedUserWithSession('pd-admin');
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies: admin.cookies,
      payload: { name: `PD Workspace ${role}`, slug: `pd-ws-${role}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const actor = await seedUserWithSession(`pd-${role}`);
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId: actor.user.id, role });

    return { workspaceId, admin, actor };
  }

  async function createProjectAs(cookies: Record<string, string>, workspaceId: string) {
    return app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Project ${Date.now()}` },
    });
  }

  describe('reviewer/viewer can GET but are denied writes on projects/diagrams', () => {
    it.each(['reviewer', 'viewer'] as const)(
      '%s: GET /projects succeeds, POST /projects is 403',
      async (role) => {
        const { workspaceId, actor } = await seedWorkspaceWithActorRole(role);

        const get = await app.inject({
          method: 'GET',
          url: `/projects?workspaceId=${workspaceId}`,
          cookies: actor.cookies,
        });
        expect(get.statusCode).toBe(200);

        const post = await createProjectAs(actor.cookies, workspaceId);
        expect(post.statusCode).toBe(403);
      },
    );

    it.each(['reviewer', 'viewer'] as const)(
      '%s: PATCH and DELETE /projects/:id are 403',
      async (role) => {
        const { workspaceId, admin, actor } = await seedWorkspaceWithActorRole(role);
        const project = (await createProjectAs(admin.cookies, workspaceId)).json().project;

        const patch = await app.inject({
          method: 'PATCH',
          url: `/projects/${project.id}`,
          cookies: actor.cookies,
          payload: { name: 'Renamed' },
        });
        expect(patch.statusCode).toBe(403);

        const del = await app.inject({
          method: 'DELETE',
          url: `/projects/${project.id}`,
          cookies: actor.cookies,
        });
        expect(del.statusCode).toBe(403);
      },
    );

    it.each(['reviewer', 'viewer'] as const)(
      '%s: GET /diagrams succeeds, POST/PATCH/DELETE /diagrams are 403',
      async (role) => {
        const { workspaceId, admin, actor } = await seedWorkspaceWithActorRole(role);
        const project = (await createProjectAs(admin.cookies, workspaceId)).json().project;
        const createDiagramResponse = await app.inject({
          method: 'POST',
          url: '/diagrams',
          cookies: admin.cookies,
          payload: { projectId: project.id, title: 'System Overview' },
        });
        const diagram = createDiagramResponse.json().diagram;

        const get = await app.inject({
          method: 'GET',
          url: `/diagrams?projectId=${project.id}`,
          cookies: actor.cookies,
        });
        expect(get.statusCode).toBe(200);

        const post = await app.inject({
          method: 'POST',
          url: '/diagrams',
          cookies: actor.cookies,
          payload: { projectId: project.id, title: 'Blocked Diagram' },
        });
        expect(post.statusCode).toBe(403);

        const patch = await app.inject({
          method: 'PATCH',
          url: `/diagrams/${diagram.id}`,
          cookies: actor.cookies,
          payload: { title: 'Blocked Rename' },
        });
        expect(patch.statusCode).toBe(403);

        const del = await app.inject({
          method: 'DELETE',
          url: `/diagrams/${diagram.id}`,
          cookies: actor.cookies,
        });
        expect(del.statusCode).toBe(403);
      },
    );
  });

  it('an out-of-enum diagram status is rejected with 400 (problem+json)', async () => {
    const { workspaceId, admin } = await seedWorkspaceWithActorRole('editor');
    const project = (await createProjectAs(admin.cookies, workspaceId)).json().project;
    const diagram = (
      await app.inject({
        method: 'POST',
        url: '/diagrams',
        cookies: admin.cookies,
        payload: { projectId: project.id, title: 'Status Test Diagram' },
      })
    ).json().diagram;

    const response = await app.inject({
      method: 'PATCH',
      url: `/diagrams/${diagram.id}`,
      cookies: admin.cookies,
      payload: { status: 'not_a_real_status' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('a valid diagram status transition (draft -> in_review) succeeds', async () => {
    const { workspaceId, admin } = await seedWorkspaceWithActorRole('editor');
    const project = (await createProjectAs(admin.cookies, workspaceId)).json().project;
    const diagram = (
      await app.inject({
        method: 'POST',
        url: '/diagrams',
        cookies: admin.cookies,
        payload: { projectId: project.id, title: 'Valid Status Diagram' },
      })
    ).json().diagram;
    expect(diagram.status).toBe('draft');

    const response = await app.inject({
      method: 'PATCH',
      url: `/diagrams/${diagram.id}`,
      cookies: admin.cookies,
      payload: { status: 'in_review' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().diagram.status).toBe('in_review');
  });

  it('a created diagram inherits workspace_id from its project via join, never from the request body', async () => {
    const { workspaceId, admin } = await seedWorkspaceWithActorRole('editor');
    const project = (await createProjectAs(admin.cookies, workspaceId)).json().project;

    const otherWorkspaceCreate = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies: admin.cookies,
      payload: { name: 'Other Workspace', slug: `other-ws-${Date.now()}` },
    });
    const otherWorkspaceId = otherWorkspaceCreate.json().workspace.id;

    const response = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies: admin.cookies,
      // The route schema has no workspaceId field for diagrams at all — this
      // extra key must be silently ignored, not used to override the join.
      payload: {
        projectId: project.id,
        title: 'Spoofed Workspace Diagram',
        workspaceId: otherWorkspaceId,
      },
    });
    expect(response.statusCode).toBe(201);
    const diagramId = response.json().diagram.id;

    const [row] = await db
      .select({ workspaceId: schema.projects.workspaceId })
      .from(schema.diagrams)
      .innerJoin(schema.projects, eq(schema.diagrams.projectId, schema.projects.id))
      .where(eq(schema.diagrams.id, diagramId));

    expect(row?.workspaceId).toBe(workspaceId);
    expect(row?.workspaceId).not.toBe(otherWorkspaceId);
  });
});
