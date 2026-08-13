/**
 * Redis pub/sub `PresenceBroadcaster` (AD-009, T74) — opt-in, cross-process
 * fan-out for presence/cursor events. Never persisted anywhere: `publish`/
 * `subscribe` are the only two operations this file performs against Redis
 * (`PUBLISH`/`SUBSCRIBE`), and this file imports NOTHING from `Db`/drizzle —
 * the same structural CLB-04 guarantee `presence.ts` documents, confirmable
 * by grep alone.
 *
 * Channel-per-diagram (`presence:{diagramId}`), not a single shared channel
 * filtered by a `diagramId` field in the payload — the simpler of the two
 * options the task spec allows: it pushes the "does this event belong to my
 * diagram" filtering down to Redis's own `SUBSCRIBE`/`PUBLISH` routing
 * instead of re-implementing it in application code on every message this
 * process receives for every diagram anyone is subscribed to.
 *
 * ioredis (researched against the installed 6.0.0 README/`Redis.d.ts`
 * before writing this, per the Knowledge Verification Chain — never
 * guessed): a connection that has issued `SUBSCRIBE`/`PSUBSCRIBE` enters
 * "subscriber mode" and can no longer run ordinary commands (`PUBLISH`
 * included), so pub/sub requires two separate `Redis` clients — one
 * dedicated publisher, one dedicated subscriber. The subscriber client
 * fires a single process-wide `'message'` event, `(channel, rawMessage)`,
 * for every channel it's subscribed to — this class multiplexes that one
 * event back out to per-`diagramId` local listeners via an internal
 * `EventEmitter`, mirroring `InMemoryPresenceBroadcaster`'s own shape for
 * the last mile once a message has actually arrived from Redis.
 */
import { EventEmitter } from 'node:events';
import { Redis, type RedisOptions } from 'ioredis';
import type { PresenceBroadcaster, PresenceEvent } from './presence.js';

const CHANNEL_PREFIX = 'presence:';

function channelFor(diagramId: string): string {
  return `${CHANNEL_PREFIX}${diagramId}`;
}

function diagramIdFromChannel(channel: string): string | undefined {
  return channel.startsWith(CHANNEL_PREFIX) ? channel.slice(CHANNEL_PREFIX.length) : undefined;
}

export class RedisPresenceBroadcaster implements PresenceBroadcaster {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly localEmitter = new EventEmitter();
  private readonly subscribedChannels = new Set<string>();

  /**
   * `redisUrl` is a full `redis://[[user]:password@]host[:port][/db]` URL —
   * the same "one config string" shape as the `REDIS_URL`-equivalent config
   * T81 (a later batch) wires through `registerModules.ts`. Two independent
   * `ioredis` clients are opened eagerly (publisher + subscriber) — ioredis
   * itself lazy-connects on first command/`subscribe()` call, so this
   * constructor never blocks on network I/O.
   */
  constructor(redisUrl: string, options: RedisOptions = {}) {
    this.publisher = new Redis(redisUrl, options);
    this.subscriber = new Redis(redisUrl, options);
    this.localEmitter.setMaxListeners(0);

    this.subscriber.on('message', (channel: string, raw: string) => {
      const diagramId = diagramIdFromChannel(channel);
      if (!diagramId) return; // Not one of ours — ignore rather than throw.

      let event: PresenceEvent;
      try {
        event = JSON.parse(raw) as PresenceEvent;
      } catch {
        // Malformed payload from a misbehaving publisher — presence is
        // best-effort (AD-009), drop it rather than crash the process.
        return;
      }
      this.localEmitter.emit(diagramId, event);
    });
  }

  async publish(diagramId: string, event: PresenceEvent): Promise<void> {
    await this.publisher.publish(channelFor(diagramId), JSON.stringify(event));
  }

  subscribe(diagramId: string, handler: (event: PresenceEvent) => void): () => void {
    this.localEmitter.on(diagramId, handler);

    const channel = channelFor(diagramId);
    if (!this.subscribedChannels.has(channel)) {
      this.subscribedChannels.add(channel);
      // Fire-and-forget: ioredis queues SUBSCRIBE until the connection is
      // ready and resolves once the server confirms it. `subscribe()` here
      // must stay synchronous (the `PresenceBroadcaster` interface returns
      // an unsubscribe function, not a promise) — a caller that needs to
      // know the subscription has actually landed server-side (e.g. a test
      // publishing immediately after subscribing) must poll/retry, exactly
      // like any other eventually-consistent network subscription.
      void this.subscriber.subscribe(channel);
    }

    return () => {
      this.localEmitter.off(diagramId, handler);
      if (
        this.localEmitter.listenerCount(diagramId) === 0 &&
        this.subscribedChannels.has(channel)
      ) {
        this.subscribedChannels.delete(channel);
        void this.subscriber.unsubscribe(channel);
      }
    };
  }

  /** Not part of `PresenceBroadcaster` — closes both underlying connections. Tests/graceful shutdown only. */
  async close(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}
