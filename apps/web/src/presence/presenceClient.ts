import { parseWsMessage } from '@arch-canvas/shared-contracts';
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

  private socket: PresenceSocket | null = null;
  /** Set by `close()` — every asynchronous continuation checks it so nothing reopens after teardown. */
  private disposed = false;

  constructor(options: PresenceClientOptions) {
    this.diagramId = options.diagramId;
    this.selfUserId = options.selfUserId;
    this.store = options.store;
    // `fetch` must be invoked with `window` as its receiver in real browsers —
    // bind it once here, same as `DiagramSyncClient`.
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.WebSocketImpl = options.WebSocketImpl ?? defaultWebSocketImpl();
    this.now = options.now ?? (() => Date.now());
  }

  /** LIVE-06: mints a ticket and opens the socket. */
  connect(): void {
    if (this.disposed) return;
    this.store.getState().setConnection('connecting');
    void this.openSocket();
  }

  /** LIVE-08: closes the socket and blocks any later reopen. */
  close(): void {
    this.disposed = true;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.store.getState().setConnection('disconnected');
    this.store.getState().clearRemotes();
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
    };

    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.markDisconnected();
    };

    socket.onerror = () => {
      // A socket error is always followed by a close event, which is where the
      // disconnect is handled — nothing to do here beyond not throwing.
    };
  }

  private markDisconnected(): void {
    if (this.disposed) return;
    this.store.getState().setConnection('disconnected');
    // LIVE-23: a disconnected client shows no remote cursors — every one of
    // them is now stale by definition.
    this.store.getState().clearRemotes();
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
