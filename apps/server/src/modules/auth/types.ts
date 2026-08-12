import type { LocalUser } from './accounts.js';

export interface AuthContext {
  user: LocalUser;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}
