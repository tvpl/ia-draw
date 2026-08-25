// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI uses real Postgres via GitHub Actions services (AD-007). The concurrency case below accepts PGlite's single-connection limitation (genuine concurrent-connection proof is `lastAdmin.concurrency.int.spec.ts`'s scope, not this feature's — spec.md/tasks.md T8).

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

describe('organization-admins REST routes (ORG-05..11)', () => {
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

  let seedCounter = 0;

  /**
   * A workspace in an organisation of its OWN, created directly rather than through
   * `POST /workspaces` — that route resolves `getOrCreateDefaultOrganization` (one shared
   * organisation for the whole suite), so counting `organization_members` rows per
   * organisation would measure every other test's fixtures too (same reasoning as
   * `rbac-matrix.int.spec.ts`'s `seedIsolatedWorkspace`).
   *
   * The owner gets both a `workspace_admin` row (T16's normal create-flow shape) and the
   * `organization_members` grant, so it starts as the organisation's exactly-one admin.
   */
  async function seedWorkspaceWithOrgAdmin() {
    seedCounter += 1;
    const owner = await seedUserWithSession('org-admin-owner');
    const [organization] = await db
      .insert(schema.organizations)
      .values({
        name: `Org Admins Org ${seedCounter}`,
        slug: `org-admins-org-${seedCounter}-${Date.now()}`,
      })
      .returning();
    if (!organization) throw new Error('organization insert failed');
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        organizationId: organization.id,
        name: 'Org Admins WS',
        slug: `org-admins-ws-${seedCounter}-${Date.now()}`,
      })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: workspace.id, userId: owner.user.id, role: 'workspace_admin' });
    await db
      .insert(schema.organizationMembers)
      .values({ organizationId: organization.id, userId: owner.user.id });
    return { workspaceId: workspace.id, organizationId: organization.id, owner };
  }

  it('GET returns the admin list for any member of the workspace (ORG-05)', async () => {
    const { workspaceId, owner } = await seedWorkspaceWithOrgAdmin();
    const viewer = await seedUserWithSession('org-admins-viewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: viewer.user.id, role: 'viewer' });

    const response = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/organization-admins`,
      cookies: viewer.cookies,
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().items as Array<{ userId: string }>;
    expect(items.some((item) => item.userId === owner.user.id)).toBe(true);
  });

  it('POST/DELETE respond 403 for a workspace_admin who is not org_admin (ORG-06)', async () => {
    const { workspaceId, organizationId } = await seedWorkspaceWithOrgAdmin();
    const wsAdmin = await seedUserWithSession('org-admins-ws-admin');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: wsAdmin.user.id, role: 'workspace_admin' });
    const target = await seedUserWithSession('org-admins-post-target');

    const post = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/organization-admins`,
      cookies: wsAdmin.cookies,
      payload: { email: target.user.email },
    });
    expect(post.statusCode).toBe(403);

    // Nothing was granted.
    const rows = await db
      .select()
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, organizationId),
          eq(schema.organizationMembers.userId, target.user.id),
        ),
      );
    expect(rows).toHaveLength(0);

    const del = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/organization-admins/${target.user.id}`,
      cookies: wsAdmin.cookies,
    });
    expect(del.statusCode).toBe(403);
  });

  it('POST grants organization-wide admin by email and records an audit event with actor and target (ORG-06)', async () => {
    const { workspaceId, organizationId, owner } = await seedWorkspaceWithOrgAdmin();
    const target = await seedUserWithSession('org-admins-grant-target');

    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/organization-admins`,
      cookies: owner.cookies,
      payload: { email: target.user.email },
    });
    expect(response.statusCode).toBe(201);

    const rows = await db
      .select()
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, organizationId),
          eq(schema.organizationMembers.userId, target.user.id),
        ),
      );
    expect(rows).toHaveLength(1);

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'organization.admin.added'));
    const event = events.find(
      (candidate) =>
        (candidate.metadataJson as { targetUserId?: string }).targetUserId === target.user.id,
    );
    expect(event).toBeDefined();
    expect(event?.actorId).toBe(owner.user.id);
    expect(event?.resourceType).toBe('organization');
    expect(event?.resourceId).toBe(organizationId);
  });

  it('POST with an email matching no existing user refuses with a clear message and creates nothing (ORG-07)', async () => {
    const { workspaceId, organizationId, owner } = await seedWorkspaceWithOrgAdmin();

    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/organization-admins`,
      cookies: owner.cookies,
      payload: { email: 'nobody-with-this-email@example.com' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().title).toBeTruthy();

    const rows = await db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organizationId, organizationId));
    // Only the seeding owner's own grant exists — nothing was added by the failed POST.
    expect(rows).toHaveLength(1);
  });

  it('DELETE revokes and records an audit event with actor and target (ORG-09)', async () => {
    const { workspaceId, organizationId, owner } = await seedWorkspaceWithOrgAdmin();
    const target = await seedUserWithSession('org-admins-revoke-target');
    await db.insert(schema.organizationMembers).values({ organizationId, userId: target.user.id });

    const response = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/organization-admins/${target.user.id}`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(204);

    const rows = await db
      .select()
      .from(schema.organizationMembers)
      .where(
        and(
          eq(schema.organizationMembers.organizationId, organizationId),
          eq(schema.organizationMembers.userId, target.user.id),
        ),
      );
    expect(rows).toHaveLength(0);

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'organization.admin.removed'));
    const event = events.find(
      (candidate) =>
        (candidate.metadataJson as { targetUserId?: string }).targetUserId === target.user.id,
    );
    expect(event).toBeDefined();
    expect(event?.actorId).toBe(owner.user.id);
    expect(event?.resourceType).toBe('organization');
    expect(event?.resourceId).toBe(organizationId);
  });

  it('DELETE that would leave the organization with no administrator responds 409 naming the reason, removing no one (ORG-10)', async () => {
    const { workspaceId, organizationId, owner } = await seedWorkspaceWithOrgAdmin();

    const response = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/organization-admins/${owner.user.id}`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().title).toBeTruthy();

    const rows = await db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organizationId, organizationId));
    expect(rows).toHaveLength(1);
  });

  it("two concurrent DELETEs of the organization's only two administrators resolve to at most one success, never an unhandled error (edge case)", async () => {
    const { workspaceId, organizationId, owner } = await seedWorkspaceWithOrgAdmin();
    const second = await seedUserWithSession('org-admins-concurrent-second');
    await db.insert(schema.organizationMembers).values({ organizationId, userId: second.user.id });

    const [responseA, responseB] = await Promise.all([
      app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/organization-admins/${owner.user.id}`,
        cookies: owner.cookies,
      }),
      app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/organization-admins/${second.user.id}`,
        cookies: owner.cookies,
      }),
    ]);

    // Neither request threw an unhandled error — both resolved to a real HTTP response, and
    // each status is one this route can legitimately produce.
    for (const response of [responseA, responseB]) {
      expect([204, 409]).toContain(response.statusCode);
    }

    const rows = await db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.organizationId, organizationId));
    // At most one removal actually succeeded — the organization never ends up with zero admins.
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
