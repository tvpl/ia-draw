import { describe, expect, it } from 'vitest';
import type { ArrowElement, CompiledScene, RectangleElement, TextElement } from './compile.js';
import { compile } from './compile.js';
import { geometryMetrics } from './metrics.js';
import type { IrDocument, IrEdge, IrKind, IrNode } from './schema.js';

// --- Minimal hand-built elements for the direct positive/negative tests ---
// (deliberately not going through compile() here, so overlap/crossing are
// asserted against scenes whose geometry is fully controlled by the test.)

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function rect(x: number, y: number, width: number, height: number): RectangleElement {
  return {
    id: nextId('rect'),
    type: 'rectangle',
    x,
    y,
    width,
    height,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roundness: null,
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: 1,
    version: 1,
    versionNonce: 1,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
  };
}

function text(value: string, width: number, height = 24): TextElement {
  return {
    ...rect(0, 0, width, height),
    id: nextId('text'),
    type: 'text',
    fontSize: 16,
    fontFamily: 5,
    text: value,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: null,
    originalText: value,
    autoResize: true,
    lineHeight: 1.25,
  };
}

function arrow(
  fromId: string,
  toId: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): ArrowElement {
  return {
    ...rect(x1, y1, Math.abs(x2 - x1), Math.abs(y2 - y1)),
    id: nextId('arrow'),
    type: 'arrow',
    points: [
      [0, 0],
      [x2 - x1, y2 - y1],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: fromId, focus: 0, gap: 4 },
    endBinding: { elementId: toId, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
  };
}

describe('geometryMetrics', () => {
  it('returns 0 for every metric on a manually built scene with no overlaps or crossings', () => {
    const scene: CompiledScene = {
      elements: [
        rect(0, 0, 100, 80),
        rect(200, 0, 100, 80),
        rect(400, 0, 100, 80),
        arrow('a', 'b', 100, 40, 200, 40),
        arrow('b', 'c', 300, 40, 400, 40),
      ],
    };

    const metrics = geometryMetrics(scene);
    expect(metrics.overlaps).toBe(0);
    expect(metrics.crossings).toBe(0);
  });

  it('does NOT count a container rectangle fully enclosing a smaller child rectangle as an overlap', () => {
    const scene: CompiledScene = {
      elements: [rect(0, 0, 400, 300), rect(50, 50, 100, 80)],
    };
    expect(geometryMetrics(scene).overlaps).toBe(0);
  });

  it('returns > 0 overlaps for a scene with two same-size sibling rectangles deliberately coinciding', () => {
    const scene: CompiledScene = {
      elements: [rect(0, 0, 100, 80), rect(20, 20, 100, 80)],
    };
    expect(geometryMetrics(scene).overlaps).toBeGreaterThan(0);
  });

  it('returns > 0 crossings for a scene with two edges that deliberately cross (an X shape, no shared endpoint)', () => {
    const scene: CompiledScene = {
      elements: [arrow('a', 'b', 0, 0, 100, 100), arrow('c', 'd', 0, 100, 100, 0)],
    };
    expect(geometryMetrics(scene).crossings).toBeGreaterThan(0);
  });

  it('does not count two edges sharing an endpoint node as a crossing (they meet there by design)', () => {
    const scene: CompiledScene = {
      elements: [arrow('a', 'b', 0, 0, 100, 100), arrow('b', 'c', 100, 100, 200, 0)],
    };
    expect(geometryMetrics(scene).crossings).toBe(0);
  });

  it('counts a text label whose estimated width exceeds its recorded width as truncated', () => {
    const scene: CompiledScene = {
      elements: [text('This label is far too long to fit in a narrow box', 40)],
    };
    expect(geometryMetrics(scene).truncatedLabels).toBe(1);
  });

  it('does not count a short label in a generously sized box as truncated', () => {
    const scene: CompiledScene = { elements: [text('OK', 200)] };
    expect(geometryMetrics(scene).truncatedLabels).toBe(0);
  });

  it('returns whitespaceBalance 0 for a perfectly evenly-spaced row of rectangles', () => {
    const scene: CompiledScene = {
      elements: [
        rect(0, 0, 100, 80),
        rect(200, 0, 100, 80),
        rect(400, 0, 100, 80),
        rect(600, 0, 100, 80),
      ],
    };
    expect(geometryMetrics(scene).whitespaceBalance).toBeCloseTo(0, 10);
  });

  it('returns a positive whitespaceBalance for unevenly-spaced rectangles', () => {
    const scene: CompiledScene = {
      elements: [rect(0, 0, 100, 80), rect(150, 0, 100, 80), rect(2000, 0, 100, 80)],
    };
    expect(geometryMetrics(scene).whitespaceBalance).toBeGreaterThan(0);
  });
});

// --- Property-based test: synthetic IRs up to 200 elements, all three T44-T46 engines ---

/** mulberry32 — tiny deterministic PRNG, same algorithm used elsewhere in this package. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNodes(count: number): IrNode[] {
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
}

/**
 * grid-zones kind: nodes distributed across 2-4 sibling containers, zero
 * edges. grid-zones (T44) lays out purely by containment, not by edge
 * topology, so a synthetic IR that also had edges would place them at
 * essentially arbitrary relative positions, making a "zero crossings"
 * claim meaningless rather than a real property of the layout — this
 * generator intentionally covers the containment-only diagrams grid-zones
 * targets (C4/cloud-zone diagrams), documented here rather than silently
 * assumed.
 */
function generateContainmentIr(kind: IrKind, nodeCount: number, seed: number): IrDocument {
  const rng = mulberry32(seed);
  const containerCount = 2 + Math.floor(rng() * 3); // 2..4
  const containers = Array.from({ length: containerCount }, (_, c) => ({
    id: `c${c}`,
    label: `Zone ${c}`,
    kind: 'zone' as const,
    children: [] as string[],
  }));
  const nodes = makeNodes(nodeCount);
  nodes.forEach((node, i) => {
    // biome-ignore lint/style/noNonNullAssertion: i % containerCount is always in range
    containers[i % containerCount]!.children.push(node.id);
  });
  return { version: 'v1', kind, nodes, containers, edges: [] };
}

/**
 * elk-layered kind: a tree (each node past the first has exactly one
 * parent, branching factor varies by seed) — no reconvergence, so the
 * layered algorithm's straight-line parent-child segments don't cross.
 * (A general DAG with reconvergent fan-in/fan-out isn't guaranteed
 * crossing-free for the straight-line center-to-center approximation
 * `geometryMetrics` uses — trees are the topology this generator commits
 * to proving, not an unbounded claim about every possible graph shape.)
 */
function generateTreeIr(kind: IrKind, nodeCount: number, seed: number): IrDocument {
  const rng = mulberry32(seed);
  const branchingFactor = 1 + Math.floor(rng() * 3); // 1..3
  const nodes = makeNodes(nodeCount);
  const edges: IrEdge[] = [];
  for (let i = 1; i < nodeCount; i++) {
    const parent = Math.floor((i - 1) / branchingFactor);
    edges.push({
      from: `n${parent}`,
      to: `n${i}`,
      semantics: { mode: 'dependency', direction: 'oneway' },
    });
  }
  return { version: 'v1', kind, nodes, containers: [], edges };
}

/**
 * business-flow kind: 2-5 swimlanes, each an internal linear chain
 * (round-robin assignment, edges only within a lane) — the topology
 * `layoutSwimlane`'s own T46 tests already proved crossing-free.
 */
function generateSwimlaneIr(nodeCount: number, seed: number): IrDocument {
  const rng = mulberry32(seed);
  const laneCount = 2 + Math.floor(rng() * 4); // 2..5
  const containers = Array.from({ length: laneCount }, (_, l) => ({
    id: `lane${l}`,
    label: `Lane ${l}`,
    kind: 'swimlane' as const,
    children: [] as string[],
  }));
  const nodes = makeNodes(nodeCount);
  const edges: IrEdge[] = [];
  nodes.forEach((node, i) => {
    // biome-ignore lint/style/noNonNullAssertion: i % laneCount is always in range
    const lane = containers[i % laneCount]!;
    const previous = lane.children.at(-1);
    if (previous) {
      edges.push({
        from: previous,
        to: node.id,
        semantics: { mode: 'dependency', direction: 'oneway' },
      });
    }
    lane.children.push(node.id);
  });
  return { version: 'v1', kind: 'business-flow', nodes, containers, edges };
}

interface SyntheticCase {
  name: string;
  ir: IrDocument;
}

/**
 * 21 variations (>= the task's own "pelo menos 20" suggestion), spanning
 * all three T44-T46 engines, sizes ranging up to 200 elements, several
 * seeds per shape for genuine variety while staying deterministic.
 */
function buildSyntheticCases(): SyntheticCase[] {
  const cases: SyntheticCase[] = [];
  const sizes = [3, 10, 25, 50, 100, 150, 200];

  sizes.forEach((size, index) => {
    cases.push({
      name: `grid-zones aws-multi-az n=${size}`,
      ir: generateContainmentIr('aws-multi-az', size, index * 3 + 1),
    });
    cases.push({
      name: `elk-layered microservices n=${size}`,
      ir: generateTreeIr('microservices', size, index * 3 + 2),
    });
    cases.push({
      name: `swimlane business-flow n=${size}`,
      ir: generateSwimlaneIr(size, index * 3 + 3),
    });
  });

  return cases;
}

describe('geometryMetrics property-based: zero overlaps/crossings across synthetic IRs', () => {
  const cases = buildSyntheticCases();
  it('generates at least 20 synthetic scenarios', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  for (const { name, ir } of buildSyntheticCases()) {
    it(`"${name}" compiles with zero overlaps and zero crossings`, async () => {
      const scene = await compile(ir, [], { seed: 99 });
      const metrics = geometryMetrics(scene);
      expect(metrics.overlaps).toBe(0);
      expect(metrics.crossings).toBe(0);
      // F2b Verifier (validation.md, AIG-03 gap): the zero-overlap/crossing sweep
      // never checked truncated labels at the same 200-element scale, only by hand
      // at small scenes. Sweep it here too — same synthetic cases, same assertion style.
      expect(metrics.truncatedLabels).toBe(0);
    });
  }
});
