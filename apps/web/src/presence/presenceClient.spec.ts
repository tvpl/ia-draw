import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket } from './fakeSocket.js';
import {
  CURSOR_THROTTLE_MS,
  IDLE_AFTER_MS,
  PresenceClient,
  type PresenceClientOptions,
  STALE_REMOTE_AFTER_MS,
  SWEEP_INTERVAL_MS,
} from './presenceClient.js';
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

interface ScheduledTimer {
  callback: () => void;
  delayMs: number;
  handle: number;
  cancelled: boolean;
}

/** Captures every scheduled timer so a test can fire exactly the one it means to. */
function timerHarness() {
  const scheduled: ScheduledTimer[] = [];
  let nextHandle = 1;
  return {
    scheduled,
    setTimeoutImpl: (callback: () => void, delayMs: number) => {
      const handle = nextHandle++;
      scheduled.push({ callback, delayMs, handle, cancelled: false });
      return handle;
    },
    clearTimeoutImpl: (handle: unknown) => {
      const entry = scheduled.find((timer) => timer.handle === handle);
      if (entry) entry.cancelled = true;
    },
    /** Fires the first pending, non-cancelled timer registered for `delayMs`. */
    fire(delayMs: number): void {
      const entry = scheduled.find((timer) => timer.delayMs === delayMs && !timer.cancelled);
      if (!entry) throw new Error(`no pending timer scheduled for ${delayMs}ms`);
      entry.cancelled = true;
      entry.callback();
    },
  };
}

function sentPayloads(socket: FakeSocket | undefined): Record<string, unknown>[] {
  return (socket?.sent ?? []).map(
    (raw) => (JSON.parse(raw) as { payload: Record<string, unknown> }).payload,
  );
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

describe('PresenceClient: local broadcast (T8, LIVE-09..12)', () => {
  beforeEach(() => {
    FakeSocket.reset();
  });

  async function connected(overrides: Partial<PresenceClientOptions> = {}) {
    const timers = timerHarness();
    const { client, store } = build({
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      ...overrides,
    });
    client.connect();
    await settle();
    FakeSocket.last?.open();
    return { client, store, timers, socket: FakeSocket.last };
  }

  it('collapses a burst of cursor moves into one message carrying the last position (LIVE-09)', async () => {
    const { client, timers, socket } = await connected();

    for (let index = 0; index < 10; index += 1) {
      client.sendCursor({ x: index, y: index * 2 });
    }
    expect(socket?.sent).toHaveLength(0);

    timers.fire(CURSOR_THROTTLE_MS);

    expect(sentPayloads(socket)).toEqual([{ cursor: { x: 9, y: 18 }, status: 'active' }]);
  });

  it('sends the selection immediately, without throttling (LIVE-10)', async () => {
    const { client, socket } = await connected();

    client.sendSelection(['el-1', 'el-2']);

    expect(sentPayloads(socket)).toEqual([{ selection: ['el-1', 'el-2'], status: 'active' }]);
  });

  it('sends nothing while the socket is not open (LIVE-11)', async () => {
    const timers = timerHarness();
    const { client } = build({
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
    });
    client.connect();
    await settle();
    // Deliberately never opened.

    client.sendSelection(['el-1']);
    client.sendCursor({ x: 1, y: 1 });
    timers.fire(CURSOR_THROTTLE_MS);

    expect(FakeSocket.last?.sent).toEqual([]);
  });

  it('reports idle exactly once after a stretch of inactivity, then active again on movement (LIVE-12)', async () => {
    let clock = 1_000;
    const { client, timers, socket } = await connected({ now: () => clock });

    clock += IDLE_AFTER_MS;
    timers.fire(SWEEP_INTERVAL_MS);
    expect(sentPayloads(socket)).toEqual([{ status: 'idle' }]);

    // A second sweep with no movement in between must not re-announce.
    clock += SWEEP_INTERVAL_MS;
    timers.fire(SWEEP_INTERVAL_MS);
    expect(sentPayloads(socket)).toEqual([{ status: 'idle' }]);

    client.sendCursor({ x: 3, y: 4 });
    timers.fire(CURSOR_THROTTLE_MS);
    expect(sentPayloads(socket)).toEqual([
      { status: 'idle' },
      { cursor: { x: 3, y: 4 }, status: 'active' },
    ]);
  });

  it('prunes a remote that has sent nothing for longer than the stale window', async () => {
    let clock = 1_000;
    const { store, timers, socket } = await connected({ now: () => clock });

    socket?.receive(presenceFrame({ senderId: PEER_ID, displayName: 'Ana', status: 'active' }));
    expect(store.getState().remotes[PEER_ID]).toBeDefined();

    clock += STALE_REMOTE_AFTER_MS + 1;
    timers.fire(SWEEP_INTERVAL_MS);

    expect(store.getState().remotes).toEqual({});
  });

  it('close() cancels the pending throttle and sweep timers (LIVE-08)', async () => {
    const { client, timers } = await connected();

    client.sendCursor({ x: 1, y: 1 });
    client.close();

    expect(timers.scheduled.filter((timer) => !timer.cancelled)).toEqual([]);
  });
});
