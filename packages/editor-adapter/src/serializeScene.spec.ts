import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { sanitizeAppState } from './sanitizeAppState.js';
import { parseScene, serializeScene } from './serializeScene.js';
import type { SceneElement } from './types.js';

describe('serializeScene / parseScene round-trip', () => {
  it('preserves elements and appState exactly', () => {
    const elements = allFixtures.frame as readonly SceneElement[];
    const appState = sanitizeAppState({ viewBackgroundColor: '#112233', gridSize: 10 });

    const json = serializeScene(elements, appState);
    const parsed = parseScene(json);

    expect(parsed.elements).toEqual(elements);
    expect(parsed.appState).toEqual(appState);
  });

  it('preserves an unknown/future field added to an element', () => {
    const [element] = allFixtures.text as readonly SceneElement[];
    const withUnknownField = {
      ...element,
      futureFieldFromNextExcalidrawVersion: 'keep-me',
    } as unknown as SceneElement;

    const json = serializeScene([withUnknownField], sanitizeAppState({}));
    const parsed = parseScene(json);

    const roundTripped = parsed.elements[0] as unknown as Record<string, unknown>;
    expect(roundTripped.futureFieldFromNextExcalidrawVersion).toBe('keep-me');
  });
});
