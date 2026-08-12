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
import { createLocalAccount } from './accounts.js';
import { SESSION_COOKIE_NAME } from './cookie.js';
import { registerAuthModule } from './routes.js';
import { createSession } from './session.js';
import { consumeWsTicket, issueWsTicket } from './ws-ticket.js';

describe('WebSocket ticket issuance + consumption (T15, AUTH-02)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await client.close();
  });

  /** Seeds an org/workspace/project/diagram and returns their ids. */
  async function seedDiagram() {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}-${Math.random()}` })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: 'Platform', slug: `platform-${Date.now()}-${Math.random()}` })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    const owner = await createLocalAccount(db, {
      email: `owner-${Date.now()}-${Math.random()}@example.com`,
      displayName: 'Owner',
      password: 'owner-password',
    });

    const [project] = await db
      .insert(schema.projects)
      .values({ workspaceId: workspace.id, name: 'Core', ownerId: owner.id })
      .returning();
    if (!project) throw new Error('project insert failed');

    const [diagram] = await db
      .insert(schema.diagrams)
      .values({ projectId: project.id, title: 'System Overview', ownerId: owner.id })
      .returning();
    if (!diagram) throw new Error('diagram insert failed');

    return { workspaceId: workspace.id, diagramId: diagram.id };
  }

  describe('issueWsTicket / consumeWsTicket', () => {
    it('a ticket is consumable exactly once; the second attempt returns null', async () => {
      const { workspaceId, diagramId } = await seedDiagram();
      const user = await createLocalAccount(db, {
        email: `member-${Date.now()}@example.com`,
        displayName: 'Member',
        password: 'member-password',
      });
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId: user.id, role: 'editor' });

      const issued = await issueWsTicket(db, user.id, diagramId);

      const firstConsume = await consumeWsTicket(db, issued.ticket);
      expect(firstConsume).toEqual({ userId: user.id, diagramId });

      const secondConsume = await consumeWsTicket(db, issued.ticket);
      expect(secondConsume).toBeNull();
    });

    it('an expired ticket (TTL 30s) is not consumable', async () => {
      const { workspaceId, diagramId } = await seedDiagram();
      const user = await createLocalAccount(db, {
        email: `expired-${Date.now()}@example.com`,
        displayName: 'Expired Ticket User',
        password: 'expired-password',
      });
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId: user.id, role: 'editor' });

      const issued = await issueWsTicket(db, user.id, diagramId);
      // Force the TTL to have already elapsed, without touching consumeWsTicket's
      // own atomic UPDATE — this isolates the expiry rule from the reuse rule.
      // token_hash isn't recoverable from the plaintext ticket without duplicating
      // consumeWsTicket's hashing, so match on the (diagram, user) pair instead —
      // this seed only ever issues one ticket for that pair.
      await db
        .update(schema.wsTickets)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(and(eq(schema.wsTickets.diagramId, diagramId), eq(schema.wsTickets.userId, user.id)));

      const consumed = await consumeWsTicket(db, issued.ticket);
      expect(consumed).toBeNull();
    });
  });

  describe('POST /diagrams/:id/ws-ticket', () => {
    async function buildApp(): Promise<FastifyInstance> {
      const config = loadConfig({ NODE_ENV: 'test' });
      const app = buildServer(config);
      await registerAuthModule(app, { db, config });
      await app.ready();
      return app;
    }

    it('returns 401 without a session cookie', async () => {
      const app = await buildApp();
      const { diagramId } = await seedDiagram();

      const response = await app.inject({ method: 'POST', url: `/diagrams/${diagramId}/ws-ticket` });
      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it('returns 404 (not 403) when the session holder has no membership in the diagram workspace (IDOR)', async () => {
      const app = await buildApp();
      const { diagramId } = await seedDiagram();

      const outsider = await createLocalAccount(db, {
        email: `outsider-${Date.now()}@example.com`,
        displayName: 'Outsider',
        password: 'outsider-password',
      });
      const session = await createSession(db, outsider.id);

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ws-ticket`,
        cookies: { [SESSION_COOKIE_NAME]: session.token },
      });
      expect(response.statusCode).toBe(404);
      await app.close();
    });

    it('returns a ticket for a workspace member (200)', async () => {
      const app = await buildApp();
      const { workspaceId, diagramId } = await seedDiagram();

      const member = await createLocalAccount(db, {
        email: `route-member-${Date.now()}@example.com`,
        displayName: 'Route Member',
        password: 'route-member-password',
      });
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId: member.id, role: 'viewer' });
      const session = await createSession(db, member.id);

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ws-ticket`,
        cookies: { [SESSION_COOKIE_NAME]: session.token },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(typeof body.ticket).toBe('string');
      expect(body.ticket.length).toBeGreaterThan(0);
      expect(typeof body.expiresAt).toBe('string');
      await app.close();
    });
  });
});
