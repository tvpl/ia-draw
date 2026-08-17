import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket } from './fakeSocket.js';
import { PresenceClient, type PresenceClientOptions } from './presenceClient.js';
import { createPresenceStore } from './presenceStore.js';

const DIAGRAM_ID = '4fa2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f70';
const SELF_ID = '9ab2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f72';
const PEER_ID = '1cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f73';

function presenceFrame(payload: Record<string, unknown>): string {
  return JSON.stringify({
    protocolVersion: 1,
    diagramId: DIAGRAM_ID,
    messageId: '7cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f71',
    sentAt: '2026-08-17T12:00:00.000Z',
    type: 'presence',
    payload,
  });
}

function ticketFetch(ticket = 'ticket-1'): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ ticket, expiresAt: '2026-08-17T12:00:30.000Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

function build(overrides: Partial<PresenceClientOptions> = {}) {
  const store = createPresenceStore();
  const client = new PresenceClient({
    diagramId: DIAGRAM_ID,
    selfUserId: SELF_ID,
    store,
    fetchImpl: ticketFetch(),
    WebSocketImpl: FakeSocket,
    now: () => 1_000,
    ...overrides,
  });
  return { store, client };
}

/** Lets the ticket fetch's promise chain (including `Response.json()`) settle before assertions. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('PresenceClient: connection and reception (T7, LIVE-06..08, LIVE-13..18, LIVE-23)', () => {
  beforeEach(() => {
    FakeSocket.reset();
  });

  it('mints a ticket and opens the ws route carrying it as a query parameter (LIVE-06)', async () => {
    const fetchImpl = ticketFetch('the-ticket');
    const { client, store } = build({ fetchImpl });

    client.connect();
    expect(store.getState().connection).toBe('connecting');
    await settle();

    expect(fetchImpl).toHaveBeenCalledWith(`/diagrams/${DIAGRAM_ID}/ws-ticket`, {
      method: 'POST',
    });
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.last?.url).toBe(
      `ws://localhost:3000/ws/diagrams/${DIAGRAM_ID}?ticket=the-ticket`,
    );

    FakeSocket.last?.open();
    expect(store.getState().connection).toBe('connected');
  });

  it('opens no socket and reports disconnected when the ticket route fails (LIVE-07)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 403 }),
    ) as unknown as typeof fetch;
    const { client, store } = build({ fetchImpl });

    client.connect();
    await settle();

    expect(FakeSocket.instances).toHaveLength(0);
    expect(store.getState().connection).toBe('disconnected');
  });

  it('opens no socket and reports disconnected when the ticket request throws (LIVE-07)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const { client, store } = build({ fetchImpl });

    client.connect();
    await settle();

    expect(FakeSocket.instances).toHaveLength(0);
    expect(store.getState().connection).toBe('disconnected');
  });

  it('close() closes the socket, reports disconnected and ignores a later connect() (LIVE-08)', async () => {
    const { client, store } = build();
    client.connect();
    await settle();
    FakeSocket.last?.open();

    client.close();

    expect(FakeSocket.last?.readyState).toBe(3);
    expect(store.getState().connection).toBe('disconnected');

    client.connect();
    await settle();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("records a peer's cursor, selection and display name from a relayed presence message (LIVE-13, LIVE-14)", async () => {
    const { client, store } = build({ now: () => 4_242 });
    client.connect();
    await settle();
    FakeSocket.last?.open();

    FakeSocket.last?.receive(
      presenceFrame({
        senderId: PEER_ID,
        displayName: 'Ana',
        cursor: { x: 11, y: 22 },
        selection: ['el-1', 'el-2'],
        status: 'active',
      }),
    );

    expect(store.getState().remotes[PEER_ID]).toEqual({
      senderId: PEER_ID,
      displayName: 'Ana',
      cursor: { x: 11, y: 22 },
      selection: ['el-1', 'el-2'],
      lastSeenAt: 4_242,
    });
  });

  it('ignores a presence message that carries no senderId (LIVE-16)', async () => {
    const { client, store } = build();
    client.connect();
    await settle();
    FakeSocket.last?.open();

    FakeSocket.last?.receive(presenceFrame({ cursor: { x: 1, y: 1 }, status: 'active' }));

    expect(store.getState().remotes).toEqual({});
  });

  it("ignores presence whose senderId is this client's own user (LIVE-17)", async () => {
    const { client, store } = build();
    client.connect();
    await settle();
    FakeSocket.last?.open();

    FakeSocket.last?.receive(
      presenceFrame({
        senderId: SELF_ID,
        displayName: 'Me',
        cursor: { x: 5, y: 5 },
        status: 'active',
      }),
    );

    expect(store.getState().remotes).toEqual({});
  });

  it('removes a peer that reports status idle (LIVE-18)', async () => {
    const { client, store } = build();
    client.connect();
    await settle();
    FakeSocket.last?.open();

    FakeSocket.last?.receive(
      presenceFrame({ senderId: PEER_ID, displayName: 'Ana', status: 'active' }),
    );
    expect(store.getState().remotes[PEER_ID]).toBeDefined();

    FakeSocket.last?.receive(presenceFrame({ senderId: PEER_ID, status: 'idle' }));
    expect(store.getState().remotes).toEqual({});
  });

  it('empties the remote map when the socket drops (LIVE-23)', async () => {
    const { client, store } = build();
    client.connect();
    await settle();
    FakeSocket.last?.open();
    FakeSocket.last?.receive(
      presenceFrame({ senderId: PEER_ID, displayName: 'Ana', status: 'active' }),
    );
    expect(store.getState().remotes[PEER_ID]).toBeDefined();

    FakeSocket.last?.emitClose();

    expect(store.getState().connection).toBe('disconnected');
    expect(store.getState().remotes).toEqual({});
  });

  it('drops a malformed or unhandled frame without disconnecting', async () => {
    const { client, store } = build();
    client.connect();
    await settle();
    const socket = FakeSocket.last;
    socket?.open();

    socket?.receive('{not json');
    socket?.receive(JSON.stringify({ protocolVersion: 1, type: 'nonsense' }));
    socket?.receive(
      JSON.stringify({
        protocolVersion: 1,
        diagramId: DIAGRAM_ID,
        messageId: '7cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f71',
        sentAt: '2026-08-17T12:00:00.000Z',
        type: 'pong',
        payload: {},
      }),
    );

    expect(store.getState().connection).toBe('connected');
    expect(store.getState().remotes).toEqual({});
  });
});
