import { allFixtures } from '@arch-canvas/test-fixtures';
import { MAX_WS_MESSAGE_BYTES } from '@arch-canvas/shared-contracts';
import { describe, expect, it } from 'vitest';
import {
  MAX_OPERATION_ELEMENTS,
  OperationEnvelopeError,
  parseOperationEnvelope,
} from './envelope.js';

const CLIENT_MUTATION_ID = '3f9e6f2a-3d3a-4b6a-9b9a-0f7a2f6a1c11';
const ACTOR_ID = '7a1b6f2a-3d3a-4b6a-9b9a-0f7a2f6a1c22';

function upsertDelta(elementId: string, overrides: Record<string, unknown> = {}) {
  const [fixtureElement] = allFixtures.text;
  if (!fixtureElement) throw new Error('fixture must have at least one element');
  return {
    elementId,
    kind: 'upsert' as const,
    element: { ...fixtureElement, ...overrides, id: elementId },
    version: 1,
    versionNonce: 1,
  };
}

function validEnvelope(deltas: unknown[] = [upsertDelta('el-1')]) {
  return {
    clientMutationId: CLIENT_MUTATION_ID,
    baseRevision: 0,
    actorId: ACTOR_ID,
    deltas,
  };
}

describe('parseOperationEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    const envelope = parseOperationEnvelope(validEnvelope());
    expect(envelope.clientMutationId).toBe(CLIENT_MUTATION_ID);
    expect(envelope.baseRevision).toBe(0);
    expect(envelope.actorId).toBe(ACTOR_ID);
    expect(envelope.deltas).toHaveLength(1);
  });

  it('rejects an envelope with more than MAX_OPERATION_ELEMENTS deltas with a specific code', () => {
    // Deliberately minimal deltas (not the full fixture element) — MAX_OPERATION_ELEMENTS + 1
    // copies of the full text fixture would themselves cross the 256 KB size limit and mask
    // the count check this test targets.
    const tooMany = Array.from({ length: MAX_OPERATION_ELEMENTS + 1 }, (_, i) => ({
      elementId: `el-${i}`,
      kind: 'upsert' as const,
      element: { id: `el-${i}`, type: 'text' },
      version: 1,
      versionNonce: 1,
    }));

    expect(() => parseOperationEnvelope(validEnvelope(tooMany))).toThrow(OperationEnvelopeError);
    try {
      parseOperationEnvelope(validEnvelope(tooMany));
      throw new Error('expected parseOperationEnvelope to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OperationEnvelopeError);
      expect((error as OperationEnvelopeError).code).toBe('too_many_elements');
      expect((error as OperationEnvelopeError).statusCode).toBe(413);
    }
  });

  it('rejects an envelope whose serialized size exceeds MAX_WS_MESSAGE_BYTES with a specific code', () => {
    const oversizedElement = upsertDelta('el-1', {
      oversizedFiller: 'x'.repeat(MAX_WS_MESSAGE_BYTES + 1),
    });

    try {
      parseOperationEnvelope(validEnvelope([oversizedElement]));
      throw new Error('expected parseOperationEnvelope to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OperationEnvelopeError);
      expect((error as OperationEnvelopeError).code).toBe('payload_too_large');
      expect((error as OperationEnvelopeError).statusCode).toBe(413);
    }
  });

  it('rejects a malformed envelope (invalid clientMutationId) as invalid_envelope', () => {
    const malformed = { ...validEnvelope(), clientMutationId: 'not-a-uuid' };

    try {
      parseOperationEnvelope(malformed);
      throw new Error('expected parseOperationEnvelope to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OperationEnvelopeError);
      expect((error as OperationEnvelopeError).code).toBe('invalid_envelope');
      expect((error as OperationEnvelopeError).statusCode).toBe(400);
    }
  });
});
