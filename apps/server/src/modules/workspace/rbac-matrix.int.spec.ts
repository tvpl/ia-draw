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
import { eq } from 'drizzle-orm';
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

  describe('org_admin reaches every workspace of its organisation (RBAC-01, ORG-01/03)', () => {
    it('an organization_members admin with no membership row in a workspace still reads it', async () => {
      // Two workspaces owned by the same organisation: the actor administers the
      // organisation (via `organization_members`, not a `workspace_members` row anywhere),
      // and has no row at all in either workspace.
      const owner = await seedUserWithSession('org-owner');
      const first = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS A', slug: `org-ws-a-${Date.now()}` },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS B', slug: `org-ws-b-${Date.now()}` },
      });
      const secondId = second.json().workspace.id;
      const organizationId = first.json().workspace.organizationId;

      const actor = await seedUserWithSession('org-admin-actor');
      await db.insert(schema.organizationMembers).values({ organizationId, userId: actor.user.id });

      const response = await app.inject({
        method: 'GET',
        url: `/workspaces/${secondId}`,
        cookies: actor.cookies,
      });

      expect(response.statusCode).toBe(200);
    });

    it('an organization_members admin with no membership row in a workspace may still write to it', async () => {
      const owner = await seedUserWithSession('org-owner-w');
      const first = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS C', slug: `org-ws-c-${Date.now()}` },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS D', slug: `org-ws-d-${Date.now()}` },
      });
      const actor = await seedUserWithSession('org-admin-writer');
      await db.insert(schema.organizationMembers).values({
        organizationId: first.json().workspace.organizationId,
        userId: actor.user.id,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        cookies: actor.cookies,
        payload: { workspaceId: second.json().workspace.id, name: 'Cross-workspace project' },
      });

      expect(response.statusCode).toBe(201);
    });

    it('a workspace_members row with role org_admin (legacy) grants NO organisation-wide reach on its own (ORG-03)', async () => {
      // The exact scenario the old, buggy read used to allow: `org_admin` in ONE workspace's
      // `workspace_members` row, with no corresponding `organization_members` row at all.
      const owner = await seedUserWithSession('org-owner-legacy');
      const first = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS Legacy A', slug: `org-ws-legacy-a-${Date.now()}` },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS Legacy B', slug: `org-ws-legacy-b-${Date.now()}` },
      });
      const actor = await seedUserWithSession('legacy-org-admin-actor');
      await db.insert(schema.workspaceMembers).values({
        workspaceId: first.json().workspace.id,
        userId: actor.user.id,
        role: 'org_admin',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/workspaces/${second.json().workspace.id}`,
        cookies: actor.cookies,
      });

      expect(response.statusCode).toBe(404);
    });

    it('a workspace_admin of one workspace still gets 404 on another (the reach is org_admin-only)', async () => {
      const owner = await seedUserWithSession('org-owner-ws');
      const first = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS E', slug: `org-ws-e-${Date.now()}` },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS F', slug: `org-ws-f-${Date.now()}` },
      });
      const actor = await seedUserWithSession('ws-admin-actor');
      await db.insert(schema.workspaceMembers).values({
        workspaceId: first.json().workspace.id,
        userId: actor.user.id,
        role: 'workspace_admin',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/workspaces/${second.json().workspace.id}`,
        cookies: actor.cookies,
      });

      expect(response.statusCode).toBe(404);
    });

    it('the more permissive of the two levels wins: organization_members admin downgraded to viewer locally still writes (RBAC edge case)', async () => {
      const owner = await seedUserWithSession('org-owner-mix');
      const first = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS G', slug: `org-ws-g-${Date.now()}` },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/workspaces',
        cookies: owner.cookies,
        payload: { name: 'Org WS H', slug: `org-ws-h-${Date.now()}` },
      });
      const secondId = second.json().workspace.id;
      const actor = await seedUserWithSession('org-admin-mixed');
      await db.insert(schema.organizationMembers).values({
        organizationId: first.json().workspace.organizationId,
        userId: actor.user.id,
      });
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId: secondId, userId: actor.user.id, role: 'viewer' });

      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        cookies: actor.cookies,
        payload: { workspaceId: secondId, name: 'Still allowed' },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('a workspace never loses its last administrator (RBAC-08..12)', () => {
    /**
     * A workspace in an organisation of its OWN, created directly rather than through
     * `POST /workspaces`.
     *
     * The route puts every workspace in the single default organisation, and RBAC-10 says
     * an `org_admin` anywhere in the owning organisation keeps a workspace administered —
     * correctly, by design. Sharing the default organisation with the rest of this suite
     * would therefore mean the guard never fires here, and the test would be measuring the
     * other tests' fixtures instead of the guard.
     */
    async function seedIsolatedWorkspace() {
      seedCounter += 1;
      const owner = await seedUserWithSession('last-admin-owner');
      const [organization] = await db
        .insert(schema.organizations)
        .values({
          name: `Last admin org ${seedCounter}`,
          slug: `last-admin-org-${seedCounter}-${Date.now()}`,
        })
        .returning();
      const [workspace] = await db
        .insert(schema.workspaces)
        .values({
          organizationId: organization?.id ?? '',
          name: 'Last admin WS',
          slug: `last-admin-${seedCounter}-${Date.now()}`,
        })
        .returning();
      await db.insert(schema.workspaceMembers).values({
        workspaceId: workspace?.id ?? '',
        userId: owner.user.id,
        role: 'workspace_admin',
      });
      return { workspaceId: workspace?.id ?? '', owner };
    }

    it('refuses to remove the only administrator, with 409, leaving the row in place', async () => {
      const { workspaceId, owner } = await seedIsolatedWorkspace();

      const response = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/members/${owner.user.id}`,
        cookies: owner.cookies,
      });

      expect(response.statusCode).toBe(409);
      const rows = await db
        .select()
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
      expect(rows).toHaveLength(1);
    });

    it('refuses to downgrade the only administrator, with 409, leaving the role in place', async () => {
      const { workspaceId, owner } = await seedIsolatedWorkspace();

      const response = await app.inject({
        method: 'PATCH',
        url: `/workspaces/${workspaceId}/members/${owner.user.id}`,
        cookies: owner.cookies,
        payload: { role: 'viewer' },
      });

      expect(response.statusCode).toBe(409);
      const [row] = await db
        .select()
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
      expect(row?.role).toBe('workspace_admin');
    });

    it('allows removing one administrator while another remains', async () => {
      const { workspaceId, owner } = await seedIsolatedWorkspace();
      const second = await seedUserWithSession('second-admin');
      await db.insert(schema.workspaceMembers).values({
        workspaceId,
        userId: second.user.id,
        role: 'workspace_admin',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/members/${second.user.id}`,
        cookies: owner.cookies,
      });

      expect(response.statusCode).toBe(204);
    });

    it('records the previous role on the audit event of a role change (RBAC-11)', async () => {
      const { workspaceId, owner } = await seedIsolatedWorkspace();
      const target = await seedUserWithSession('audit-target');
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId, userId: target.user.id, role: 'viewer' });

      await app.inject({
        method: 'PATCH',
        url: `/workspaces/${workspaceId}/members/${target.user.id}`,
        cookies: owner.cookies,
        payload: { role: 'editor' },
      });

      const events = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, 'workspace.member.updated'));
      const event = events.find(
        (candidate) =>
          (candidate.metadataJson as { targetUserId?: string }).targetUserId === target.user.id,
      );
      expect(event).toBeDefined();
      const metadata = event?.metadataJson as { previousRole?: string; role?: string };
      expect(metadata.previousRole).toBe('viewer');
      expect(metadata.role).toBe('editor');
    });
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
