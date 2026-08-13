import type { SceneElement } from '@arch-canvas/editor-adapter';
import { describe, expect, it } from 'vitest';
import type { ElementMetadataRow } from '../library/metadata.js';
import { buildBestEffortIr, exportDslFromScene } from './exportDsl.js';

function rect(id: string, extra: Record<string, unknown> = {}): SceneElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    isDeleted: false,
    ...extra,
  } as unknown as SceneElement;
}

function boundText(id: string, containerId: string, text: string): SceneElement {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    text,
    containerId,
    isDeleted: false,
  } as unknown as SceneElement;
}

function arrow(
  id: string,
  startBinding: { elementId: string } | null,
  endBinding: { elementId: string } | null,
): SceneElement {
  return {
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    isDeleted: false,
    startBinding,
    endBinding,
  } as unknown as SceneElement;
}

function meta(
  elementId: string,
  fields: { semanticType?: string | null; metadataJson?: Record<string, unknown> },
): ElementMetadataRow {
  return {
    diagramId: 'd1',
    elementId,
    semanticType: fields.semanticType ?? null,
    metadataJson: fields.metadataJson ?? {},
    revision: 1,
  };
}

describe('buildBestEffortIr / exportDslFromScene (T68, AAC-02)', () => {
  it('builds a valid IrDocument with 2 nodes (bound-text labels resolved, not duplicated as their own node) and 1 edge', () => {
    const scene = [
      rect('a'),
      boundText('a-label', 'a', 'Service A'),
      rect('b'),
      boundText('b-label', 'b', 'Service B'),
      arrow('conn', { elementId: 'a' }, { elementId: 'b' }),
    ];

    const ir = buildBestEffortIr(scene, []);
    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(ir.nodes.find((n) => n.id === 'a')?.label).toBe('Service A');
    expect(ir.nodes.find((n) => n.id === 'b')?.label).toBe('Service B');
    expect(ir.containers).toEqual([]);
    expect(ir.edges).toEqual([
      { from: 'a', to: 'b', semantics: { mode: 'dependency', direction: 'oneway' } },
    ]);
  });

  it('a node with no resolvable label falls back to its own elementId', () => {
    const ir = buildBestEffortIr([rect('lonely')], []);
    expect(ir.nodes).toEqual([{ id: 'lonely', label: 'lonely' }]);
  });

  it("reads an edge's mode/protocol/direction from the connecting arrow's own metadata, defaulting to dependency/oneway when absent", () => {
    const scene = [rect('a'), rect('b'), arrow('conn', { elementId: 'a' }, { elementId: 'b' })];
    const elementsMeta = [
      meta('conn', {
        metadataJson: { mode: 'data', direction: 'bidirectional', protocol: 'grpc' },
      }),
    ];

    const ir = buildBestEffortIr(scene, elementsMeta);
    expect(ir.edges).toEqual([
      {
        from: 'a',
        to: 'b',
        semantics: { mode: 'data', direction: 'bidirectional', protocol: 'grpc' },
      },
    ]);
  });

  it('exportDslFromScene(mermaid) on a mode:"data" edge returns a DSL plus a limitations entry documenting the lost semantics', () => {
    const scene = [rect('a'), rect('b'), arrow('conn', { elementId: 'a' }, { elementId: 'b' })];
    const elementsMeta = [meta('conn', { metadataJson: { mode: 'data' } })];

    const { dsl, limitations } = exportDslFromScene('mermaid', scene, elementsMeta);
    expect(dsl).toContain('flowchart');
    expect(dsl).toContain('a --> b');
    expect(limitations.some((l) => l.toLowerCase().includes('data'))).toBe(true);
  });

  it('exportDslFromScene(mermaid) on a 2-node connected scene returns a valid DSL containing both labels', () => {
    const scene = [
      rect('a'),
      boundText('a-label', 'a', 'Checkout'),
      rect('b'),
      boundText('b-label', 'b', 'Payments'),
      arrow('conn', { elementId: 'a' }, { elementId: 'b' }),
    ];

    const { dsl } = exportDslFromScene('mermaid', scene, []);
    expect(dsl).toContain('Checkout');
    expect(dsl).toContain('Payments');
  });

  it('exportDslFromScene(structurizr) renders the same best-effort IR through toStructurizrDsl', () => {
    const scene = [rect('a'), rect('b'), arrow('conn', { elementId: 'a' }, { elementId: 'b' })];
    const { dsl } = exportDslFromScene('structurizr', scene, []);
    expect(dsl.length).toBeGreaterThan(0);
  });

  it('a deleted arrow is excluded from edges entirely', () => {
    const deletedArrow = {
      id: 'conn',
      type: 'arrow',
      x: 0,
      y: 0,
      isDeleted: true,
      startBinding: { elementId: 'a' },
      endBinding: { elementId: 'b' },
    } as unknown as SceneElement;
    const scene = [rect('a'), rect('b'), deletedArrow];
    const ir = buildBestEffortIr(scene, []);
    expect(ir.edges).toEqual([]);
  });
});
