import type { SceneElement } from '@arch-canvas/editor-adapter';
import { LIBRARY_MANIFEST } from '@arch-canvas/library-content';
import { describe, expect, it } from 'vitest';
import { createDefaultToolRegistry } from './registry.js';
import type { PatchOperation, ToolContext } from './types.js';
import {
  addAnnotationTool,
  alignElementsTool,
  autoLayoutTool,
  compileIrTool,
  connectElementsTool,
  createComponentTool,
  createElementTool,
  createFrameTool,
  createGroupTool,
  deleteElementsTool,
  distributeElementsTool,
  duplicateElementsTool,
  generateIrTool,
  resizeContainerTool,
  setSemanticMetadataTool,
  updateConnectorTool,
  updateElementTool,
  writeTools,
} from './writeTools.js';

const LIBRARY = LIBRARY_MANIFEST.items;

function rect(id: string, x: number, y: number, width = 100, height = 50): SceneElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
  } as unknown as SceneElement;
}

function arrow(id: string, fromId: string, toId: string): SceneElement {
  return {
    id,
    type: 'arrow',
    x: 100,
    y: 25,
    width: 200,
    height: 0,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    startBinding: { elementId: fromId },
    endBinding: { elementId: toId },
  } as unknown as SceneElement;
}

function baseScene(): SceneElement[] {
  return [rect('rect-a', 0, 0), rect('rect-b', 300, 0), arrow('arrow-ab', 'rect-a', 'rect-b')];
}

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    scene: baseScene(),
    selection: [],
    library: LIBRARY,
    ...overrides,
  };
}

function findOp(operations: PatchOperation[], elementId: string): PatchOperation | undefined {
  return operations.find(
    (operation) => 'elementId' in operation && operation.elementId === elementId,
  );
}

describe('write tools (T52, AIE-01) — every tool returns a well-formed AbstractPatch, no side effects', () => {
  it('create_element (shape) produces upsert operations for the shape and its bound label', async () => {
    const result = await createElementTool.execute(ctx(), {
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      label: 'Auth Service',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations).toHaveLength(2);
    const shapeOp = findOp(result.data.patch.operations, result.data.elementId);
    expect(shapeOp).toMatchObject({
      op: 'upsertElement',
      element: { type: 'rectangle', x: 10, y: 20 },
    });
  });

  it('create_element (text) requires label as content — schema-invalid without it returns a structured error', async () => {
    const registry = createDefaultToolRegistry();
    const result = await registry.execute(ctx(), 'create_element', 1, { type: 'text', x: 0, y: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('invalid_args');
  });

  it('create_component resolves the shape color/label from the authorized library and tags it with setMetadata', async () => {
    const result = await createComponentTool.execute(ctx(), { stableKey: 'aws.ec2', x: 0, y: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const metadataOp = result.data.patch.operations.find((op) => op.op === 'setMetadata');
    expect(metadataOp).toMatchObject({ op: 'setMetadata', metadata: { componentKey: 'aws.ec2' } });
    const shapeOp = findOp(result.data.patch.operations, result.data.elementId);
    expect(shapeOp).toMatchObject({ element: { strokeColor: '#ED7100' } });
  });

  it('create_component returns a structured error for a stableKey outside the authorized library', async () => {
    const result = await createComponentTool.execute(ctx({ library: [] }), {
      stableKey: 'aws.ec2',
      x: 0,
      y: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('component_not_found');
  });

  it('create_group appends the new groupId onto every referenced element, without touching unrelated elements', async () => {
    const result = await createGroupTool.execute(ctx(), {
      elementIds: ['rect-a', 'rect-b'],
      groupId: 'group-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations).toHaveLength(2);
    expect(findOp(result.data.patch.operations, 'rect-a')).toMatchObject({
      element: { groupIds: ['group-1'] },
    });
  });

  it('create_group with an elementId outside the diagram returns a structured error', async () => {
    const result = await createGroupTool.execute(ctx(), { elementIds: ['rect-a', 'not-in-scene'] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  it('create_frame creates the frame and reparents every childId onto it', async () => {
    const result = await createFrameTool.execute(ctx(), {
      label: 'Backend',
      x: 0,
      y: 0,
      width: 500,
      height: 200,
      childIds: ['rect-a', 'rect-b'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations).toHaveLength(3); // frame + 2 children
    const frameOp = findOp(result.data.patch.operations, result.data.frameId);
    expect(frameOp).toMatchObject({ element: { type: 'frame', name: 'Backend' } });
    expect(findOp(result.data.patch.operations, 'rect-a')).toMatchObject({
      element: { frameId: result.data.frameId },
    });
  });

  it('create_frame with an unknown childId returns a structured error', async () => {
    const result = await createFrameTool.execute(ctx(), {
      label: 'X',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      childIds: ['not-in-scene'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  it('update_element merges only the changed fields, preserving the rest of the element', async () => {
    const result = await updateElementTool.execute(ctx(), { elementId: 'rect-a', x: 999 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations).toEqual([
      {
        op: 'upsertElement',
        elementId: 'rect-a',
        element: expect.objectContaining({ x: 999, type: 'rectangle' }),
      },
    ]);
  });

  it('update_element referencing an elementId outside the diagram returns a structured error', async () => {
    const result = await updateElementTool.execute(ctx(), { elementId: 'not-in-scene', x: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  it('delete_elements produces one deleteElement operation per id', async () => {
    const result = await deleteElementsTool.execute(ctx(), { elementIds: ['rect-a', 'rect-b'] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations).toEqual([
      { op: 'deleteElement', elementId: 'rect-a' },
      { op: 'deleteElement', elementId: 'rect-b' },
    ]);
  });

  it('delete_elements referencing an elementId outside the diagram returns a structured error', async () => {
    const result = await deleteElementsTool.execute(ctx(), {
      elementIds: ['rect-a', 'not-in-scene'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  it('duplicate_elements creates new elements offset from the originals, with fresh ids', async () => {
    const result = await duplicateElementsTool.execute(ctx(), {
      elementIds: ['rect-a'],
      offsetX: 20,
      offsetY: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.createdIds).toHaveLength(1);
    expect(result.data.createdIds[0]).not.toBe('rect-a');
    const op = findOp(result.data.patch.operations, result.data.createdIds[0] as string);
    expect(op).toMatchObject({ element: { x: 20, y: 20 } });
  });

  it('connect_elements creates a bound arrow between two known elements', async () => {
    const result = await connectElementsTool.execute(ctx(), {
      fromId: 'rect-a',
      toId: 'rect-b',
      direction: 'oneway',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const arrowOp = findOp(result.data.patch.operations, result.data.connectorId);
    expect(arrowOp).toMatchObject({
      element: {
        type: 'arrow',
        startBinding: { elementId: 'rect-a' },
        endBinding: { elementId: 'rect-b' },
      },
    });
  });

  it('connect_elements referencing an unknown fromId returns a structured error', async () => {
    const result = await connectElementsTool.execute(ctx(), {
      fromId: 'not-in-scene',
      toId: 'rect-b',
      direction: 'oneway',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  it('update_connector on a non-arrow element returns a structured error', async () => {
    const result = await updateConnectorTool.execute(ctx(), {
      elementId: 'rect-a',
      direction: 'bidirectional',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('not_a_connector');
  });

  it('update_connector toggles both arrowheads when direction becomes bidirectional', async () => {
    const result = await updateConnectorTool.execute(ctx(), {
      elementId: 'arrow-ab',
      direction: 'bidirectional',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations).toEqual([
      {
        op: 'upsertElement',
        elementId: 'arrow-ab',
        element: expect.objectContaining({ startArrowhead: 'arrow' }),
      },
    ]);
  });

  it('set_semantic_metadata keeps only the known semantic fields, dropping anything else', async () => {
    const result = await setSemanticMetadataTool.execute(ctx(), {
      elementId: 'rect-a',
      metadata: {
        technology: 'nodejs',
        ...({ comments: ['secret note'] } as Record<string, unknown>),
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations).toEqual([
      { op: 'setMetadata', elementId: 'rect-a', metadata: { technology: 'nodejs' } },
    ]);
  });

  it('set_semantic_metadata on an unknown elementId returns a structured error', async () => {
    const result = await setSemanticMetadataTool.execute(ctx(), {
      elementId: 'not-in-scene',
      metadata: { technology: 'nodejs' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  it('align_elements("top") moves every element to the minimum y, leaving x untouched', async () => {
    const scene = [rect('rect-a', 0, 0), rect('rect-b', 300, 50), rect('rect-c', 600, 100)];
    const result = await alignElementsTool.execute(ctx({ scene }), {
      elementIds: ['rect-a', 'rect-b', 'rect-c'],
      axis: 'top',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    for (const id of ['rect-a', 'rect-b', 'rect-c']) {
      expect(findOp(result.data.patch.operations, id)).toMatchObject({ element: { y: 0 } });
    }
  });

  it('distribute_elements("horizontal") spaces the middle element evenly between the outer two', async () => {
    const scene = [rect('rect-a', 0, 0), rect('rect-b', 100, 0), rect('rect-c', 600, 0)];
    const result = await distributeElementsTool.execute(ctx({ scene }), {
      elementIds: ['rect-a', 'rect-b', 'rect-c'],
      axis: 'horizontal',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(findOp(result.data.patch.operations, 'rect-b')).toMatchObject({ element: { x: 300 } });
  });

  it('auto_layout repositions connected elements using the elk-layered engine, keeping a from->to left-to-right order', async () => {
    const result = await autoLayoutTool.execute(ctx(), { elementIds: ['rect-a', 'rect-b'] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const opA = findOp(result.data.patch.operations, 'rect-a');
    const opB = findOp(result.data.patch.operations, 'rect-b');
    if (opA?.op !== 'upsertElement' || opB?.op !== 'upsertElement') {
      throw new Error('expected upsertElement operations for both rect-a and rect-b');
    }
    const xA = opA.element.x as number;
    const xB = opB.element.x as number;
    expect(xA).toBeTypeOf('number');
    expect(xB).toBeTypeOf('number');
    // elk's "RIGHT" direction lays the source of an edge to the left of its target.
    expect(xA).toBeLessThan(xB);
  });

  it('resize_container updates only width/height', async () => {
    const result = await resizeContainerTool.execute(ctx(), {
      elementId: 'rect-a',
      width: 400,
      height: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations).toEqual([
      {
        op: 'upsertElement',
        elementId: 'rect-a',
        element: expect.objectContaining({ width: 400, height: 300, x: 0, y: 0 }),
      },
    ]);
  });

  it('resize_container on an unknown elementId returns a structured error', async () => {
    const result = await resizeContainerTool.execute(ctx(), {
      elementId: 'not-in-scene',
      width: 1,
      height: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  it('add_annotation creates a free-floating text element', async () => {
    const result = await addAnnotationTool.execute(ctx(), { text: 'needs review', x: 5, y: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const op = findOp(result.data.patch.operations, result.data.annotationId);
    expect(op).toMatchObject({ element: { type: 'text', text: 'needs review' } });
  });

  it('add_annotation with an unknown targetElementId returns a structured error', async () => {
    const result = await addAnnotationTool.execute(ctx(), {
      text: 'x',
      x: 0,
      y: 0,
      targetElementId: 'not-in-scene',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  const VALID_IR = {
    version: 'v1' as const,
    kind: 'microservices' as const,
    nodes: [
      { id: 'n1', label: 'API', componentKey: 'generic.compute.server' },
      { id: 'n2', label: 'DB', componentKey: 'generic.database.relational-database' },
    ],
    containers: [],
    edges: [
      { from: 'n1', to: 'n2', semantics: { mode: 'sync' as const, direction: 'oneway' as const } },
    ],
  };

  it('generate_ir validates and returns the IR without touching the scene (empty patch)', async () => {
    const result = await generateIrTool.execute(ctx(), VALID_IR);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.ir).toEqual(VALID_IR);
    expect(result.data.patch.operations).toEqual([]);
  });

  it('generate_ir returns a structured error for a document with a dangling edge reference', async () => {
    const invalidIr = {
      ...VALID_IR,
      edges: [
        {
          from: 'n1',
          to: 'does-not-exist',
          semantics: { mode: 'sync' as const, direction: 'oneway' as const },
        },
      ],
    };
    const result = await generateIrTool.execute(ctx(), invalidIr);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('invalid_ir');
  });

  it('compile_ir turns a validated IR into upsertElement operations via diagram-ir compile()', async () => {
    const result = await compileIrTool.execute(ctx(), VALID_IR);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.patch.operations.length).toBeGreaterThan(0);
    expect(result.data.patch.operations.every((op) => op.op === 'upsertElement')).toBe(true);
  });

  it('compile_ir returns a structured error for an unresolvable componentKey', async () => {
    const irWithBadKey = {
      ...VALID_IR,
      nodes: [{ id: 'n1', label: 'API', componentKey: 'does.not.exist' }],
      edges: [],
    };
    const result = await compileIrTool.execute(ctx(), irWithBadKey);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('unresolved_component');
  });

  it('no write tool mutates the ToolContext.scene it was given', async () => {
    const scene = baseScene();
    const snapshot = JSON.parse(JSON.stringify(scene));
    await createElementTool.execute(ctx({ scene }), { type: 'rectangle', x: 0, y: 0, label: 'x' });
    await updateElementTool.execute(ctx({ scene }), { elementId: 'rect-a', x: 42 });
    await deleteElementsTool.execute(ctx({ scene }), { elementIds: ['rect-a'] });
    expect(JSON.parse(JSON.stringify(scene))).toEqual(snapshot);
  });

  it('no write tool schema exposes a generic url/command/sql field (design.md §8.3)', () => {
    const forbiddenFieldNames = new Set(['url', 'command', 'cmd', 'shell', 'sql']);
    for (const tool of writeTools) {
      const properties = (tool.schema as { properties?: Record<string, unknown> }).properties ?? {};
      const fieldNames = Object.keys(properties).map((name) => name.toLowerCase());
      for (const forbidden of forbiddenFieldNames) {
        expect(fieldNames, `tool "${tool.name}" schema field names`).not.toContain(forbidden);
      }
    }
  });
});
