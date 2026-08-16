import { LIBRARY_MANIFEST } from '@arch-canvas/library-content';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { type DecompileMetadataInput, decompile } from './decompile.js';
import { type IrDocument, validateIr } from './schema.js';

const library = LIBRARY_MANIFEST.items;

function baseDoc(overrides: Partial<IrDocument>): IrDocument {
  return {
    version: 'v1',
    kind: 'aws-multi-az', // grid-zones layout (compile.ts's layoutFor): geometrically nests container boxes around their children, unlike elk-layered/swimlane.
    nodes: [],
    containers: [],
    edges: [],
    ...overrides,
  };
}

describe('decompile', () => {
  it('reconstructs simple standalone nodes (id/label) from a real compiled scene', async () => {
    const ir = baseDoc({
      nodes: [
        { id: 'n1', label: 'Web server' },
        { id: 'n2', label: 'Database' },
      ],
    });
    const scene = await compile(ir, library, { seed: 1 });

    const decompiled = decompile(scene.elements, []);

    expect(decompiled.containers).toEqual([]);
    expect(new Set(decompiled.nodes.map((n) => n.id))).toEqual(new Set(['n1', 'n2']));
    expect(decompiled.nodes.find((n) => n.id === 'n1')?.label).toBe('Web server');
    expect(decompiled.nodes.find((n) => n.id === 'n2')?.label).toBe('Database');
  });

  it('reconstructs edges from arrow bindings, including direction and the bound label', async () => {
    const ir = baseDoc({
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [
        {
          from: 'n1',
          to: 'n2',
          semantics: { mode: 'sync', direction: 'bidirectional', label: 'reads from' },
        },
      ],
    });
    const scene = await compile(ir, library, { seed: 2 });

    const decompiled = decompile(scene.elements, []);

    expect(decompiled.edges).toHaveLength(1);
    expect(decompiled.edges[0]?.from).toBe('n1');
    expect(decompiled.edges[0]?.to).toBe('n2');
    // Direction round-trips exactly: compile() encodes it into startArrowhead, decompile() reads it back.
    expect(decompiled.edges[0]?.semantics.direction).toBe('bidirectional');
    // Label round-trips exactly: compile() binds it as a text child, extractSceneSemantics resolves it back.
    expect(decompiled.edges[0]?.semantics.label).toBe('reads from');
  });

  it('recovers componentKey/semantics for a node and mode/protocol for an edge from metadata, when present', async () => {
    const ir = baseDoc({
      nodes: [
        { id: 'n1', label: 'Web server', componentKey: 'generic.compute.server' },
        { id: 'n2', label: 'Database' },
      ],
      edges: [{ from: 'n1', to: 'n2', semantics: { mode: 'sync', direction: 'oneway' } }],
    });
    const scene = await compile(ir, library, { seed: 3 });
    const arrow = scene.elements.find((el) => el.type === 'arrow');
    expect(arrow).toBeDefined();

    const metadata: DecompileMetadataInput[] = [
      {
        elementId: 'n1',
        metadataJson: { componentKey: 'generic.compute.server', technology: 'Node.js' },
      },
      // biome-ignore lint/style/noNonNullAssertion: asserted defined above
      { elementId: arrow!.id, metadataJson: { mode: 'async', protocol: 'grpc' } },
    ];

    const decompiled = decompile(scene.elements, metadata);

    const n1 = decompiled.nodes.find((n) => n.id === 'n1');
    expect(n1?.componentKey).toBe('generic.compute.server');
    expect(n1?.semantics).toEqual({ technology: 'Node.js' });

    expect(decompiled.edges[0]?.semantics.mode).toBe('async');
    expect(decompiled.edges[0]?.semantics.protocol).toBe('grpc');
  });

  it('infers a 1-level container by geometric containment, kind always "group"', async () => {
    const ir = baseDoc({
      nodes: [
        { id: 'n1', label: 'Web server' },
        { id: 'n2', label: 'Database' },
      ],
      containers: [{ id: 'c1', label: 'VPC', kind: 'vpc', children: ['n1', 'n2'] }],
    });
    const scene = await compile(ir, library, { seed: 4 });

    const decompiled = decompile(scene.elements, []);

    expect(decompiled.containers).toHaveLength(1);
    const c1 = decompiled.containers[0];
    expect(c1?.id).toBe('c1');
    expect(c1?.label).toBe('VPC');
    // Semantic kind ('vpc') is not recoverable from geometry — always 'group', disclosed in design.md.
    expect(c1?.kind).toBe('group');
    expect(new Set(c1?.children)).toEqual(new Set(['n1', 'n2']));
    // n1/n2 remain independent IrNode entries too (containers reference, not replace, node entities).
    expect(new Set(decompiled.nodes.map((n) => n.id))).toEqual(new Set(['n1', 'n2']));
  });

  it('infers nested containers, associating each child with its direct (innermost) parent', async () => {
    const ir = baseDoc({
      nodes: [
        { id: 'n1', label: 'Web server' },
        { id: 'n2', label: 'Database' },
      ],
      containers: [
        { id: 'c1', label: 'Subnet', kind: 'zone', children: ['n1', 'n2'] },
        { id: 'c2', label: 'VPC', kind: 'vpc', children: ['c1'] },
      ],
    });
    const scene = await compile(ir, library, { seed: 5 });

    const decompiled = decompile(scene.elements, []);

    expect(decompiled.containers).toHaveLength(2);
    const c1 = decompiled.containers.find((c) => c.id === 'c1');
    const c2 = decompiled.containers.find((c) => c.id === 'c2');
    expect(new Set(c1?.children)).toEqual(new Set(['n1', 'n2']));
    // c2's only child is c1 itself, not n1/n2 directly (n1/n2's direct/innermost parent is c1, not c2).
    expect(c2?.children).toEqual(['c1']);
  });

  it('turns a rectangle with no contained rectangle into a plain node, never an empty container', async () => {
    const ir = baseDoc({
      nodes: [
        { id: 'n1', label: 'Contained' },
        { id: 'n2', label: 'Standalone' },
      ],
      containers: [{ id: 'c1', label: 'VPC', kind: 'vpc', children: ['n1'] }],
    });
    const scene = await compile(ir, library, { seed: 6 });

    const decompiled = decompile(scene.elements, []);

    expect(decompiled.containers.map((c) => c.id)).toEqual(['c1']);
    expect(decompiled.containers.find((c) => c.id === 'n2')).toBeUndefined();
    expect(decompiled.nodes.map((n) => n.id)).toContain('n2');
  });

  it('does not throw on an empty scene, returning a structurally valid empty document', () => {
    const decompiled = decompile([], []);

    expect(decompiled.nodes).toEqual([]);
    expect(decompiled.containers).toEqual([]);
    expect(decompiled.edges).toEqual([]);
    expect(() => validateIr(decompiled)).not.toThrow();
  });

  it('round-trips compile(ir) -> scene -> decompile(scene): same nodes/edges by id, same container parent-child associations', async () => {
    const ir = baseDoc({
      nodes: [
        { id: 'n1', label: 'Web server', componentKey: 'generic.compute.server' },
        { id: 'n2', label: 'Database' },
        { id: 'n3', label: 'Standalone' },
      ],
      containers: [
        { id: 'c1', label: 'Subnet', kind: 'zone', children: ['n1', 'n2'] },
        { id: 'c2', label: 'VPC', kind: 'vpc', children: ['c1'] },
      ],
      edges: [
        { from: 'n1', to: 'n2', semantics: { mode: 'sync', direction: 'oneway', label: 'reads' } },
        { from: 'n3', to: 'n1', semantics: { mode: 'async', direction: 'bidirectional' } },
      ],
    });
    const scene = await compile(ir, library, { seed: 42 });

    const decompiled = decompile(scene.elements, []);

    // validateIr() proves the reverse-compiled document is itself schema-valid, not just non-throwing.
    expect(() => validateIr(decompiled)).not.toThrow();

    expect(new Set(decompiled.nodes.map((n) => n.id))).toEqual(new Set(ir.nodes.map((n) => n.id)));
    expect(new Set(decompiled.edges.map((e) => `${e.from}->${e.to}`))).toEqual(
      new Set(ir.edges.map((e) => `${e.from}->${e.to}`)),
    );

    // Container parent-child association survives by id (kind does not — geometrically unrecoverable, see design.md).
    const originalChildrenById = new Map(ir.containers.map((c) => [c.id, new Set(c.children)]));
    for (const container of decompiled.containers) {
      expect(originalChildrenById.has(container.id)).toBe(true);
      expect(new Set(container.children)).toEqual(originalChildrenById.get(container.id));
    }
    expect(new Set(decompiled.containers.map((c) => c.id))).toEqual(
      new Set(ir.containers.map((c) => c.id)),
    );
  });
});
