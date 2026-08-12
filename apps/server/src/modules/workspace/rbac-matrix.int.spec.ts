// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (see packages/database/src/migrate.int.spec.ts for the established pattern this mirrors).
//
// T18 scope note (AUTH-04, AUTH-05): this suite proves the full role x
// operation matrix over REST, the IDOR 404-not-403 rule, and that a role
// downgrade is enforced on the very next REST request for the same
// session — because every route resolves the actor's role fresh from
// `workspace_members` per request (see rbac.ts's resolveWorkspaceRole),
// this "next request" property holds by construction and satisfies the
// spec's "within 10 seconds" bound for REST. Enforcement on an
// already-open WebSocket connection is explicitly out of scope here — the
// ws-gateway module that owns live connections doesn't exist until F1b
// (see spec.md Edge Cases and design.md ws-gateway component).

import type { Role } from '@arch-canvas/auth';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerWorkspaceModule } from './routes.js';

const ROLES: readonly Role[] = ['org_admin', 'workspace_admin', 'editor', 'reviewer', 'viewer'];
const ADMIN_TIER = new Set<Role>(['org_admin', 'workspace_admin']);
const EDITOR_TIER = new Set<Role>(['org_admin', 'workspace_admin', 'editor']);
const ALL_ROLES = new Set<Role>(ROLES);

describe('RBAC IDOR + role x operation matrix (T18, AUTH-04, AUTH-05)', () => {
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

  let seedCounter = 0;
  async function seedUserWithSession(prefix: string) {
    seedCounter += 1;
    const user = await createLocalAccount(db, {
      email: `${prefix}-${seedCounter}-${Date.now()}@example.com`,
      displayName: prefix,
      password: `${prefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  /**
   * Seeds an isolated workspace (created by a separate admin), a project
   * and a diagram inside it, then grants `role` to a fresh actor. Fully
   * isolated per call so destructive scenarios (DELETE) never interfere
   * with each other.
   */
  async function seedContext(role: Role) {
    const admin = await seedUserWithSession('matrix-admin');
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies: admin.cookies,
      payload: {
        name: `Matrix WS ${role}`,
        slug: `matrix-ws-${role}-${seedCounter}-${Date.now()}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    // `admin` (the workspace creator) already holds workspace_admin
    // automatically via T16's create flow; `actor` is always a distinct
    // user and needs its own explicit membership row for every role under
    // test, including workspace_admin.
    const actor = await seedUserWithSession(`matrix-${role}`);
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId: actor.user.id, role });

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies: admin.cookies,
      payload: { workspaceId, name: `Matrix Project ${role}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies: admin.cookies,
      payload: { projectId, title: `Matrix Diagram ${role}` },
    });
    const diagramId = createDiagram.json().diagram.id;

    return { workspaceId, projectId, diagramId, actor, admin };
  }

  interface Scenario {
    name: string;
    allowedRoles: Set<Role>;
    successStatus: number;
    request: (
      ctx: Awaited<ReturnType<typeof seedContext>>,
      extra: { newUserId: string },
    ) => InjectOptions;
  }

  const SCENARIOS: Scenario[] = [
    {
      name: 'workspace:read (GET /workspaces/:id)',
      allowedRoles: ALL_ROLES,
      successStatus: 200,
      request: (ctx) => ({
        method: 'GET',
        url: `/workspaces/${ctx.workspaceId}`,
        cookies: ctx.actor.cookies,
      }),
    },
    {
      name: 'workspace:write (PATCH /workspaces/:id)',
      allowedRoles: ADMIN_TIER,
      successStatus: 200,
      request: (ctx) => ({
        method: 'PATCH',
        url: `/workspaces/${ctx.workspaceId}`,
        cookies: ctx.actor.cookies,
        payload: { name: 'Renamed by matrix test' },
      }),
    },
    {
      name: 'workspace:delete (DELETE /workspaces/:id)',
      allowedRoles: ADMIN_TIER,
      successStatus: 204,
      request: (ctx) => ({
        method: 'DELETE',
        url: `/workspaces/${ctx.workspaceId}`,
        cookies: ctx.actor.cookies,
      }),
    },
    {
      name: 'workspace:manage_members (POST /workspaces/:id/members)',
      allowedRoles: ADMIN_TIER,
      successStatus: 201,
      request: (ctx, extra) => ({
        method: 'POST',
        url: `/workspaces/${ctx.workspaceId}/members`,
        cookies: ctx.actor.cookies,
        payload: { userId: extra.newUserId, role: 'viewer' },
      }),
    },
    {
      name: 'project:read (GET /projects/:id)',
      allowedRoles: ALL_ROLES,
      successStatus: 200,
      request: (ctx) => ({
        method: 'GET',
        url: `/projects/${ctx.projectId}`,
        cookies: ctx.actor.cookies,
      }),
    },
    {
      name: 'project:write create (POST /projects)',
      allowedRoles: EDITOR_TIER,
      successStatus: 201,
      request: (ctx) => ({
        method: 'POST',
        url: '/projects',
        cookies: ctx.actor.cookies,
        payload: { workspaceId: ctx.workspaceId, name: 'Matrix-created project' },
      }),
    },
    {
      name: 'project:write update (PATCH /projects/:id)',
      allowedRoles: EDITOR_TIER,
      successStatus: 200,
      request: (ctx) => ({
        method: 'PATCH',
        url: `/projects/${ctx.projectId}`,
        cookies: ctx.actor.cookies,
        payload: { name: 'Renamed project' },
      }),
    },
    {
      name: 'project:delete (DELETE /projects/:id)',
      allowedRoles: EDITOR_TIER,
      successStatus: 204,
      request: (ctx) => ({
        method: 'DELETE',
        url: `/projects/${ctx.projectId}`,
        cookies: ctx.actor.cookies,
      }),
    },
    {
      name: 'diagram:read (GET /diagrams/:id)',
      allowedRoles: ALL_ROLES,
      successStatus: 200,
      request: (ctx) => ({
        method: 'GET',
        url: `/diagrams/${ctx.diagramId}`,
        cookies: ctx.actor.cookies,
      }),
    },
    {
      name: 'diagram:write create (POST /diagrams)',
      allowedRoles: EDITOR_TIER,
      successStatus: 201,
      request: (ctx) => ({
        method: 'POST',
        url: '/diagrams',
        cookies: ctx.actor.cookies,
        payload: { projectId: ctx.projectId, title: 'Matrix-created diagram' },
      }),
    },
    {
      name: 'diagram:write update (PATCH /diagrams/:id)',
      allowedRoles: EDITOR_TIER,
      successStatus: 200,
      request: (ctx) => ({
        method: 'PATCH',
        url: `/diagrams/${ctx.diagramId}`,
        cookies: ctx.actor.cookies,
        payload: { title: 'Renamed diagram' },
      }),
    },
    {
      name: 'diagram:delete (DELETE /diagrams/:id)',
      allowedRoles: EDITOR_TIER,
      successStatus: 204,
      request: (ctx) => ({
        method: 'DELETE',
        url: `/diagrams/${ctx.diagramId}`,
        cookies: ctx.actor.cookies,
      }),
    },
  ];

  describe('full role x operation matrix', () => {
    for (const scenario of SCENARIOS) {
      for (const role of ROLES) {
        const expectedStatus = scenario.allowedRoles.has(role) ? scenario.successStatus : 403;

        it(`${scenario.name} x role=${role} -> ${expectedStatus}`, async () => {
          const ctx = await seedContext(role);
          const newUser = await seedUserWithSession(`matrix-target-${role}`);
          const response: LightMyRequestResponse = await app.inject(
            scenario.request(ctx, { newUserId: newUser.user.id }),
          );
          expect(response.statusCode).toBe(expectedStatus);
        });
      }
    }
  });

  describe('IDOR: non-member gets 404, never 403, on GET of workspace/project/diagram', () => {
    it('GET /workspaces/:id returns 404 for a user with no membership row', async () => {
      const { workspaceId } = await seedContext('editor');
      const outsider = await seedUserWithSession('idor-outsider-ws');

      const response = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}`,
        cookies: outsider.cookies,
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /projects/:id returns 404 for a user with no membership row', async () => {
      const { projectId } = await seedContext('editor');
      const outsider = await seedUserWithSession('idor-outsider-project');

      const response = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}`,
        cookies: outsider.cookies,
      });
      expect(response.statusCode).toBe(404);
    });

    it('GET /diagrams/:id returns 404 for a user with no membership row', async () => {
      const { diagramId } = await seedContext('editor');
      const outsider = await seedUserWithSession('idor-outsider-diagram');

      const response = await app.inject({
        method: 'GET',
        url: `/diagrams/${diagramId}`,
        cookies: outsider.cookies,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('immediate role-downgrade enforcement (AUTH-05)', () => {
    it('downgrading editor -> viewer makes the very next mutation from the same session 403', async () => {
      const { workspaceId, diagramId, actor, admin } = await seedContext('editor');

      const beforeDowngrade = await app.inject({
        method: 'PATCH',
        url: `/diagrams/${diagramId}`,
        cookies: actor.cookies,
        payload: { title: 'Editable before downgrade' },
      });
      expect(beforeDowngrade.statusCode).toBe(200);

      const downgrade = await app.inject({
        method: 'PATCH',
        url: `/workspaces/${workspaceId}/members/${actor.user.id}`,
        cookies: admin.cookies,
        payload: { role: 'viewer' },
      });
      expect(downgrade.statusCode).toBe(200);

      // Same session cookie, no re-login — the very next request must be blocked.
      const afterDowngrade = await app.inject({
        method: 'PATCH',
        url: `/diagrams/${diagramId}`,
        cookies: actor.cookies,
        payload: { title: 'Blocked after downgrade' },
      });
      expect(afterDowngrade.statusCode).toBe(403);
    });
  });
});
