import { reconcileElements } from '@excalidraw/excalidraw';
import type { ReconcileAppState, SceneElement } from './types.js';

type LocalElements = Parameters<typeof reconcileElements>[0];
type RemoteElements = Parameters<typeof reconcileElements>[1];

/**
 * Thin wrapper around the real upstream `reconcileElements`, whose exact exported
 * signature (verified in
 * node_modules/@excalidraw/excalidraw/dist/types/excalidraw/data/reconcile.d.ts) is:
 *
 *   reconcileElements(
 *     localElements: readonly OrderedExcalidrawElement[],
 *     remoteElements: readonly RemoteExcalidrawElement[],
 *     localAppState: AppState,
 *   ): ReconciledExcalidrawElement[]
 *
 * `localElements`/`remoteElements` are branded types (`OrderedExcalidrawElement`,
 * `RemoteExcalidrawElement`) that a plain `SceneElement` array satisfies structurally
 * but not nominally, hence the two casts below.
 *
 * `localAppState` is only read by the internal `shouldDiscardRemoteElement` for three
 * id comparisons (`editingTextElement`, `resizingElement`, `newElement` — confirmed by
 * reading dist/dev/index.js) used to keep an element the user is actively mid-edit on.
 * None of those apply to a non-interactive caller (server, tests), so they default to
 * `null` unless the caller passes real values.
 *
 * Reconciliation tie-break (also read from dist/dev/index.js, function
 * `shouldDiscardRemoteElement`): when `local.version === remote.version`, the element
 * with the LOWER `versionNonce` wins, on whichever side it is. When versions differ,
 * the higher `version` wins outright.
 */
export function applyRemote(
  local: readonly SceneElement[],
  remote: readonly SceneElement[],
  localAppState: Partial<ReconcileAppState> = {},
): SceneElement[] {
  const appState = {
    editingTextElement: null,
    resizingElement: null,
    newElement: null,
    ...localAppState,
  } as ReconcileAppState;

  return reconcileElements(local as LocalElements, remote as RemoteElements, appState);
}
