import type { ElementDelta, SceneElement } from '@arch-canvas/editor-adapter';
import { buildSceneIndex } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { reconcileOperation } from './reconcile.js';

function firstOf(elements: readonly SceneElement[]): SceneElement {
  const [first] = elements;
  if (!first) throw new Error('fixture must have at least one element');
  return first;
}

describe('reconcileOperation', () => {
  const base = firstOf(allFixtures.text as readonly SceneElement[]);

  it('applies an upsert delta for a brand-new element into an empty scene', () => {
    const empty = buildSceneIndex([]);
    const delta: ElementDelta = {
      elementId: base.id,
      kind: 'upsert',
      element: base,
      version: base.version,
      versionNonce: base.versionNonce,
    };

    const { scene, applied } = reconcileOperation(empty, [delta]);

    expect(scene.get(base.id)?.id).toBe(base.id);
    expect(applied).toEqual([delta]);
  });

  it('applies a delete delta by tombstoning the element the server already has', () => {
    const current = buildSceneIndex([base]);
    const delta: ElementDelta = {
      elementId: base.id,
      kind: 'delete',
      version: base.version + 1,
      versionNonce: base.versionNonce + 1,
    };

    const { scene, applied } = reconcileOperation(current, [delta]);

    expect(scene.get(base.id)?.isDeleted).toBe(true);
    expect(applied).toEqual([delta]);
  });

  it('drops a delete delta for an element the server never had (true no-op)', () => {
    const empty = buildSceneIndex([]);
    const delta: ElementDelta = {
      elementId: 'never-existed',
      kind: 'delete',
      version: 1,
      versionNonce: 1,
    };

    const { scene, applied } = reconcileOperation(empty, [delta]);

    expect(scene.size).toBe(0);
    expect(applied).toEqual([]);
  });

  it('uses the same versionNonce tie-break as applyRemote: lower versionNonce wins at equal version', () => {
    const local: SceneElement = { ...base, version: 5, versionNonce: 200 };
    const current = buildSceneIndex([local]);

    const incoming: SceneElement = { ...base, version: 5, versionNonce: 100 };
    const delta: ElementDelta = {
      elementId: base.id,
      kind: 'upsert',
      element: incoming,
      version: incoming.version,
      versionNonce: incoming.versionNonce,
    };

    const { scene } = reconcileOperation(current, [delta]);

    expect(scene.get(base.id)?.versionNonce).toBe(100);
  });

  it('a stale upsert (lower version than what the server already has) loses the tie-break but is still returned as applied', () => {
    const local: SceneElement = { ...base, version: 10, versionNonce: 999 };
    const current = buildSceneIndex([local]);

    const stale: SceneElement = { ...base, version: 5, versionNonce: 1 };
    const delta: ElementDelta = {
      elementId: base.id,
      kind: 'upsert',
      element: stale,
      version: stale.version,
      versionNonce: stale.versionNonce,
    };

    const { scene, applied } = reconcileOperation(current, [delta]);

    expect(scene.get(base.id)?.version).toBe(10);
    expect(applied).toEqual([delta]);
  });

  it('leaves an element untouched in the scene when no delta references it', () => {
    const untouched: SceneElement = { ...base, id: 'untouched-element' };
    const current = buildSceneIndex([untouched]);

    const { scene } = reconcileOperation(current, []);

    expect(scene.get('untouched-element')?.id).toBe('untouched-element');
  });
});
