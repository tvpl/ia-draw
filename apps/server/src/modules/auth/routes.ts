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
}
