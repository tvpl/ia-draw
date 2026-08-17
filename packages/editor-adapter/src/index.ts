export { applyRemote } from './applyRemote.js';
export { buildSceneIndex, computeDiff } from './computeDiff.js';
export {
  EditorSurface,
  type EditorSurfaceHandle,
  type EditorSurfaceProps,
  type RemoteCollaborator,
} from './EditorSurface.js';
export { sanitizeAppState } from './sanitizeAppState.js';
export { parseScene, type SerializedScene, serializeScene } from './serializeScene.js';
export type {
  ElementDelta,
  PersistableAppState,
  ReconcileAppState,
  SceneElement,
  SceneIndex,
} from './types.js';
