import { randomUUID } from 'node:crypto';
import { can } from '@arch-canvas/auth';
import { recordAuditEvent } from '@arch-canvas/database';
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import * as client from 'openid-client';
import { z } from 'zod';
import type { AppConfig } from '../../core/config.js';
import type { MetricsRegistry } from '../../core/metrics.js';
import type { RouteSchemaMap } from '../../openapi/types.js';
import { verifyLocalPassword } from './accounts.js';
import {
  clearedOidcPkceCookieOptions,
  clearedSessionCookieOptions,
  OIDC_PKCE_COOKIE_NAME,
  oidcPkceCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from './cookie.js';
import type { Db } from './db.js';
import { requireSession } from './middleware.js';
import {
  getOidcClientConfiguration,
  resolveOidcRole,
  resolveOrCreateOidcUser,
  syncOidcWorkspaceRole,
} from './oidc.js';
import { createSession, revokeSession, rotateSession } from './session.js';
import { hashToken } from './tokens.js';
import './types.js';
import { issueWsTicket, resolveDiagramMembership } from './ws-ticket.js';

export interface AuthModuleDeps {
  db: Db;
  config: AppConfig;
  /** Optional (T93, OBS-03: "aumento de auth failures") — every failed login (local or OIDC) increments `arch_canvas_auth_failures_total`. Omitted = auth still works unchanged, same optional-degrade shape as every other `deps.metrics` seam. */
  metrics?: MetricsRegistry;
}

const loginBodySchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

function invalidCredentials(): never {
  throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
}

function unauthorized(): never {
  throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });

/** Shape persisted in the short-lived `oidc_pkce` cookie between `/login` and `/callback` (T87). */
interface OidcPkceState {
  codeVerifier: string;
  state: string;
  nonce: string;
}

function oidcNotConfigured(): never {
  throw Object.assign(new Error('OIDC is not configured on this server'), { statusCode: 503 });
}

function badOidcCallback(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

/**
 * OpenAPI schema map for this module's 8 routes (T5, API-01). `/auth/logout`,
 * `/auth/refresh`, `/me` and the three OIDC routes take no query/params/body —
 * they act on the session cookie, never a Zod-validated payload.
 */
export const routeSchemas: RouteSchemaMap = {
  'POST /auth/login': { body: loginBodySchema },
  'POST /auth/logout': {},
  'POST /auth/refresh': {},
  'GET /me': {},
  'POST /diagrams/:id/ws-ticket': { params: diagramIdParamsSchema },
  'GET /auth/oidc/login': {},
  'GET /auth/oidc/callback': {},
  'GET /auth/oidc/status': {},
};

/** Registers /auth/login, /auth/logout, /auth/refresh and /me on `app` (T14). */
export async function registerAuthModule(
  app: FastifyInstance,
  deps: AuthModuleDeps,
): Promise<void> {
  const { db, config, metrics } = deps;

  await app.register(fastifyCookie);

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw Object.assign(new Error('Invalid login payload'), { statusCode: 400 });
    }

    // SEC-04: audits both outcomes (success AND failure) with distinct
    // `action`/`outcome` metadata, per `recordAuditEvent`'s established
    // convention (workspace/routes.ts). `ipHash` (never the raw IP) reuses
    // `hashToken` (sha256, tokens.ts) — the same "never store the raw
    // identifying value" discipline already applied to session/ticket
    // tokens, applied here to the requester's IP.
    const ipHash = hashToken(request.ip);
    const user = await verifyLocalPassword(db, parsed.data.email, parsed.data.password);
    if (!user) {
      await recordAuditEvent(db, {
        action: 'auth.login.failed',
        resourceType: 'user',
        // No `actorId` — the credentials never resolved to a real user, so
        // there is no user id to attribute this to. `audit_events.resource_id`
        // is a NOT NULL uuid column with no real user to reference here (the
        // email may not even belong to an account — verifyLocalPassword
        // deliberately never reveals which, AUTH-01), so this uses a fresh
        // random id as a non-referencing placeholder and records WHICH
        // account was targeted (the attempted email, never the password) in
        // `metadataJson` instead.
        resourceId: randomUUID(),
        ipHash,
        metadataJson: { outcome: 'failure', attemptedEmail: parsed.data.email },
      });
      metrics?.recordAuthFailure();
      invalidCredentials();
    }

    const issued = await createSession(db, user.id);
    reply.setCookie(SESSION_COOKIE_NAME, issued.token, sessionCookieOptions(config));

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'auth.login.succeeded',
      resourceType: 'user',
      resourceId: user.id,
      ipHash,
      metadataJson: { outcome: 'success' },
    });

    return { user };
  });

  app.post('/auth/logout', { preHandler: requireSession(db) }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) await revokeSession(db, token);
    reply.clearCookie(SESSION_COOKIE_NAME, clearedSessionCookieOptions(config));
    reply.code(204);
    return null;
  });

  app.post('/auth/refresh', { preHandler: requireSession(db) }, async (request, reply) => {
    const oldToken = request.cookies[SESSION_COOKIE_NAME];
    const rotated = oldToken ? await rotateSession(db, oldToken) : null;
    if (!rotated) unauthorized();

    reply.setCookie(SESSION_COOKIE_NAME, rotated.token, sessionCookieOptions(config));
    return { user: request.authContext?.user };
  });

  app.get('/me', { preHandler: requireSession(db) }, async (request) => {
    return { user: request.authContext?.user };
  });

  // Emission stub only (T15) — the WebSocket gateway that consumes these
  // tickets is out of scope for this wave (F1b).
  app.post('/diagrams/:id/ws-ticket', { preHandler: requireSession(db) }, async (request) => {
    const params = diagramIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) unauthorized();

    const membership = await resolveDiagramMembership(db, params.id, user.id);
    if (!membership) notFound();

    const decision = can({ role: membership.role }, 'diagram:read', {
      workspaceId: membership.workspaceId,
    });
    if (!decision.allowed) notFound();

    const issued = await issueWsTicket(db, user.id, params.id);
    return { ticket: issued.ticket, expiresAt: issued.expiresAt.toISOString() };
  });

  // T1 (SSO-09/11): cheap, public discovery signal so the frontend knows
  // whether to render the SSO button, without ever attempting the flow and
  // risking a 503 mid-navigation. Never 401/403 — this is capability
  // information about the deploy, not about the caller.
  app.get('/auth/oidc/status', async () => {
    return { configured: config.oidc !== undefined };
  });

  // T87 (OIDC-01/02/03): Authorization Code + PKCE flow against a
  // configurable OIDC provider. Both routes respond 503 (not a boot
  // failure, not a route-not-found 404) when OIDC isn't configured — local
  // email/password auth above is entirely unaffected either way.
  app.get('/auth/oidc/login', async (_request, reply) => {
    if (!config.oidc) oidcNotConfigured();
    const oidcConfig = await getOidcClientConfiguration(config.oidc);

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();

    const authorizationUrl = client.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: config.oidc.redirectUri,
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    const pkceState: OidcPkceState = { codeVerifier, state, nonce };
    reply.setCookie(
      OIDC_PKCE_COOKIE_NAME,
      JSON.stringify(pkceState),
      oidcPkceCookieOptions(config),
    );
    reply.redirect(authorizationUrl.toString());
  });

  app.get('/auth/oidc/callback', async (request, reply) => {
    if (!config.oidc) oidcNotConfigured();
    const oidcConfigForCallback = config.oidc;

    const rawPkceState = request.cookies[OIDC_PKCE_COOKIE_NAME];
    reply.clearCookie(OIDC_PKCE_COOKIE_NAME, clearedOidcPkceCookieOptions(config));
    if (!rawPkceState) {
      badOidcCallback('Missing or expired OIDC login state — please retry /auth/oidc/login');
    }

    let pkceState: OidcPkceState;
    try {
      pkceState = JSON.parse(rawPkceState) as OidcPkceState;
    } catch {
      badOidcCallback('Malformed OIDC login state');
    }

    const ipHash = hashToken(request.ip);

    try {
      const oidcConfig = await getOidcClientConfiguration(oidcConfigForCallback);
      // openid-client reads `code`/`state`/`iss` off this URL's query string
      // — publicUrl (never the Host header) is the base, consistent with
      // every other absolute-URL construction in this codebase.
      const currentUrl = new URL(request.url, config.publicUrl);

      const tokenSet = await client.authorizationCodeGrant(oidcConfig, currentUrl, {
        pkceCodeVerifier: pkceState.codeVerifier,
        expectedState: pkceState.state,
        expectedNonce: pkceState.nonce,
      });

      const claims = tokenSet.claims();
      if (!claims) badOidcCallback('OIDC provider did not return an ID token');

      // Most OIDC-conformant providers (this project's own test provider,
      // T88, included — `conformIdTokenClaims` is `true` by default in
      // `oidc-provider`, matching the OIDC Core §5.4 recommendation) omit
      // non-essential scope claims like `email`/`profile`/a custom `groups`
      // claim from the ID token itself whenever an access token is ALSO
      // issued (true for every Authorization Code Grant), deferring them to
      // the UserInfo endpoint instead. Reading ONLY `tokenSet.claims()`
      // would silently see `groups: undefined` against such a provider —
      // never a security issue (`resolveOidcRole` already treats "no
      // matching group" as "no role", the safe default) but a real
      // functional gap this fetch closes. Best-effort: if the userinfo
      // endpoint is unreachable/misconfigured, callers still get whatever
      // the ID token itself carried — same fail-safe default applies.
      let mergedClaims: Record<string, unknown> = { ...claims };
      if (tokenSet.access_token) {
        try {
          const userInfo = await client.fetchUserInfo(
            oidcConfig,
            tokenSet.access_token,
            claims.sub,
          );
          mergedClaims = { ...mergedClaims, ...userInfo };
        } catch {
          // Best-effort enrichment only — see the comment above.
        }
      }

      const email = typeof mergedClaims.email === 'string' ? mergedClaims.email : undefined;
      const displayName = typeof mergedClaims.name === 'string' ? mergedClaims.name : undefined;
      const groupClaimValue = mergedClaims[oidcConfigForCallback.groupClaim];
      const role = resolveOidcRole(groupClaimValue, oidcConfigForCallback.groupRoleMap);

      const user = await resolveOrCreateOidcUser(db, {
        issuerUrl: oidcConfigForCallback.issuerUrl,
        subject: claims.sub,
        email,
        displayName,
      });

      if (role && oidcConfigForCallback.defaultWorkspaceId) {
        await syncOidcWorkspaceRole(db, oidcConfigForCallback.defaultWorkspaceId, user.id, role);
      }

      // Same session mechanism as local login (F1a, session.ts) — never a
      // parallel scheme. No ID/access/refresh token from the IdP is ever
      // set as a cookie or otherwise exposed to the client.
      const issued = await createSession(db, user.id);
      reply.setCookie(SESSION_COOKIE_NAME, issued.token, sessionCookieOptions(config));

      await recordAuditEvent(db, {
        actorId: user.id,
        action: 'auth.oidc_login.succeeded',
        resourceType: 'user',
        resourceId: user.id,
        ipHash,
        metadataJson: { outcome: 'success', mappedRole: role },
      });

      reply.redirect(config.publicUrl);
      return;
    } catch (error) {
      await recordAuditEvent(db, {
        action: 'auth.oidc_login.failed',
        resourceType: 'user',
        resourceId: randomUUID(),
        ipHash,
        metadataJson: {
          outcome: 'failure',
          reason: error instanceof Error ? error.message : 'unknown_error',
        },
      });
      metrics?.recordAuthFailure();
      throw error;
    }
  });
}
