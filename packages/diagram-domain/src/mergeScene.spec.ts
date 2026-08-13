import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { buildSceneIndex, mergeScene } from './mergeScene.js';

function firstOf(elements: readonly SceneElement[]): SceneElement {
  const [first] = elements;
  if (!first) throw new Error('fixture must have at least one element');
  return first;
}

describe('mergeScene (local LWW tie-break, no @excalidraw/excalidraw at runtime)', () => {
  const base = firstOf(allFixtures.text as readonly SceneElement[]);

  it('adds a remote-only element untouched', () => {
    const merged = mergeScene([], [base]);
    expect(merged).toEqual([base]);
  });

  it('keeps a local-only element untouched when remote has nothing for it', () => {
    const merged = mergeScene([base], []);
    expect(merged).toEqual([base]);
  });

  it('picks the higher version outright when versions differ', () => {
    const local: SceneElement = { ...base, version: 3, versionNonce: 999 };
    const remote: SceneElement = { ...base, version: 5, versionNonce: 1 };

    expect(mergeScene([local], [remote])).toEqual([remote]);
    // symmetric: a lower-version remote never wins even with a "better" versionNonce
    expect(mergeScene([remote], [local])).toEqual([remote]);
  });

  it('at equal version, the lower versionNonce wins on whichever side it is', () => {
    const higherNonce: SceneElement = { ...base, version: 5, versionNonce: 200 };
    const lowerNonce: SceneElement = { ...base, version: 5, versionNonce: 100 };

    expect(mergeScene([higherNonce], [lowerNonce])).toEqual([lowerNonce]);
    expect(mergeScene([lowerNonce], [higherNonce])).toEqual([lowerNonce]);
  });

  it('buildSceneIndex indexes elements by id', () => {
    const index = buildSceneIndex([base]);
    expect(index.get(base.id)).toBe(base);
    expect(index.size).toBe(1);
  });
});
