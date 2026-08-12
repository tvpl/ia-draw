// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (see packages/database/src/migrate.int.spec.ts for the established pattern this mirrors).
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import * as schema from '@arch-canvas/database';
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
      .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, admin.user.id)));
    expect(membership?.role).toBe('workspace_admin');
  });

  describe('member management permissions', () => {
    async function seedWorkspaceWithRole(role: 'workspace_admin' | 'editor' | 'reviewer' | 'viewer') {
      const admin = await seedUserWithSession('member-mgmt-admin');
      const create = await createWorkspaceAs(admin.cookies, `member-mgmt-${role}-${Date.now()}`);
      const workspaceId = create.json().workspace.id;

      const actor = await seedUserWithSession(`member-mgmt-${role}`);
      if (role !== 'workspace_admin') {
        await db.insert(schema.workspaceMembers).values({ workspaceId, userId: actor.user.id, role });
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
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId: target.user.id, role: 'viewer' });

      const response = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/members/${target.user.id}`,
        cookies: admin.cookies,
      });
      expect(response.statusCode).toBe(204);
    });

    it.each(['editor', 'reviewer', 'viewer'] as const)('%s receives 403 adding a member', async (role) => {
      const { workspaceId, actor } = await seedWorkspaceWithRole(role);
      const target = await seedUserWithSession(`blocked-add-target-${role}`);

      const response = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/members`,
        cookies: actor.cookies,
        payload: { userId: target.user.id, role: 'viewer' },
      });
      expect(response.statusCode).toBe(403);
    });

    it.each(['editor', 'reviewer', 'viewer'] as const)('%s receives 403 removing a member', async (role) => {
      const { workspaceId, actor, admin } = await seedWorkspaceWithRole(role);

      const response = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/members/${admin.user.id}`,
        cookies: actor.cookies,
      });
      expect(response.statusCode).toBe(403);
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
      .where(and(eq(schema.auditEvents.resourceType, 'workspace'), eq(schema.auditEvents.resourceId, workspaceId)));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'workspace.created',
      actorId: admin.user.id,
      resourceType: 'workspace',
      resourceId: workspaceId,
    });
  });
});
