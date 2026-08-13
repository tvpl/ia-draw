import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { applyRemote } from './applyRemote.js';
import type { SceneElement } from './types.js';

// Verified against the real upstream `shouldDiscardRemoteElement` implementation in
// node_modules/@excalidraw/excalidraw/dist/dev/index.js: at equal `version`, the side
// with the LOWER `versionNonce` wins, regardless of whether that's local or remote.
function firstOf(elements: readonly SceneElement[]): SceneElement {
  const [first] = elements;
  if (!first) throw new Error('fixture must have at least one element');
  return first;
}

describe('applyRemote', () => {
  const base = firstOf(allFixtures.text as readonly SceneElement[]);

  it('at equal version, keeps the LOCAL element when it has the lower versionNonce', () => {
    const local: SceneElement = { ...base, version: 5, versionNonce: 100 };
    const remote: SceneElement = { ...base, version: 5, versionNonce: 200 };

    const result = applyRemote([local], [remote]);

    expect(result).toHaveLength(1);
    expect(result[0]?.versionNonce).toBe(100);
  });

  it('at equal version, keeps the REMOTE element when it has the lower versionNonce', () => {
    const local: SceneElement = { ...base, version: 5, versionNonce: 200 };
    const remote: SceneElement = { ...base, version: 5, versionNonce: 100 };

    const result = applyRemote([local], [remote]);

    expect(result).toHaveLength(1);
    expect(result[0]?.versionNonce).toBe(100);
  });

  it('keeps the local element when its version is strictly newer than remote', () => {
    const local: SceneElement = { ...base, version: 10, versionNonce: 999 };
    const remote: SceneElement = { ...base, version: 5, versionNonce: 1 };

    const result = applyRemote([local], [remote]);

    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBe(10);
    expect(result[0]?.versionNonce).toBe(999);
  });

  it('keeps the remote element when its version is strictly newer than local', () => {
    const local: SceneElement = { ...base, version: 5, versionNonce: 1 };
    const remote: SceneElement = { ...base, version: 10, versionNonce: 999 };

    const result = applyRemote([local], [remote]);

    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBe(10);
    expect(result[0]?.versionNonce).toBe(999);
  });

  it('converges to the same winning versionNonce regardless of which side calls it', () => {
    const sceneA: SceneElement = { ...base, version: 5, versionNonce: 100 };
    const sceneB: SceneElement = { ...base, version: 5, versionNonce: 200 };

    const fromA = applyRemote([sceneA], [sceneB]);
    const fromB = applyRemote([sceneB], [sceneA]);

    expect(fromA[0]?.versionNonce).toBe(fromB[0]?.versionNonce);
    expect(fromA[0]?.versionNonce).toBe(100);
  });

  it('keeps a local-only element that has no remote counterpart', () => {
    const localOnly: SceneElement = { ...base, id: 'local-only-element' };

    const result = applyRemote([localOnly], []);

    expect(result.map((e) => e.id)).toContain('local-only-element');
  });
});
