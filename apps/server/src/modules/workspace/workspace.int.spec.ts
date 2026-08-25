// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (see packages/database/src/migrate.int.spec.ts for the established pattern this mirrors).

import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
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

describe('workspace + member CRUD (T16, AUTH-02)', () => {
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

  async function createWorkspaceAs(cookies: Record<string, string>, slug: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: `Workspace ${slug}`, slug },
    });
    return response;
  }

  it('creating a workspace with a slug that already exists returns 409', async () => {
    const admin = await seedUserWithSession('slug-owner');
    const slug = `dup-slug-${Date.now()}`;

    const first = await createWorkspaceAs(admin.cookies, slug);
    expect(first.statusCode).toBe(201);

    const second = await createWorkspaceAs(admin.cookies, slug);
    expect(second.statusCode).toBe(409);
  });

  it('the creator becomes workspace_admin automatically', async () => {
    const admin = await seedUserWithSession('creator');
    const create = await createWorkspaceAs(admin.cookies, `creator-ws-${Date.now()}`);
    const workspaceId = create.json().workspace.id;

    const [membership] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          eq(schema.workspaceMembers.userId, admin.user.id),
        ),
      );
    expect(membership?.role).toBe('workspace_admin');
  });

  describe('member management permissions', () => {
    async function seedWorkspaceWithRole(
      role: 'workspace_admin' | 'editor' | 'reviewer' | 'viewer',
    ) {
      const admin = await seedUserWithSession('member-mgmt-admin');
      const create = await createWorkspaceAs(admin.cookies, `member-mgmt-${role}-${Date.now()}`);
      const workspaceId = create.json().workspace.id;

      const actor = await seedUserWithSession(`member-mgmt-${role}`);
      if (role !== 'workspace_admin') {
        await db
          .insert(schema.workspaceMembers)
          .values({ workspaceId, userId: actor.user.id, role });
      }
      return { workspaceId, actor, admin };
    }

    it('workspace_admin can add a member', async () => {
      const { workspaceId, admin } = await seedWorkspaceWithRole('workspace_admin');
      const target = await seedUserWithSession('added-by-admin');

      const response = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/members`,
        cookies: admin.cookies,
        payload: { userId: target.user.id, role: 'editor' },
      });
      expect(response.statusCode).toBe(201);
    });

    it('workspace_admin can remove a member', async () => {
      const { workspaceId, admin } = await seedWorkspaceWithRole('workspace_admin');
      const target = await seedUserWithSession('removed-by-admin');
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId, userId: target.user.id, role: 'viewer' });

      const response = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/members/${target.user.id}`,
        cookies: admin.cookies,
      });
      expect(response.statusCode).toBe(204);
    });

    it.each(['editor', 'reviewer', 'viewer'] as const)(
      '%s receives 403 adding a member',
      async (role) => {
        const { workspaceId, actor } = await seedWorkspaceWithRole(role);
        const target = await seedUserWithSession(`blocked-add-target-${role}`);

        const response = await app.inject({
          method: 'POST',
          url: `/workspaces/${workspaceId}/members`,
          cookies: actor.cookies,
          payload: { userId: target.user.id, role: 'viewer' },
        });
        expect(response.statusCode).toBe(403);
      },
    );

    it.each(['editor', 'reviewer', 'viewer'] as const)(
      '%s receives 403 removing a member',
      async (role) => {
        const { workspaceId, actor, admin } = await seedWorkspaceWithRole(role);

        const response = await app.inject({
          method: 'DELETE',
          url: `/workspaces/${workspaceId}/members/${admin.user.id}`,
          cookies: actor.cookies,
        });
        expect(response.statusCode).toBe(403);
      },
    );
  });

  describe('role in GET /workspaces and GET /workspaces/:id (NAV-13, NAV-17, NAV-09..12)', () => {
    it('GET /workspaces includes each item’s own distinct role for the caller', async () => {
      const owner = await seedUserWithSession('multi-role-owner');
      const wsA = await createWorkspaceAs(owner.cookies, `multi-role-a-${Date.now()}`);
      const wsB = await createWorkspaceAs(owner.cookies, `multi-role-b-${Date.now()}`);
      const workspaceAId = wsA.json().workspace.id;
      const workspaceBId = wsB.json().workspace.id;

      const actor = await seedUserWithSession('multi-role-actor');
      await db.insert(schema.workspaceMembers).values([
        { workspaceId: workspaceAId, userId: actor.user.id, role: 'editor' },
        { workspaceId: workspaceBId, userId: actor.user.id, role: 'viewer' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/workspaces',
        cookies: actor.cookies,
      });
      expect(response.statusCode).toBe(200);

      const items = response.json().items as Array<{
        id: string;
        organizationId: string;
        name: string;
        slug: string;
        accessPolicy: string;
        createdAt: string;
        updatedAt: string;
        role: string;
      }>;

      const itemA = items.find((item) => item.id === workspaceAId);
      const itemB = items.find((item) => item.id === workspaceBId);
      expect(itemA?.role).toBe('editor');
      expect(itemB?.role).toBe('viewer');
      // Existing fields stay byte-for-byte present alongside the new one.
      expect(itemA).toMatchObject({
        id: workspaceAId,
        organizationId: expect.any(String),
        name: expect.any(String),
        slug: expect.any(String),
        accessPolicy: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('GET /workspaces/:id includes the caller’s role for a non-admin member', async () => {
      const admin = await seedUserWithSession('detail-role-admin');
      const create = await createWorkspaceAs(admin.cookies, `detail-role-${Date.now()}`);
      const workspaceId = create.json().workspace.id;

      const actor = await seedUserWithSession('detail-role-actor');
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId, userId: actor.user.id, role: 'reviewer' });

      const response = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}`,
        cookies: actor.cookies,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().workspace).toMatchObject({
        id: workspaceId,
        role: 'reviewer',
      });
    });
  });

  describe('listWorkspacesForUser reads organisation-wide reach from organization_members (ORG-03)', () => {
    it('GET /workspaces includes every workspace of the organisation for a user with only an organization_members row', async () => {
      const owner = await seedUserWithSession('org-list-owner');
      const wsA = await createWorkspaceAs(owner.cookies, `org-list-a-${Date.now()}`);
      const wsB = await createWorkspaceAs(owner.cookies, `org-list-b-${Date.now()}`);
      const workspaceAId = wsA.json().workspace.id;
      const workspaceBId = wsB.json().workspace.id;
      const organizationId = wsA.json().workspace.organizationId;

      // The actor has NO workspace_members row anywhere — only an organization_members row.
      const actor = await seedUserWithSession('org-list-actor');
      await db.insert(schema.organizationMembers).values({ organizationId, userId: actor.user.id });

      const response = await app.inject({
        method: 'GET',
        url: '/workspaces',
        cookies: actor.cookies,
      });
      expect(response.statusCode).toBe(200);

      const items = response.json().items as Array<{ id: string; role: string }>;
      const itemA = items.find((item) => item.id === workspaceAId);
      const itemB = items.find((item) => item.id === workspaceBId);
      expect(itemA?.role).toBe('org_admin');
      expect(itemB?.role).toBe('org_admin');
    });

    it('a legacy workspace_members row with role org_admin alone does NOT widen GET /workspaces (ORG-03)', async () => {
      const owner = await seedUserWithSession('org-list-legacy-owner');
      const wsA = await createWorkspaceAs(owner.cookies, `org-list-legacy-a-${Date.now()}`);
      const wsB = await createWorkspaceAs(owner.cookies, `org-list-legacy-b-${Date.now()}`);
      const workspaceAId = wsA.json().workspace.id;
      const workspaceBId = wsB.json().workspace.id;

      const actor = await seedUserWithSession('org-list-legacy-actor');
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId: workspaceAId, userId: actor.user.id, role: 'org_admin' });

      const response = await app.inject({
        method: 'GET',
        url: '/workspaces',
        cookies: actor.cookies,
      });
      expect(response.statusCode).toBe(200);

      const items = response.json().items as Array<{ id: string }>;
      expect(items.some((item) => item.id === workspaceAId)).toBe(true);
      expect(items.some((item) => item.id === workspaceBId)).toBe(false);
    });
  });

  it('a successful mutation records one row in audit_events', async () => {
    const admin = await seedUserWithSession('audit-owner');
    const slug = `audit-ws-${Date.now()}`;
    const create = await createWorkspaceAs(admin.cookies, slug);
    const workspaceId = create.json().workspace.id;

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.resourceType, 'workspace'),
          eq(schema.auditEvents.resourceId, workspaceId),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'workspace.created',
      actorId: admin.user.id,
      resourceType: 'workspace',
      resourceId: workspaceId,
    });
  });
});
