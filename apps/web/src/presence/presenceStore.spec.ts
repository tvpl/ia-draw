import { describe, expect, it } from 'vitest';
import {
  CONNECTION_PHASES,
  type ConnectionPhase,
  createPresenceStore,
  presenceStatusTranslationKey,
  type RemotePresence,
} from './presenceStore.js';

function remote(senderId: string, lastSeenAt: number): RemotePresence {
  return {
    senderId,
    displayName: `Name ${senderId}`,
    cursor: { x: 1, y: 2 },
    selection: [],
    lastSeenAt,
  };
}

describe('presenceStore (T5, LIVE-18/23/24)', () => {
  it('starts in the connecting phase with no remotes', () => {
    const store = createPresenceStore();
    expect(store.getState().connection).toBe('connecting');
    expect(store.getState().remotes).toEqual({});
  });

  it('setConnection reaches every one of the three phases (LIVE-24)', () => {
    const store = createPresenceStore();
    for (const phase of CONNECTION_PHASES) {
      store.getState().setConnection(phase);
      expect(store.getState().connection).toBe(phase);
    }
  });

  it('presenceStatusTranslationKey maps each phase to its presence.status.* key (LIVE-24)', () => {
    const expected: Record<ConnectionPhase, string> = {
      connecting: 'presence.status.connecting',
      connected: 'presence.status.connected',
      disconnected: 'presence.status.disconnected',
    };
    for (const phase of CONNECTION_PHASES) {
      expect(presenceStatusTranslationKey(phase)).toBe(expected[phase]);
    }
  });

  it('upsertRemote adds a new remote and replaces an existing one by senderId', () => {
    const store = createPresenceStore();
    store.getState().upsertRemote(remote('a', 100));
    expect(store.getState().remotes.a?.lastSeenAt).toBe(100);

    store.getState().upsertRemote({ ...remote('a', 200), cursor: { x: 9, y: 9 } });
    expect(Object.keys(store.getState().remotes)).toEqual(['a']);
    expect(store.getState().remotes.a?.cursor).toEqual({ x: 9, y: 9 });
    expect(store.getState().remotes.a?.lastSeenAt).toBe(200);
  });

  it('dropRemote removes only the named remote (LIVE-18)', () => {
    const store = createPresenceStore();
    store.getState().upsertRemote(remote('a', 100));
    store.getState().upsertRemote(remote('b', 100));

    store.getState().dropRemote('a');
    expect(Object.keys(store.getState().remotes)).toEqual(['b']);

    // Dropping an unknown id is a no-op, not a crash.
    store.getState().dropRemote('nobody');
    expect(Object.keys(store.getState().remotes)).toEqual(['b']);
  });

  it('pruneRemotes removes only entries strictly older than the cutoff', () => {
    const store = createPresenceStore();
    store.getState().upsertRemote(remote('old', 100));
    store.getState().upsertRemote(remote('exactly', 200));
    store.getState().upsertRemote(remote('fresh', 300));

    store.getState().pruneRemotes(200);
    expect(Object.keys(store.getState().remotes).sort()).toEqual(['exactly', 'fresh']);
  });

  it('clearRemotes empties the map while leaving the connection phase alone (LIVE-23)', () => {
    const store = createPresenceStore();
    store.getState().setConnection('disconnected');
    store.getState().upsertRemote(remote('a', 100));

    store.getState().clearRemotes();
    expect(store.getState().remotes).toEqual({});
    expect(store.getState().connection).toBe('disconnected');
  });
});
