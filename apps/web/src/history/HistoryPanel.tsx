import { type FormEvent, type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSnapshotClient, type SnapshotRow } from './snapshotClient.js';
import { snapshotLabel } from './snapshotLabel.js';

export interface HistoryPanelProps {
  diagramId: string;
  /** Gates the "create snapshot" action (SNAP-02) — same `diagram:mutate` decision every other panel already receives as a plain boolean (`AiDock`'s `canMutate`, resolved once from bootstrap). */
  canMutate: boolean;
  /** Injectable for tests; defaults to the global fetch (same convention as `AiDock`/`AuthProvider`). */
  fetchImpl?: typeof fetch;
}

type ListStatus = 'loading' | 'ready' | 'error';

/**
 * The history/snapshots timeline (SNAP-01..05) — lists every snapshot the server returns
 * (already most-recent-first, by revision) and, for someone with `diagram:mutate`, offers
 * creating a named one. Restore (T3) extends this same component with a per-item action and
 * `RestoreConfirmDialog`, rather than a second list.
 */
export function HistoryPanel({ diagramId, canMutate, fetchImpl }: HistoryPanelProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createSnapshotClient({ fetchImpl }), [fetchImpl]);

  const [items, setItems] = useState<SnapshotRow[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [createName, setCreateName] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    client.list(diagramId).then(
      (list) => {
        if (cancelled) return;
        setItems(list);
        setStatus('ready');
      },
      () => {
        if (!cancelled) setStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, diagramId]);

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      // SNAP-03/04: `createName` may be blank — `snapshotClient.create` omits the `name`
      // field entirely in that case rather than sending `name: ""`.
      const created = await client.create(diagramId, createName);
      // SNAP-03: inserted at the top from the 201 response itself, no extra GET.
      setItems((previous) => [created, ...previous]);
      setCreateName('');
      setAnnouncement(t('history.create.success'));
    } catch {
      setAnnouncement(t('history.create.error'));
    }
  }

  const showEmptyState = status === 'ready' && items.length === 0;

  return (
    <div>
      <div aria-live="polite" data-testid="history-announcement">
        {announcement}
      </div>

      {status === 'loading' && <p>{t('history.loading')}</p>}
      {status === 'error' && <p>{t('history.error')}</p>}
      {/* SNAP-05: an explicit empty state, distinct from the loading/error states above. */}
      {showEmptyState && <p>{t('history.emptyState')}</p>}

      {status === 'ready' && items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.id} data-testid="history-item">
              <span>{snapshotLabel(t, item)}</span>{' '}
              {/* SNAP-01: creation date, shown alongside the kind/name label. */}
              <time dateTime={item.createdAt}>{item.createdAt}</time>
            </li>
          ))}
        </ul>
      )}

      {canMutate && (
        <form onSubmit={(event) => void handleCreate(event)}>
          <label>
            {t('history.create.nameLabel')}
            <input value={createName} onChange={(event) => setCreateName(event.target.value)} />
          </label>
          <button type="submit">{t('history.create.submit')}</button>
        </form>
      )}
    </div>
  );
}
