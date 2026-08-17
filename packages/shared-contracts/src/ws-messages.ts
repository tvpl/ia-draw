import { z } from 'zod';
import { uuidSchema } from './ids.js';
import {
  MAX_WS_MESSAGE_BYTES,
  type WsEnvelope,
  type WsMessageType,
  wsEnvelopeSchema,
} from './ws-envelope.js';

/**
 * Per-message-type `payload` schemas (T72, CLB-01/02) layered on top of the
 * envelope (`wsEnvelopeSchema`, F0) already validating
 * `protocolVersion`/`diagramId`/`messageId`/`sentAt`/`type`. `mutation`'s
 * `deltas` are intentionally validated only as `unknown[]` here — the real
 * per-delta shape validation is `parseOperationEnvelope`'s job
 * (`packages/diagram-domain`, reused unchanged by `ws-gateway`/T73). This
 * package never imports that function or its types by value: duplicating
 * delta validation here would be exactly the "reimplement op-log
 * validation inside ws-gateway" anti-pattern the F4 lessons warn against,
 * just one layer higher.
 */

export const helloPayloadSchema = z.object({
  userId: uuidSchema,
  diagramId: uuidSchema,
});
export type HelloPayload = z.infer<typeof helloPayloadSchema>;

/** `afterSequence` omitted = full bootstrap (T73 always answers with the full scene in this wave — see T76 for the incremental-catch-up decision). */
export const syncRequestPayloadSchema = z.object({
  afterSequence: z.number().int().nonnegative().optional(),
});
export type SyncRequestPayload = z.infer<typeof syncRequestPayloadSchema>;

export const syncStatePayloadSchema = z.object({
  scene: z.array(z.unknown()),
  revision: z.number().int().nonnegative(),
});
export type SyncStatePayload = z.infer<typeof syncStatePayloadSchema>;

/** Same shape as `OperationEnvelope` (`packages/diagram-domain`) — `import type` only would still couple this package to that one, so the shape is re-declared structurally instead (`deltas` opaque, validated downstream). */
export const mutationPayloadSchema = z.object({
  clientMutationId: uuidSchema,
  baseRevision: z.number().int().nonnegative(),
  deltas: z.array(z.unknown()),
});
export type MutationPayload = z.infer<typeof mutationPayloadSchema>;

export const mutationAckPayloadSchema = z.object({
  clientMutationId: uuidSchema,
  sequence: z.number().int().nonnegative(),
});
export type MutationAckPayload = z.infer<typeof mutationAckPayloadSchema>;

export const mutationRejectedPayloadSchema = z.object({
  clientMutationId: uuidSchema,
  reason: z.string().min(1),
});
export type MutationRejectedPayload = z.infer<typeof mutationRejectedPayloadSchema>;

export const presenceStatusSchema = z.enum(['active', 'idle']);

/**
 * One schema validates BOTH directions of the `presence` message
 * (`wsPayloadSchemaByType` has one entry per message type, not one per
 * direction), so `senderId`/`displayName` are optional: a client sends
 * neither. The server stamps both on every relayed copy (LIVE-01..03) — it
 * resolves them from the ticket-authenticated connection and NEVER reads
 * them off an inbound payload, exactly like it already refuses to trust an
 * `actorId` from the wire on `mutation`. A `senderId` arriving from a client
 * is therefore ignored, not honored (LIVE-04).
 */
export const presencePayloadSchema = z.object({
  cursor: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
  selection: z.array(z.string()).optional(),
  status: presenceStatusSchema,
  /** Server-populated on relay; ignored when it arrives from a client. */
  senderId: uuidSchema.optional(),
  /** Server-populated on relay (`users.display_name`); ignored when it arrives from a client. */
  displayName: z.string().min(1).optional(),
});
export type PresencePayload = z.infer<typeof presencePayloadSchema>;

export const commentEventPayloadSchema = z.object({
  commentId: uuidSchema,
  action: z.enum(['created', 'resolved']),
});
export type CommentEventPayload = z.infer<typeof commentEventPayloadSchema>;

export const permissionChangedPayloadSchema = z.object({
  role: z.string().min(1),
});
export type PermissionChangedPayload = z.infer<typeof permissionChangedPayloadSchema>;

export const serverDrainingPayloadSchema = z.object({
  reason: z.string().min(1).optional(),
});
export type ServerDrainingPayload = z.infer<typeof serverDrainingPayloadSchema>;

/** `ping`/`pong` carry no data — `.strict()` so an unexpected field is still a validation error, not silently ignored. */
export const emptyPayloadSchema = z.object({}).strict();
export type EmptyPayload = z.infer<typeof emptyPayloadSchema>;

/**
 * One payload schema per `wsMessageTypeSchema` member — `satisfies
 * Record<WsMessageType, ...>` is the structural guarantee that a new
 * protocol message type can never be added to `ws-envelope.ts` without
 * this map failing to typecheck until a payload schema is added for it.
 */
export const wsPayloadSchemaByType = {
  hello: helloPayloadSchema,
  sync_request: syncRequestPayloadSchema,
  sync_state: syncStatePayloadSchema,
  mutation: mutationPayloadSchema,
  mutation_ack: mutationAckPayloadSchema,
  mutation_rejected: mutationRejectedPayloadSchema,
  presence: presencePayloadSchema,
  comment_event: commentEventPayloadSchema,
  permission_changed: permissionChangedPayloadSchema,
  server_draining: serverDrainingPayloadSchema,
  ping: emptyPayloadSchema,
  pong: emptyPayloadSchema,
} as const satisfies Record<WsMessageType, z.ZodType>;

export type WsMessagePayloadMap = {
  [K in keyof typeof wsPayloadSchemaByType]: z.infer<(typeof wsPayloadSchemaByType)[K]>;
};

/** A `WsEnvelope` whose `payload` has been narrowed to the schema matching its own `type` — the return type of `parseWsMessage`. */
export type WsMessage = {
  [K in WsMessageType]: Omit<WsEnvelope, 'type' | 'payload'> & {
    type: K;
    payload: WsMessagePayloadMap[K];
  };
}[WsMessageType];

export type WsMessageParseErrorCode =
  | 'payload_too_large'
  | 'invalid_json'
  | 'invalid_envelope'
  | 'invalid_payload';

/**
 * Thrown by `parseWsMessage` — always carries `code` plus, whenever the
 * failure can be pinned to a specific field, `field` (dotted path, e.g.
 * `"payload.clientMutationId"`) so callers (ws-gateway's error responses,
 * tests) can report exactly what failed instead of a generic message.
 */
export class WsMessageParseError extends Error {
  readonly code: WsMessageParseErrorCode;
  readonly field?: string;

  constructor(code: WsMessageParseErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'WsMessageParseError';
    this.code = code;
    this.field = field;
  }
}

function byteLengthOf(raw: string | Buffer): number {
  return typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength;
}

/**
 * Validates an untrusted raw WS frame into a well-formed `WsMessage`:
 *
 * 1. Rejects anything over `MAX_WS_MESSAGE_BYTES` by byte length BEFORE
 *    calling `JSON.parse` at all — a frame right at the limit still costs
 *    only a `Buffer.byteLength`/`.length` check, never a parse of
 *    attacker-controlled megabytes.
 * 2. `JSON.parse`s the remainder, then validates the envelope shape
 *    (`wsEnvelopeSchema`, F0).
 * 3. Validates `payload` against the schema keyed by the envelope's own
 *    `type` (discriminated union via `wsPayloadSchemaByType`).
 *
 * Throws `WsMessageParseError` on any failure — never returns a partial
 * or best-effort result.
 */
export function parseWsMessage(raw: string | Buffer): WsMessage {
  const byteLength = byteLengthOf(raw);
  if (byteLength > MAX_WS_MESSAGE_BYTES) {
    throw new WsMessageParseError(
      'payload_too_large',
      `WS message is ${byteLength} bytes, exceeding the ${MAX_WS_MESSAGE_BYTES}-byte limit.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch (error) {
    throw new WsMessageParseError(
      'invalid_json',
      `WS message is not valid JSON: ${(error as Error).message}`,
    );
  }

  const envelopeResult = wsEnvelopeSchema.safeParse(json);
  if (!envelopeResult.success) {
    const issue = envelopeResult.error.issues[0];
    throw new WsMessageParseError(
      'invalid_envelope',
      envelopeResult.error.message,
      issue ? issue.path.join('.') : undefined,
    );
  }

  const envelope = envelopeResult.data;
  const payloadSchema = wsPayloadSchemaByType[envelope.type];
  const payloadResult = payloadSchema.safeParse(envelope.payload);
  if (!payloadResult.success) {
    const issue = payloadResult.error.issues[0];
    const field = ['payload', ...(issue ? issue.path.map(String) : [])].join('.');
    throw new WsMessageParseError(
      'invalid_payload',
      `payload for type "${envelope.type}" failed validation: ${payloadResult.error.message}`,
      field,
    );
  }

  return { ...envelope, payload: payloadResult.data } as WsMessage;
}
