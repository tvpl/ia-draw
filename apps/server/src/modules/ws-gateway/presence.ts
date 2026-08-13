/**
 * Presence/cursor broadcast contract (AD-009, T73/T74). `ws-gateway` never
 * writes presence data to Postgres — publishing and subscribing are the
 * ONLY operations a `PresenceBroadcaster` exposes, and neither this file
 * nor `redisPresence.ts` (T74) imports `Db`/drizzle at all, which is the
 * structural guarantee behind CLB-04 ("losing presence never risks durable
 * content").
 */
import { EventEmitter } from 'node:events';
export interface PresenceEvent extends Record<string, unknown> {
  /** Freeform application event name, e.g. `'presence_update'` / `'mutation_broadcast'` — never a `WsMessageType` 1:1 (a single WS `presence`/`mutation` message can fan out to any shape of broadcast event this module chooses). */
  type: string;
}

export interface PresenceBroadcaster {
  /** Publishes `event` to every current subscriber of `diagramId` — never persisted anywhere, best-effort. */
  publish(diagramId: string, event: PresenceEvent): Promise<void>;
  /** Registers `handler` for every event published on `diagramId`; returns an unsubscribe function. */
  subscribe(diagramId: string, handler: (event: PresenceEvent) => void): () => void;
}

/**
 * A no-op stand-in used only where a real `PresenceBroadcaster` isn't
 * wired yet (T73's own tests, before T74 adds `InMemoryPresenceBroadcaster`
 * below). `publish` resolves immediately without doing anything;
 * `subscribe` never calls its handler. Never used in production wiring —
 * `registerModules.ts` (T81) always injects a real broadcaster.
 */
export class NullPresenceBroadcaster implements PresenceBroadcaster {
  async publish(): Promise<void> {
    // Intentionally does nothing.
  }

  subscribe(): () => void {
    return () => {
      // Intentionally does nothing.
    };
  }
}

/**
 * (T74) `EventEmitter`-based `PresenceBroadcaster`, scoped to a single Node
 * process — the AD-009 default. Requires zero external service, so
 * `ws-gateway` (and the whole server, per AD-003's single-process MVP) works
 * completely standalone with no `REDIS_URL`-equivalent config supplied.
 * `diagramId` doubles as the emitter's event name; there's no cross-process
 * fan-out (that's `RedisPresenceBroadcaster`'s job, `redisPresence.ts`).
 */
export class InMemoryPresenceBroadcaster implements PresenceBroadcaster {
  private readonly emitter = new EventEmitter();

  constructor() {
    // A busy diagram can have far more than Node's default 10-listener cap
    // (one subscriber per connected WS client, all on the same `diagramId`
    // event name) — uncapped here on purpose, this is not a leak signal for
    // this particular emitter.
    this.emitter.setMaxListeners(0);
  }

  async publish(diagramId: string, event: PresenceEvent): Promise<void> {
    this.emitter.emit(diagramId, event);
  }

  subscribe(diagramId: string, handler: (event: PresenceEvent) => void): () => void {
    this.emitter.on(diagramId, handler);
    return () => {
      this.emitter.off(diagramId, handler);
    };
  }
}
