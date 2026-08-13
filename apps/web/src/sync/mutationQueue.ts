import type { ElementDelta } from '@arch-canvas/editor-adapter';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

/** EDT-02: debounce window is 500-1000ms; anything passed outside that range is clamped into it. */
export const MIN_DEBOUNCE_MS = 500;
export const MAX_DEBOUNCE_MS = 1000;
export const DEFAULT_DEBOUNCE_MS = 750;

export interface MutationBatch {
  clientMutationId: string;
  baseRevision: number;
  deltas: ElementDelta[];
}

export interface MutationQueueOptions {
  /** Called once a batch is ready to send — after the debounce elapses, or a forced flush. Never called for an empty queue. */
  onFlush: (batch: MutationBatch) => void;
  /** Debounce window in ms; clamped to [MIN_DEBOUNCE_MS, MAX_DEBOUNCE_MS]. Defaults to DEFAULT_DEBOUNCE_MS. */
  debounceMs?: number;
  /** Injectable clientMutationId generator — defaults to crypto.randomUUID(), overridden in tests for determinism. */
  generateId?: () => string;
}

export interface MutationQueueState {
  /** Deltas since the last flush, keyed by elementId (last write per element wins the slot — the server still sees every version via `version`/`versionNonce` on the winning delta). */
  pendingByElementId: Map<string, ElementDelta>;
  /** Last revision this client knows about — carried on every flushed batch as `baseRevision`. */
  baseRevision: number;
  /** `pendingByElementId.size`, kept as its own field so React consumers can select just the count (e.g. for the "Offline — N alterações pendentes" status) without re-rendering on every delta's content. */
  pendingCount: number;
  enqueue: (deltas: ElementDelta[]) => void;
  setBaseRevision: (revision: number) => void;
  /** Forces an immediate flush of whatever is pending, bypassing the debounce timer. No-op if the queue is empty. */
  flush: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Creates one local mutation queue instance (Zustand store — apps/web's only use of
 * Zustand, per design.md Tech Decisions: TanStack Query owns server state, Zustand is
 * for ephemeral client state like this queue). The queue is cache/fila only — it is
 * never read as the source of truth for the scene; it only exists to batch and debounce
 * outgoing deltas before they reach the server (EDT-02).
 */
export function createMutationQueue(
  options: MutationQueueOptions,
): UseBoundStore<StoreApi<MutationQueueState>> {
  const debounceMs = clamp(
    options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    MIN_DEBOUNCE_MS,
    MAX_DEBOUNCE_MS,
  );
  const generateId = options.generateId ?? (() => crypto.randomUUID());

  // The debounce timer is deliberately NOT store state — it's an implementation detail
  // with no UI consumer, and Zustand state is meant to be read/rendered, not mutated as
  // a side-effect handle.
  let timer: ReturnType<typeof setTimeout> | null = null;

  const store = create<MutationQueueState>((set, get) => ({
    pendingByElementId: new Map(),
    baseRevision: 0,
    pendingCount: 0,

    setBaseRevision: (revision) => set({ baseRevision: revision }),

    enqueue: (deltas) => {
      if (deltas.length === 0) return;

      set((state) => {
        const next = new Map(state.pendingByElementId);
        for (const delta of deltas) next.set(delta.elementId, delta);
        return { pendingByElementId: next, pendingCount: next.size };
      });

      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        get().flush();
      }, debounceMs);
    },

    flush: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      const { pendingByElementId, baseRevision } = get();
      if (pendingByElementId.size === 0) return;

      const batch: MutationBatch = {
        clientMutationId: generateId(),
        baseRevision,
        deltas: Array.from(pendingByElementId.values()),
      };

      set({ pendingByElementId: new Map(), pendingCount: 0 });
      options.onFlush(batch);
    },
  }));

  return store;
}

/**
 * Wires forced-flush triggers for a queue: `visibilitychange` (tab hidden) and
 * `pagehide` (navigating away/closing) — the two browser events EDT-02 requires to
 * flush immediately even mid-debounce. Returns a cleanup function that removes both
 * listeners (call it, e.g., from the mounting component's effect cleanup — the same
 * moment internal router navigation away from the editor route unmounts it).
 */
export function wireForcedFlush(
  store: UseBoundStore<StoreApi<MutationQueueState>>,
  target: {
    addEventListener: typeof window.addEventListener;
    removeEventListener: typeof window.removeEventListener;
  } = window,
  doc: {
    addEventListener: typeof document.addEventListener;
    removeEventListener: typeof document.removeEventListener;
    visibilityState: DocumentVisibilityState;
  } = document,
): () => void {
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') store.getState().flush();
  };
  const onPageHide = () => store.getState().flush();

  doc.addEventListener('visibilitychange', onVisibilityChange);
  target.addEventListener('pagehide', onPageHide);

  return () => {
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    target.removeEventListener('pagehide', onPageHide);
  };
}
