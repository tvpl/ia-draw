import { EditorSurface, type SceneElement } from '@arch-canvas/editor-adapter';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
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
 */
export function DiagramEditorPage(): JSX.Element {
  const { diagramId } = useParams<{ workspaceId: string; diagramId: string }>();
  const { t } = useTranslation();

  const status = useMemo(() => createSaveStatusStore(), []);
  const clientRef = useRef<DiagramSyncClient | null>(null);
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

  useEffect(() => wireForcedFlush(queue), [queue]);

  useEffect(() => {
    if (!diagramId) return;
    const client = new DiagramSyncClient({ diagramId, queue, status });
    clientRef.current = client;

    let cancelled = false;
    (async () => {
      const me = await fetch('/me').then(
        (response) => response.json() as Promise<{ user: { id: string } }>,
      );
      if (cancelled) return;
      client.setActorId(me.user.id);

      const bootstrapResult = await client.bootstrap();
      if (cancelled) return;
      setInitialElements(bootstrapResult.scene);
    })();

    return () => {
      cancelled = true;
      clientRef.current = null;
    };
  }, [diagramId, queue, status]);

  const kind = status((s) => s.kind);
  const pendingCount = status((s) => s.pendingCount);

  if (!diagramId) return <p>Missing diagram id.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <p data-testid="save-status">{t(saveStatusTranslationKey(kind), { count: pendingCount })}</p>
      {initialElements ? (
        // Excalidraw fills its parent's box — a flex child with flex:1 gives it the
        // concrete height it needs (an unstyled ancestor chain collapses to 0 height).
        <div style={{ flex: 1, minHeight: 0 }}>
          <EditorSurface
            initialElements={initialElements}
            onDeltas={(deltas) => queue.getState().enqueue(deltas)}
          />
        </div>
      ) : (
        <p>{t('diagram.loading')}</p>
      )}
    </div>
  );
}
