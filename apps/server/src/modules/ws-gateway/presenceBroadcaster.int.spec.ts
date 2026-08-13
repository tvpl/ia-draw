/**
 * Shared contract test suite (T74) — parameterized over BOTH `PresenceBroadcaster`
 * implementations, proving the same positive/negative correctness bar for each:
 * publish on `diagramId` A is received by a subscriber of A, and NEVER received by a
 * subscriber of a different `diagramId` B. `RedisPresenceBroadcaster` runs against a
 * genuinely spawned `redis-server` process for this whole file — never mocked, per the
 * explicit AD-009 commitment to using the real thing. `InMemoryPresenceBroadcaster`
 * needs no such setup; it's included in the same `describe.each` table purely to keep
 * this ONE suite (not two near-duplicates), which is the point of the task.
 *
 * Redis subscription is asynchronous (SUBSCRIBE is a network round trip; a publish
 * issued before it lands server-side is simply never delivered — Redis pub/sub has no
 * backlog/replay). `publishUntilReceived` below retries the publish every 50ms until
 * the subscriber has observed at least one copy, tolerating that propagation delay
 * without hard-coding a guessed fixed wait; `InMemoryPresenceBroadcaster` always
 * satisfies it on the very first iteration since its `subscribe()` is synchronous.
 * Because of the retry, more than one identical copy can legitimately arrive over
 * Redis (a publish landing exactly as the subscription completes can race a retry);
 * the assertions below check "at least one, and every one is the expected event" for
 * that reason, never an exact delivery count.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryPresenceBroadcaster,
  type PresenceBroadcaster,
  type PresenceEvent,
} from './presence.js';
import { RedisPresenceBroadcaster } from './redisPresence.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishUntilReceived(
  broadcaster: PresenceBroadcaster,
  diagramId: string,
  event: PresenceEvent,
  isReceived: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isReceived()) {
    if (Date.now() > deadline) {
      throw new Error(`event was never received on diagramId ${diagramId} within ${timeoutMs}ms`);
    }
    await broadcaster.publish(diagramId, event);
    await sleep(50);
  }
}

function isRedisReady(port: number): boolean {
  try {
    const out = execFileSync('redis-cli', ['-p', String(port), 'ping'], {
      encoding: 'utf8',
      timeout: 1_000,
    });
    return out.trim() === 'PONG';
  } catch {
    return false;
  }
}

async function waitForRedisReady(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isRedisReady(port)) return;
    await sleep(100);
  }
  throw new Error(`redis-server on port ${port} did not answer PING within ${timeoutMs}ms`);
}

describe('PresenceBroadcaster contract (T74, CLB-01/04) — real redis-server, never mocked', () => {
  let redisProcess: ChildProcess;
  let redisPort: number;
  let redisUrl: string;

  beforeAll(async () => {
    // Wide + PID-jittered range to keep collisions unlikely against anything else
    // that might be listening in this sandbox.
    redisPort = 21_000 + ((process.pid + Math.floor(Math.random() * 9_000)) % 9_000);
    redisUrl = `redis://127.0.0.1:${redisPort}`;

    redisProcess = spawn(
      'redis-server',
      [
        '--port',
        String(redisPort),
        '--bind',
        '127.0.0.1',
        '--save',
        '',
        '--appendonly',
        'no',
        '--daemonize',
        'no',
      ],
      { stdio: 'ignore' },
    );

    await waitForRedisReady(redisPort);
  }, 20_000);

  afterAll(async () => {
    if (!redisProcess) return;
    await new Promise<void>((resolve) => {
      if (redisProcess.exitCode !== null) {
        resolve();
        return;
      }
      redisProcess.once('exit', () => resolve());
      redisProcess.kill('SIGTERM');
      setTimeout(resolve, 2_000);
    });
  }, 20_000);

  interface Harness {
    name: string;
    create(): PresenceBroadcaster;
    dispose(broadcaster: PresenceBroadcaster): Promise<void>;
  }

  const harnesses: Harness[] = [
    {
      name: 'InMemoryPresenceBroadcaster',
      create: () => new InMemoryPresenceBroadcaster(),
      dispose: async () => {
        // Zero external I/O — nothing to tear down.
      },
    },
    {
      name: 'RedisPresenceBroadcaster',
      create: () => new RedisPresenceBroadcaster(redisUrl),
      dispose: async (broadcaster) => {
        await (broadcaster as RedisPresenceBroadcaster).close();
      },
    },
  ];

  describe.each(harnesses)('$name', (harness) => {
    it('a subscriber of diagramId A receives what was published on A', async () => {
      const broadcaster = harness.create();
      try {
        const diagramIdA = `diagram-a-${randomUUID()}`;
        const received: PresenceEvent[] = [];
        const unsubscribe = broadcaster.subscribe(diagramIdA, (event) => received.push(event));

        const event: PresenceEvent = { type: 'presence_update', marker: randomUUID() };
        await publishUntilReceived(broadcaster, diagramIdA, event, () => received.length > 0);

        expect(received.length).toBeGreaterThan(0);
        for (const receivedEvent of received) expect(receivedEvent).toEqual(event);

        unsubscribe();
      } finally {
        await harness.dispose(broadcaster);
      }
    });

    it('a subscriber of a DIFFERENT diagramId B never receives what was published on A', async () => {
      const broadcaster = harness.create();
      try {
        const diagramIdA = `diagram-a-${randomUUID()}`;
        const diagramIdB = `diagram-b-${randomUUID()}`;

        const receivedOnA: PresenceEvent[] = [];
        const receivedOnB: PresenceEvent[] = [];
        broadcaster.subscribe(diagramIdA, (event) => receivedOnA.push(event));
        broadcaster.subscribe(diagramIdB, (event) => receivedOnB.push(event));

        const event: PresenceEvent = { type: 'presence_update', marker: randomUUID() };
        // Confirm the event genuinely round-trips through this broadcaster at all
        // (rules out "B never got it because publish/subscribe is broken entirely").
        await publishUntilReceived(broadcaster, diagramIdA, event, () => receivedOnA.length > 0);

        // Give a (hypothetical, incorrect) cross-diagram leak a fair chance to arrive.
        await sleep(300);

        expect(receivedOnB).toHaveLength(0);
      } finally {
        await harness.dispose(broadcaster);
      }
    });

    it('unsubscribe stops further delivery to that handler', async () => {
      const broadcaster = harness.create();
      try {
        const diagramId = `diagram-unsub-${randomUUID()}`;
        const received: PresenceEvent[] = [];
        const unsubscribe = broadcaster.subscribe(diagramId, (event) => received.push(event));

        const firstEvent: PresenceEvent = { type: 'presence_update', marker: 'first' };
        await publishUntilReceived(broadcaster, diagramId, firstEvent, () => received.length > 0);
        unsubscribe();

        const countAfterUnsubscribe = received.length;
        const secondEvent: PresenceEvent = { type: 'presence_update', marker: 'second' };
        // Nobody is listening anymore, so there is no "received" signal to poll for —
        // publish it a few times over a real wall-clock window and confirm the count
        // never moves, rather than a single check that could race delivery.
        for (let i = 0; i < 5; i += 1) {
          await broadcaster.publish(diagramId, secondEvent);
          await sleep(100);
        }

        expect(received).toHaveLength(countAfterUnsubscribe);
      } finally {
        await harness.dispose(broadcaster);
      }
    });
  });
});
