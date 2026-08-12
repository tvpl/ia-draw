import { describe, expect, it } from 'vitest';
import type { IrDocument } from '../schema.js';
import { layoutSwimlane } from './swimlane.js';
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
    kind: 'business-flow',
    nodes: [],
    containers: [],
    edges: [],
    ...overrides,
  };
}

describe('layoutSwimlane', () => {
  it('places 3 lanes with 2-4 nodes each with zero overlap between lanes and between nodes in the same lane', () => {
    const ir = baseDoc({
      nodes: [
        node('a1'),
        node('a2'),
        node('b1'),
        node('b2'),
        node('b3'),
        node('c1'),
        node('c2'),
        node('c3'),
        node('c4'),
      ],
      containers: [
        { id: 'lane-a', label: 'Sales', kind: 'swimlane', children: ['a1', 'a2'] },
        { id: 'lane-b', label: 'Fulfillment', kind: 'swimlane', children: ['b1', 'b2', 'b3'] },
        { id: 'lane-c', label: 'Support', kind: 'swimlane', children: ['c1', 'c2', 'c3', 'c4'] },
      ],
    });

    const positions = layoutSwimlane(ir);
    // 3 lane bands + 9 nodes
    expect(positions).toHaveLength(3 + 9);

    let overlapCount = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
        const a = positions[i]!;
        // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
        const b = positions[j]!;
        // A lane band and its own member nodes are expected to overlap (the
        // nodes sit inside the lane) — only count overlaps between things
        // that are NOT a lane-and-its-own-member pair.
        const laneOwnsA = ir.containers.find((c) => c.id === a.id)?.children.includes(b.id);
        const laneOwnsB = ir.containers.find((c) => c.id === b.id)?.children.includes(a.id);
        if (laneOwnsA || laneOwnsB) continue;
        if (rectsOverlap(a, b)) overlapCount++;
      }
    }
    expect(overlapCount).toBe(0);
  });

  it('orders nodes connected by a "dependency" edge consistently with the edge direction (from before to, on the x axis)', () => {
    const ir = baseDoc({
      nodes: [node('start'), node('middle'), node('end')],
      containers: [
        { id: 'lane', label: 'Process', kind: 'swimlane', children: ['end', 'start', 'middle'] },
      ],
      edges: [
        { from: 'start', to: 'middle', semantics: { mode: 'dependency', direction: 'oneway' } },
        { from: 'middle', to: 'end', semantics: { mode: 'dependency', direction: 'oneway' } },
      ],
    });

    const positions = layoutSwimlane(ir);
    const byId = new Map(positions.map((p) => [p.id, p]));
    const start = byId.get('start');
    const middle = byId.get('middle');
    const end = byId.get('end');
    expect(start).toBeDefined();
    expect(middle).toBeDefined();
    expect(end).toBeDefined();
    if (start && middle && end) {
      expect(start.x).toBeLessThan(middle.x);
      expect(middle.x).toBeLessThan(end.x);
    }
  });
});
