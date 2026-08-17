import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createLintClient, type LintWarning } from './lintClient.js';

export interface LintPanelProps {
  diagramId: string;
  /** Element ids of the scene this editor session has loaded — the only source this panel has
   * for telling a live `elementId` from one already removed from the canvas (ALNT-08..10, same
   * role `CommentsSidebar`'s `liveElementIds` already plays for CMT2-09/10). */
  liveElementIds: readonly string[];
  /** Called when the person clicks "jump to element" for a live id. `DiagramEditorPage` wires
   * this to `EditorSurfaceHandle.focusElement` — this component never touches the canvas ref
   * directly (same separation `LibraryPanel.onInsert`/`MetadataPanel` already use). */
  onJumpToElement: (elementId: string) => void;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

type PanelStatus = 'loading' | 'ready' | 'error';

/**
 * The lint-warnings panel (ALNT-01..14) — fetches `GET /diagrams/:id/lint` on mount and on an
 * explicit "Atualizar" click (REST-only, same convention `CommentsSidebar` already documents:
 * no polling, no reaction to every canvas delta). Purely consultive: nothing here disables,
 * blocks or gates any canvas tool (ALNT-07) — this component has no prop/callback that could
 * even reach a canvas-mutating path other than `onJumpToElement`, which itself never mutates
 * scene content (ALNT-12, enforced in `EditorSurfaceHandle.focusElement`).
 */
export function LintPanel({
  diagramId,
  liveElementIds,
  onJumpToElement,
  fetchImpl,
}: LintPanelProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createLintClient(fetchImpl), [fetchImpl]);
  const liveIds = useMemo(() => new Set(liveElementIds), [liveElementIds]);

  const [status, setStatus] = useState<PanelStatus>('loading');
  const [warnings, setWarnings] = useState<LintWarning[]>([]);
  const [announcement, setAnnouncement] = useState('');

  const load = useCallback((): (() => void) => {
    let cancelled = false;
    setStatus('loading');
    client.list(diagramId).then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') {
        setWarnings(result.warnings);
        setStatus('ready');
      } else {
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, diagramId]);

  useEffect(() => load(), [load]);

  function handleJump(elementId: string): void {
    onJumpToElement(elementId);
    setAnnouncement(t('lint.announce.jumped', { elementId }));
  }

  return (
    <section aria-labelledby="lint-title">
      <h2 id="lint-title">{t('lint.title')}</h2>

      <div aria-live="polite" data-testid="lint-announcement">
        {announcement}
      </div>

      {/* ALNT-05: this single button doubles as the explicit "Atualizar" action and, when
          status is 'error', as the "tentar novamente" retry action (ALNT-04) — one control,
          always visible, rather than a second button that only exists during an error. */}
      <button type="button" onClick={() => load()}>
        {t('lint.refresh')}
      </button>

      {status === 'loading' && <p>{t('lint.loading')}</p>}

      {status === 'error' && <p>{t('lint.error')}</p>}

      {status === 'ready' && warnings.length === 0 && <p>{t('lint.empty')}</p>}

      {status === 'ready' && warnings.length > 0 && (
        <ul>
          {warnings.map((warning, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: LintWarning has no stable id of its own — the list is replaced wholesale on every load/refresh, never reordered in place.
            <li key={`${warning.rule}-${index}`} data-testid="lint-warning">
              <p>{warning.message}</p>
              <ul>
                {warning.elementIds.map((elementId) =>
                  liveIds.has(elementId) ? (
                    <li key={elementId}>
                      <button type="button" onClick={() => handleJump(elementId)}>
                        {t('lint.jumpToElement')} {elementId}
                      </button>
                    </li>
                  ) : (
                    <li key={elementId}>
                      {elementId} — {t('lint.elementUnavailable')}
                    </li>
                  ),
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
