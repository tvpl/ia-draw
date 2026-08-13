import { create, type StoreApi, type UseBoundStore } from 'zustand';

/**
 * EDT-05: the save-status display is exactly one of these five values —
 * `Salvo | Salvando… | Offline — N alterações pendentes | Conflito | Somente leitura`.
 * `pendingCount` is only meaningful when `kind === 'offline'` (the "— N" part);
 * every setter resets it so the state can never carry a stale count into another kind.
 */
export type SaveStatusKind = 'saved' | 'saving' | 'offline' | 'conflict' | 'readOnly';

export const SAVE_STATUS_KINDS: readonly SaveStatusKind[] = [
  'saved',
  'saving',
  'offline',
  'conflict',
  'readOnly',
];

/** i18next key for each kind — see the `saveStatus` block in the locale translation.json files. */
export function saveStatusTranslationKey(kind: SaveStatusKind): string {
  return `saveStatus.${kind}`;
}

export interface SaveStatusState {
  kind: SaveStatusKind;
  pendingCount: number;
  setSaved: () => void;
  setSaving: () => void;
  setOffline: (pendingCount: number) => void;
  setConflict: () => void;
  setReadOnly: () => void;
}

/** Creates one save-status store instance, initially `saving` (bootstrap is in flight until the first successful load). */
export function createSaveStatusStore(
  initialKind: SaveStatusKind = 'saving',
): UseBoundStore<StoreApi<SaveStatusState>> {
  return create<SaveStatusState>((set) => ({
    kind: initialKind,
    pendingCount: 0,
    setSaved: () => set({ kind: 'saved', pendingCount: 0 }),
    setSaving: () => set({ kind: 'saving', pendingCount: 0 }),
    setOffline: (pendingCount) => set({ kind: 'offline', pendingCount }),
    setConflict: () => set({ kind: 'conflict', pendingCount: 0 }),
    setReadOnly: () => set({ kind: 'readOnly', pendingCount: 0 }),
  }));
}
