export { createLocalAccount, type LocalUser, verifyLocalPassword } from './accounts.js';
export {
  clearedSessionCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from './cookie.js';
export type { Db } from './db.js';
export { requireSession } from './middleware.js';
export { type AuthModuleDeps, registerAuthModule } from './routes.js';
export {
  createSession,
  revokeSession,
  rotateSession,
  SESSION_TTL_MS,
  type SessionIssue,
  verifySession,
} from './session.js';
export { generateOpaqueToken, hashToken } from './tokens.js';
export type { AuthContext } from './types.js';
export {
  consumeWsTicket,
  type DiagramMembership,
  issueWsTicket,
  resolveDiagramMembership,
  WS_TICKET_TTL_MS,
  type WsTicketClaim,
  type WsTicketIssue,
} from './ws-ticket.js';
