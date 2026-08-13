import type { WsTicketClaim } from '../auth/ws-ticket.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireWsTicket`'s `preValidation` hook once the single-use ticket has been consumed — never cached across messages, only used to seed the WS handler's closure at connection time. */
    wsTicketClaim?: WsTicketClaim;
  }
}
