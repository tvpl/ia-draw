import { create, type StoreApi, type UseBoundStore } from 'zustand';

/**
 * DOCK-04/06..20: every state the AI dock can be in. The dock never applies a
 * patch on its own — `awaiting_approval` always requires the explicit
 * approve click (DOCK-12), regardless of `requiresExplicitApproval`.
 */
export type AiDockPhase =
  | 'idle'
  | 'submitting'
  | 'awaiting_approval'
  | 'approving'
  | 'applied'
  | 'restoring'
  | 'error'
  | 'rate_limited'
  | 'expired';

/** Mirrors the server's structural diff summary (design.md's Data Models). */
export interface PreviewSummary {
  added: string[];
  removed: string[];
  moved: string[];
  modified: string[];
  metadataChanged: string[];
}

/** i18next key for each phase — see the `aiDock.status` block in the locale translation.json files. */
export function aiDockStatusTranslationKey(phase: AiDockPhase): string {
  return `aiDock.status.${phase}`;
}

export interface AiDockRun {
  id: string;
  status: string;
}

export interface AiDockState {
  phase: AiDockPhase;
  requestText: string;
  run: AiDockRun | null;
  preview: PreviewSummary | null;
  requiresExplicitApproval: boolean;
  errorCode: string | null;
  /** The snapshot to restore on Desfazer — only ever the most recently applied run in this session (DOCK-20). */
  lastSnapshotId: string | null;
  /** Epoch ms; the dock reenables submit once `Date.now() >= rateLimitedUntil` (DOCK-05). */
  rateLimitedUntil: number | null;

  setRequestText: (text: string) => void;
  submitStart: () => void;
  submitSuccess: (result: {
    run: AiDockRun;
    preview: PreviewSummary;
    requiresExplicitApproval: boolean;
  }) => void;
  submitFailed: (errorCode: string) => void;
  rateLimited: (rateLimitedUntil: number) => void;
  approveStart: () => void;
  approveSuccess: (snapshotId: string) => void;
  approveConflict: () => void;
  cancelled: () => void;
  undoStart: () => void;
  undoSuccess: () => void;
  undoFailed: () => void;
  reset: () => void;
}

const INITIAL_STATE: Pick<
  AiDockState,
  | 'phase'
  | 'requestText'
  | 'run'
  | 'preview'
  | 'requiresExplicitApproval'
  | 'errorCode'
  | 'lastSnapshotId'
  | 'rateLimitedUntil'
> = {
  phase: 'idle',
  requestText: '',
  run: null,
  preview: null,
  requiresExplicitApproval: false,
  errorCode: null,
  lastSnapshotId: null,
  rateLimitedUntil: null,
};

/** Creates one AI dock store instance — ephemeral client state, molded on `createSaveStatusStore` (`apps/web/src/sync/saveStatus.ts`). */
export function createAiDockStore(): UseBoundStore<StoreApi<AiDockState>> {
  return create<AiDockState>((set) => ({
    ...INITIAL_STATE,

    setRequestText: (text) => set({ requestText: text }),

    // A fresh submit clears whatever error/preview/run a previous attempt left behind.
    submitStart: () =>
      set({
        phase: 'submitting',
        errorCode: null,
        run: null,
        preview: null,
        requiresExplicitApproval: false,
      }),

    submitSuccess: ({ run, preview, requiresExplicitApproval }) =>
      set({ phase: 'awaiting_approval', run, preview, requiresExplicitApproval }),

    // DOCK-09/10: never loses the errorCode — requestText stays untouched (preserved).
    submitFailed: (errorCode) =>
      set({ phase: 'error', errorCode, run: null, preview: null, requiresExplicitApproval: false }),

    // DOCK-05: requestText stays untouched (preserved).
    rateLimited: (rateLimitedUntil) => set({ phase: 'rate_limited', rateLimitedUntil }),

    approveStart: () => set({ phase: 'approving' }),

    approveSuccess: (snapshotId) => set({ phase: 'applied', lastSnapshotId: snapshotId }),

    // DOCK-15: the stale run/preview are discarded, never applied; requestText stays
    // untouched (preserved) so the same text can be resubmitted.
    approveConflict: () =>
      set({ phase: 'idle', run: null, preview: null, requiresExplicitApproval: false }),

    cancelled: () =>
      set({ phase: 'idle', run: null, preview: null, requiresExplicitApproval: false }),

    undoStart: () => set({ phase: 'restoring' }),

    // DOCK-20: undo only ever targets the most recently applied run — once undone,
    // there is no more "applied run" to offer Desfazer for.
    undoSuccess: () => set({ phase: 'idle', lastSnapshotId: null }),

    // DOCK-19: never reports success; lastSnapshotId is left untouched so Desfazer
    // stays available for a retry.
    undoFailed: () => set({ phase: 'applied' }),

    reset: () => set({ ...INITIAL_STATE }),
  }));
}
