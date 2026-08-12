import { describe, expect, it } from 'vitest';
import {
  MAX_WS_MESSAGE_BYTES,
  WS_PROTOCOL_VERSION,
  wsEnvelopeSchema,
  wsMessageTypeSchema,
} from './ws-envelope.js';

const validEnvelope = {
  protocolVersion: WS_PROTOCOL_VERSION,
  diagramId: '4fa2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f70',
  messageId: '7cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f71',
  sentAt: '2026-08-12T12:00:00.000Z',
  type: 'mutation',
  payload: { anything: true },
};

describe('ws envelope (spec §7.2)', () => {
  it('caps a single message at 256 KB', () => {
    expect(MAX_WS_MESSAGE_BYTES).toBe(262144);
  });

  it('parses a valid envelope with protocolVersion, diagramId, messageId and sentAt', () => {
    const parsed = wsEnvelopeSchema.parse(validEnvelope);
    expect(parsed.type).toBe('mutation');
    expect(parsed.protocolVersion).toBe(WS_PROTOCOL_VERSION);
  });

  it('rejects an unknown protocol version', () => {
    expect(wsEnvelopeSchema.safeParse({ ...validEnvelope, protocolVersion: 2 }).success).toBe(
      false,
    );
  });

  it('rejects an unknown message type', () => {
    expect(wsEnvelopeSchema.safeParse({ ...validEnvelope, type: 'drop_table' }).success).toBe(
      false,
    );
  });

  it('rejects a non-ISO sentAt', () => {
    expect(wsEnvelopeSchema.safeParse({ ...validEnvelope, sentAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('covers every protocol message from spec §7.2', () => {
    const expected = [
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
    ];
    expect(wsMessageTypeSchema.options).toEqual(expected);
  });
});
