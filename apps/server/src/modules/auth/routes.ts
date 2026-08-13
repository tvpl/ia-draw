import { randomUUID } from 'node:crypto';
import { can } from '@arch-canvas/auth';
import { recordAuditEvent } from '@arch-canvas/database';
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../core/config.js';
import { verifyLocalPassword } from './accounts.js';
import {
  clearedSessionCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from './cookie.js';
import type { Db } from './db.js';
import { requireSession } from './middleware.js';
import { createSession, revokeSession, rotateSession } from './session.js';
import { hashToken } from './tokens.js';
import './types.js';
import { issueWsTicket, resolveDiagramMembership } from './ws-ticket.js';

export interface AuthModuleDeps {
  db: Db;
  config: AppConfig;
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

/** Registers /auth/login, /auth/logout, /auth/refresh and /me on `app` (T14). */
export async function registerAuthModule(
  app: FastifyInstance,
  deps: AuthModuleDeps,
): Promise<void> {
  const { db, config } = deps;

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
}
