// @vitest-environment node
//
// The above pragma overrides vitest.integration.config.ts's project-wide
// `environment: 'jsdom'` (needed elsewhere for editor-adapter/Excalidraw,
// see that config's own comment) for THIS file only: `openid-client`'s PKCE
// code-challenge computation performs real Node `crypto`/`Buffer` operations
// that jsdom's browser-shimmed `crypto`/typed-array globals do not support
// end-to-end (empirically: `input.subarray is not a function` inside the
// PKCE code path when run under jsdom) — this module never touches
// Excalidraw/DOM APIs, so plain Node is both correct and sufficient here.
//
// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved (AD-007). The OIDC/PKCE protocol itself, unlike Postgres, is NEVER mocked here — `oidc-provider` (Panva's npm package, devDependency ONLY, see package.json) runs a genuinely protocol-conformant OpenID Provider in-process, on a real ephemeral TCP port, exactly like AD-009's real-Redis discipline for presence.
//
// T88 (OIDC-01/02/03, Gate: build): drives the COMPLETE Authorization Code +
// PKCE flow against that real in-process provider — real authorization
// request, real PKCE code_verifier/code_challenge, real login+consent HTML
// forms submitted exactly as a browser would (parsed out of the provider's
// own rendered `devInteractions` pages, not hardcoded route knowledge), a
// real `code`, and a real token-endpoint exchange — then asserts our own
// `/auth/oidc/callback` produces a session capped to the mapped role.

import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import Provider from 'oidc-provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { OIDC_PKCE_COOKIE_NAME, SESSION_COOKIE_NAME } from './cookie.js';
import { resetOidcClientConfigurationCache } from './oidc.js';
import { registerAuthModule } from './routes.js';

const PUBLIC_URL = 'http://localhost:3000';
const REDIRECT_URI = `${PUBLIC_URL}/auth/oidc/callback`;
const CLIENT_ID = 'arch-canvas-test-client';
const CLIENT_SECRET = 'arch-canvas-test-client-secret';

/** Test IdP accounts (T88) — `groups` is the real claim our server maps; `role`/`admin` are adversarial extras a real ID token can carry that `resolveOidcRole` must never read. */
const TEST_ACCOUNTS: Record<
  string,
  { email: string; name: string; groups: string[]; role?: string; admin?: boolean }
> = {
  'editor-account': {
    email: 'editor@example.test',
    name: 'Editor Account',
    groups: ['platform-team'],
  },
  'viewer-with-adversarial-claims': {
    email: 'viewer@example.test',
    name: 'Viewer Account',
    // "workspace_admin"/"org_admin" here are GROUP NAMES this account
    // genuinely carries that have NO entry in our OIDC_GROUP_ROLE_MAP below
    // — a naive implementation might be tempted to string-match a group
    // name against a role name. `readonly-team` is the only mapped one.
    groups: ['readonly-team', 'workspace_admin', 'org_admin'],
    // Top-level suggestive claims a malicious/misconfigured IdP might add —
    // our resolver must never read these under any circumstance.
    role: 'workspace_admin',
    admin: true,
  },
  // Verifier-added (F5 independent verification, discrimination-sensor
  // mutation "a"): carries ZERO groups that match OIDC_GROUP_ROLE_MAP at
  // all, only top-level `role`/`admin` claims. A wiring-level fallback at
  // the /auth/oidc/callback call site (e.g. `resolveOidcRole(...) ??
  // mergedClaims.role`) would grant `workspace_admin` here even though
  // `resolveOidcRole` itself correctly returns null — the pre-existing
  // 'viewer-with-adversarial-claims' account always has a REAL matching
  // group ('readonly-team'), so `resolveOidcRole` never returns null for
  // it and a call-site-level fallback bug would go completely unnoticed by
  // every test that existed before this one. This account is what makes
  // that specific class of regression observable.
  'attacker-no-mapped-groups': {
    email: 'attacker-no-mapped-groups@example.test',
    name: 'Attacker No Mapped Groups',
    groups: ['some-unrelated-group', 'another-unmapped-group'],
    role: 'workspace_admin',
    admin: true,
  },
  // Distinct subject from 'editor-account' — used only by the
  // no-default-workspace test, so its zero-membership assertion is never
  // contaminated by a membership row a DIFFERENT test already granted the
  // shared 'editor-account' subject in this same PGlite database.
  'editor-account-no-workspace-configured': {
    email: 'editor-no-workspace@example.test',
    name: 'Editor No Workspace',
    groups: ['platform-team'],
  },
};

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo | null;
      if (!address) {
        probe.close();
        reject(new Error('failed to allocate a free port'));
        return;
      }
      probe.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

/** Minimal cookie jar (name -> value) — merges every Set-Cookie from a fetch Response, forwards them all on the next request. Real HTTP hops only; never touches app.inject's own cookie handling. */
class CookieJar {
  private readonly values = new Map<string, string>();

  absorb(headers: Headers): void {
    for (const setCookie of headers.getSetCookie()) {
      const pair = setCookie.split(';', 1)[0] ?? '';
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;
      this.values.set(pair.slice(0, eqIndex).trim(), pair.slice(eqIndex + 1).trim());
    }
  }

  header(): string | undefined {
    if (this.values.size === 0) return undefined;
    return [...this.values.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

describe('OIDC login — real in-process OpenID Provider, full PKCE protocol (T88, OIDC-01/02/03)', () => {
  let dbClient: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let providerHttpServer: ReturnType<typeof createServer>;
  let issuerUrl: string;
  let workspaceId: string;

  beforeAll(async () => {
    dbClient = new PGlite();
    db = drizzle(dbClient, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'OIDC Test Org', slug: `oidc-org-${Date.now()}-${Math.random()}` })
      .returning();
    if (!org) throw new Error('organization insert failed');
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        organizationId: org.id,
        name: 'OIDC Test Workspace',
        slug: `oidc-ws-${Date.now()}-${Math.random()}`,
      })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceId = workspace.id;

    const port = await getFreePort();
    issuerUrl = `http://127.0.0.1:${port}`;

    const provider = new Provider(issuerUrl, {
      clients: [
        {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uris: [REDIRECT_URI],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
        },
      ],
      claims: {
        openid: ['sub'],
        email: ['email'],
        // "role"/"admin" are declared here purely so the PROVIDER genuinely
        // includes them in the real ID token under the `profile` scope our
        // client already requests — the adversarial claims must be real,
        // never a fabrication our own test injects after the fact.
        profile: ['name', 'groups', 'role', 'admin'],
      },
      // biome-ignore lint/suspicious/noExplicitAny: oidc-provider's own Account type is intentionally loose (findAccount may return any claims shape)
      async findAccount(_ctx: unknown, sub: string): Promise<any> {
        const account = TEST_ACCOUNTS[sub];
        if (!account) return undefined;
        return {
          accountId: sub,
          claims: () => ({
            sub,
            email: account.email,
            name: account.name,
            groups: account.groups,
            ...(account.role !== undefined ? { role: account.role } : {}),
            ...(account.admin !== undefined ? { admin: account.admin } : {}),
          }),
        };
      },
      features: { devInteractions: { enabled: true } },
    });

    providerHttpServer = createServer(provider.callback());
    providerHttpServer.listen(port, '127.0.0.1');
    await once(providerHttpServer, 'listening');
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      providerHttpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await dbClient.close();
  });

  /**
   * Drives the FULL real protocol: our server's `/auth/oidc/login` ->
   * real redirect to the real provider -> real login form submit -> real
   * consent form submit -> real redirect back to our redirect_uri with a
   * real `code`+`state` -> our server's `/auth/oidc/callback` performs the
   * real PKCE token exchange. Returns the final callback response.
   */
  async function driveOidcLogin(
    app: FastifyInstance,
    accountId: string,
  ): Promise<{ statusCode: number; sessionToken: string | undefined }> {
    const loginResponse = await app.inject({ method: 'GET', url: '/auth/oidc/login' });
    expect(loginResponse.statusCode).toBe(302);
    const authorizationUrl = loginResponse.headers.location as string;
    expect(authorizationUrl).toContain(issuerUrl);

    const pkceCookie = loginResponse.cookies.find((c) => c.name === OIDC_PKCE_COOKIE_NAME);
    expect(pkceCookie).toBeDefined();

    const jar = new CookieJar();
    let currentUrl = authorizationUrl;
    let finalRedirect: string | null = null;

    for (let hop = 0; hop < 10 && !finalRedirect; hop += 1) {
      const cookieHeader = jar.header();
      const response = await fetch(currentUrl, {
        redirect: 'manual',
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      });
      jar.absorb(response.headers);

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        const resolved = new URL(location, currentUrl).toString();
        if (resolved.startsWith(REDIRECT_URI)) {
          finalRedirect = resolved;
          break;
        }
        currentUrl = resolved;
        continue;
      }

      // A non-redirect response at this point is a real devInteractions
      // HTML page (login or consent form) — parse the SAME fields a real
      // browser's form submit would send, out of the SAME markup.
      const html = await response.text();
      const promptMatch = html.match(/name="prompt" value="(login|consent)"/);
      const actionMatch = html.match(/action="([^"]+)"/);
      if (!promptMatch || !actionMatch) {
        throw new Error(
          `Unexpected OIDC interaction page (no prompt/action found): ${html.slice(0, 400)}`,
        );
      }
      const prompt = promptMatch[1] as 'login' | 'consent';
      const submitUrl = new URL(actionMatch[1] as string, currentUrl).toString();

      const body = new URLSearchParams({ prompt });
      if (prompt === 'login') body.set('login', accountId);

      const submitCookieHeader = jar.header();
      const submitResponse = await fetch(submitUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(submitCookieHeader ? { cookie: submitCookieHeader } : {}),
        },
        body: body.toString(),
      });
      jar.absorb(submitResponse.headers);
      const submitLocation = submitResponse.headers.get('location');
      if (!submitLocation) {
        throw new Error(
          `OIDC interaction submit (${prompt}) did not redirect (status ${submitResponse.status})`,
        );
      }
      const resolvedSubmit = new URL(submitLocation, submitUrl).toString();
      if (resolvedSubmit.startsWith(REDIRECT_URI)) {
        finalRedirect = resolvedSubmit;
      } else {
        currentUrl = resolvedSubmit;
      }
    }

    if (!finalRedirect)
      throw new Error('OIDC login flow did not reach the redirect_uri within 10 hops');

    const finalUrl = new URL(finalRedirect);
    expect(finalUrl.searchParams.get('code')).toBeTruthy();
    expect(finalUrl.searchParams.get('state')).toBeTruthy();

    const callbackResponse = await app.inject({
      method: 'GET',
      url: `/auth/oidc/callback${finalUrl.search}`,
      cookies: { [OIDC_PKCE_COOKIE_NAME]: pkceCookie?.value as string },
    });

    return {
      statusCode: callbackResponse.statusCode,
      sessionToken: callbackResponse.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value,
    };
  }

  async function buildAppWithOidc(
    defaultWorkspaceId: string | undefined,
  ): Promise<FastifyInstance> {
    resetOidcClientConfigurationCache();
    const config = loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL,
      OIDC_ISSUER_URL: issuerUrl,
      OIDC_CLIENT_ID: CLIENT_ID,
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_GROUP_ROLE_MAP: JSON.stringify({ 'platform-team': 'editor', 'readonly-team': 'viewer' }),
      ...(defaultWorkspaceId ? { OIDC_DEFAULT_WORKSPACE_ID: defaultWorkspaceId } : {}),
    });
    const app = buildServer(config);
    await registerAuthModule(app, { db, config });
    await app.ready();
    return app;
  }

  it('a full real PKCE flow ends in a valid session, with the workspace role capped to the mapped group', async () => {
    const app = await buildAppWithOidc(workspaceId);

    const result = await driveOidcLogin(app, 'editor-account');
    expect(result.statusCode).toBe(302);
    expect(result.sessionToken).toBeDefined();

    // Same-session-mechanism proof (F1a reuse): the resulting cookie
    // authenticates against /me exactly like a local-login session would.
    const me = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { [SESSION_COOKIE_NAME]: result.sessionToken as string },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('editor@example.test');

    const [membership] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, me.json().user.id));
    expect(membership?.role).toBe('editor');
    expect(membership?.workspaceId).toBe(workspaceId);

    await app.close();
  });

  it('the role ceiling holds against a real ID token carrying adversarial extra claims — mapped role is viewer, never workspace_admin/org_admin', async () => {
    const app = await buildAppWithOidc(workspaceId);

    const result = await driveOidcLogin(app, 'viewer-with-adversarial-claims');
    expect(result.statusCode).toBe(302);
    expect(result.sessionToken).toBeDefined();

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { [SESSION_COOKIE_NAME]: result.sessionToken as string },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('viewer@example.test');

    const [membership] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, me.json().user.id));
    expect(membership?.role).toBe('viewer');
    expect(membership?.role).not.toBe('workspace_admin');
    expect(membership?.role).not.toBe('org_admin');

    await app.close();
  });

  it('Verifier-added: zero mapped groups + top-level role/admin claims -> login succeeds but NO workspace membership is ever created (never a call-site fallback to the top-level claim)', async () => {
    const app = await buildAppWithOidc(workspaceId);

    const result = await driveOidcLogin(app, 'attacker-no-mapped-groups');
    expect(result.statusCode).toBe(302);
    expect(result.sessionToken).toBeDefined();

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { [SESSION_COOKIE_NAME]: result.sessionToken as string },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('attacker-no-mapped-groups@example.test');

    // The account's real ID token carries `role: 'workspace_admin'` and
    // `admin: true` — a call-site fallback reading either would grant a
    // role here even though none of its groups are mapped. The correct
    // behavior is zero membership rows: resolveOidcRole returned null and
    // syncOidcWorkspaceRole must never have been called with an invented
    // role.
    const memberships = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, me.json().user.id));
    expect(memberships).toHaveLength(0);

    await app.close();
  });

  it('a session originated via OIDC refreshes through the exact same /auth/refresh endpoint as a local session', async () => {
    const app = await buildAppWithOidc(workspaceId);

    const result = await driveOidcLogin(app, 'editor-account');
    const oldToken = result.sessionToken as string;

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { [SESSION_COOKIE_NAME]: oldToken },
    });
    expect(refresh.statusCode).toBe(200);
    const newToken = refresh.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value;
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
      cookies: { [SESSION_COOKIE_NAME]: newToken as string },
    });
    expect(meWithNewToken.statusCode).toBe(200);

    await app.close();
  });

  it('with no OIDC_DEFAULT_WORKSPACE_ID configured, login still succeeds but no workspace membership is ever created', async () => {
    const app = await buildAppWithOidc(undefined);

    const result = await driveOidcLogin(app, 'editor-account-no-workspace-configured');
    expect(result.statusCode).toBe(302);
    expect(result.sessionToken).toBeDefined();

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { [SESSION_COOKIE_NAME]: result.sessionToken as string },
    });
    const memberships = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, me.json().user.id));
    expect(memberships).toHaveLength(0);

    await app.close();
  });
});
