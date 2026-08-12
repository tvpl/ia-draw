import type { FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME } from './cookie.js';
import type { Db } from './db.js';
import { verifySession } from './session.js';
import './types.js';

function unauthorized(): never {
  throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
}

/**
 * Reusable session-auth preHandler (T14). Populates `request.authContext`
 * on success; throws a 401 (routed through core's problem+json error
 * handler) when the cookie is missing or the session is invalid/expired.
 */
export function requireSession(db: Db) {
  return async function requireSessionPreHandler(request: FastifyRequest): Promise<void> {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) unauthorized();

    const result = await verifySession(db, token);
    if (!result) unauthorized();

    request.authContext = { user: result.user, sessionId: result.sessionId };
  };
}
