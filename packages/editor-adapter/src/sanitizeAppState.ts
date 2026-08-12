import type { PersistableAppState, ReconcileAppState } from './types.js';

/**
 * Keeps only the `AppState` fields that describe the persisted document itself
 * (canvas background, grid, zen mode, theme, diagram name) and discards everything the
 * real `AppState` interface
 * (node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts) documents as
 * interaction or session state, e.g.:
 * - selection: `selectedElementIds`, `hoveredElementIds`, `selectedGroupIds`, `editingGroupId`, `selectedLinearElement`
 * - in-progress editing: `editingTextElement`, `resizingElement`, `newElement`, `multiElement`, `isCropping`, `croppingElementId`
 * - collaboration/presence: `collaborators`, `userToFollow`, `followedBy`
 * - viewport/pointer: `scrollX`, `scrollY`, `zoom`, `cursorButton`, `width`, `height`, `offsetTop`, `offsetLeft`
 * - UI chrome: `contextMenu`, `toast`, `openDialog`, `openMenu`, `openPopup`, `openSidebar`, `stats`, `searchMatches`, `snapLines`
 *
 * `currentItem*` fields (default style for the *next* drawn element) are also left out:
 * they affect only future elements, not anything already on the persisted canvas.
 */
export function sanitizeAppState(appState: Partial<ReconcileAppState>): PersistableAppState {
  return {
    viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
    gridSize: appState.gridSize ?? 0,
    gridStep: appState.gridStep ?? 5,
    gridModeEnabled: appState.gridModeEnabled ?? false,
    zenModeEnabled: appState.zenModeEnabled ?? false,
    theme: appState.theme ?? ('light' as PersistableAppState['theme']),
    name: appState.name ?? null,
  };
}
