import type { LibraryItem } from '@arch-canvas/library-content';
import { layoutElkLayered } from './layout/elkLayered.js';
import { layoutGridZones } from './layout/gridZones.js';
import { layoutSwimlane } from './layout/swimlane.js';
import type { PositionedNode } from './layout/types.js';
import type { IrDocument, IrEdge, IrKind, IrNode } from './schema.js';

/**
 * AD-008 discipline (see the lesson block at the top of tasks-f2b.md, and
 * `packages/diagram-domain/src/mergeScene.ts` for the established
 * precedent): this whole package runs server-side and must never import
 * `@excalidraw/excalidraw` or `@arch-canvas/editor-adapter` BY VALUE. Every
 * element this file builds is therefore hand-assembled plain data — never
 * via `restoreElements`/`convertToExcalidrawElements` — with the exact
 * field set `@arch-canvas/editor-adapter`'s `SceneElement` type requires
 * (verified directly against `@excalidraw/excalidraw`'s own shipped
 * `element/types.d.ts` — `_ExcalidrawElementBase`, `ExcalidrawTextElement`,
 * `ExcalidrawLinearElement`/`ExcalidrawArrowElement`, `PointBinding`,
 * `BoundElement` — while writing this file, reading only, no runtime
 * import), mirroring the same plain-data convention
 * `packages/test-fixtures/src/generateScene.ts` already established for
 * exactly this reason.
 *
 * `CompiledElement` is intentionally a local structural type, not
 * `import type { SceneElement }` from editor-adapter: `SceneElement` there
 * is `ReturnType<typeof restoreElements>[number]` — every field is
 * `Readonly<...>`, which is correct for elements that came out of
 * `restoreElements`, but this compiler never calls that function, so
 * asserting the exact upstream type would overclaim a runtime guarantee
 * (e.g. actual immutability) this code doesn't provide. The field set
 * below matches it exactly; only the nominal type differs.
 */

/** Minimal mutable-object shape a well-formed base Excalidraw-style element needs. */
interface BaseElementFields {
  id: string;
  x: number;
  y: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: 'solid';
  strokeWidth: number;
  strokeStyle: 'solid';
  roundness: null;
  roughness: number;
  opacity: number;
  width: number;
  height: number;
  angle: number;
  seed: number;
  version: number;
  versionNonce: number;
  index: null;
  isDeleted: boolean;
  groupIds: string[];
  frameId: null;
  boundElements: { id: string; type: 'arrow' | 'text' }[] | null;
  updated: number;
  link: null;
  locked: boolean;
}

export interface RectangleElement extends BaseElementFields {
  type: 'rectangle';
}

export interface TextElement extends BaseElementFields {
  type: 'text';
  fontSize: number;
  fontFamily: number;
  text: string;
  textAlign: 'center';
  verticalAlign: 'middle';
  containerId: string | null;
  originalText: string;
  autoResize: boolean;
  lineHeight: number;
}

export interface ArrowElement extends BaseElementFields {
  type: 'arrow';
  points: [number, number][];
  lastCommittedPoint: null;
  startBinding: { elementId: string; focus: number; gap: number } | null;
  endBinding: { elementId: string; focus: number; gap: number } | null;
  startArrowhead: 'arrow' | null;
  endArrowhead: 'arrow' | null;
  elbowed: boolean;
}

export type CompiledElement = RectangleElement | TextElement | ArrowElement;

export interface CompiledScene {
  elements: CompiledElement[];
}

export type CompileErrorCode = 'unknown_component_key';

export interface CompileIssue {
  code: CompileErrorCode;
  nodeId: string;
  componentKey: string;
}

/**
 * Thrown by `compile()` when one or more nodes reference a `componentKey`
 * that doesn't resolve against `library` by `stableKey` — a structured
 * error, never a generic exception, and no partial/half-built scene is
 * returned alongside it.
 */
export class CompileError extends Error {
  readonly issues: CompileIssue[];

  constructor(issues: CompileIssue[]) {
    super(
      `compile failed: ${issues
        .map(
          (issue) =>
            `node "${issue.nodeId}" references unknown componentKey "${issue.componentKey}"`,
        )
        .join('; ')}`,
    );
    this.name = 'CompileError';
    this.issues = issues;
  }
}

export interface CompileOptions {
  /**
   * Seeds the deterministic PRNG used for `seed`/`versionNonce` — tests
   * pass a fixed seed for byte-identical output across calls; production
   * omits it, which falls back to `Math.random()` (per T47's "aleatório em
   * produção" instruction).
   */
  seed?: number;
}

/** mulberry32 — tiny deterministic PRNG, same public-domain algorithm test-fixtures uses. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRandomInt(options: CompileOptions): () => number {
  const rng = options.seed === undefined ? Math.random : mulberry32(options.seed);
  return () => Math.floor(rng() * 2 ** 31);
}

const DEFAULT_STROKE_COLOR = '#1e1e1e';
const DEFAULT_BACKGROUND_COLOR = 'transparent';
const FONT_SIZE = 16;
const FONT_FAMILY = 5; // matches the convention `packages/test-fixtures/src/generateScene.ts` uses

function baseFields(
  id: string,
  positioned: PositionedNode,
  randomInt: () => number,
  strokeColor: string,
): BaseElementFields {
  return {
    id,
    x: positioned.x,
    y: positioned.y,
    width: positioned.width,
    height: positioned.height,
    strokeColor,
    backgroundColor: DEFAULT_BACKGROUND_COLOR,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roundness: null,
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function buildLabelElement(
  labelId: string,
  containerId: string,
  label: string,
  containerBox: PositionedNode,
  randomInt: () => number,
): TextElement {
  return {
    ...baseFields(
      labelId,
      {
        id: labelId,
        x: containerBox.x,
        y: containerBox.y,
        width: containerBox.width,
        height: containerBox.height,
      },
      randomInt,
      DEFAULT_STROKE_COLOR,
    ),
    type: 'text',
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    text: label,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId,
    originalText: label,
    autoResize: true,
    lineHeight: 1.25,
  };
}

function buildRectangleElement(
  id: string,
  label: string,
  positioned: PositionedNode,
  color: string,
  randomInt: () => number,
  elements: CompiledElement[],
): void {
  const labelId = `${id}__label`;
  const rect: RectangleElement = {
    ...baseFields(id, positioned, randomInt, color),
    type: 'rectangle',
    boundElements: [{ id: labelId, type: 'text' }],
  };
  elements.push(rect);
  elements.push(buildLabelElement(labelId, id, label, positioned, randomInt));
}

function buildArrowElement(
  edge: IrEdge,
  index: number,
  positionedById: Map<string, PositionedNode>,
  randomInt: () => number,
  elements: CompiledElement[],
): void {
  const fromBox = positionedById.get(edge.from);
  const toBox = positionedById.get(edge.to);
  if (!fromBox || !toBox) return; // unreachable for a validateIr()-passed document; see schema.ts referential checks

  const fromCenter = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 };
  const toCenter = { x: toBox.x + toBox.width / 2, y: toBox.y + toBox.height / 2 };
  const id = `edge-${index}`;
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  const arrow: ArrowElement = {
    ...baseFields(
      id,
      { id, x: fromCenter.x, y: fromCenter.y, width: Math.abs(dx), height: Math.abs(dy) },
      randomInt,
      DEFAULT_STROKE_COLOR,
    ),
    type: 'arrow',
    points: [
      [0, 0],
      [dx, dy],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: edge.from, focus: 0, gap: 4 },
    endBinding: { elementId: edge.to, focus: 0, gap: 4 },
    startArrowhead: edge.semantics.direction === 'bidirectional' ? 'arrow' : null,
    endArrowhead: 'arrow',
    elbowed: false,
  };
  elements.push(arrow);

  if (edge.semantics.label) {
    const labelId = `${id}__label`;
    const midpoint = { x: fromCenter.x + dx / 2, y: fromCenter.y + dy / 2 };
    arrow.boundElements = [{ id: labelId, type: 'text' }];
    elements.push(
      buildLabelElement(
        labelId,
        id,
        edge.semantics.label,
        { id: labelId, x: midpoint.x - 40, y: midpoint.y - 12, width: 80, height: 24 },
        randomInt,
      ),
    );
  }
}

/**
 * Picks the layout engine per `ir.kind`, per T47's mapping: grid-zones for
 * cloud-zone/C4 diagrams (and `wireframe`, a reasonable default for laying
 * out screen blocks — not explicitly assigned by the spec, so documented
 * here rather than guessed silently), elk-layered for flow-shaped
 * diagrams, swimlane for business flows.
 */
async function layoutFor(ir: IrDocument): Promise<PositionedNode[]> {
  const kind: IrKind = ir.kind;
  switch (kind) {
    case 'aws-multi-az':
    case 'c4-context':
    case 'c4-container':
    case 'wireframe':
      return layoutGridZones(ir);
    case 'microservices':
    case 'event-driven':
    case 'network-topology':
      return layoutElkLayered(ir);
    case 'business-flow':
      return layoutSwimlane(ir);
    default: {
      // Exhaustiveness guard: IR_KINDS/IrKind are the only valid values per
      // validateIr(), so this is unreachable for any validated document.
      const _exhaustive: never = kind;
      throw new Error(`compile: unhandled ir.kind "${_exhaustive as string}"`);
    }
  }
}

/**
 * Compiles a validated `IrDocument` into a `CompiledScene` of well-formed,
 * plain-data scene elements: resolves each node's `componentKey` against
 * `library` by `stableKey`, lays out the whole document with the engine
 * `ir.kind` selects, then builds one rectangle (+ bound text label) per
 * node/container and one arrow (+ optional bound text label) per edge.
 *
 * Returns a `Promise` (not a bare `CompiledScene`) because the
 * elk-layered engine (T45) is itself async — `elkjs`'s `layout()` always
 * returns a `Promise`, so any caller of it must too.
 */
export async function compile(
  ir: IrDocument,
  library: LibraryItem[],
  options: CompileOptions = {},
): Promise<CompiledScene> {
  const libraryByKey = new Map(library.map((item) => [item.stableKey, item]));

  const issues: CompileIssue[] = ir.nodes
    .filter((node): node is IrNode & { componentKey: string } => Boolean(node.componentKey))
    .filter((node) => !libraryByKey.has(node.componentKey))
    .map((node) => ({
      code: 'unknown_component_key' as const,
      nodeId: node.id,
      componentKey: node.componentKey,
    }));

  if (issues.length > 0) {
    throw new CompileError(issues);
  }

  const positioned = await layoutFor(ir);
  const positionedById = new Map(positioned.map((p) => [p.id, p]));
  const randomInt = makeRandomInt(options);

  const elements: CompiledElement[] = [];

  for (const container of ir.containers) {
    const box = positionedById.get(container.id);
    if (!box) continue;
    buildRectangleElement(
      container.id,
      container.label,
      box,
      DEFAULT_STROKE_COLOR,
      randomInt,
      elements,
    );
  }

  for (const node of ir.nodes) {
    const box = positionedById.get(node.id);
    if (!box) continue;
    const component = node.componentKey ? libraryByKey.get(node.componentKey) : undefined;
    const color = component?.color ?? DEFAULT_STROKE_COLOR;
    buildRectangleElement(node.id, node.label, box, color, randomInt, elements);
  }

  ir.edges.forEach((edge, index) => {
    buildArrowElement(edge, index, positionedById, randomInt, elements);
  });

  return { elements };
}
