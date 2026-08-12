// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (see packages/database/src/migrate.int.spec.ts for the established pattern this mirrors).

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
import { registerAuthModule } from './routes.js';

describe('auth module — login/logout/refresh/me (AUTH-01)', () => {
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

  async function buildApp(publicUrl = 'http://localhost:3000'): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', PUBLIC_URL: publicUrl });
    const app = buildServer(config);
    await registerAuthModule(app, { db, config });
    await app.ready();
    return app;
  }

  it('login with the correct password verifies the Argon2id hash and sets an HttpOnly, SameSite=Lax cookie', async () => {
    const app = await buildApp();
    await createLocalAccount(db, {
      email: 'alice@example.com',
      displayName: 'Alice',
      password: 'correct horse battery staple',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'alice@example.com', password: 'correct horse battery staple' },
    });

    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    await app.close();
  });

  it('sets Secure on the session cookie when config.publicUrl is https', async () => {
    const app = await buildApp('https://canvas.example.com');
    await createLocalAccount(db, {
      email: 'secure-user@example.com',
      displayName: 'Secure User',
      password: 'https-only-password',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'secure-user@example.com', password: 'https-only-password' },
    });

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie?.secure).toBe(true);
    await app.close();
  });

  it('does not set Secure on the session cookie when config.publicUrl is http (dev)', async () => {
    const app = await buildApp('http://localhost:3000');
    await createLocalAccount(db, {
      email: 'dev-user@example.com',
      displayName: 'Dev User',
      password: 'dev-only-password',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dev-user@example.com', password: 'dev-only-password' },
    });

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    // light-my-request's cookie parser only sets `secure: true` when the
    // Set-Cookie header actually carries the `Secure` attribute; absence
    // surfaces as `undefined`, not `false` — assert both that the parsed
    // flag isn't true AND that the raw header text has no `Secure` token.
    expect(cookie?.secure).not.toBe(true);
    const rawSetCookie = response.headers['set-cookie'];
    const rawCookieHeader = Array.isArray(rawSetCookie) ? rawSetCookie.join(';') : rawSetCookie;
    expect(rawCookieHeader).not.toMatch(/;\s*Secure/i);
    await app.close();
  });

  it('rejects a wrong password with 401 and does not reveal whether the email exists', async () => {
    const app = await buildApp();
    await createLocalAccount(db, {
      email: 'bob@example.com',
      displayName: 'Bob',
      password: 'bobs-real-password',
    });

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'bob@example.com', password: 'not-bobs-password' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody-at-all@example.com', password: 'anything' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    // Same status and same response body for both cases — no signal that
    // distinguishes "wrong password" from "no such account".
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(wrongPassword.cookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();
    await app.close();
  });

  it('GET /me returns 401 without a session cookie', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('GET /me returns the authenticated user with a valid session cookie', async () => {
    const app = await buildApp();
    await createLocalAccount(db, {
      email: 'carol@example.com',
      displayName: 'Carol',
      password: 'carols-password',
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'carol@example.com', password: 'carols-password' },
    });
    const token = login.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value;
    expect(token).toBeDefined();

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { [SESSION_COOKIE_NAME]: token as string },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: 'carol@example.com', displayName: 'Carol' },
    });
    await app.close();
  });

  it('POST /auth/refresh rotates the session token; the old token stops working', async () => {
    const app = await buildApp();
    await createLocalAccount(db, {
      email: 'dave@example.com',
      displayName: 'Dave',
      password: 'daves-password',
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dave@example.com', password: 'daves-password' },
    });
    const oldToken = login.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value as string;

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { [SESSION_COOKIE_NAME]: oldToken },
    });
    expect(refresh.statusCode).toBe(200);
    const newToken = refresh.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value as string;
    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(oldToken);

    const meWithOldToken = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { [SESSION_COOKIE_NAME]: oldToken },
    });
    expect(meWithOldToken.statusCode).toBe(401);

    const meWithNewToken = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { [SESSION_COOKIE_NAME]: newToken },
    });
    expect(meWithNewToken.statusCode).toBe(200);
    await app.close();
  });

  it('POST /auth/logout revokes the session; the same cookie fails on the next request', async () => {
    const app = await buildApp();
    await createLocalAccount(db, {
      email: 'erin@example.com',
      displayName: 'Erin',
      password: 'erins-password',
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'erin@example.com', password: 'erins-password' },
    });
    const token = login.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value as string;

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(logout.statusCode).toBe(204);

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(meAfterLogout.statusCode).toBe(401);
    await app.close();
  });
});
