import { parseWsMessage, WS_PROTOCOL_VERSION } from '@arch-canvas/shared-contracts';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { PresenceState } from './presenceStore.js';

/**
 * The slice of the browser `WebSocket` this client actually uses. Typed
 * structurally rather than as `typeof WebSocket` so a test can inject a small
 * hand-written fake instead of the repo taking on a `mock-socket`/`ws`
 * devDependency for a five-member surface (design.md, Fork 3). The real
 * `WebSocket` satisfies it as-is.
 */
export interface PresenceSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type PresenceSocketConstructor = new (url: string) => PresenceSocket;

/** RFC 6455 readyState 1 == OPEN — compared as a plain number, same convention as the server's ws-gateway. */
export const SOCKET_OPEN = 1;

/**
 * Trailing throttle window for outgoing cursor updates (LIVE-09). The server
 * applies no throttle of its own — every message published here fans out to
 * every other subscriber of the diagram — so 20 Hz is a deliberate network
 * budget, not a rendering choice.
 */
export const CURSOR_THROTTLE_MS = 50;

/** No local pointer movement for this long reports `status: 'idle'` once (LIVE-12). */
export const IDLE_AFTER_MS = 60_000;

/** A remote with no message for this long is dropped — covers a peer whose tab closed without ever reporting idle. */
export const STALE_REMOTE_AFTER_MS = 90_000;

/** One timer drives both time-based sweeps above. */
export const SWEEP_INTERVAL_MS = 15_000;

/**
 * Close codes the server uses for a deterministic policy rejection
 * (`WS_CLOSE_FORBIDDEN` / `WS_CLOSE_PAYLOAD_TOO_LARGE`, `ws-gateway/routes.ts`).
 * Retrying either would reproduce the same rejection, so reconnection stops.
 */
export const NON_RETRYABLE_CLOSE_CODES: readonly number[] = [4403, 4413];

/** Same capped exponential schedule `DiagramSyncClient` already retries batches with. */
export const reconnectDelayMs = (attempt: number): number => Math.min(1000 * 2 ** attempt, 30_000);

export interface PresenceClientOptions {
  diagramId: string;
  /** From `useAuth()` (AD-011) — used only to filter this user's own relayed presence out of the remote map. */
  selfUserId: string;
  store: UseBoundStore<StoreApi<PresenceState>>;
  /** Injectable for tests; defaults to the global fetch (same convention as `DiagramSyncClient`). */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to the global `WebSocket`. */
  WebSocketImpl?: PresenceSocketConstructor;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Injectable timers for tests; default to the global ones (same seam as `DiagramSyncClient.scheduleRetryTimer`). */
  setTimeoutImpl?: (callback: () => void, delayMs: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  /** Called after a socket opens that was NOT the first one — the catch-up trigger (LIVE-20). */
  onReconnected?: () => void;
}

function defaultWebSocketImpl(): PresenceSocketConstructor | undefined {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof candidate === 'function' ? (candidate as PresenceSocketConstructor) : undefined;
}

function socketUrl(diagramId: string, ticket: string): string {
  const { protocol, host } = globalThis.location;
  const scheme = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${host}/ws/diagrams/${diagramId}?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Owns the realtime presence socket for one open diagram: mints the single-use
 * ticket, opens the WebSocket, and turns inbound `presence` messages into
 * remote-collaborator state. It knows nothing about React or Excalidraw — the
 * store is the only thing it writes to.
 */
export class PresenceClient {
  private readonly diagramId: string;
  private readonly selfUserId: string;
  private readonly store: UseBoundStore<StoreApi<PresenceState>>;
  private readonly fetchImpl: typeof fetch;
  private readonly WebSocketImpl?: PresenceSocketConstructor;
  private readonly now: () => number;
  private readonly setTimeoutImpl: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimeoutImpl: (handle: unknown) => void;
  private readonly onReconnected?: () => void;

  private socket: PresenceSocket | null = null;
  /** Set by `close()` — every asynchronous continuation checks it so nothing reopens after teardown. */
  private disposed = false;

  private pendingCursor: { x: number; y: number } | null = null;
  private throttleHandle: unknown;
  private sweepHandle: unknown;
  private reconnectHandle: unknown;
  private lastPointerMoveAt = 0;
  private localStatus: 'active' | 'idle' = 'active';
  private retryAttempt = 0;
  private everConnected = false;

  constructor(options: PresenceClientOptions) {
    this.diagramId = options.diagramId;
    this.selfUserId = options.selfUserId;
    this.store = options.store;
    // `fetch` must be invoked with `window` as its receiver in real browsers —
    // bind it once here, same as `DiagramSyncClient`.
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.WebSocketImpl = options.WebSocketImpl ?? defaultWebSocketImpl();
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutImpl = options.setTimeoutImpl ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? ((handle) => clearTimeout(handle as number));
    this.onReconnected = options.onReconnected;
  }

  /** LIVE-06: mints a ticket and opens the socket. */
  connect(): void {
    if (this.disposed) return;
    this.store.getState().setConnection('connecting');
    void this.openSocket();
  }

  /** LIVE-08: closes the socket, stops every timer, and blocks any later reopen. */
  close(): void {
    this.disposed = true;
    this.stopTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.store.getState().setConnection('disconnected');
    this.store.getState().clearRemotes();
  }

  /**
   * LIVE-09: the local pointer position. Trailing-throttled — repeated calls
   * inside one window collapse into a single message carrying the most recent
   * position, never the first one.
   */
  sendCursor(cursor: { x: number; y: number }): void {
    if (this.disposed) return;
    this.pendingCursor = cursor;
    this.lastPointerMoveAt = this.now();
    this.localStatus = 'active';
    if (this.throttleHandle !== undefined) return;
    this.throttleHandle = this.setTimeoutImpl(() => {
      this.throttleHandle = undefined;
      const pending = this.pendingCursor;
      this.pendingCursor = null;
      if (pending) this.publish({ cursor: pending, status: 'active' });
    }, CURSOR_THROTTLE_MS);
  }

  /** LIVE-10: selection changes are rare and meaningful — sent immediately, never throttled. */
  sendSelection(selection: readonly string[]): void {
    if (this.disposed) return;
    this.publish({ selection: [...selection], status: this.localStatus });
  }

  private stopTimers(): void {
    if (this.throttleHandle !== undefined) {
      this.clearTimeoutImpl(this.throttleHandle);
      this.throttleHandle = undefined;
    }
    if (this.sweepHandle !== undefined) {
      this.clearTimeoutImpl(this.sweepHandle);
      this.sweepHandle = undefined;
    }
    if (this.reconnectHandle !== undefined) {
      this.clearTimeoutImpl(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
    this.pendingCursor = null;
  }

  /**
   * LIVE-19: rescheduled with the same capped exponential backoff
   * `DiagramSyncClient` uses. Every attempt goes through `openSocket`, which
   * mints a FRESH ticket — the server's are single-use, so reusing one would
   * be rejected before the upgrade.
   */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectHandle !== undefined) return;
    const delay = reconnectDelayMs(this.retryAttempt);
    this.retryAttempt += 1;
    this.reconnectHandle = this.setTimeoutImpl(() => {
      this.reconnectHandle = undefined;
      if (this.disposed) return;
      this.store.getState().setConnection('connecting');
      void this.openSocket();
    }, delay);
  }

  private scheduleSweep(): void {
    if (this.disposed || this.sweepHandle !== undefined) return;
    this.sweepHandle = this.setTimeoutImpl(() => {
      this.sweepHandle = undefined;
      this.sweep();
      this.scheduleSweep();
    }, SWEEP_INTERVAL_MS);
  }

  private sweep(): void {
    if (this.disposed) return;
    const nowMs = this.now();

    // LIVE-12: announce idleness exactly once per stretch of inactivity.
    if (this.localStatus === 'active' && nowMs - this.lastPointerMoveAt >= IDLE_AFTER_MS) {
      this.localStatus = 'idle';
      this.publish({ status: 'idle' });
    }

    // A peer whose tab closed never sends `idle`; without this its cursor would
    // sit on the canvas forever.
    this.store.getState().pruneRemotes(nowMs - STALE_REMOTE_AFTER_MS);
  }

  /** LIVE-11: nothing leaves this client unless the socket is genuinely open. */
  private publish(payload: {
    cursor?: { x: number; y: number };
    selection?: string[];
    status: 'active' | 'idle';
  }): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(
      JSON.stringify({
        protocolVersion: WS_PROTOCOL_VERSION,
        diagramId: this.diagramId,
        messageId: crypto.randomUUID(),
        sentAt: new Date(this.now()).toISOString(),
        type: 'presence',
        payload,
      }),
    );
  }

  private async openSocket(): Promise<void> {
    if (this.disposed) return;

    let ticket: string;
    try {
      const response = await this.fetchImpl(`/diagrams/${this.diagramId}/ws-ticket`, {
        method: 'POST',
      });
      if (!response.ok) {
        // LIVE-07: no socket is opened at all when the ticket cannot be minted.
        this.markDisconnected();
        return;
      }
      ticket = ((await response.json()) as { ticket: string }).ticket;
    } catch {
      this.markDisconnected();
      return;
    }

    if (this.disposed) return;

    const SocketImpl = this.WebSocketImpl;
    if (!SocketImpl) {
      // No WebSocket in this environment: the editor keeps working, just
      // without presence. Never a thrown error on the render path.
      this.markDisconnected();
      return;
    }

    const socket = new SocketImpl(socketUrl(this.diagramId, ticket));
    this.socket = socket;

    socket.onopen = () => {
      if (this.disposed) return;
      this.store.getState().setConnection('connected');
      this.retryAttempt = 0;
      this.lastPointerMoveAt = this.now();
      this.localStatus = 'active';
      this.scheduleSweep();
      // LIVE-20: only a RE-connection triggers catch-up. The first open follows
      // the editor's own bootstrap, which already loaded the current scene.
      if (this.everConnected) this.onReconnected?.();
      this.everConnected = true;
    };

    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.markDisconnected(event?.code);
    };

    socket.onerror = () => {
      // A socket error is always followed by a close event, which is where the
      // disconnect is handled — nothing to do here beyond not throwing.
    };
  }

  private markDisconnected(code?: number): void {
    if (this.disposed) return;
    this.stopTimers();
    this.store.getState().setConnection('disconnected');
    // LIVE-23: a disconnected client shows no remote cursors — every one of
    // them is now stale by definition.
    this.store.getState().clearRemotes();
    if (code !== undefined && NON_RETRYABLE_CLOSE_CODES.includes(code)) return;
    this.scheduleReconnect();
  }

  private handleMessage(data: unknown): void {
    if (this.disposed) return;
    if (typeof data !== 'string') return;

    let message: ReturnType<typeof parseWsMessage>;
    try {
      message = parseWsMessage(data);
    } catch {
      // Malformed frame: dropped silently, exactly like the server does for an
      // inbound one. Never tears down an otherwise-healthy connection.
      return;
    }

    if (message.type !== 'presence') return;

    const { senderId, displayName, cursor, selection, status } = message.payload;
    // LIVE-16: without an identity there is no cursor to attribute — the
    // message is unusable, not a partial update.
    if (!senderId) return;
    // LIVE-17: the server already filters self-echo; this is the client-side
    // half of the same guarantee, and it also covers the same account open in
    // a second tab.
    if (senderId === this.selfUserId) return;

    // LIVE-18: idle means "stop drawing this cursor", not "move it to null".
    if (status === 'idle') {
      this.store.getState().dropRemote(senderId);
      return;
    }

    this.store.getState().upsertRemote({
      senderId,
      displayName: displayName ?? '',
      cursor: cursor ?? null,
      selection: selection ?? [],
      lastSeenAt: this.now(),
    });
  }
}
