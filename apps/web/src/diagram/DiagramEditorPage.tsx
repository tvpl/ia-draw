import {
  EditorSurface,
  type EditorSurfaceHandle,
  type RemoteCollaborator,
  type SceneElement,
} from '@arch-canvas/editor-adapter';
import type { LibraryItem } from '@arch-canvas/library-content';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { AiDock } from '../ai-dock/AiDock.js';
import { useAuth } from '../auth/AuthProvider.js';
import { CommentsSidebar } from '../comments/CommentsSidebar.js';
import { DocsPanel } from '../docs/DocsPanel.js';
import { BundleButton } from '../export/BundleButton.js';
import { ExportMenu } from '../export/ExportMenu.js';
import { DiffView } from '../history/DiffView.js';
import { HistoryPanel } from '../history/HistoryPanel.js';
import { LibraryPanel } from '../library/LibraryPanel.js';
import { MetadataPanel } from '../library/MetadataPanel.js';
import { LintPanel } from '../lint/LintPanel.js';
import { ConnectionStatus } from '../presence/ConnectionStatus.js';
import { collaboratorColor } from '../presence/collaboratorColor.js';
import { PresenceClient } from '../presence/presenceClient.js';
import { createPresenceStore } from '../presence/presenceStore.js';
import { ShareLinkPanel } from '../share/ShareLinkPanel.js';
import * as css from '../styles/classNames.js';
import { createMutationQueue, wireForcedFlush } from '../sync/mutationQueue.js';
import { createSaveStatusStore, saveStatusTranslationKey } from '../sync/saveStatus.js';
import { DiagramSyncClient } from '../sync/syncClient.js';
import { EditorSidePanel } from './EditorSidePanel.js';

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
 * child, the side column as its sibling. Since T8 (diagram-comments) that sibling's
 * AI/Comments half is `<EditorSidePanel/>`, a tabbed container holding `<AiDock/>` and
 * `<CommentsSidebar/>` instead of the dock alone: two docked panels would eat too much
 * canvas width, and the comments panel must stay reachable for a role whose bootstrap
 * denies mutation (CMT2-01..04). `canMutate` comes from bootstrap's
 * `mutatePermissions.allowed` (T1); `selection` comes from `EditorSurface`'s
 * `onSelectionChange` (T2). `AiDock`'s `onApproved` (reused for its undo-success path,
 * design.md) re-runs the SAME `DiagramSyncClient.bootstrap()` already used for the
 * initial load — same `GET .../bootstrap` call `AiDockClient.refreshScene()` would make,
 * with the added benefit of re-syncing the mutation queue's `baseRevision`/save-status to
 * the new server revision the AI patch just produced — then fuses the result onto the
 * canvas via `EditorSurface`'s imperative `applyRemoteScene` handle (T3), never before the
 * approve/restore call itself has resolved (DOCK-13/18).
 *
 * T8 (component-library): the side column also hosts `LibraryPanel` and
 * `MetadataPanel`, each collapsible via `<details>` (same toggle convention `AiDock`
 * established), plus a link into the inventory route. `canMutate` — the SAME
 * `diagram:mutate` decision `AiDock` already gates on — doubles as the `canWrite` prop
 * for both new panels: `packages/auth/src/rbac.ts`'s `ROLE_GRANTS` never separates
 * `diagram:write` from `diagram:mutate` for any role today (both land in `WRITE_ACTIONS`
 * together), so reusing this single already-resolved boolean is equivalent to a second
 * `diagram:write` check without adding one. `LibraryPanel.onInsert` is wired to
 * `EditorSurfaceHandle.insertLibraryItem` via the same `editorSurfaceRef` `applyRemoteScene`
 * already uses (design.md Approach A — no second ref/path onto the canvas, AD-010/EDT-07).
 * These two panels stay outside `<EditorSidePanel/>` — their collapsed-by-default
 * `<details>` footprint doesn't compete for canvas width the way two simultaneously-open
 * docks would, so there's no tab-sharing pressure for them.
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
 * LIVE-06..14/24 (realtime-presence): once bootstrap resolves, a `PresenceClient` mints a
 * ws-ticket and opens `/ws/diagrams/:id`. The local pointer reaches it through
 * `EditorSurface`'s `onPointerMove` (scene coordinates, from Excalidraw's own
 * `onPointerUpdate`) and the local selection through the SAME `selection` state
 * `onSelectionChange` already lifts for `AiDock`/`MetadataPanel` — no second wiring.
 * Remote cursors go back onto the canvas through `applyCollaborators`, the second method on
 * the AD-010 imperative handle, never a prop that would re-render `<Excalidraw/>` per cursor
 * move. `<ConnectionStatus/>` sits next to the existing save-status line.
 *
 * XPRT-01..06 (export-import): `ExportMenu`/`BundleButton` sit in a small toolbar row at
 * the top of the canvas column, above the canvas itself — both only need `diagram:read`,
 * which reaching this route already implies (bootstrap's own read-permission check), so
 * neither needs an extra role gate here.
 *
 * ALNT-01..14 (architecture-lint): `<EditorSidePanel/>`'s third tab hosts `<LintPanel/>`,
 * fed the SAME `liveElementIds` `CommentsSidebar` already receives (ALNT-06 — no second
 * "what still exists in the scene" source). `LintPanel.onJumpToElement` reaches the canvas
 * through the SAME `editorSurfaceRef` every other panel on this page already uses
 * (`EditorSurfaceHandle.focusElement`, AD-010) — no second ref/path.
 */
export function DiagramEditorPage(): JSX.Element {
  const { workspaceId, diagramId } = useParams<{ workspaceId: string; diagramId: string }>();
  const { t } = useTranslation();
  // T8/SSO-18: the actor id comes from AuthProvider's context (the app's one
  // `/me` call, resolved before this route can even render behind
  // `ProtectedRoute`), not a second `/me` fetch of this component's own.
  const { user } = useAuth();

  const status = useMemo(() => createSaveStatusStore(), []);
  const presence = useMemo(() => createPresenceStore(), []);
  const presenceClientRef = useRef<PresenceClient | null>(null);
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

  const bootstrapped = initialElements !== null;

  // LIVE-20: the presence socket coming back up is the signal that this client may have
  // missed operations while it was away. `catchUp()` shipped with `DiagramSyncClient` in
  // F4 and had no caller anywhere in `apps/web` until here.
  const handleReconnected = useCallback(() => {
    void clientRef.current?.catchUp().catch(() => {
      // Catch-up is best effort: a failure leaves the canvas exactly as it is and
      // the connection intact, and the next reconnect tries again.
    });
  }, []);

  // LIVE-06/08: the presence session opens only once bootstrap has resolved, and is torn
  // down (socket + every timer) when the editor unmounts.
  useEffect(() => {
    if (!diagramId || !user || !bootstrapped) return;
    const client = new PresenceClient({
      diagramId,
      selfUserId: user.id,
      store: presence,
      onReconnected: handleReconnected,
    });
    presenceClientRef.current = client;
    client.connect();

    return () => {
      client.close();
      presenceClientRef.current = null;
    };
  }, [bootstrapped, diagramId, handleReconnected, presence, user]);

  // LIVE-10: the same `selection` state `AiDock`/`MetadataPanel` already consume — the
  // outgoing broadcast reuses it rather than adding a second `onSelectionChange` path.
  useEffect(() => {
    presenceClientRef.current?.sendSelection(selection);
  }, [selection]);

  const remotes = presence((state) => state.remotes);

  // LIVE-13/14: remote presence reaches the canvas through the AD-010 handle only.
  const hadCollaboratorsRef = useRef(false);
  useEffect(() => {
    const entries = Object.values(remotes);
    // Nobody here and nobody a moment ago: pushing an empty map would be a
    // pointless `updateScene` on every editor that is simply alone in a diagram.
    if (entries.length === 0 && !hadCollaboratorsRef.current) return;
    hadCollaboratorsRef.current = entries.length > 0;

    const collaborators = new Map<string, RemoteCollaborator>(
      entries.map((entry) => [
        entry.senderId,
        {
          id: entry.senderId,
          username: entry.displayName,
          color: collaboratorColor(entry.senderId),
          ...(entry.cursor
            ? { pointer: { x: entry.cursor.x, y: entry.cursor.y, tool: 'pointer' as const } }
            : {}),
          selectedElementIds: Object.fromEntries(entry.selection.map((id) => [id, true as const])),
        },
      ]),
    );
    editorSurfaceRef.current?.applyCollaborators(collaborators);
  }, [remotes]);

  useEffect(() => {
    if (!diagramId || !user) return;
    const client = new DiagramSyncClient({
      diagramId,
      queue,
      status,
      // LIVE-21/22: `catchUp()` only reports HOW MANY operations the client had
      // missed — its `operations` are `{sequence, clientMutationId}`, not scene
      // elements, so nothing there can be applied to the canvas directly. When
      // it reports at least one, the scene is refetched (the same `bootstrap()`
      // the approve/restore path already reuses) and fused in through the AD-010
      // handle. Zero missed operations means nothing to repaint.
      onReconcile: (report) => {
        if (report.appliedCount <= 0) return;
        void (async () => {
          try {
            const refreshed = await clientRef.current?.bootstrap();
            if (refreshed) editorSurfaceRef.current?.applyRemoteScene(refreshed.scene);
          } catch {
            // The canvas keeps its current revision; the next reconnect retries.
            // Never propagates into the React tree.
          }
        })();
      },
    });
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

  // ALNT-08/09/10: the only place `LintPanel` reaches the canvas — via the SAME
  // `editorSurfaceRef` every other imperative-handle caller on this page already uses
  // (AD-010), never a second path. `focusElement` itself is a no-op for a stale id, so
  // there is nothing else to branch on here.
  const handleJumpToElement = useCallback((elementId: string) => {
    editorSurfaceRef.current?.focusElement(elementId);
  }, []);

  const kind = status((s) => s.kind);
  const pendingCount = status((s) => s.pendingCount);

  // CMT2-09/10: the anchor check runs against the scene this session loaded — the only element-id
  // set this page already holds without new plumbing into `EditorSurface` (spec.md's Assumptions).
  const liveElementIds = useMemo(
    () => (initialElements ?? []).map((element) => element.id),
    [initialElements],
  );

  if (!diagramId) return <p>Missing diagram id.</p>;

  return (
    <>
      {/* UIF-13/14: the side panel gets a declared width and the canvas column takes the
          rest. Before this both were flex children with no width of their own, so the panel
          grew with its content and ate into the drawing area. */}
      <div className="flex h-screen flex-row overflow-hidden bg-surface">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <p className={css.helpText} data-testid="save-status">
            {t(saveStatusTranslationKey(kind), { count: pendingCount })}
          </p>
          <ConnectionStatus store={presence} />
          {/* XPRT-01..06: export/bundle actions — both only need diagram:read, which reaching
              this route already implies (bootstrap's own read-permission check), so no extra
              role gate here. */}
          <div className="flex flex-row flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-2">
            <ExportMenu diagramId={diagramId} />
            <BundleButton diagramId={diagramId} />
          </div>
          {initialElements ? (
            // Excalidraw fills its parent's box — a flex child with flex:1 gives it the
            // concrete height it needs (an unstyled ancestor chain collapses to 0 height).
            <div className="min-h-0 flex-1">
              <EditorSurface
                ref={editorSurfaceRef}
                initialElements={initialElements}
                onDeltas={(deltas) => queue.getState().enqueue(deltas)}
                onSelectionChange={setSelection}
                onPointerMove={(pointer) => presenceClientRef.current?.sendCursor(pointer)}
                // SHR-22: a role without `diagram:mutate` gets a genuinely
                // read-only canvas. Before this, a reviewer/viewer could still
                // draw and drag locally — every one of those edits was rejected
                // by the server at flush time, silently losing the work.
                viewModeEnabled={!canMutate}
              />
            </div>
          ) : (
            <p>{t('diagram.loading')}</p>
          )}
        </div>
        <aside className="flex w-96 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-surface-raised p-3">
          <EditorSidePanel
            aiPanel={
              canMutate ? (
                <AiDock
                  diagramId={diagramId}
                  canMutate={canMutate}
                  selection={selection}
                  onApproved={handleApproved}
                />
              ) : null
            }
            commentsPanel={
              <CommentsSidebar
                diagramId={diagramId}
                selection={selection}
                liveElementIds={liveElementIds}
              />
            }
            lintPanel={
              <LintPanel
                diagramId={diagramId}
                liveElementIds={liveElementIds}
                onJumpToElement={handleJumpToElement}
              />
            }
          />
          <details className="rounded-panel border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-content">
              {t('library.title')}
            </summary>
            <LibraryPanel
              workspaceId={workspaceId}
              canWrite={canMutate}
              onInsert={handleInsertLibraryItem}
            />
          </details>
          <details className="rounded-panel border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-content">
              {t('metadata.title')}
            </summary>
            <MetadataPanel diagramId={diagramId} selection={selection} canWrite={canMutate} />
          </details>
          {/* living-docs (LDC-01): visible to anyone who reaches this route (`diagram:read` is
              already implied), same `<details>` convention as Library/Metadata above — generate
              and per-section regenerate are gated inside DocsPanel itself via `canMutate`, not by
              hiding the whole panel (unlike ShareLinkPanel below, which IS fully canMutate-gated). */}
          <details className="rounded-panel border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-content">
              {t('docs.title')}
            </summary>
            <DocsPanel
              diagramId={diagramId}
              canMutate={canMutate}
              liveElementIds={liveElementIds}
            />
          </details>
          {/* SHR-01: share-link management is gated on the same `diagram:mutate`
              decision as `AiDock` — the server requires it to create a link at
              all, so a role that cannot mutate gets no panel, not a disabled one. */}
          {canMutate && (
            <details className="rounded-panel border border-border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-content">
                {t('share.panelTitle')}
              </summary>
              <ShareLinkPanel diagramId={diagramId} canMutate={canMutate} />
            </details>
          )}
          {workspaceId && (
            <Link className={css.link} to={`/w/${workspaceId}/d/${diagramId}/inventory`}>
              {t('inventory.open')}
            </Link>
          )}
          {/* presentation-mode/T8: the ONLY change this file needs for R12 — a single link into
              the new /present route, same tier as the /inventory link above it. Everything else
              (frame CRUD, publish, presenter mode) lives entirely on the other side of this link. */}
          {workspaceId && (
            <Link className={css.link} to={`/w/${workspaceId}/d/${diagramId}/present`}>
              {t('presentation.list.title')}
            </Link>
          )}
        </aside>
      </div>
      <div className="border-t border-border bg-surface-raised px-3 py-2">
        <button
          className={css.buttonSecondary}
          type="button"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          {t('history.panelToggle')}
        </button>
        {historyOpen && (
          <div className="mt-2 flex flex-col gap-3">
            <HistoryPanel diagramId={diagramId} canMutate={canMutate} onRestored={handleApproved} />
            <DiffView diagramId={diagramId} />
          </div>
        )}
      </div>
    </>
  );
}
