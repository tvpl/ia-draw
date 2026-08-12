import type { ElementDelta } from '@arch-canvas/editor-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMutationQueue,
  DEFAULT_DEBOUNCE_MS,
  MAX_DEBOUNCE_MS,
  MIN_DEBOUNCE_MS,
  type MutationBatch,
  wireForcedFlush,
} from './mutationQueue.js';

function delta(elementId: string, version = 1): ElementDelta {
  return { elementId, kind: 'upsert', version, versionNonce: version, element: undefined };
}

describe('createMutationQueue (T24, EDT-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('an edit enqueues a mutation that flushes with correct clientMutationId/baseRevision/deltas', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({
      onFlush: (batch) => flushed.push(batch),
      generateId: () => 'fixed-id-1',
    });
    store.getState().setBaseRevision(7);

    store.getState().enqueue([delta('el-1')]);
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);

    expect(flushed).toEqual([
      { clientMutationId: 'fixed-id-1', baseRevision: 7, deltas: [delta('el-1')] },
    ]);
  });

  it('groups rapid successive edits into a single batch within the debounce window', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({
      onFlush: (batch) => flushed.push(batch),
      generateId: () => 'batch-id',
    });

    store.getState().enqueue([delta('el-1')]);
    vi.advanceTimersByTime(200);
    store.getState().enqueue([delta('el-2')]);
    vi.advanceTimersByTime(200);
    store.getState().enqueue([delta('el-3')]);

    // Not yet flushed — still inside the (restarted) debounce window.
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.deltas.map((d) => d.elementId).sort()).toEqual(['el-1', 'el-2', 'el-3']);
  });

  it('clamps a debounceMs below MIN_DEBOUNCE_MS up to MIN_DEBOUNCE_MS', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({ onFlush: (batch) => flushed.push(batch), debounceMs: 10 });

    store.getState().enqueue([delta('el-1')]);
    vi.advanceTimersByTime(MIN_DEBOUNCE_MS - 1);
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(flushed).toHaveLength(1);
  });

  it('clamps a debounceMs above MAX_DEBOUNCE_MS down to MAX_DEBOUNCE_MS', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({
      onFlush: (batch) => flushed.push(batch),
      debounceMs: 5000,
    });

    store.getState().enqueue([delta('el-1')]);
    vi.advanceTimersByTime(MAX_DEBOUNCE_MS - 1);
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(flushed).toHaveLength(1);
  });

  it('a later delta for the same elementId replaces the earlier one in the same batch', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({ onFlush: (batch) => flushed.push(batch) });

    store.getState().enqueue([delta('el-1', 1)]);
    store.getState().enqueue([delta('el-1', 2)]);
    vi.advanceTimersByTime(DEFAULT_DEBOUNCE_MS);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.deltas).toEqual([delta('el-1', 2)]);
  });

  it('flush() is a no-op when the queue is empty (never calls onFlush)', () => {
    const onFlush = vi.fn();
    const store = createMutationQueue({ onFlush });

    store.getState().flush();

    expect(onFlush).not.toHaveBeenCalled();
  });

  it('pendingCount tracks the number of distinct pending elements', () => {
    const store = createMutationQueue({ onFlush: () => {} });

    store.getState().enqueue([delta('el-1'), delta('el-2')]);
    expect(store.getState().pendingCount).toBe(2);

    store.getState().flush();
    expect(store.getState().pendingCount).toBe(0);
  });
});

describe('wireForcedFlush (T24, EDT-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeTarget() {
    const listeners = new Map<string, Set<() => void>>();
    return {
      addEventListener: (type: string, listener: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(listener);
      },
      removeEventListener: (type: string, listener: () => void) => {
        listeners.get(type)?.delete(listener);
      },
      dispatch: (type: string) => {
        for (const listener of listeners.get(type) ?? []) listener();
      },
    };
  }

  it('visibilitychange forces an immediate flush mid-debounce when the tab becomes hidden', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({ onFlush: (batch) => flushed.push(batch) });
    const win = fakeTarget();
    const doc = { ...fakeTarget(), visibilityState: 'hidden' as DocumentVisibilityState };

    const unwire = wireForcedFlush(store, win as unknown as Window, doc as unknown as Document);

    store.getState().enqueue([delta('el-1')]);
    // Still well inside the debounce window — without the forced flush this would be 0.
    doc.dispatch('visibilitychange');

    expect(flushed).toHaveLength(1);
    unwire();
  });

  it('a visibilitychange while still visible does NOT force a flush', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({ onFlush: (batch) => flushed.push(batch) });
    const win = fakeTarget();
    const doc = { ...fakeTarget(), visibilityState: 'visible' as DocumentVisibilityState };

    const unwire = wireForcedFlush(store, win as unknown as Window, doc as unknown as Document);

    store.getState().enqueue([delta('el-1')]);
    doc.dispatch('visibilitychange');

    expect(flushed).toHaveLength(0);
    unwire();
  });

  it('pagehide forces an immediate flush mid-debounce', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({ onFlush: (batch) => flushed.push(batch) });
    const win = fakeTarget();
    const doc = { ...fakeTarget(), visibilityState: 'visible' as DocumentVisibilityState };

    const unwire = wireForcedFlush(store, win as unknown as Window, doc as unknown as Document);

    store.getState().enqueue([delta('el-1')]);
    win.dispatch('pagehide');

    expect(flushed).toHaveLength(1);
    unwire();
  });

  it('unwiring removes both listeners — a later event no longer forces a flush', () => {
    const flushed: MutationBatch[] = [];
    const store = createMutationQueue({ onFlush: (batch) => flushed.push(batch) });
    const win = fakeTarget();
    const doc = { ...fakeTarget(), visibilityState: 'hidden' as DocumentVisibilityState };

    const unwire = wireForcedFlush(store, win as unknown as Window, doc as unknown as Document);
    unwire();

    store.getState().enqueue([delta('el-1')]);
    doc.dispatch('visibilitychange');
    win.dispatch('pagehide');

    expect(flushed).toHaveLength(0);
  });
});
