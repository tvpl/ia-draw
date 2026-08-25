// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007);
// PGlite runs a real Postgres engine, so advisory locks and transactional rollback behave
// as they do in production. See the race test below for what PGlite cannot prove.

import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from './accounts.js';
import { SESSION_COOKIE_NAME } from './cookie.js';
import { registerAuthModule } from './routes.js';

const VALID_BODY = {
  email: 'Admin@Example.COM',
  displayName: 'Admin',
  password: 'correct horse battery staple',
  workspaceName: 'Arquitetura',
};

describe('first-run instance bootstrap (BOOT-01..11)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;

  beforeEach(async () => {
    // A fresh database per test: "the instance is empty" is the predicate under test, so it
    // cannot be shared across cases.
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await client.close();
  });

  describe('availability (BOOT-01, BOOT-02)', () => {
    it('reports available while the instance has no account', async () => {
      const response = await app.inject({ method: 'GET', url: '/auth/first-run' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ available: true });
    });

    it('answers 404 once an account exists, without confirming the instance state', async () => {
      await createLocalAccount(db, {
        email: 'someone@example.com',
        displayName: 'Someone',
        password: 'correct horse battery staple',
      });

      const response = await app.inject({ method: 'GET', url: '/auth/first-run' });

      expect(response.statusCode).toBe(404);
    });

    it('flips to 404 as soon as an account is created by any other path (BOOT-11)', async () => {
      expect((await app.inject({ method: 'GET', url: '/auth/first-run' })).statusCode).toBe(200);

      await createLocalAccount(db, {
        email: 'someone@example.com',
        displayName: 'Someone',
        password: 'correct horse battery staple',
      });

      // No restart, no cache to invalidate.
      expect((await app.inject({ method: 'GET', url: '/auth/first-run' })).statusCode).toBe(404);
    });
  });

  describe('bootstrap (BOOT-03, BOOT-07)', () => {
    it('creates the account, organization, workspace and org_admin membership, and opens a session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/first-run',
        payload: VALID_BODY,
      });

      expect(response.statusCode).toBe(201);

      const accounts = await db.select().from(schema.users);
      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.displayName).toBe('Admin');

      const orgs = await db.select().from(schema.organizations);
      expect(orgs).toHaveLength(1);

      const spaces = await db.select().from(schema.workspaces);
      expect(spaces).toHaveLength(1);
      expect(spaces[0]?.name).toBe('Arquitetura');

      const members = await db.select().from(schema.workspaceMembers);
      expect(members).toHaveLength(1);
      expect(members[0]?.role).toBe('org_admin');
      expect(members[0]?.userId).toBe(accounts[0]?.id);

      const cookie = response.cookies.find((entry) => entry.name === SESSION_COOKIE_NAME);
      expect(cookie?.value).toBeTruthy();
      expect(cookie?.httpOnly).toBe(true);
    });

    it('normalizes the email so the account can be logged into afterwards (edge case)', async () => {
      await app.inject({ method: 'POST', url: '/auth/first-run', payload: VALID_BODY });

      const [account] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'admin@example.com'));

      expect(account).toBeDefined();

      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@example.com', password: VALID_BODY.password },
      });
      expect(login.statusCode).toBe(200);
    });

    it('records an instance.bootstrapped audit event naming the created account (BOOT-07)', async () => {
      await app.inject({ method: 'POST', url: '/auth/first-run', payload: VALID_BODY });

      const [account] = await db.select().from(schema.users);
      const events = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, 'instance.bootstrapped'));

      expect(events).toHaveLength(1);
      expect(events[0]?.actorId).toBe(account?.id);
      expect(events[0]?.ipHash).toBeTruthy();
    });

    it('never reads a role from the request body (BOOT-10)', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/first-run',
        payload: { ...VALID_BODY, role: 'viewer' },
      });

      const members = await db.select().from(schema.workspaceMembers);
      expect(members[0]?.role).toBe('org_admin');
    });
  });

  describe('validation (BOOT-05, BOOT-06)', () => {
    it('refuses a password shorter than 12 characters, naming the field, creating nothing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/first-run',
        payload: { ...VALID_BODY, password: 'short' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().title).toBe('Invalid password');
      expect(await db.select().from(schema.users)).toHaveLength(0);
    });

    it('refuses an invalid email, naming the field, creating nothing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/first-run',
        payload: { ...VALID_BODY, email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().title).toBe('Invalid email');
      expect(await db.select().from(schema.users)).toHaveLength(0);
    });

    it('refuses an empty workspace name, naming the field, creating nothing (edge case)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/first-run',
        payload: { ...VALID_BODY, workspaceName: '   ' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().title).toBe('Invalid workspaceName');
      expect(await db.select().from(schema.users)).toHaveLength(0);
    });
  });

  describe('the door closes behind it (BOOT-04, BOOT-08)', () => {
    it('answers 404 to a second bootstrap attempt without touching the database', async () => {
      await app.inject({ method: 'POST', url: '/auth/first-run', payload: VALID_BODY });

      const second = await app.inject({
        method: 'POST',
        url: '/auth/first-run',
        payload: { ...VALID_BODY, email: 'other@example.com' },
      });

      expect(second.statusCode).toBe(404);
      expect(await db.select().from(schema.users)).toHaveLength(1);
    });

    it('leaves exactly one account when two bootstraps are issued together (BOOT-08)', async () => {
      // PGlite serialises everything onto one connection, so this proves the DECISION path
      // (second attempt is refused, one account exists) and cannot prove behaviour under
      // genuine parallelism. The guard that does hold there is the advisory lock in
      // `bootstrapInstance` plus the emptiness check inside the same transaction; the real
      // parallel case belongs to CI, where Postgres runs as a service.
      const [first, second] = await Promise.all([
        app.inject({ method: 'POST', url: '/auth/first-run', payload: VALID_BODY }),
        app.inject({
          method: 'POST',
          url: '/auth/first-run',
          payload: { ...VALID_BODY, email: 'second@example.com' },
        }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();
      expect(statuses[0]).toBe(201);
      expect([404, 409]).toContain(statuses[1]);
      expect(await db.select().from(schema.users)).toHaveLength(1);
    });
  });

  describe('rate limit (BOOT-09)', () => {
    it('answers 429 once the per-IP window is exceeded', async () => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await app.inject({ method: 'GET', url: '/auth/first-run' });
        statuses.push(response.statusCode);
      }

      expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
      expect(statuses[0]).toBe(200);
    });
  });
});
