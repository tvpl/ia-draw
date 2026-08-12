import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_APP_STATE } from './generateExports.js';
import { parseScene, serializeScene } from './sceneFile.js';

describe('sceneFile serializeScene / parseScene round-trip', () => {
  it('preserves elements and appState exactly (T32 Done-when: .excalidraw round-trips via parseScene)', () => {
    const elements = allFixtures.frame as unknown as readonly SceneElement[];

    const json = serializeScene(elements, DEFAULT_EXPORT_APP_STATE);
    const parsed = parseScene(json);

    expect(parsed.elements).toEqual(elements);
    expect(parsed.appState).toEqual(DEFAULT_EXPORT_APP_STATE);
  });

  it('preserves an unknown/future field added to an element', () => {
    const [element] = allFixtures.text as unknown as readonly SceneElement[];
    const withUnknownField = {
      ...element,
      futureFieldFromNextExcalidrawVersion: 'keep-me',
    } as unknown as SceneElement;

    const json = serializeScene([withUnknownField], DEFAULT_EXPORT_APP_STATE);
    const parsed = parseScene(json);

    const roundTripped = parsed.elements[0] as unknown as Record<string, unknown>;
    expect(roundTripped.futureFieldFromNextExcalidrawVersion).toBe('keep-me');
  });

  it('rejects a JSON file that is not the architecture-canvas/scene envelope', () => {
    const notAScene = JSON.stringify({ type: 'something-else', elements: [], appState: {} });

    expect(() => parseScene(notAScene)).toThrow(/not a valid architecture-canvas\/scene file/);
  });
});
