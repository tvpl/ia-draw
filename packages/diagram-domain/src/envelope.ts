import type { ElementDelta } from '@arch-canvas/editor-adapter';
import { MAX_WS_MESSAGE_BYTES } from '@arch-canvas/shared-contracts';
import { z } from 'zod';

/** Max deltas accepted in a single operation batch (design.md, T19). */
export const MAX_OPERATION_ELEMENTS = 500;

/**
 * Structural runtime validator for `ElementDelta` (type imported from
 * `@arch-canvas/editor-adapter`, never redefined here). `element` is
 * validated as an opaque record — modeling every Excalidraw element variant
 * is editor-adapter's concern; this schema only needs to catch a malformed
 * envelope shape.
 */
const elementDeltaSchema = z.object({
  elementId: z.string().min(1),
  kind: z.enum(['upsert', 'delete']),
  element: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int(),
  versionNonce: z.number().int(),
});

/**
 * `OperationEnvelope` (design.md "packages/diagram-domain"). `deltas` has no
 * `.max()` here — the element-count limit is enforced separately in
 * `parseOperationEnvelope` so it can raise its own specific error code,
 * distinct from a generic shape-validation failure.
 */
export const operationEnvelopeSchema = z.object({
  clientMutationId: z.uuid(),
  baseRevision: z.number().int().nonnegative(),
  actorId: z.uuid(),
  deltas: z.array(elementDeltaSchema).min(1),
});

export interface OperationEnvelope {
  clientMutationId: string;
  baseRevision: number;
  actorId: string;
  deltas: ElementDelta[];
}

export type OperationEnvelopeErrorCode = 'payload_too_large' | 'too_many_elements' | 'invalid_envelope';

/**
 * Thrown by `parseOperationEnvelope` when a limit is exceeded or the shape
 * is invalid. Carries `statusCode` so `apps/server`'s generic error handler
 * (core/server.ts) renders it as problem+json without any diagram-sync-side
 * mapping — mirrors the `notFound()`/`forbidden()` helper pattern already
 * used by the workspace module.
 */
export class OperationEnvelopeError extends Error {
  readonly code: OperationEnvelopeErrorCode;
  readonly statusCode: number;

  constructor(code: OperationEnvelopeErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'OperationEnvelopeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Validates an untrusted `raw` payload into a well-formed `OperationEnvelope`,
 * enforcing both limits from T19's "Done when": a max serialized size of
 * `MAX_WS_MESSAGE_BYTES` (256 KB — same limit as the WS protocol) and a max
 * element count (`MAX_OPERATION_ELEMENTS`). Each violation raises its own
 * `OperationEnvelopeError` code so callers (and clients, per the edge case
 * in spec.md) can distinguish "split the batch" from "malformed request".
 */
export function parseOperationEnvelope(raw: unknown): OperationEnvelope {
  const serializedBytes = Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
  if (serializedBytes > MAX_WS_MESSAGE_BYTES) {
    throw new OperationEnvelopeError(
      'payload_too_large',
      `Operation envelope is ${serializedBytes} bytes, exceeding the ${MAX_WS_MESSAGE_BYTES}-byte limit. Split the batch into smaller chunks and resend.`,
      413,
    );
  }

  const parsed = operationEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OperationEnvelopeError('invalid_envelope', parsed.error.message, 400);
  }

  if (parsed.data.deltas.length > MAX_OPERATION_ELEMENTS) {
    throw new OperationEnvelopeError(
      'too_many_elements',
      `Operation envelope carries ${parsed.data.deltas.length} deltas, exceeding the ${MAX_OPERATION_ELEMENTS}-element limit per batch. Split the batch into smaller chunks and resend.`,
      413,
    );
  }

  return {
    clientMutationId: parsed.data.clientMutationId,
    baseRevision: parsed.data.baseRevision,
    actorId: parsed.data.actorId,
    // Structurally compatible with ElementDelta; `element` is validated as an
    // opaque record above rather than re-modeling SceneElement's full shape.
    deltas: parsed.data.deltas as ElementDelta[],
  };
}
