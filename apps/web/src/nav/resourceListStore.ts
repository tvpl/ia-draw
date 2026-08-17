import { create, type StoreApi, type UseBoundStore } from 'zustand';

/**
 * Generic list state (design.md's `resourceListStore.ts`) — one store factory shared by the
 * workspace, project, and diagram list pages instead of three near-identical stores. Molded on
 * `createSaveStatusStore` (`apps/web/src/sync/saveStatus.ts`): a factory returning a fresh
 * Zustand store instance per page/list.
 */
export type ResourceListStatus = 'loading' | 'ready' | 'error';

export interface ResourceListState<T extends { id: string }> {
  items: T[];
  status: ResourceListStatus;
  /** Replaces the whole list and lands the store in `ready` — the outcome of a successful list fetch. */
  setItems: (items: T[]) => void;
  /** Lands the store in `error`, leaving whatever items were already loaded untouched. */
  setError: () => void;
  /** Appends a newly created item to the end of the list. */
  addItem: (item: T) => void;
  /** Removes the item with this id — the outcome of a successful archive. */
  removeItem: (id: string) => void;
  /** Replaces the item with this id in place — the outcome of a successful rename. */
  replaceItem: (id: string, item: T) => void;
}

/** Creates one resource-list store instance, initially `loading` (the first fetch is in flight until it resolves). */
export function createResourceListStore<T extends { id: string }>(): UseBoundStore<
  StoreApi<ResourceListState<T>>
> {
  return create<ResourceListState<T>>((set) => ({
    items: [],
    status: 'loading',
    setItems: (items) => set({ items, status: 'ready' }),
    setError: () => set({ status: 'error' }),
    addItem: (item) => set((state) => ({ items: [...state.items, item] })),
    removeItem: (id) => set((state) => ({ items: state.items.filter((it) => it.id !== id) })),
    replaceItem: (id, item) =>
      set((state) => ({ items: state.items.map((it) => (it.id === id ? item : it)) })),
  }));
}
