import type { PersistableAppState, SceneElement } from './types.js';

export interface SerializedScene {
  elements: readonly SceneElement[];
  appState: PersistableAppState;
}

const SCENE_FORMAT = 'architecture-canvas/scene';
const SCENE_FORMAT_VERSION = 1;

/**
 * Serializes a scene to JSON. Deliberately a thin `JSON.stringify`, not a schema-driven
 * encoder: elements and appState are passed through as-is, so any field neither this
 * package nor its caller knows about yet (a future Excalidraw element property, an
 * upstream addition) survives the round trip instead of being stripped by an allow-list.
 */
export function serializeScene(
  elements: readonly SceneElement[],
  appState: PersistableAppState,
): string {
  return JSON.stringify({
    type: SCENE_FORMAT,
    version: SCENE_FORMAT_VERSION,
    elements,
    appState,
  });
}

/** Inverse of `serializeScene`, with the same pass-through guarantee. */
export function parseScene(json: string): SerializedScene {
  const parsed = JSON.parse(json) as {
    elements: readonly SceneElement[];
    appState: PersistableAppState;
  };
  return { elements: parsed.elements, appState: parsed.appState };
}
