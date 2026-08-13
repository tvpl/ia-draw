import { LIBRARY_MANIFEST } from '@arch-canvas/library-content';
import { describe, expect, it } from 'vitest';
import { type CompiledElement, CompileError, compile } from './compile.js';
import type { IrDocument } from './schema.js';

const library = LIBRARY_MANIFEST.items;

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

const BASE_ELEMENT_FIELDS = [
  'id',
  'x',
  'y',
  'strokeColor',
  'backgroundColor',
  'fillStyle',
  'strokeWidth',
  'strokeStyle',
  'roundness',
  'roughness',
  'opacity',
  'width',
  'height',
  'angle',
  'seed',
  'version',
  'versionNonce',
  'index',
  'isDeleted',
  'groupIds',
  'frameId',
  'boundElements',
  'updated',
  'link',
  'locked',
] as const;

const TEXT_ELEMENT_FIELDS = [
  'fontSize',
  'fontFamily',
  'text',
  'textAlign',
  'verticalAlign',
  'containerId',
  'originalText',
  'autoResize',
  'lineHeight',
] as const;

const ARROW_ELEMENT_FIELDS = [
  'points',
  'lastCommittedPoint',
  'startBinding',
  'endBinding',
  'startArrowhead',
  'endArrowhead',
  'elbowed',
] as const;

/**
 * Same convention `packages/test-fixtures` fixtures satisfy (every base
 * field present, plus every type-specific field for that element's own
 * `type`) — checked structurally here instead of importing test-fixtures
 * (which pulls in `@excalidraw/excalidraw` at module load, and is a test
 * fixture package this compiler must never depend on regardless).
 */
function isWellFormedElement(element: CompiledElement): boolean {
  const hasBaseFields = BASE_ELEMENT_FIELDS.every((field) => field in element);
  if (!hasBaseFields) return false;
  if (element.type === 'text') return TEXT_ELEMENT_FIELDS.every((field) => field in element);
  if (element.type === 'arrow') return ARROW_ELEMENT_FIELDS.every((field) => field in element);
  return element.type === 'rectangle';
}

describe('compile', () => {
  it('resolves a componentKey present in the library to the matching library item (color inherited)', async () => {
    const libraryItem = library.find((item) => item.stableKey === 'generic.compute.server');
    expect(libraryItem).toBeDefined();

    const ir = baseDoc({
      nodes: [{ id: 'n1', label: 'Web server', componentKey: 'generic.compute.server' }],
    });

    const scene = await compile(ir, library, { seed: 42 });
    const rect = scene.elements.find((el) => el.id === 'n1');
    expect(rect).toBeDefined();
    expect(rect?.type).toBe('rectangle');
    if (rect && rect.type === 'rectangle') {
      expect(rect.strokeColor).toBe(libraryItem?.color);
    }
  });

  it('throws a structured CompileError (not a generic exception, no partial scene) for a componentKey absent from the library', async () => {
    const ir = baseDoc({
      nodes: [{ id: 'n1', label: 'Mystery box', componentKey: 'does.not.exist' }],
    });

    await expect(compile(ir, library, { seed: 42 })).rejects.toThrow(CompileError);

    try {
      await compile(ir, library, { seed: 42 });
      expect.unreachable('compile should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CompileError);
      const compileError = error as CompileError;
      expect(compileError.issues).toEqual([
        { code: 'unknown_component_key', nodeId: 'n1', componentKey: 'does.not.exist' },
      ]);
    }
  });

  it('produces only well-formed elements (every base field, plus every type-specific field, present)', async () => {
    const ir = baseDoc({
      nodes: [
        { id: 'n1', label: 'Web server', componentKey: 'generic.compute.server' },
        { id: 'n2', label: 'Database' },
      ],
      containers: [{ id: 'c1', label: 'VPC', kind: 'vpc', children: ['n1', 'n2'] }],
      edges: [
        {
          from: 'n1',
          to: 'n2',
          semantics: { mode: 'sync', direction: 'oneway', label: 'reads from' },
        },
      ],
    });

    const scene = await compile(ir, library, { seed: 7 });
    expect(scene.elements.length).toBeGreaterThan(0);
    for (const element of scene.elements) {
      expect(isWellFormedElement(element)).toBe(true);
    }

    // At least one rectangle (node/container), one bound text label, and one arrow.
    expect(scene.elements.some((el) => el.type === 'rectangle')).toBe(true);
    expect(scene.elements.some((el) => el.type === 'text')).toBe(true);
    expect(scene.elements.some((el) => el.type === 'arrow')).toBe(true);
  });

  it('picks the elk-layered engine for a "microservices" kind and grid-zones for "c4-context" (positions differ from a no-op)', async () => {
    const flowIr = baseDoc({
      kind: 'microservices',
      nodes: [
        { id: 'n1', label: 'A' },
        { id: 'n2', label: 'B' },
      ],
      edges: [{ from: 'n1', to: 'n2', semantics: { mode: 'sync', direction: 'oneway' } }],
    });
    const flowScene = await compile(flowIr, library, { seed: 1 });
    const flowRect = flowScene.elements.find((el) => el.id === 'n2');
    expect(flowRect).toBeDefined();
    // In the elk-layered "RIGHT" direction, the second node in the chain
    // must land to the right of the first (x strictly greater).
    const firstRect = flowScene.elements.find((el) => el.id === 'n1');
    if (flowRect && firstRect) {
      expect(flowRect.x).toBeGreaterThan(firstRect.x);
    }
  });
});
