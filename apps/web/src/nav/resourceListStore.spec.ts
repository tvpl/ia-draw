import { describe, expect, it } from 'vitest';
import { createResourceListStore } from './resourceListStore.js';

interface Item {
  id: string;
  name: string;
}

describe('createResourceListStore', () => {
  it('starts in "loading" with an empty item list', () => {
    const store = createResourceListStore<Item>();
    expect(store.getState().status).toBe('loading');
    expect(store.getState().items).toEqual([]);
  });

  it('setItems replaces the list and moves status to "ready"', () => {
    const store = createResourceListStore<Item>();
    const items = [
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ];

    store.getState().setItems(items);

    expect(store.getState().status).toBe('ready');
    expect(store.getState().items).toEqual(items);
  });

  it('setError moves status to "error" without touching already-loaded items', () => {
    const store = createResourceListStore<Item>();
    const items = [{ id: '1', name: 'a' }];
    store.getState().setItems(items);

    store.getState().setError();

    expect(store.getState().status).toBe('error');
    expect(store.getState().items).toEqual(items);
  });

  it('addItem appends a new item to the end of the list', () => {
    const store = createResourceListStore<Item>();
    store.getState().setItems([{ id: '1', name: 'a' }]);

    store.getState().addItem({ id: '2', name: 'b' });

    expect(store.getState().items).toEqual([
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ]);
  });

  it('removeItem drops only the item with the matching id', () => {
    const store = createResourceListStore<Item>();
    store.getState().setItems([
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ]);

    store.getState().removeItem('1');

    expect(store.getState().items).toEqual([{ id: '2', name: 'b' }]);
  });

  it('removeItem is a no-op when the id is not present', () => {
    const store = createResourceListStore<Item>();
    const items = [{ id: '1', name: 'a' }];
    store.getState().setItems(items);

    store.getState().removeItem('missing');

    expect(store.getState().items).toEqual(items);
  });

  it('replaceItem swaps the item with the matching id in place, leaving others unchanged', () => {
    const store = createResourceListStore<Item>();
    store.getState().setItems([
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ]);

    store.getState().replaceItem('1', { id: '1', name: 'renamed' });

    expect(store.getState().items).toEqual([
      { id: '1', name: 'renamed' },
      { id: '2', name: 'b' },
    ]);
  });
});
