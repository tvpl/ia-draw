import { z } from 'zod';
import { uuidSchema } from './ids.js';

/** Hard limit for a single WebSocket message (docs/product-spec.md §7.2). */
export const MAX_WS_MESSAGE_BYTES = 256 * 1024;

export const WS_PROTOCOL_VERSION = 1;

export const wsMessageTypeSchema = z.enum([
  'hello',
  'sync_request',
  'sync_state',
  'mutation',
  'mutation_ack',
  'mutation_rejected',
  'presence',
  'comment_event',
  'permission_changed',
  'server_draining',
  'ping',
  'pong',
]);

export type WsMessageType = z.infer<typeof wsMessageTypeSchema>;

export const wsEnvelopeSchema = z.object({
  protocolVersion: z.literal(WS_PROTOCOL_VERSION),
  diagramId: uuidSchema,
  messageId: uuidSchema,
  sentAt: z.iso.datetime(),
  type: wsMessageTypeSchema,
  payload: z.unknown(),
});

export type WsEnvelope = z.infer<typeof wsEnvelopeSchema>;
