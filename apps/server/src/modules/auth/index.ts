export { createLocalAccount, verifyLocalPassword, type LocalUser } from './accounts.js';
export { SESSION_COOKIE_NAME, sessionCookieOptions, clearedSessionCookieOptions } from './cookie.js';
export type { Db } from './db.js';
export { requireSession } from './middleware.js';
export {
  createSession,
  revokeSession,
  rotateSession,
  verifySession,
  SESSION_TTL_MS,
  type SessionIssue,
} from './session.js';
export { registerAuthModule, type AuthModuleDeps } from './routes.js';
export { generateOpaqueToken, hashToken } from './tokens.js';
export type { AuthContext } from './types.js';
