import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { structuralDiff } from './structuralDiff.js';

function firstOf(elements: readonly SceneElement[]): SceneElement {
  const [first] = elements;
  if (!first) throw new Error('fixture must have at least one element');
  return first;
}

describe('structuralDiff (VER-04)', () => {
  const base = firstOf(allFixtures.text as readonly SceneElement[]);

  it('reports added, removed, moved and modified correctly for a scenario with one of each', () => {
    const added: SceneElement = { ...base, id: 'el-added', x: 0, y: 0 };
    const removed: SceneElement = { ...base, id: 'el-removed', x: 10, y: 10 };
    const movedFrom: SceneElement = { ...base, id: 'el-moved', x: 20, y: 20 };
    const movedTo: SceneElement = { ...base, id: 'el-moved', x: 99, y: 99 };
    const modifiedFrom: SceneElement = {
      ...base,
      id: 'el-modified',
      x: 30,
      y: 30,
      backgroundColor: '#000000',
    };
    const modifiedTo: SceneElement = {
      ...base,
      id: 'el-modified',
      x: 30,
      y: 30,
      backgroundColor: '#ffffff',
    };
    const unchanged: SceneElement = { ...base, id: 'el-unchanged', x: 40, y: 40 };

    const from = [removed, movedFrom, modifiedFrom, unchanged];
    const to = [added, movedTo, modifiedTo, unchanged];

    const result = structuralDiff(from, to);

    expect(result.added).toEqual(['el-added']);
    expect(result.removed).toEqual(['el-removed']);
    expect(result.moved).toEqual(['el-moved']);
    expect(result.modified).toEqual(['el-modified']);
  });

  it('an element identical in both scenes appears in no bucket', () => {
    const unchanged: SceneElement = { ...base, id: 'el-same', x: 5, y: 5 };
    const result = structuralDiff([unchanged], [unchanged]);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.moved).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  it('an element bumped to isDeleted:true is reported as removed, not modified', () => {
    const present: SceneElement = { ...base, id: 'el-tombstone', isDeleted: false };
    const tombstoned: SceneElement = { ...base, id: 'el-tombstone', isDeleted: true };

    const result = structuralDiff([present], [tombstoned]);
    expect(result.removed).toEqual(['el-tombstone']);
    expect(result.modified).toEqual([]);
  });

  it('an element both moved and content-modified is bucketed as modified, not moved (documented precedence)', () => {
    const from: SceneElement = { ...base, id: 'el-both', x: 0, y: 0, backgroundColor: '#000000' };
    const to: SceneElement = { ...base, id: 'el-both', x: 50, y: 50, backgroundColor: '#ffffff' };

    const result = structuralDiff([from], [to]);
    expect(result.modified).toEqual(['el-both']);
    expect(result.moved).toEqual([]);
  });

  it('a version/versionNonce/updated-only change (no visible content difference) reports no change', () => {
    const from: SceneElement = { ...base, id: 'el-bookkeeping', version: 1, versionNonce: 111 };
    const to: SceneElement = { ...base, id: 'el-bookkeeping', version: 2, versionNonce: 222 };

    const result = structuralDiff([from], [to]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.moved).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  it('an element present in "from" but entirely absent from "to" (never mentioned) is reported as removed', () => {
    const onlyInFrom: SceneElement = { ...base, id: 'el-gone' };
    const result = structuralDiff([onlyInFrom], []);
    expect(result.removed).toEqual(['el-gone']);
  });
});
