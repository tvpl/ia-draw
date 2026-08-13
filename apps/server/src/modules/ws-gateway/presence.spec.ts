import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryPresenceBroadcaster,
  NullPresenceBroadcaster,
  type PresenceBroadcaster,
  type PresenceEvent,
} from './presence.js';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

describe('presence.ts / redisPresence.ts never touch Postgres (AD-009, CLB-04)', () => {
  // Structural guarantee, enforced by code rather than trusted from a comment: presence
  // is never persisted anywhere, and the only way to be sure that stays true as the
  // module evolves is to grep the actual source text for a `Db`/drizzle import, same
  // check T71's own status note promises is "confirmable by reading the code" — this
  // makes that confirmation automated instead of manual.
  it.each(['presence.ts', 'redisPresence.ts'])(
    '%s imports nothing from drizzle-orm and no local Db type',
    (filename) => {
      const source = readFileSync(`${THIS_DIR}/${filename}`, 'utf8');
      const importLines = source
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line))
        .join('\n');

      expect(importLines).not.toMatch(/drizzle-orm/);
      expect(importLines).not.toMatch(/\bDb\b/);
      expect(importLines).not.toMatch(/\/auth\/db(\.js)?['"]/);
    },
  );
});

describe('NullPresenceBroadcaster (T73)', () => {
  it('publish resolves without doing anything observable', async () => {
    // Typed as the interface, not the concrete class: `NullPresenceBroadcaster`'s own
    // `publish()`/`subscribe()` are deliberately declared with zero parameters (it
    // ignores whatever it's given), which is a valid structural implementation of
    // `PresenceBroadcaster` but not directly callable with arguments on its own narrower
    // type — exactly how `routes.ts` consumes it (`deps.presence: PresenceBroadcaster`).
    const broadcaster: PresenceBroadcaster = new NullPresenceBroadcaster();
    await expect(
      broadcaster.publish('diagram-1', { type: 'presence_update' }),
    ).resolves.toBeUndefined();
  });

  it('subscribe never invokes its handler', async () => {
    const broadcaster: PresenceBroadcaster = new NullPresenceBroadcaster();
    const handler = vi.fn<(event: PresenceEvent) => void>();
    const unsubscribe = broadcaster.subscribe('diagram-1', handler);

    await broadcaster.publish('diagram-1', { type: 'presence_update' });

    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('InMemoryPresenceBroadcaster basic wiring (T74)', () => {
  it('a same-process publish on a diagramId is delivered synchronously to its subscriber', async () => {
    const broadcaster = new InMemoryPresenceBroadcaster();
    const received: PresenceEvent[] = [];
    const unsubscribe = broadcaster.subscribe('diagram-a', (event) => received.push(event));

    await broadcaster.publish('diagram-a', { type: 'presence_update', cursor: { x: 1, y: 2 } });

    expect(received).toEqual([{ type: 'presence_update', cursor: { x: 1, y: 2 } }]);
    unsubscribe();
  });

  it('unsubscribe stops further delivery to that handler only', async () => {
    const broadcaster = new InMemoryPresenceBroadcaster();
    const handlerA = vi.fn<(event: PresenceEvent) => void>();
    const handlerB = vi.fn<(event: PresenceEvent) => void>();
    const unsubscribeA = broadcaster.subscribe('diagram-a', handlerA);
    broadcaster.subscribe('diagram-a', handlerB);

    await broadcaster.publish('diagram-a', { type: 'presence_update' });
    unsubscribeA();
    await broadcaster.publish('diagram-a', { type: 'presence_update' });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(2);
  });
});
