import { describe, expect, it } from 'vitest';
import { parseMermaidFlowchart, toMermaidFlowchart } from './mermaid.js';

describe('parseMermaidFlowchart / toMermaidFlowchart (T60, AAC-01/02)', () => {
  it('parses a flowchart with 4 nodes, 1 subgraph, and 3 edges (one labeled) into a valid IrDocument', () => {
    const dsl = [
      'flowchart TD',
      'subgraph core[Core Services]',
      '  A[Auth Service]',
      '  B[Payment Service]',
      'end',
      'C[Web Client]',
      'D[Database]',
      'A --> D',
      'B --> D',
      'C -->|calls| A',
    ].join('\n');

    const { ir, limitations } = parseMermaidFlowchart(dsl);

    expect(limitations).toEqual([]);
    expect(ir.nodes).toHaveLength(4);
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(ir.edges).toHaveLength(3);

    const container = ir.containers.find((c) => c.id === 'core');
    expect(container).toMatchObject({ kind: 'group', label: 'Core Services' });
    expect(container?.children.sort()).toEqual(['A', 'B']);

    const labeledEdge = ir.edges.find((e) => e.from === 'C' && e.to === 'A');
    expect(labeledEdge?.semantics.label).toBe('calls');
    const unlabeledEdge = ir.edges.find((e) => e.from === 'A' && e.to === 'D');
    expect(unlabeledEdge?.semantics.label).toBeUndefined();
  });

  it('continues parsing past an unrecognized line, reporting it in limitations without corrupting the rest', () => {
    const dsl = [
      'flowchart TD',
      'A[Node A]',
      'this is not valid mermaid syntax at all !!',
      'B[Node B]',
      'A --> B',
    ].join('\n');

    const { ir, limitations } = parseMermaidFlowchart(dsl);

    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
    expect(ir.edges).toEqual([
      { from: 'A', to: 'B', semantics: { mode: 'dependency', direction: 'oneway' } },
    ]);
    expect(limitations).toHaveLength(1);
    expect(limitations[0]).toContain('this is not valid mermaid syntax at all !!');
  });

  it('toMermaidFlowchart of an edge with semantics.mode "data" produces valid DSL and mentions the semantic loss in limitations', () => {
    const ir = {
      version: 'v1' as const,
      kind: 'c4-context' as const,
      nodes: [
        { id: 'A', label: 'Producer' },
        { id: 'B', label: 'Consumer' },
      ],
      containers: [],
      edges: [
        { from: 'A', to: 'B', semantics: { mode: 'data' as const, direction: 'oneway' as const } },
      ],
    };

    const { dsl, limitations } = toMermaidFlowchart(ir);

    expect(dsl).toContain('A --> B');
    expect(limitations.length).toBeGreaterThan(0);
    expect(limitations[0]).toContain('data');

    // The exported DSL itself must still be parseable (never a total loss).
    const reparsed = parseMermaidFlowchart(dsl);
    expect(reparsed.ir.edges).toHaveLength(1);
  });

  it('round-trips a simple document (parse -> export -> parse) preserving nodes and edges', () => {
    const dsl = ['flowchart TD', 'A[Service A]', 'B[Service B]', 'A -->|talks to| B'].join('\n');

    const first = parseMermaidFlowchart(dsl);
    const exported = toMermaidFlowchart(first.ir);
    const second = parseMermaidFlowchart(exported.dsl);

    expect(second.ir.nodes.map((n) => n.id).sort()).toEqual(first.ir.nodes.map((n) => n.id).sort());
    expect(second.ir.edges.map((e) => [e.from, e.to])).toEqual(
      first.ir.edges.map((e) => [e.from, e.to]),
    );
    // Labels are preserved here since both node & edge labels round-trip through `[...]`/`|...|`
    // verbatim in this subset — documented limitation is about SHAPE (rect/round/diamond), which
    // is never preserved (every export re-emits `[label]` regardless of the original shape).
    expect(second.ir.nodes.map((n) => n.label).sort()).toEqual(
      first.ir.nodes.map((n) => n.label).sort(),
    );
  });
});
