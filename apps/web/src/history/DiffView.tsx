import { type FormEvent, type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSnapshotClient, type DiffResult, type SnapshotRow } from './snapshotClient.js';
import { snapshotLabel } from './snapshotLabel.js';

export interface DiffViewProps {
  diagramId: string;
  /** Injectable for tests; defaults to the global fetch (same convention as `AiDock`/`HistoryPanel`). */
  fetchImpl?: typeof fetch;
}

type ListStatus = 'loading' | 'ready' | 'error';

const DIFF_CATEGORIES = ['added', 'removed', 'moved', 'modified'] as const;

function isEmptyDiff(diff: DiffResult): boolean {
  return DIFF_CATEGORIES.every((category) => diff[category].length === 0);
}

/**
 * Comparison panel (SNAP-11..13) — its own timeline fetch (same list/loading/error pattern as
 * `HistoryPanel`) feeds two "from"/"to" pickers; comparing calls `snapshotClient.diff` and
 * renders the four categorized element-id lists. Read-only: available to anyone with
 * `diagram:read` (no `canMutate` gate), unlike creating or restoring.
 */
export function DiffView({ diagramId, fetchImpl }: DiffViewProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createSnapshotClient({ fetchImpl }), [fetchImpl]);

  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    client.list(diagramId).then(
      (list) => {
        if (cancelled) return;
        setSnapshots(list);
        setStatus('ready');
        // Default to comparing the two most recent points (list is most-recent-first).
        if (list.length >= 2) {
          setFromId((current) => current || (list[1]?.id ?? ''));
          setToId((current) => current || (list[0]?.id ?? ''));
        }
      },
      () => {
        if (!cancelled) setStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, diagramId]);

  async function handleCompare(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!fromId || !toId) return;

    setDiffError(null);
    const result = await client.diff(diagramId, fromId, toId);

    if (result.status === 'ok') {
      setDiffResult(result.diff);
      return;
    }
    setDiffResult(null);
    if (result.status === 'not_found') {
      // SNAP-13: the server's own message, shown as-is, panel stays usable.
      setDiffError(result.message || t('history.diff.error'));
      return;
    }
    setDiffError(t('history.diff.error'));
  }

  // Edge case (spec.md): fewer than two points on the timeline -> compare is disabled with
  // an explanation, instead of letting someone pick the same single entry twice.
  const compareDisabled = snapshots.length < 2;

  return (
    <div>
      <h3>{t('history.diff.title')}</h3>

      {status === 'loading' && <p>{t('history.loading')}</p>}
      {status === 'error' && <p>{t('history.error')}</p>}

      {status === 'ready' &&
        (compareDisabled ? (
          <p>{t('history.diff.disabledExplanation')}</p>
        ) : (
          <form onSubmit={(event) => void handleCompare(event)}>
            <label>
              {t('history.diff.fromLabel')}
              <select value={fromId} onChange={(event) => setFromId(event.target.value)}>
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {snapshot.revision} — {snapshotLabel(t, snapshot)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('history.diff.toLabel')}
              <select value={toId} onChange={(event) => setToId(event.target.value)}>
                {snapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {snapshot.revision} — {snapshotLabel(t, snapshot)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">{t('history.diff.compare')}</button>
          </form>
        ))}

      {diffError && <p>{diffError}</p>}

      {diffResult &&
        (isEmptyDiff(diffResult) ? (
          <p>{t('history.diff.noChanges')}</p>
        ) : (
          <div>
            {DIFF_CATEGORIES.map((category) => (
              <div key={category}>
                <h4>{t(`history.diff.${category}`, { count: diffResult[category].length })}</h4>
                <ul>
                  {diffResult[category].map((elementId) => (
                    <li key={elementId}>{elementId}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
