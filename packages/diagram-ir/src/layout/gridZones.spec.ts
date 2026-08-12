import { describe, expect, it } from 'vitest';
import type { IrDocument } from '../schema.js';
import { layoutGridZones } from './gridZones.js';
import type { PositionedNode } from './types.js';

/** True only when the two axis-aligned boxes share positive-area overlap (touching edges don't count). */
function rectsOverlap(a: PositionedNode, b: PositionedNode): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * A container's box is *expected* to geometrically enclose its own
 * children's boxes — that isn't the "overlap" the layout must avoid.
 * Only pairs that are neither ancestor nor descendant of each other (i.e.
 * different branches, or true siblings) count as a problematic overlap.
 * `descendantsOf(id)` returns every id nested (at any depth) under `id`.
 */
function descendantsOf(ir: IrDocument, id: string): Set<string> {
  const container = ir.containers.find((c) => c.id === id);
  if (!container) return new Set();
  const out = new Set<string>();
  for (const childId of container.children) {
    out.add(childId);
    for (const grandchild of descendantsOf(ir, childId)) out.add(grandchild);
  }
  return out;
}

function isAncestorOrDescendant(ir: IrDocument, a: string, b: string): boolean {
  return descendantsOf(ir, a).has(b) || descendantsOf(ir, b).has(a);
}

function badOverlapCount(ir: IrDocument, positions: PositionedNode[]): number {
  let count = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
      const a = positions[i]!;
      // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
      const b = positions[j]!;
      if (isAncestorOrDescendant(ir, a.id, b.id)) continue;
      if (rectsOverlap(a, b)) count++;
    }
  }
  return count;
}

function node(id: string, label = id) {
  return { id, label };
}

function baseDoc(overrides: Partial<IrDocument>): IrDocument {
  return {
    version: 'v1',
    kind: 'aws-multi-az',
    nodes: [],
    containers: [],
    edges: [],
    ...overrides,
  };
}

describe('layoutGridZones', () => {
  it('places 2 sibling containers with 3 nodes each with zero pairwise overlaps', () => {
    const ir = baseDoc({
      nodes: [
        node('n1'),
        node('n2'),
        node('n3'),
        node('n4'),
        node('n5'),
        node('n6'),
      ],
      containers: [
        { id: 'c1', label: 'Zone A', kind: 'zone', children: ['n1', 'n2', 'n3'] },
        { id: 'c2', label: 'Zone B', kind: 'zone', children: ['n4', 'n5', 'n6'] },
      ],
    });

    const positions = layoutGridZones(ir);
    expect(positions).toHaveLength(8); // 6 nodes + 2 containers
    expect(badOverlapCount(ir, positions)).toBe(0);
  });

  it('positions nested containers (container inside container) without overlap between a parent and another branch\'s children', () => {
    const ir = baseDoc({
      nodes: [node('inner1'), node('inner2'), node('sibling1'), node('sibling2')],
      containers: [
        { id: 'outer', label: 'VPC', kind: 'vpc', children: ['middle', 'sibling1', 'sibling2'] },
        { id: 'middle', label: 'Subnet', kind: 'zone', children: ['inner1', 'inner2'] },
      ],
    });

    const positions = layoutGridZones(ir);
    expect(positions).toHaveLength(6); // 4 nodes + 2 containers
    expect(badOverlapCount(ir, positions)).toBe(0);

    // The nested container ("middle") must sit strictly inside its parent ("outer").
    const outer = positions.find((p) => p.id === 'outer');
    const middle = positions.find((p) => p.id === 'middle');
    expect(outer).toBeDefined();
    expect(middle).toBeDefined();
    if (outer && middle) {
      expect(middle.x).toBeGreaterThanOrEqual(outer.x);
      expect(middle.y).toBeGreaterThanOrEqual(outer.y);
      expect(middle.x + middle.width).toBeLessThanOrEqual(outer.x + outer.width);
      expect(middle.y + middle.height).toBeLessThanOrEqual(outer.y + outer.height);
    }

    // sibling1/sibling2 (direct children of "outer", siblings of "middle") must not
    // overlap "middle" or its descendants ("inner1"/"inner2") — cross-branch check.
    const middleDescendantIds = new Set(['middle', 'inner1', 'inner2']);
    const otherBranch = positions.filter((p) => !middleDescendantIds.has(p.id) && p.id !== 'outer');
    const middleBranch = positions.filter((p) => middleDescendantIds.has(p.id));
    for (const a of otherBranch) {
      for (const b of middleBranch) {
        expect(rectsOverlap(a, b)).toBe(false);
      }
    }
  });

  it('is deterministic: the same IR produces exactly the same positions across two calls', () => {
    const ir = baseDoc({
      nodes: [node('n1'), node('n2'), node('n3')],
      containers: [{ id: 'c1', label: 'Zone', kind: 'zone', children: ['n1', 'n2', 'n3'] }],
    });

    const first = layoutGridZones(ir);
    const second = layoutGridZones(ir);
    expect(second).toEqual(first);
  });
});
