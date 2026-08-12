import { EditorSurface } from '@arch-canvas/editor-adapter';
import { type JSX, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { createMutationQueue, wireForcedFlush } from '../sync/mutationQueue.js';

/**
 * Route: `/w/:workspaceId/d/:diagramId` (chosen routing shape — workspace-scoped,
 * mirrors the REST resource nesting used by the server's workspace/diagram routes).
 *
 * Mounts the real `<EditorSurface/>` (T24) and feeds every change into a local,
 * debounced mutation queue (T24's `createMutationQueue`) with forced flush on
 * `visibilitychange`/`pagehide` (`wireForcedFlush`). The queue's `onFlush` here is a
 * placeholder — T25 replaces it with the real sync client (bootstrap/operations:batch/
 * catch-up) and the save-status state machine. The queue itself is cache/fila only: it
 * is never read back as the source of truth for the canvas.
 */
export function DiagramEditorPage(): JSX.Element {
  const { diagramId } = useParams<{ workspaceId: string; diagramId: string }>();

  const queue = useMemo(
    () =>
      createMutationQueue({
        onFlush: (batch) => {
          // TODO(T25): send via the sync client's operations:batch call and drive the
          // save-status state machine from its result.
          void batch;
        },
      }),
    [],
  );

  useEffect(() => wireForcedFlush(queue), [queue]);

  if (!diagramId) return <p>Missing diagram id.</p>;

  return (
    <EditorSurface
      onDeltas={(deltas) => {
        queue.getState().enqueue(deltas);
      }}
    />
  );
}
