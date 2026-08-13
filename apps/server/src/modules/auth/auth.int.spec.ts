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

describe('auth module — login audit coverage (SEC-04, T85)', () => {
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
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  it('a successful login records exactly one audit_events row, actor=the logged-in user', async () => {
    const user = await createLocalAccount(db, {
      email: 'audit-success@example.com',
      displayName: 'Audit Success',
      password: 'audit-success-password',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'audit-success@example.com', password: 'audit-success-password' },
    });
    expect(response.statusCode).toBe(200);

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, 'auth.login.succeeded'),
          eq(schema.auditEvents.actorId, user.id),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'auth.login.succeeded',
      actorId: user.id,
      resourceType: 'user',
      resourceId: user.id,
    });
    expect(rows[0]?.ipHash).toBeTruthy();
  });

  it('a failed login (wrong password) records a distinct-outcome audit_events row, no actorId', async () => {
    await createLocalAccount(db, {
      email: 'audit-failure@example.com',
      displayName: 'Audit Failure',
      password: 'the-real-password',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'audit-failure@example.com', password: 'not-the-real-password' },
    });
    expect(response.statusCode).toBe(401);

    // `resource_id` is a NOT NULL uuid column with no real user to reference
    // for a failed login (see routes.ts's comment) — the attempted email
    // lives in `metadataJson` instead, so this filters on `action` and
    // matches the attempted email via metadata in JS.
    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'auth.login.failed'));
    const matching = rows.filter(
      (row) =>
        (row.metadataJson as { attemptedEmail?: string })?.attemptedEmail ===
        'audit-failure@example.com',
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      action: 'auth.login.failed',
      actorId: null,
      resourceType: 'user',
    });
    expect(matching[0]?.metadataJson).toMatchObject({ outcome: 'failure' });
  });

  it('success and failure for the SAME account produce two audit rows with distinct actions/outcomes', async () => {
    const user = await createLocalAccount(db, {
      email: 'audit-both@example.com',
      displayName: 'Audit Both',
      password: 'audit-both-password',
    });

    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'audit-both@example.com', password: 'wrong-password' },
    });
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'audit-both@example.com', password: 'audit-both-password' },
    });

    const allFailureRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'auth.login.failed'));
    const failureRows = allFailureRows.filter(
      (row) =>
        (row.metadataJson as { attemptedEmail?: string })?.attemptedEmail ===
        'audit-both@example.com',
    );
    const successRows = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, 'auth.login.succeeded'),
          eq(schema.auditEvents.actorId, user.id),
        ),
      );

    expect(failureRows).toHaveLength(1);
    expect(failureRows[0]?.metadataJson).toMatchObject({ outcome: 'failure' });
    expect(successRows).toHaveLength(1);
    expect(successRows[0]?.metadataJson).toMatchObject({ outcome: 'success' });
  });
});

describe('auth module — OIDC routes without OIDC configured (T87, OIDC-01)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    // Deliberately NO OIDC_ISSUER_URL/CLIENT_ID/CLIENT_SECRET — this is the
    // "OIDC not configured" boot path every deployment starts from.
    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  it('GET /auth/oidc/login responds 503 (never crashes boot, never a bare 404) when OIDC is unconfigured', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/oidc/login' });
    expect(response.statusCode).toBe(503);
  });

  it('GET /auth/oidc/callback also responds 503 when OIDC is unconfigured', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/oidc/callback?code=x&state=y' });
    expect(response.statusCode).toBe(503);
  });

  it('local email/password login keeps working normally on a server with no OIDC configured', async () => {
    await createLocalAccount(db, {
      email: 'no-oidc@example.com',
      displayName: 'No OIDC',
      password: 'local-auth-still-works',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'no-oidc@example.com', password: 'local-auth-still-works' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.cookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeDefined();
  });
});
