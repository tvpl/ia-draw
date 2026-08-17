import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RestoreConfirmDialog } from './RestoreConfirmDialog.js';
import { createSnapshotClient, type SnapshotRow } from './snapshotClient.js';
import { snapshotLabel } from './snapshotLabel.js';

export interface HistoryPanelProps {
  diagramId: string;
  /** Gates the "create snapshot" and "restore" actions (SNAP-02/10) — same `diagram:mutate` decision every other panel already receives as a plain boolean (`AiDock`'s `canMutate`, resolved once from bootstrap). */
  canMutate: boolean;
  // SPEC_DEVIATION: tasks.md's T3 sketch has this component receive `EditorSurfaceHandle`
  // directly (prop/ref). Instead it takes this callback, mirroring `AiDock`'s existing
  // `onApproved` contract exactly. Reason: `DiagramEditorPage` already owns one reusable
  // "re-bootstrap + applyRemoteScene" handler wired to `AiDock.onApproved` (see its own
  // header comment) — reusing the *same* callback for restore avoids a second path to the
  // same effect and keeps `applyRemoteScene` itself called from exactly one place, unmodified.
  /** Called after a restore's `POST` resolves `200` (SNAP-08) — the caller re-bootstraps and applies the fresh scene via `EditorSurfaceHandle.applyRemoteScene`. This panel never touches canvas state directly. */
  onRestored: () => Promise<void>;
  /** Injectable for tests; defaults to the global fetch (same convention as `AiDock`/`AuthProvider`). */
  fetchImpl?: typeof fetch;
}

type ListStatus = 'loading' | 'ready' | 'error';

/**
 * The history/snapshots timeline (SNAP-01..05) plus the restore flow (SNAP-06..10) — lists every
 * snapshot the server returns (already most-recent-first, by revision), offers creating a named
 * one, and, per item, offers restoring it as a new revision behind a native-`<dialog>`
 * confirmation (`RestoreConfirmDialog`). Both actions are gated on `canMutate`.
 */
export function HistoryPanel({
  diagramId,
  canMutate,
  onRestored,
  fetchImpl,
}: HistoryPanelProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createSnapshotClient({ fetchImpl }), [fetchImpl]);

  const [items, setItems] = useState<SnapshotRow[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [createName, setCreateName] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const [restoreTarget, setRestoreTarget] = useState<SnapshotRow | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // SNAP-06 Assumptions: one clientMutationId per restore attempt, reused if the person
  // clicks confirm again before the previous response comes back — never a new id per click.
  const clientMutationIdRef = useRef<string | null>(null);

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

  /** Re-fetches the list after a restore resolves (SNAP-08/09) — a plain re-fetch, not a merge, since the server is the only source of truth for what a restore produced (Edge Cases: never overwrite with a stale optimistic state). */
  async function refreshList(): Promise<void> {
    try {
      const list = await client.list(diagramId);
      setItems(list);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    if (restoreTarget) dialogRef.current?.showModal();
  }, [restoreTarget]);

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

  function requestRestore(snapshot: SnapshotRow): void {
    clientMutationIdRef.current = null;
    setRestoreTarget(snapshot);
  }

  function closeRestoreDialog(): void {
    dialogRef.current?.close();
    setRestoreTarget(null);
  }

  async function confirmRestore(): Promise<void> {
    const target = restoreTarget;
    if (!target) return;

    if (!clientMutationIdRef.current) clientMutationIdRef.current = crypto.randomUUID();
    const mutationId = clientMutationIdRef.current;

    setIsRestoring(true);
    const result = await client.restore(diagramId, target.id, mutationId);
    setIsRestoring(false);
    clientMutationIdRef.current = null;

    if (result.status === 'ok') {
      // SNAP-08: the new currentRevision is shown; canvas application goes through the
      // caller's `onRestored` (the same reused bootstrap+applyRemoteScene flow), never here.
      setAnnouncement(t('history.restore.success', { revision: result.currentRevision }));
      closeRestoreDialog();
      await refreshList();
      await onRestored();
      return;
    }
    if (result.status === 'not_found') {
      // SNAP-09: the snapshot no longer exists (e.g. a race with another tab) — inform and relist.
      setAnnouncement(t('history.restore.notFound'));
      closeRestoreDialog();
      await refreshList();
      return;
    }
    // Any other outcome (forbidden or a generic error) never touches the canvas — no
    // `onRestored` call, no partial application.
    setAnnouncement(t('history.restore.error'));
    closeRestoreDialog();
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
              {/* SNAP-10: restore is hidden entirely without diagram:mutate, same as create. */}
              {canMutate && (
                <button type="button" onClick={() => requestRestore(item)}>
                  {t('history.restoreAction')}
                </button>
              )}
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

      {restoreTarget && (
        <RestoreConfirmDialog
          ref={dialogRef}
          snapshotLabel={snapshotLabel(t, restoreTarget)}
          onConfirm={() => void confirmRestore()}
          onCancel={closeRestoreDialog}
        />
      )}
      {isRestoring && <span data-testid="history-restoring" />}
    </div>
  );
}
