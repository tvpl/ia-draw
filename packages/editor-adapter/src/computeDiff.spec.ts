import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { buildSceneIndex, computeDiff } from './computeDiff.js';
import type { SceneElement } from './types.js';

/** Fixtures are always non-empty; this narrows away `| undefined` without `!`. */
function firstOf(elements: readonly SceneElement[]): SceneElement {
  const [first] = elements;
  if (!first) throw new Error('fixture must have at least one element');
  return first;
}

describe('computeDiff', () => {
  for (const [fixtureName, elements] of Object.entries(allFixtures)) {
    describe(`fixture: ${fixtureName}`, () => {
      it('detects an upsert for every element new to the scene', () => {
        const deltas = computeDiff(new Map(), elements);

        expect(deltas).toHaveLength(elements.length);
        for (const element of elements) {
          const delta = deltas.find((d) => d.elementId === element.id);
          expect(delta).toBeDefined();
          expect(delta?.kind).toBe('upsert');
          expect(delta?.version).toBe(element.version);
          expect(delta?.versionNonce).toBe(element.versionNonce);
          // payload check: the actual element object must be carried, not just referenced
          expect(delta?.element).toBe(element);
        }
      });

      it('is a no-op (no delta) when version and versionNonce are unchanged', () => {
        const prev = buildSceneIndex(elements);

        const deltas = computeDiff(prev, elements);

        expect(deltas).toEqual([]);
      });

      it('detects a delete when an element is removed from the scene', () => {
        const prev = buildSceneIndex(elements);
        const removedElement = firstOf(elements);
        const [, ...rest] = elements;

        const deltas = computeDiff(prev, rest);

        expect(deltas).toEqual([
          {
            elementId: removedElement.id,
            kind: 'delete',
            version: removedElement.version,
            versionNonce: removedElement.versionNonce,
          },
        ]);
      });

      it('detects a delete when an element flips isDeleted to true', () => {
        const prev = buildSceneIndex(elements);
        const target = firstOf(elements);
        const [, ...rest] = elements;
        const tombstoned: SceneElement = {
          ...target,
          isDeleted: true,
          version: target.version + 1,
          versionNonce: target.versionNonce + 1,
        };

        const deltas = computeDiff(prev, [tombstoned, ...rest]);

        expect(deltas).toEqual([
          {
            elementId: target.id,
            kind: 'delete',
            version: tombstoned.version,
            versionNonce: tombstoned.versionNonce,
          },
        ]);
      });

      it('detects an upsert when version/versionNonce change on an existing element', () => {
        const prev = buildSceneIndex(elements);
        const target = firstOf(elements);
        const [, ...rest] = elements;
        const bumped: SceneElement = {
          ...target,
          x: target.x + 1,
          version: target.version + 1,
          versionNonce: target.versionNonce + 1,
        };

        const deltas = computeDiff(prev, [bumped, ...rest]);

        expect(deltas).toEqual([
          {
            elementId: target.id,
            kind: 'upsert',
            element: bumped,
            version: bumped.version,
            versionNonce: bumped.versionNonce,
          },
        ]);
      });

      it('detects an upsert when only version changes and versionNonce is unchanged', () => {
        const prev = buildSceneIndex(elements);
        const target = firstOf(elements);
        const [, ...rest] = elements;
        const bumped: SceneElement = {
          ...target,
          version: target.version + 1,
        };

        const deltas = computeDiff(prev, [bumped, ...rest]);

        expect(deltas).toEqual([
          {
            elementId: target.id,
            kind: 'upsert',
            element: bumped,
            version: bumped.version,
            versionNonce: bumped.versionNonce,
          },
        ]);
      });

      it('detects an upsert when only versionNonce changes and version is unchanged', () => {
        const prev = buildSceneIndex(elements);
        const target = firstOf(elements);
        const [, ...rest] = elements;
        const renonced: SceneElement = {
          ...target,
          versionNonce: target.versionNonce + 1,
        };

        const deltas = computeDiff(prev, [renonced, ...rest]);

        expect(deltas).toEqual([
          {
            elementId: target.id,
            kind: 'upsert',
            element: renonced,
            version: renonced.version,
            versionNonce: renonced.versionNonce,
          },
        ]);
      });
    });
  }
});
