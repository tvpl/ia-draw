import { can } from '@arch-canvas/auth';
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../core/config.js';
import { verifyLocalPassword } from './accounts.js';
import { clearedSessionCookieOptions, SESSION_COOKIE_NAME, sessionCookieOptions } from './cookie.js';
import type { Db } from './db.js';
import { requireSession } from './middleware.js';
import { createSession, revokeSession, rotateSession } from './session.js';
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
export async function registerAuthModule(app: FastifyInstance, deps: AuthModuleDeps): Promise<void> {
  const { db, config } = deps;

  await app.register(fastifyCookie);

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw Object.assign(new Error('Invalid login payload'), { statusCode: 400 });
    }

    const user = await verifyLocalPassword(db, parsed.data.email, parsed.data.password);
    if (!user) invalidCredentials();

    const issued = await createSession(db, user.id);
    reply.setCookie(SESSION_COOKIE_NAME, issued.token, sessionCookieOptions(config));
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
