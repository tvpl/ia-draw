import { create, type StoreApi, type UseBoundStore } from 'zustand';

/**
 * LIVE-24: the realtime connection is exactly one of these three states.
 * Mirrors `saveStatus.ts`'s shape (kind union + translation-key helper +
 * `create*Store` factory), which is this app's established store convention.
 */
export type ConnectionPhase = 'connecting' | 'connected' | 'disconnected';

export const CONNECTION_PHASES: readonly ConnectionPhase[] = [
  'connecting',
  'connected',
  'disconnected',
];

/** i18next key for each phase — see the `presence` block in the locale translation.json files. */
export function presenceStatusTranslationKey(phase: ConnectionPhase): string {
  return `presence.status.${phase}`;
}

/**
 * One remote participant, as last reported over the wire. `lastSeenAt` is the
 * client's own clock at receipt — it drives the stale-collaborator prune that
 * covers a peer whose tab closed without ever sending `status: 'idle'`.
 */
export interface RemotePresence {
  senderId: string;
  displayName: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
  lastSeenAt: number;
}

export interface PresenceState {
  connection: ConnectionPhase;
  remotes: Record<string, RemotePresence>;
  setConnection: (phase: ConnectionPhase) => void;
  upsertRemote: (entry: RemotePresence) => void;
  dropRemote: (senderId: string) => void;
  /** Removes every remote whose `lastSeenAt` is strictly older than `staleBefore`. */
  pruneRemotes: (staleBefore: number) => void;
  clearRemotes: () => void;
}

/**
 * Creates one presence store instance, initially `connecting` — the editor
 * starts minting a ticket as soon as bootstrap resolves, so there is no
 * meaningful "idle, never tried" state to represent.
 */
export function createPresenceStore(
  initialPhase: ConnectionPhase = 'connecting',
): UseBoundStore<StoreApi<PresenceState>> {
  return create<PresenceState>((set) => ({
    connection: initialPhase,
    remotes: {},
    setConnection: (phase) => set({ connection: phase }),
    upsertRemote: (entry) =>
      set((state) => ({ remotes: { ...state.remotes, [entry.senderId]: entry } })),
    dropRemote: (senderId) =>
      set((state) => {
        if (!(senderId in state.remotes)) return state;
        const { [senderId]: _removed, ...rest } = state.remotes;
        return { remotes: rest };
      }),
    pruneRemotes: (staleBefore) =>
      set((state) => {
        const kept = Object.entries(state.remotes).filter(
          ([, entry]) => entry.lastSeenAt >= staleBefore,
        );
        if (kept.length === Object.keys(state.remotes).length) return state;
        return { remotes: Object.fromEntries(kept) };
      }),
    clearRemotes: () => set({ remotes: {} }),
  }));
}
