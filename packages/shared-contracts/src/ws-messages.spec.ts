import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_WS_MESSAGE_BYTES, WS_PROTOCOL_VERSION, wsMessageTypeSchema } from './ws-envelope.js';
import { parseWsMessage, WsMessageParseError, wsPayloadSchemaByType } from './ws-messages.js';

const DIAGRAM_ID = '4fa2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f70';
const MESSAGE_ID = '7cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f71';
const USER_ID = '9ab2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f72';

function envelope(type: string, payload: unknown) {
  return {
    protocolVersion: WS_PROTOCOL_VERSION,
    diagramId: DIAGRAM_ID,
    messageId: MESSAGE_ID,
    sentAt: '2026-08-12T12:00:00.000Z',
    type,
    payload,
  };
}

describe('ws-messages: per-message-type payload schemas (T72, CLB-01/02)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a valid presence message with cursor and selection', () => {
    const raw = JSON.stringify(
      envelope('presence', {
        cursor: { x: 10, y: 20 },
        selection: ['el-1', 'el-2'],
        status: 'active',
      }),
    );
    const parsed = parseWsMessage(raw);
    expect(parsed.type).toBe('presence');
    if (parsed.type !== 'presence') throw new Error('unreachable');
    expect(parsed.payload).toEqual({
      cursor: { x: 10, y: 20 },
      selection: ['el-1', 'el-2'],
      status: 'active',
    });
  });

  it('parses a valid presence message with a null cursor and no selection', () => {
    const raw = JSON.stringify(envelope('presence', { cursor: null, status: 'idle' }));
    const parsed = parseWsMessage(raw);
    expect(parsed.type).toBe('presence');
    if (parsed.type !== 'presence') throw new Error('unreachable');
    expect(parsed.payload.status).toBe('idle');
    expect(parsed.payload.cursor).toBeNull();
  });

  // LIVE-05 (realtime-presence): `senderId`/`displayName` are populated by the
  // server on the relay only. The same schema validates both directions, so a
  // client-sent payload must still parse without them.
  it('parses a client-sent presence message that carries no senderId or displayName (LIVE-05)', () => {
    const raw = JSON.stringify(envelope('presence', { status: 'active' }));
    const parsed = parseWsMessage(raw);
    if (parsed.type !== 'presence') throw new Error('unreachable');
    expect(parsed.payload).toEqual({ status: 'active' });
    expect(parsed.payload.senderId).toBeUndefined();
    expect(parsed.payload.displayName).toBeUndefined();
  });

  it('preserves the senderId and displayName the server stamps on a relayed presence message (LIVE-05)', () => {
    const raw = JSON.stringify(
      envelope('presence', {
        cursor: { x: 4, y: 5 },
        selection: ['el-9'],
        status: 'active',
        senderId: USER_ID,
        displayName: 'Ana',
      }),
    );
    const parsed = parseWsMessage(raw);
    if (parsed.type !== 'presence') throw new Error('unreachable');
    expect(parsed.payload.senderId).toBe(USER_ID);
    expect(parsed.payload.displayName).toBe('Ana');
  });

  it('rejects a presence senderId that is not a uuid, pointing at the field (LIVE-05)', () => {
    const raw = JSON.stringify(envelope('presence', { status: 'active', senderId: 'not-a-uuid' }));
    try {
      parseWsMessage(raw);
      throw new Error('expected parseWsMessage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WsMessageParseError);
      const parseError = error as WsMessageParseError;
      expect(parseError.code).toBe('invalid_payload');
      expect(parseError.field).toBe('payload.senderId');
    }
  });

  it('rejects a mutation message missing clientMutationId with a structured error pointing at the field', () => {
    const raw = JSON.stringify(
      envelope('mutation', { baseRevision: 3, deltas: [{ elementId: 'a' }] }),
    );
    try {
      parseWsMessage(raw);
      throw new Error('expected parseWsMessage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WsMessageParseError);
      const parseError = error as WsMessageParseError;
      expect(parseError.code).toBe('invalid_payload');
      expect(parseError.field).toBe('payload.clientMutationId');
    }
  });

  it('rejects a raw string above MAX_WS_MESSAGE_BYTES BEFORE calling JSON.parse', () => {
    const parseSpy = vi.spyOn(JSON, 'parse');
    // Pad well past the 256 KB limit with a value that would also fail JSON.parse
    // if it were ever attempted, so a false "pass" can't hide a missed size check.
    const oversized = `{"padding":"${'x'.repeat(MAX_WS_MESSAGE_BYTES + 1024)}`; // deliberately unterminated JSON

    expect(() => parseWsMessage(oversized)).toThrow(WsMessageParseError);
    try {
      parseWsMessage(oversized);
    } catch (error) {
      expect((error as WsMessageParseError).code).toBe('payload_too_large');
    }
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('accepts a message at exactly the byte limit and rejects one byte over it', () => {
    // Build a valid, parseable envelope, then pad `reason` on server_draining
    // so the total serialized size lands exactly at (accepted) and one byte
    // above (rejected) MAX_WS_MESSAGE_BYTES.
    const base = envelope('server_draining', { reason: '' });
    const baseBytes = Buffer.byteLength(JSON.stringify(base), 'utf8');
    const padLength = MAX_WS_MESSAGE_BYTES - baseBytes;
    const atLimit = JSON.stringify(envelope('server_draining', { reason: 'x'.repeat(padLength) }));
    expect(Buffer.byteLength(atLimit, 'utf8')).toBe(MAX_WS_MESSAGE_BYTES);
    expect(() => parseWsMessage(atLimit)).not.toThrow();

    const overLimit = JSON.stringify(
      envelope('server_draining', { reason: 'x'.repeat(padLength + 1) }),
    );
    expect(Buffer.byteLength(overLimit, 'utf8')).toBe(MAX_WS_MESSAGE_BYTES + 1);
    expect(() => parseWsMessage(overLimit)).toThrow(WsMessageParseError);
  });

  it('every member of wsMessageTypeSchema has a corresponding payload schema (exhaustive)', () => {
    for (const type of wsMessageTypeSchema.options) {
      expect(wsPayloadSchemaByType).toHaveProperty(type);
    }
    expect(Object.keys(wsPayloadSchemaByType).sort()).toEqual(
      [...wsMessageTypeSchema.options].sort(),
    );
  });

  it('parses hello, sync_request, sync_state, mutation, mutation_ack, mutation_rejected, comment_event, permission_changed, ping, pong', () => {
    expect(
      parseWsMessage(JSON.stringify(envelope('hello', { userId: USER_ID, diagramId: DIAGRAM_ID })))
        .type,
    ).toBe('hello');
    expect(parseWsMessage(JSON.stringify(envelope('sync_request', {}))).type).toBe('sync_request');
    expect(
      parseWsMessage(JSON.stringify(envelope('sync_request', { afterSequence: 5 }))).type,
    ).toBe('sync_request');
    expect(
      parseWsMessage(
        JSON.stringify(envelope('sync_state', { scene: [{ id: 'el-1' }], revision: 7 })),
      ).type,
    ).toBe('sync_state');
    expect(
      parseWsMessage(
        JSON.stringify(
          envelope('mutation', {
            clientMutationId: MESSAGE_ID,
            baseRevision: 1,
            deltas: [{ elementId: 'el-1', kind: 'upsert' }],
          }),
        ),
      ).type,
    ).toBe('mutation');
    expect(
      parseWsMessage(
        JSON.stringify(envelope('mutation_ack', { clientMutationId: MESSAGE_ID, sequence: 2 })),
      ).type,
    ).toBe('mutation_ack');
    expect(
      parseWsMessage(
        JSON.stringify(
          envelope('mutation_rejected', { clientMutationId: MESSAGE_ID, reason: 'forbidden' }),
        ),
      ).type,
    ).toBe('mutation_rejected');
    expect(
      parseWsMessage(
        JSON.stringify(envelope('comment_event', { commentId: MESSAGE_ID, action: 'created' })),
      ).type,
    ).toBe('comment_event');
    expect(
      parseWsMessage(JSON.stringify(envelope('permission_changed', { role: 'viewer' }))).type,
    ).toBe('permission_changed');
    expect(parseWsMessage(JSON.stringify(envelope('ping', {}))).type).toBe('ping');
    expect(parseWsMessage(JSON.stringify(envelope('pong', {}))).type).toBe('pong');
  });

  it('rejects an invalid presence status value', () => {
    const raw = JSON.stringify(envelope('presence', { status: 'away' }));
    expect(() => parseWsMessage(raw)).toThrow(WsMessageParseError);
  });

  it('rejects malformed JSON with a distinct error code (never reaching envelope validation)', () => {
    expect(() => parseWsMessage('{not json')).toThrow(WsMessageParseError);
    try {
      parseWsMessage('{not json');
    } catch (error) {
      expect((error as WsMessageParseError).code).toBe('invalid_json');
    }
  });

  it('rejects an envelope-level failure (unknown type) distinctly from a payload failure', () => {
    const raw = JSON.stringify(envelope('drop_table', {}));
    try {
      parseWsMessage(raw);
      throw new Error('expected parseWsMessage to throw');
    } catch (error) {
      expect((error as WsMessageParseError).code).toBe('invalid_envelope');
    }
  });
});
