import { type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiDockClient } from './aiDockClient.js';
import {
  aiDockStatusTranslationKey,
  createAiDockStore,
  type PreviewSummary,
} from './aiDockStore.js';

export interface AiDockProps {
  diagramId: string;
  /** From `bootstrapResult.mutatePermissions.allowed` (T1/T9) — the dock renders nothing at all when this is `false` (DOCK-02), never a disabled shell. */
  canMutate: boolean;
  /** The canvas's currently-selected element ids (`EditorSurface`'s `onSelectionChange`, T2/T9) — forwarded on every request (DOCK-03). */
  selection: readonly string[];
  /** Called once a scene-changing action resolves successfully — after an approve (DOCK-13) AND after an undo (DOCK-18), reusing the same callback for both, per design.md/T9: `DiagramEditorPage` reacts by calling `refreshScene()` then `applyRemoteScene(scene)`. The dock never touches canvas state directly. */
  onApproved: () => Promise<void>;
  /** Injectable for tests; defaults to the global fetch (same convention as `AuthProvider`). */
  fetchImpl?: typeof fetch;
}

type PreviewKey = keyof PreviewSummary;

const DEFAULT_PREVIEW_ORDER: PreviewKey[] = [
  'added',
  'removed',
  'moved',
  'modified',
  'metadataChanged',
];

/** DOCK-07: `removed` goes first whenever it has at least 1 element; otherwise natural order. */
function previewOrder(preview: PreviewSummary): PreviewKey[] {
  if (preview.removed.length > 0) {
    return ['removed', 'added', 'moved', 'modified', 'metadataChanged'];
  }
  return DEFAULT_PREVIEW_ORDER;
}

const MAX_VISIBLE_PREVIEW_ITEMS = 50;

const RUN_ONGOING_PHASES = new Set(['submitting', 'awaiting_approval', 'approving', 'restoring']);

/**
 * The AI dock — collapsible side panel (native `<details>`, keyboard-toggleable for free)
 * with the request field, structural-diff preview, and the approve/discard/undo actions.
 * Composes `aiDockStore` + `AiDockClient` internally (design.md's Components section: the
 * dock owns its own ephemeral state/client, `DiagramEditorPage` only supplies identity,
 * permission, selection, and the post-mutation refresh callback).
 */
export function AiDock({
  diagramId,
  canMutate,
  selection,
  onApproved,
  fetchImpl,
}: AiDockProps): JSX.Element | null {
  const { t, i18n } = useTranslation();

  const store = useMemo(() => createAiDockStore(), []);
  const client = useMemo(
    () => new AiDockClient({ diagramId, store, fetchImpl }),
    [diagramId, store, fetchImpl],
  );

  const phase = store((s) => s.phase);
  const requestText = store((s) => s.requestText);
  const run = store((s) => s.run);
  const preview = store((s) => s.preview);
  const requiresExplicitApproval = store((s) => s.requiresExplicitApproval);
  const errorCode = store((s) => s.errorCode);
  const lastSnapshotId = store((s) => s.lastSnapshotId);
  const rateLimitedUntil = store((s) => s.rateLimitedUntil);
  const setRequestText = store((s) => s.setRequestText);

  // DOCK-05: the store itself never leaves `rate_limited` on its own — this re-renders
  // the component once the 60s window elapses so `submitDisabled` re-evaluates.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== 'rate_limited' || rateLimitedUntil === null) return;
    const remainingMs = Math.max(0, rateLimitedUntil - Date.now());
    const timer = setTimeout(() => setNow(Date.now()), remainingMs);
    return () => clearTimeout(timer);
  }, [phase, rateLimitedUntil]);

  // DOCK-15: `approveConflict()` lands the store back in plain `idle`, indistinguishable
  // from the initial idle state — this local flag is what actually drives the "diagram
  // changed since your request" message; a deliberate Discard never sets it.
  const [showConflict, setShowConflict] = useState(false);

  if (!canMutate) return null;

  const isBlank = requestText.trim().length === 0;
  const isRunOngoing = RUN_ONGOING_PHASES.has(phase);
  const isRateLimited =
    phase === 'rate_limited' && rateLimitedUntil !== null && now < rateLimitedUntil;
  const submitDisabled = isBlank || isRunOngoing || isRateLimited;

  async function handleSubmit() {
    if (submitDisabled) return;
    setShowConflict(false);
    await client.submitRequest(requestText, i18n.language, [...selection]);
  }

  async function handleApprove() {
    if (!run) return;
    await client.approve(run.id);
    const nextPhase = store.getState().phase;
    if (nextPhase === 'applied') {
      await onApproved();
    } else if (nextPhase === 'idle') {
      // Only a 409 conflict routes awaiting_approval -> idle via approveConflict().
      setShowConflict(true);
    }
  }

  async function handleDiscard() {
    if (!run) return;
    await client.cancel(run.id);
  }

  async function handleUndo() {
    if (!lastSnapshotId) return;
    await client.undo(lastSnapshotId);
    // Only undoSuccess() routes -> idle; undoFailed() keeps `applied` (DOCK-19).
    if (store.getState().phase === 'idle') {
      await onApproved();
    }
  }

  const errorMessageKey =
    errorCode === 'no_provider_configured'
      ? 'aiDock.error.no_provider_configured'
      : 'aiDock.error.unknown';

  return (
    <details open>
      <summary>{t('aiDock.title')}</summary>

      <div aria-live="polite">{t(aiDockStatusTranslationKey(phase))}</div>

      <label>
        {t('aiDock.requestLabel')}
        <textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} />
      </label>
      <button type="button" onClick={() => void handleSubmit()} disabled={submitDisabled}>
        {t('aiDock.submit')}
      </button>

      {phase === 'rate_limited' && <p>{t('aiDock.rateLimited')}</p>}
      {showConflict && <p>{t('aiDock.conflict')}</p>}
      {phase === 'error' && <p>{t(errorMessageKey, { code: errorCode })}</p>}

      {preview && (
        <div>
          {previewOrder(preview).map((key) => (
            <div key={key}>
              <h3>{t(`aiDock.preview.${key}`, { count: preview[key].length })}</h3>
              <ul>
                {preview[key].slice(0, MAX_VISIBLE_PREVIEW_ITEMS).map((elementId) => (
                  <li key={elementId}>{elementId}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {phase === 'awaiting_approval' && (
        <div>
          <button type="button" onClick={() => void handleApprove()}>
            {t('aiDock.approve')}
          </button>
          {requiresExplicitApproval && <span>{t('aiDock.sensitiveChange')}</span>}
          <button type="button" onClick={() => void handleDiscard()}>
            {t('aiDock.discard')}
          </button>
        </div>
      )}

      {lastSnapshotId && (
        <button type="button" onClick={() => void handleUndo()} disabled={phase === 'restoring'}>
          {t('aiDock.undo')}
        </button>
      )}
    </details>
  );
}
