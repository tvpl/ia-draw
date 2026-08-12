import { describe, expect, it } from 'vitest';
import { createSaveStatusStore, SAVE_STATUS_KINDS, type SaveStatusKind } from './saveStatus.js';

describe('createSaveStatusStore (T25, EDT-05)', () => {
  it('starts in "saving" (bootstrap in flight)', () => {
    const store = createSaveStatusStore();
    expect(store.getState().kind).toBe('saving');
    expect(store.getState().pendingCount).toBe(0);
  });

  it('exposes exactly the 5 defined kinds — never any other value (exhaustive state machine test)', () => {
    expect(SAVE_STATUS_KINDS).toEqual(['saved', 'saving', 'offline', 'conflict', 'readOnly']);

    const store = createSaveStatusStore();
    const setters: Array<[() => void, SaveStatusKind]> = [
      [store.getState().setSaved, 'saved'],
      [store.getState().setSaving, 'saving'],
      [() => store.getState().setOffline(3), 'offline'],
      [store.getState().setConflict, 'conflict'],
      [store.getState().setReadOnly, 'readOnly'],
    ];

    for (const [act, expectedKind] of setters) {
      act();
      const { kind } = store.getState();
      expect(SAVE_STATUS_KINDS).toContain(kind);
      expect(kind).toBe(expectedKind);
    }
  });

  it('setOffline carries the correct pending count', () => {
    const store = createSaveStatusStore();
    store.getState().setOffline(5);
    expect(store.getState()).toMatchObject({ kind: 'offline', pendingCount: 5 });
  });

  it('transitioning to saved/saving/conflict/readOnly always resets pendingCount to 0', () => {
    const store = createSaveStatusStore();
    store.getState().setOffline(9);

    store.getState().setSaved();
    expect(store.getState().pendingCount).toBe(0);

    store.getState().setOffline(9);
    store.getState().setConflict();
    expect(store.getState().pendingCount).toBe(0);
  });
});
