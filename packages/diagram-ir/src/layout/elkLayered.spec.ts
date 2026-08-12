import { describe, expect, it } from 'vitest';
import type { IrDocument } from '../schema.js';
import { layoutElkLayered } from './elkLayered.js';
import type { PositionedNode } from './types.js';

function rectsOverlap(a: PositionedNode, b: PositionedNode): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function node(id: string, label = id) {
  return { id, label };
}

function baseDoc(overrides: Partial<IrDocument>): IrDocument {
  return {
    version: 'v1',
    kind: 'microservices',
    nodes: [],
    containers: [],
    edges: [],
    ...overrides,
  };
}

describe('layoutElkLayered', () => {
  it('positions a linear chain of 5 connected nodes in strictly increasing topological order', async () => {
    const ir = baseDoc({
      nodes: [node('n1'), node('n2'), node('n3'), node('n4'), node('n5')],
      edges: [
        { from: 'n1', to: 'n2', semantics: { mode: 'sync', direction: 'oneway' } },
        { from: 'n2', to: 'n3', semantics: { mode: 'sync', direction: 'oneway' } },
        { from: 'n3', to: 'n4', semantics: { mode: 'async', direction: 'oneway' } },
        { from: 'n4', to: 'n5', semantics: { mode: 'data', direction: 'oneway' } },
      ],
    });

    const positions = await layoutElkLayered(ir);
    expect(positions).toHaveLength(5);

    const byId = new Map(positions.map((p) => [p.id, p]));
    const chain = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id) => {
      const pos = byId.get(id);
      expect(pos).toBeDefined();
      return pos as PositionedNode;
    });

    for (let i = 1; i < chain.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: indices are within chain bounds by the loop
      expect(chain[i]!.x).toBeGreaterThan(chain[i - 1]!.x);
    }
  });

  it('produces zero overlapping bounding boxes among positioned nodes', async () => {
    const ir = baseDoc({
      nodes: [node('a'), node('b'), node('c'), node('d'), node('e'), node('f')],
      edges: [
        { from: 'a', to: 'b', semantics: { mode: 'sync', direction: 'oneway' } },
        { from: 'a', to: 'c', semantics: { mode: 'sync', direction: 'oneway' } },
        { from: 'b', to: 'd', semantics: { mode: 'async', direction: 'oneway' } },
        { from: 'c', to: 'd', semantics: { mode: 'async', direction: 'oneway' } },
        { from: 'd', to: 'e', semantics: { mode: 'data', direction: 'oneway' } },
        { from: 'd', to: 'f', semantics: { mode: 'dependency', direction: 'oneway' } },
      ],
    });

    const positions = await layoutElkLayered(ir);
    expect(positions).toHaveLength(6);

    let overlapCount = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
        if (rectsOverlap(positions[i]!, positions[j]!)) overlapCount++;
      }
    }
    expect(overlapCount).toBe(0);
  });
});
