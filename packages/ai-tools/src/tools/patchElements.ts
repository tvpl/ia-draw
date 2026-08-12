import { randomUUID } from 'node:crypto';

/**
 * Local, hand-assembled plain-data element builders for the write tools
 * (T52) — mirrors `packages/diagram-ir/src/compile.ts`'s own convention
 * (see that file's docstring for the full AD-008 rationale): this package
 * runs server-side and must never import `@excalidraw/excalidraw` or
 * `@arch-canvas/editor-adapter` BY VALUE, so every element a write tool
 * creates is built here as a plain, structurally-compatible object — never
 * via `restoreElements`/`convertToExcalidrawElements`.
 */

export interface BaseElementFields {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: 'solid';
  strokeWidth: number;
  strokeStyle: 'solid';
  roundness: null;
  roughness: number;
  opacity: number;
  angle: number;
  seed: number;
  version: number;
  versionNonce: number;
  index: null;
  isDeleted: boolean;
  groupIds: string[];
  frameId: string | null;
  boundElements: { id: string; type: 'arrow' | 'text' }[] | null;
  updated: number;
  link: null;
  locked: boolean;
}

export type ShapeType = 'rectangle' | 'ellipse' | 'diamond';

export interface ShapePatchElement extends BaseElementFields {
  type: ShapeType;
}

export interface TextPatchElement extends BaseElementFields {
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

export interface ArrowPatchElement extends BaseElementFields {
  type: 'arrow';
  points: [number, number][];
  lastCommittedPoint: null;
  startBinding: { elementId: string; focus: number; gap: number } | null;
  endBinding: { elementId: string; focus: number; gap: number } | null;
  startArrowhead: 'arrow' | null;
  endArrowhead: 'arrow' | null;
  elbowed: boolean;
}

export interface FramePatchElement extends BaseElementFields {
  type: 'frame';
  name: string;
}

export type PatchElement =
  | ShapePatchElement
  | TextPatchElement
  | ArrowPatchElement
  | FramePatchElement;

export const DEFAULT_STROKE_COLOR = '#1e1e1e';
export const DEFAULT_BACKGROUND_COLOR = 'transparent';
const FONT_SIZE = 16;
const FONT_FAMILY = 5; // matches the convention packages/diagram-ir/src/compile.ts and packages/test-fixtures/src/generateScene.ts use
const DEFAULT_SHAPE_WIDTH = 140;
const DEFAULT_SHAPE_HEIGHT = 80;

export function newElementId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** Widens a strongly-typed `PatchElement` to the plain `Record<string, unknown>` shape `PatchOperation.element` carries — every field is still present, only the nominal type is erased. */
export function toPatchRecord(element: PatchElement): Record<string, unknown> {
  return { ...element };
}

function baseFields(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  strokeColor: string,
  backgroundColor: string,
): BaseElementFields {
  return {
    id,
    x,
    y,
    width,
    height,
    strokeColor,
    backgroundColor,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roundness: null,
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
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

export function buildTextElement(args: {
  id?: string;
  containerId?: string | null;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
}): TextPatchElement {
  const id = args.id ?? newElementId('text');
  return {
    ...baseFields(
      id,
      args.x,
      args.y,
      args.width ?? Math.max(40, args.text.length * 8),
      args.height ?? 24,
      DEFAULT_STROKE_COLOR,
      DEFAULT_BACKGROUND_COLOR,
    ),
    type: 'text',
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    text: args.text,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: args.containerId ?? null,
    originalText: args.text,
    autoResize: true,
    lineHeight: 1.25,
  };
}

/** Builds a shape (+ optional bound text label) — mirrors `compile.ts`'s `buildRectangleElement`, generalized to rectangle/ellipse/diamond. */
export function buildShapeElement(args: {
  id?: string;
  type: ShapeType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string;
  strokeColor?: string;
  backgroundColor?: string;
}): { shape: ShapePatchElement; label: TextPatchElement | null } {
  const id = args.id ?? newElementId(args.type);
  const width = args.width ?? DEFAULT_SHAPE_WIDTH;
  const height = args.height ?? DEFAULT_SHAPE_HEIGHT;

  const label = args.label
    ? buildTextElement({
        id: `${id}__label`,
        containerId: id,
        x: args.x,
        y: args.y,
        width,
        height,
        text: args.label,
      })
    : null;

  const shape: ShapePatchElement = {
    ...baseFields(
      id,
      args.x,
      args.y,
      width,
      height,
      args.strokeColor ?? DEFAULT_STROKE_COLOR,
      args.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
    ),
    type: args.type,
    boundElements: label ? [{ id: label.id, type: 'text' }] : null,
  };

  return { shape, label };
}

export function buildFrameElement(args: {
  id?: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): FramePatchElement {
  const id = args.id ?? newElementId('frame');
  return {
    ...baseFields(
      id,
      args.x,
      args.y,
      args.width,
      args.height,
      DEFAULT_STROKE_COLOR,
      DEFAULT_BACKGROUND_COLOR,
    ),
    type: 'frame',
    name: args.label,
  };
}

/** Builds a connecting arrow (+ optional bound label) between two known boxes — mirrors `compile.ts`'s `buildArrowElement`. */
export function buildArrowElement(args: {
  id?: string;
  fromId: string;
  fromBox: { x: number; y: number; width: number; height: number };
  toId: string;
  toBox: { x: number; y: number; width: number; height: number };
  bidirectional?: boolean;
  label?: string;
}): { arrow: ArrowPatchElement; label: TextPatchElement | null } {
  const id = args.id ?? newElementId('arrow');
  const fromCenter = {
    x: args.fromBox.x + args.fromBox.width / 2,
    y: args.fromBox.y + args.fromBox.height / 2,
  };
  const toCenter = {
    x: args.toBox.x + args.toBox.width / 2,
    y: args.toBox.y + args.toBox.height / 2,
  };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  const label = args.label
    ? buildTextElement({
        id: `${id}__label`,
        containerId: id,
        x: fromCenter.x + dx / 2 - 40,
        y: fromCenter.y + dy / 2 - 12,
        width: 80,
        height: 24,
        text: args.label,
      })
    : null;

  const arrow: ArrowPatchElement = {
    ...baseFields(
      id,
      fromCenter.x,
      fromCenter.y,
      Math.abs(dx),
      Math.abs(dy),
      DEFAULT_STROKE_COLOR,
      DEFAULT_BACKGROUND_COLOR,
    ),
    type: 'arrow',
    points: [
      [0, 0],
      [dx, dy],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: args.fromId, focus: 0, gap: 4 },
    endBinding: { elementId: args.toId, focus: 0, gap: 4 },
    startArrowhead: args.bidirectional ? 'arrow' : null,
    endArrowhead: 'arrow',
    elbowed: false,
    boundElements: label ? [{ id: label.id, type: 'text' }] : null,
  };

  return { arrow, label };
}
