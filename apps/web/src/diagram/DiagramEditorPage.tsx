import {
  EditorSurface,
  type EditorSurfaceHandle,
  type SceneElement,
} from '@arch-canvas/editor-adapter';
import type { LibraryItem } from '@arch-canvas/library-content';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { AiDock } from '../ai-dock/AiDock.js';
import { useAuth } from '../auth/AuthProvider.js';
import { BundleButton } from '../export/BundleButton.js';
import { ExportMenu } from '../export/ExportMenu.js';
import { DiffView } from '../history/DiffView.js';
import { HistoryPanel } from '../history/HistoryPanel.js';
import { LibraryPanel } from '../library/LibraryPanel.js';
import { MetadataPanel } from '../library/MetadataPanel.js';
import { createMutationQueue, wireForcedFlush } from '../sync/mutationQueue.js';
import { createSaveStatusStore, saveStatusTranslationKey } from '../sync/saveStatus.js';
import { DiagramSyncClient } from '../sync/syncClient.js';

/**
 * Route: `/w/:workspaceId/d/:diagramId` (chosen routing shape — workspace-scoped,
 * mirrors the REST resource nesting used by the server's workspace/diagram routes).
 *
 * Mounts the real `<EditorSurface/>` (T24), feeding every change into a local,
 * debounced mutation queue (T24) whose `onFlush` now calls the real sync client
 * (T25): `GET /bootstrap` before enabling editing, `POST .../operations:batch` per
 * flushed batch, driving the save-status store rendered below. The queue stays
 * cache/fila only — it is never read back as the source of truth for the canvas.
 *
 * `<EditorSurface/>` only mounts once bootstrap has resolved, so Excalidraw's
 * (non-reactive) `initialData` is correct on its one and only mount.
 *
 * T9: the layout is a row — this column (status + canvas) as a `flex:1, minHeight:0`
 * child, a sidebar column as its sibling. `canMutate` comes from bootstrap's
 * `mutatePermissions.allowed` (T1); `selection` comes from `EditorSurface`'s
 * `onSelectionChange` (T2). `AiDock`'s `onApproved` (reused for its undo-success path,
 * design.md) re-runs the SAME `DiagramSyncClient.bootstrap()` already used for the
 * initial load — same `GET .../bootstrap` call `AiDockClient.refreshScene()` would make,
 * with the added benefit of re-syncing the mutation queue's `baseRevision`/save-status to
 * the new server revision the AI patch just produced — then fuses the result onto the
 * canvas via `EditorSurface`'s imperative `applyRemoteScene` handle (T3), never before the
 * approve/restore call itself has resolved (DOCK-13/18).
 *
 * T8 (component-library): the sidebar column also hosts `LibraryPanel` and
 * `MetadataPanel`, each collapsible via `<details>` (same toggle convention `AiDock`
 * established), plus a link into the inventory route. `canMutate` — the SAME
 * `diagram:mutate` decision `AiDock` already gates on — doubles as the `canWrite` prop
 * for both new panels: `packages/auth/src/rbac.ts`'s `ROLE_GRANTS` never separates
 * `diagram:write` from `diagram:mutate` for any role today (both land in `WRITE_ACTIONS`
 * together), so reusing this single already-resolved boolean is equivalent to a second
 * `diagram:write` check without adding one. `LibraryPanel.onInsert` is wired to
 * `EditorSurfaceHandle.insertLibraryItem` via the same `editorSurfaceRef` `applyRemoteScene`
 * already uses (design.md Approach A — no second ref/path onto the canvas, AD-010/EDT-07).
 *
 * (history-snapshots T6) A collapsed-by-default history section sits below the row —
 * deliberately outside it, not a third flex child, so it never disturbs the row's own
 * layout — toggled open with a plain keyboard-focusable button (mounts nothing while
 * closed, satisfying "the panel never interferes with the canvas when closed"). It holds
 * `<HistoryPanel/>` (SNAP-01..10) and `<DiffView/>` (SNAP-11..13), both visible to anyone
 * on this page (diagram:read), gated internally on `canMutate` for create/restore.
 * `HistoryPanel`'s `onRestored` reuses the exact same `handleApproved` callback as
 * `AiDock`'s own approve/undo flow — one place calls `applyRemoteScene`, regardless of
 * which action produced the new revision.
 *
 * XPRT-01..06 (export-import): `ExportMenu`/`BundleButton` sit in a small toolbar row at
 * the top of the canvas column, above the canvas itself — both only need `diagram:read`,
 * which reaching this route already implies (bootstrap's own read-permission check), so
 * neither needs an extra role gate here.
 */
export function DiagramEditorPage(): JSX.Element {
  const { workspaceId, diagramId } = useParams<{ workspaceId: string; diagramId: string }>();
  const { t } = useTranslation();
  // T8/SSO-18: the actor id comes from AuthProvider's context (the app's one
  // `/me` call, resolved before this route can even render behind
  // `ProtectedRoute`), not a second `/me` fetch of this component's own.
  const { user } = useAuth();

  const status = useMemo(() => createSaveStatusStore(), []);
  const clientRef = useRef<DiagramSyncClient | null>(null);
  const editorSurfaceRef = useRef<EditorSurfaceHandle>(null);
  const queue = useMemo(
    () =>
      createMutationQueue({
        onFlush: (batch) => {
          void clientRef.current?.sendBatch(batch);
        },
      }),
    [],
  );

  const [initialElements, setInitialElements] = useState<readonly SceneElement[] | null>(null);
  const [canMutate, setCanMutate] = useState(false);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => wireForcedFlush(queue), [queue]);

  useEffect(() => {
    if (!diagramId || !user) return;
    const client = new DiagramSyncClient({ diagramId, queue, status });
    clientRef.current = client;
    client.setActorId(user.id);

    let cancelled = false;
    (async () => {
      const bootstrapResult = await client.bootstrap();
      if (cancelled) return;
      setInitialElements(bootstrapResult.scene);
      setCanMutate(bootstrapResult.mutatePermissions.allowed);
    })();

    return () => {
      cancelled = true;
      clientRef.current = null;
    };
  }, [diagramId, queue, status, user]);

  // DOCK-13/18/SNAP-08: never applies anything before the approve/restore HTTP call itself
  // has already resolved 200 — this only ever runs from AiDock's or HistoryPanel's own
  // post-resolution callback (`onApproved`/`onRestored`), never optimistically.
  const handleApproved = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const refreshed = await client.bootstrap();
    editorSurfaceRef.current?.applyRemoteScene(refreshed.scene);
  }, []);

  // CLIB-03/04: the only place `LibraryPanel` reaches the canvas — via the same
  // imperative ref `applyRemoteScene` already uses, never a second path (AD-010).
  const handleInsertLibraryItem = useCallback((item: LibraryItem) => {
    editorSurfaceRef.current?.insertLibraryItem(item);
  }, []);

  const kind = status((s) => s.kind);
  const pendingCount = status((s) => s.pendingCount);

  if (!diagramId) return <p>Missing diagram id.</p>;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'row', height: '100vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <p data-testid="save-status">
            {t(saveStatusTranslationKey(kind), { count: pendingCount })}
          </p>
          {/* XPRT-01..06: export/bundle actions — both only need diagram:read, which reaching
              this route already implies (bootstrap's own read-permission check), so no extra
              role gate here. */}
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
            <ExportMenu diagramId={diagramId} />
            <BundleButton diagramId={diagramId} />
          </div>
          {initialElements ? (
            // Excalidraw fills its parent's box — a flex child with flex:1 gives it the
            // concrete height it needs (an unstyled ancestor chain collapses to 0 height).
            <div style={{ flex: 1, minHeight: 0 }}>
              <EditorSurface
                ref={editorSurfaceRef}
                initialElements={initialElements}
                onDeltas={(deltas) => queue.getState().enqueue(deltas)}
                onSelectionChange={setSelection}
              />
            </div>
          ) : (
            <p>{t('diagram.loading')}</p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <AiDock
            diagramId={diagramId}
            canMutate={canMutate}
            selection={selection}
            onApproved={handleApproved}
          />
          <details>
            <summary>{t('library.title')}</summary>
            <LibraryPanel
              workspaceId={workspaceId}
              canWrite={canMutate}
              onInsert={handleInsertLibraryItem}
            />
          </details>
          <details>
            <summary>{t('metadata.title')}</summary>
            <MetadataPanel diagramId={diagramId} selection={selection} canWrite={canMutate} />
          </details>
          {workspaceId && (
            <Link to={`/w/${workspaceId}/d/${diagramId}/inventory`}>{t('inventory.open')}</Link>
          )}
        </div>
      </div>
      <div>
        <button
          type="button"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          {t('history.panelToggle')}
        </button>
        {historyOpen && (
          <div>
            <HistoryPanel diagramId={diagramId} canMutate={canMutate} onRestored={handleApproved} />
            <DiffView diagramId={diagramId} />
          </div>
        )}
      </div>
    </>
  );
}
