// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI uses real Postgres via GitHub Actions services (see packages/database/src/migrate.int.spec.ts for the established pattern this mirrors).

import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from './accounts.js';
import { SESSION_COOKIE_NAME } from './cookie.js';
import { createSession } from './session.js';
import { registerAuthModule } from './routes.js';

describe('GET /users:lookup (T1, MEM-04..06)', () => {
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

  async function buildApp(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:3000' });
    const app = buildServer(config);
    await registerAuthModule(app, { db, config });
    await app.ready();
    return app;
  }

  async function sessionCookie(userId: string): Promise<string> {
    const issued = await createSession(db, userId);
    return `${SESSION_COOKIE_NAME}=${issued.token}`;
  }

  it('returns 200 with {user: {id, email, displayName}} for an existing account, and nothing else', async () => {
    const app = await buildApp();
    const owner = await createLocalAccount(db, {
      email: 'requester@example.com',
      displayName: 'Requester',
      password: 'correct horse battery staple',
    });
    const target = await createLocalAccount(db, {
      email: 'bob@example.com',
      displayName: 'Bob',
      password: 'another password entirely',
    });
    const cookie = await sessionCookie(owner.id);

    const response = await app.inject({
      method: 'GET',
      url: '/users:lookup?email=bob@example.com',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { user: { id: string; email: string; displayName: string } };
    expect(body.user).toEqual({ id: target.id, email: 'bob@example.com', displayName: 'Bob' });
    await app.close();
  });

  it('returns 404 for an email with no matching account', async () => {
    const app = await buildApp();
    const owner = await createLocalAccount(db, {
      email: 'requester2@example.com',
      displayName: 'Requester2',
      password: 'correct horse battery staple',
    });
    const cookie = await sessionCookie(owner.id);

    const response = await app.inject({
      method: 'GET',
      url: '/users:lookup?email=nobody@example.com',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('requires only a valid session — no workspace/role check: a session with no workspace membership can still resolve an email', async () => {
    const app = await buildApp();
    const requester = await createLocalAccount(db, {
      email: 'lonely@example.com',
      displayName: 'Lonely',
      password: 'correct horse battery staple',
    });
    const target = await createLocalAccount(db, {
      email: 'target@example.com',
      displayName: 'Target',
      password: 'another password entirely',
    });
    const cookie = await sessionCookie(requester.id);

    const response = await app.inject({
      method: 'GET',
      url: '/users:lookup?email=target@example.com',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { user: { id: string } }).user.id).toBe(target.id);
    await app.close();
  });

  it('rejects an unauthenticated request with 401, before touching the database', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/users:lookup?email=whoever@example.com',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
