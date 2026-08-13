import {
  CompileError,
  compile,
  type IrDocument,
  IrValidationError,
  irDocumentSchema,
  layoutElkLayered,
  validateIr,
} from '@arch-canvas/diagram-ir';
import { z } from 'zod';
import {
  buildArrowElement,
  buildFrameElement,
  buildShapeElement,
  buildTextElement,
  newElementId,
  toPatchRecord,
} from './patchElements.js';
import {
  elementBox,
  elementExists,
  elementType,
  findElement,
  missingIds,
  toRecord,
} from './sceneHelpers.js';
import { defineTool, type PatchOperation, type ToolContext, toolError, toolOk } from './types.js';

/**
 * Write/patch domain tools (T52, AIE-01). Every tool here returns an
 * `AbstractPatch` — a list of proposed operations — and NEVER writes
 * anywhere itself; applying a patch is the pipeline's job (T55, next
 * wave). No tool in this file accepts a raw URL, shell command or SQL
 * string as a primary argument (design.md §8.3's explicit prohibition):
 * every arg schema below is enumerated fields/numbers/short strings, never
 * a generic "url"/"command" field.
 */

/**
 * `toolError`'s default `TData = never` matters here: it makes this
 * function's return type `ToolResult<never> | null`, and `ToolResult<never>`
 * is a structural subtype of every tool's own specific `ToolResult<XResult>`
 * — so `return checkAllExist(...)` type-checks against any caller's return
 * type without this helper needing to know it. Pinning `TData` to a
 * concrete shape here would break that (a `{patch}`-only result is NOT
 * assignable to e.g. `{frameId, patch}`).
 */
function checkAllExist(ctx: ToolContext, ids: readonly string[]) {
  const missing = missingIds(ctx.scene, ids);
  if (missing.length > 0) {
    return toolError(
      'element_not_found',
      `the following elementIds do not belong to the current diagram: ${missing.join(', ')}`,
    );
  }
  return null;
}

const semanticMetadataSchema = z.object({
  technology: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
  dataClassification: z.string().min(1).optional(),
  criticality: z.string().min(1).optional(),
});

function cleanMetadata(metadata: z.infer<typeof semanticMetadataSchema>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  if (metadata.technology !== undefined) cleaned.technology = metadata.technology;
  if (metadata.provider !== undefined) cleaned.provider = metadata.provider;
  if (metadata.environment !== undefined) cleaned.environment = metadata.environment;
  if (metadata.dataClassification !== undefined)
    cleaned.dataClassification = metadata.dataClassification;
  if (metadata.criticality !== undefined) cleaned.criticality = metadata.criticality;
  return cleaned;
}

// --- create_element ---------------------------------------------------

const createElementArgsSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.enum(['rectangle', 'ellipse', 'diamond', 'text']),
    x: z.number(),
    y: z.number(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    /** For a shape: an optional bound label. For `type: 'text'`: the text content itself (required). */
    label: z.string().optional(),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .refine((args) => args.type !== 'text' || Boolean(args.label), {
    message: 'label is required (used as the text content) when type is "text"',
    path: ['label'],
  });

export const createElementTool = defineTool(
  'create_element',
  1,
  createElementArgsSchema,
  (_ctx, args) => {
    const operations: PatchOperation[] = [];

    if (args.type === 'text') {
      const text = buildTextElement({
        id: args.id,
        x: args.x,
        y: args.y,
        width: args.width,
        height: args.height,
        // biome-ignore lint/style/noNonNullAssertion: enforced by the schema's .refine above
        text: args.label!,
      });
      operations.push({ op: 'upsertElement', elementId: text.id, element: toPatchRecord(text) });
      return toolOk({ elementId: text.id, patch: { operations } });
    }

    const { shape, label } = buildShapeElement({
      id: args.id,
      type: args.type,
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
      label: args.label,
      strokeColor: args.strokeColor,
      backgroundColor: args.backgroundColor,
    });
    operations.push({ op: 'upsertElement', elementId: shape.id, element: toPatchRecord(shape) });
    if (label)
      operations.push({ op: 'upsertElement', elementId: label.id, element: toPatchRecord(label) });

    return toolOk({ elementId: shape.id, patch: { operations } });
  },
);

// --- create_component ---------------------------------------------------

const createComponentArgsSchema = z.object({
  id: z.string().min(1).optional(),
  stableKey: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

export const createComponentTool = defineTool(
  'create_component',
  1,
  createComponentArgsSchema,
  (ctx: ToolContext, args) => {
    const component = ctx.library.find((item) => item.stableKey === args.stableKey);
    if (!component) {
      return toolError(
        'component_not_found',
        `no library component with stableKey "${args.stableKey}" is authorized`,
      );
    }

    const { shape, label } = buildShapeElement({
      id: args.id,
      type: 'rectangle',
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
      label: component.name,
      strokeColor: component.color,
    });

    const operations: PatchOperation[] = [
      { op: 'upsertElement', elementId: shape.id, element: toPatchRecord(shape) },
      { op: 'setMetadata', elementId: shape.id, metadata: { componentKey: args.stableKey } },
    ];
    if (label)
      operations.push({ op: 'upsertElement', elementId: label.id, element: toPatchRecord(label) });

    return toolOk({ elementId: shape.id, patch: { operations } });
  },
);

// --- create_group ---------------------------------------------------

const createGroupArgsSchema = z.object({
  elementIds: z.array(z.string().min(1)).min(2),
  groupId: z.string().min(1).optional(),
});

export const createGroupTool = defineTool(
  'create_group',
  1,
  createGroupArgsSchema,
  (ctx: ToolContext, args) => {
    const missingCheck = checkAllExist(ctx, args.elementIds);
    if (missingCheck) return missingCheck;

    const groupId = args.groupId ?? newElementId('group');
    const operations: PatchOperation[] = args.elementIds.map((id) => {
      // biome-ignore lint/style/noNonNullAssertion: existence already checked by checkAllExist above
      const element = findElement(ctx.scene, id)!;
      const record = toRecord(element);
      const groupIds = Array.isArray(record.groupIds) ? [...(record.groupIds as string[])] : [];
      if (!groupIds.includes(groupId)) groupIds.push(groupId);
      return { op: 'upsertElement', elementId: id, element: { ...record, groupIds } };
    });

    return toolOk({ groupId, patch: { operations } });
  },
);

// --- create_frame ---------------------------------------------------

const createFrameArgsSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  childIds: z.array(z.string().min(1)).default([]),
});

export const createFrameTool = defineTool(
  'create_frame',
  1,
  createFrameArgsSchema,
  (ctx: ToolContext, args) => {
    const missingCheck = checkAllExist(ctx, args.childIds);
    if (missingCheck) return missingCheck;

    const frame = buildFrameElement(args);
    const operations: PatchOperation[] = [
      { op: 'upsertElement', elementId: frame.id, element: toPatchRecord(frame) },
    ];

    for (const childId of args.childIds) {
      // biome-ignore lint/style/noNonNullAssertion: existence already checked by checkAllExist above
      const child = findElement(ctx.scene, childId)!;
      operations.push({
        op: 'upsertElement',
        elementId: childId,
        element: { ...toRecord(child), frameId: frame.id },
      });
    }

    return toolOk({ frameId: frame.id, patch: { operations } });
  },
);

// --- update_element ---------------------------------------------------

const updateElementArgsSchema = z
  .object({
    elementId: z.string().min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    opacity: z.number().min(0).max(100).optional(),
    angle: z.number().optional(),
  })
  .refine(
    (args) =>
      args.x !== undefined ||
      args.y !== undefined ||
      args.width !== undefined ||
      args.height !== undefined ||
      args.strokeColor !== undefined ||
      args.backgroundColor !== undefined ||
      args.opacity !== undefined ||
      args.angle !== undefined,
    { message: 'at least one field to change must be provided' },
  );

export const updateElementTool = defineTool(
  'update_element',
  1,
  updateElementArgsSchema,
  (ctx: ToolContext, args) => {
    const element = findElement(ctx.scene, args.elementId);
    if (!element) {
      return toolError(
        'element_not_found',
        `elementId "${args.elementId}" does not belong to the current diagram`,
      );
    }

    const { elementId, ...changes } = args;
    const definedChanges = Object.fromEntries(
      Object.entries(changes).filter(([, v]) => v !== undefined),
    );
    const updated = { ...toRecord(element), ...definedChanges, id: element.id };

    return toolOk({
      patch: { operations: [{ op: 'upsertElement' as const, elementId, element: updated }] },
    });
  },
);

// --- delete_elements ---------------------------------------------------

const deleteElementsArgsSchema = z.object({
  elementIds: z.array(z.string().min(1)).min(1),
});

export const deleteElementsTool = defineTool(
  'delete_elements',
  1,
  deleteElementsArgsSchema,
  (ctx: ToolContext, args) => {
    const missingCheck = checkAllExist(ctx, args.elementIds);
    if (missingCheck) return missingCheck;

    const operations: PatchOperation[] = args.elementIds.map((elementId) => ({
      op: 'deleteElement',
      elementId,
    }));
    return toolOk({ patch: { operations } });
  },
);

// --- duplicate_elements ---------------------------------------------------

const duplicateElementsArgsSchema = z.object({
  elementIds: z.array(z.string().min(1)).min(1),
  offsetX: z.number().default(20),
  offsetY: z.number().default(20),
});

export const duplicateElementsTool = defineTool(
  'duplicate_elements',
  1,
  duplicateElementsArgsSchema,
  (ctx: ToolContext, args) => {
    const missingCheck = checkAllExist(ctx, args.elementIds);
    if (missingCheck) return missingCheck;

    const operations: PatchOperation[] = [];
    const createdIds: string[] = [];

    for (const id of args.elementIds) {
      // biome-ignore lint/style/noNonNullAssertion: existence already checked by checkAllExist above
      const element = findElement(ctx.scene, id)!;
      const record = toRecord(element);
      const newId = newElementId(elementType(element));
      operations.push({
        op: 'upsertElement',
        elementId: newId,
        element: {
          ...record,
          id: newId,
          x: (record.x as number) + args.offsetX,
          y: (record.y as number) + args.offsetY,
          groupIds: [],
          boundElements: null,
          frameId: null,
        },
      });
      createdIds.push(newId);
    }

    return toolOk({ createdIds, patch: { operations } });
  },
);

// --- connect_elements ---------------------------------------------------

const connectElementsArgsSchema = z.object({
  id: z.string().min(1).optional(),
  fromId: z.string().min(1),
  toId: z.string().min(1),
  direction: z.enum(['oneway', 'bidirectional']).default('oneway'),
  label: z.string().optional(),
});

export const connectElementsTool = defineTool(
  'connect_elements',
  1,
  connectElementsArgsSchema,
  (ctx: ToolContext, args) => {
    const missingCheck = checkAllExist(ctx, [args.fromId, args.toId]);
    if (missingCheck) return missingCheck;

    // biome-ignore lint/style/noNonNullAssertion: existence already checked above
    const fromBox = elementBox(findElement(ctx.scene, args.fromId)!);
    // biome-ignore lint/style/noNonNullAssertion: existence already checked above
    const toBox = elementBox(findElement(ctx.scene, args.toId)!);

    const { arrow, label } = buildArrowElement({
      id: args.id,
      fromId: args.fromId,
      fromBox,
      toId: args.toId,
      toBox,
      bidirectional: args.direction === 'bidirectional',
      label: args.label,
    });

    const operations: PatchOperation[] = [
      { op: 'upsertElement', elementId: arrow.id, element: toPatchRecord(arrow) },
    ];
    if (label)
      operations.push({ op: 'upsertElement', elementId: label.id, element: toPatchRecord(label) });

    return toolOk({ connectorId: arrow.id, patch: { operations } });
  },
);

// --- update_connector ---------------------------------------------------

const EDGE_MODES = ['sync', 'async', 'data', 'dependency'] as const;

const updateConnectorArgsSchema = z
  .object({
    elementId: z.string().min(1),
    mode: z.enum(EDGE_MODES).optional(),
    protocol: z.string().min(1).optional(),
    direction: z.enum(['oneway', 'bidirectional']).optional(),
    label: z.string().optional(),
  })
  .refine(
    (args) =>
      args.mode !== undefined ||
      args.protocol !== undefined ||
      args.direction !== undefined ||
      args.label !== undefined,
    { message: 'at least one field to change must be provided' },
  );

export const updateConnectorTool = defineTool(
  'update_connector',
  1,
  updateConnectorArgsSchema,
  (ctx: ToolContext, args) => {
    const element = findElement(ctx.scene, args.elementId);
    if (!element) {
      return toolError(
        'element_not_found',
        `elementId "${args.elementId}" does not belong to the current diagram`,
      );
    }
    if (elementType(element) !== 'arrow') {
      return toolError(
        'not_a_connector',
        `elementId "${args.elementId}" is not a connector (arrow) element`,
      );
    }

    const operations: PatchOperation[] = [];
    const record = toRecord(element);

    if (args.direction !== undefined) {
      operations.push({
        op: 'upsertElement',
        elementId: args.elementId,
        element: { ...record, startArrowhead: args.direction === 'bidirectional' ? 'arrow' : null },
      });
    }

    if (args.label !== undefined) {
      const existingLabel = ctx.scene.find((el) => {
        const e = el as { type: string; containerId?: string | null };
        return e.type === 'text' && e.containerId === args.elementId;
      });
      if (existingLabel) {
        operations.push({
          op: 'upsertElement',
          elementId: (existingLabel as { id: string }).id,
          element: { ...toRecord(existingLabel), text: args.label, originalText: args.label },
        });
      } else {
        const box = elementBox(element);
        const newLabel = buildTextElement({
          id: `${args.elementId}__label`,
          containerId: args.elementId,
          x: box.x,
          y: box.y,
          text: args.label,
        });
        operations.push({
          op: 'upsertElement',
          elementId: newLabel.id,
          element: toPatchRecord(newLabel),
        });
      }
    }

    if (args.mode !== undefined || args.protocol !== undefined) {
      const metadata: Record<string, unknown> = {};
      if (args.mode !== undefined) metadata.mode = args.mode;
      if (args.protocol !== undefined) metadata.protocol = args.protocol;
      operations.push({ op: 'setMetadata', elementId: args.elementId, metadata });
    }

    return toolOk({ patch: { operations } });
  },
);

// --- set_semantic_metadata ---------------------------------------------------

const setSemanticMetadataArgsSchema = z.object({
  elementId: z.string().min(1),
  metadata: semanticMetadataSchema,
});

export const setSemanticMetadataTool = defineTool(
  'set_semantic_metadata',
  1,
  setSemanticMetadataArgsSchema,
  (ctx: ToolContext, args) => {
    if (!elementExists(ctx.scene, args.elementId)) {
      return toolError(
        'element_not_found',
        `elementId "${args.elementId}" does not belong to the current diagram`,
      );
    }
    const operations: PatchOperation[] = [
      { op: 'setMetadata', elementId: args.elementId, metadata: cleanMetadata(args.metadata) },
    ];
    return toolOk({ patch: { operations } });
  },
);

// --- align_elements ---------------------------------------------------

const alignElementsArgsSchema = z.object({
  elementIds: z.array(z.string().min(1)).min(2),
  axis: z.enum(['left', 'right', 'top', 'bottom', 'centerX', 'centerY']),
});

export const alignElementsTool = defineTool(
  'align_elements',
  1,
  alignElementsArgsSchema,
  (ctx: ToolContext, args) => {
    const missingCheck = checkAllExist(ctx, args.elementIds);
    if (missingCheck) return missingCheck;

    const boxes = args.elementIds.map((id) => {
      // biome-ignore lint/style/noNonNullAssertion: existence already checked by checkAllExist above
      const element = findElement(ctx.scene, id)!;
      return { id, element, box: elementBox(element) };
    });

    let target: number;
    switch (args.axis) {
      case 'left':
        target = Math.min(...boxes.map((b) => b.box.x));
        break;
      case 'right':
        target = Math.max(...boxes.map((b) => b.box.x + b.box.width));
        break;
      case 'top':
        target = Math.min(...boxes.map((b) => b.box.y));
        break;
      case 'bottom':
        target = Math.max(...boxes.map((b) => b.box.y + b.box.height));
        break;
      case 'centerX':
        target = boxes.reduce((sum, b) => sum + b.box.x + b.box.width / 2, 0) / boxes.length;
        break;
      case 'centerY':
        target = boxes.reduce((sum, b) => sum + b.box.y + b.box.height / 2, 0) / boxes.length;
        break;
    }

    const operations: PatchOperation[] = boxes.map(({ id, element, box }) => {
      const record = toRecord(element);
      if (args.axis === 'left') record.x = target;
      else if (args.axis === 'right') record.x = target - box.width;
      else if (args.axis === 'centerX') record.x = target - box.width / 2;
      else if (args.axis === 'top') record.y = target;
      else if (args.axis === 'bottom') record.y = target - box.height;
      else record.y = target - box.height / 2;
      return { op: 'upsertElement', elementId: id, element: record };
    });

    return toolOk({ patch: { operations } });
  },
);

// --- distribute_elements ---------------------------------------------------

const distributeElementsArgsSchema = z.object({
  elementIds: z.array(z.string().min(1)).min(3),
  axis: z.enum(['horizontal', 'vertical']),
});

export const distributeElementsTool = defineTool(
  'distribute_elements',
  1,
  distributeElementsArgsSchema,
  (ctx: ToolContext, args) => {
    const missingCheck = checkAllExist(ctx, args.elementIds);
    if (missingCheck) return missingCheck;

    const items = args.elementIds.map((id) => {
      // biome-ignore lint/style/noNonNullAssertion: existence already checked by checkAllExist above
      const element = findElement(ctx.scene, id)!;
      return { id, element, box: elementBox(element) };
    });

    const coord = args.axis === 'horizontal' ? 'x' : 'y';
    const sorted = [...items].sort((a, b) => a.box[coord] - b.box[coord]);
    // biome-ignore lint/style/noNonNullAssertion: elementIds has min(3), so first/last always exist
    const first = sorted[0]!;
    // biome-ignore lint/style/noNonNullAssertion: elementIds has min(3), so first/last always exist
    const last = sorted[sorted.length - 1]!;
    const span = last.box[coord] - first.box[coord];
    const step = span / (sorted.length - 1);

    const operations: PatchOperation[] = sorted.map((item, index) => {
      const record = toRecord(item.element);
      record[coord] = first.box[coord] + step * index;
      return { op: 'upsertElement', elementId: item.id, element: record };
    });

    return toolOk({ patch: { operations } });
  },
);

// --- auto_layout ---------------------------------------------------

const autoLayoutArgsSchema = z.object({
  elementIds: z.array(z.string().min(1)).min(1),
});

/**
 * Repositions `elementIds` with `diagram-ir`'s `elk-layered` engine (F2b) —
 * the general-purpose flow layout, reused as a pure function exactly as
 * design.md's "packages/ai-tools" entry describes ("reaproveita os layout
 * engines de diagram-ir"). Grid-zones/swimlane need container/zone
 * semantics this generic per-selection tool doesn't model — that fuller
 * layout is `compile_ir`'s job (below), which works from a complete IR
 * document rather than an arbitrary scene selection.
 */
export const autoLayoutTool = defineTool(
  'auto_layout',
  1,
  autoLayoutArgsSchema,
  async (ctx: ToolContext, args) => {
    const missingCheck = checkAllExist(ctx, args.elementIds);
    if (missingCheck) return missingCheck;

    const idSet = new Set(args.elementIds);
    const ir: IrDocument = {
      version: 'v1',
      kind: 'microservices',
      nodes: args.elementIds.map((id) => ({ id, label: id })),
      containers: [],
      edges: ctx.scene
        .filter((el) => elementType(el) === 'arrow')
        .map((el) => {
          const e = el as {
            startBinding?: { elementId: string } | null;
            endBinding?: { elementId: string } | null;
          };
          return { from: e.startBinding?.elementId, to: e.endBinding?.elementId };
        })
        .filter(
          (edge): edge is { from: string; to: string } =>
            Boolean(edge.from) &&
            Boolean(edge.to) &&
            idSet.has(edge.from as string) &&
            idSet.has(edge.to as string),
        )
        .map((edge) => ({
          from: edge.from,
          to: edge.to,
          semantics: { mode: 'dependency', direction: 'oneway' },
        })),
    };

    const positioned = await layoutElkLayered(ir);
    const operations: PatchOperation[] = positioned.map((node) => {
      // biome-ignore lint/style/noNonNullAssertion: node.id comes from args.elementIds, already existence-checked above
      const element = findElement(ctx.scene, node.id)!;
      return {
        op: 'upsertElement',
        elementId: node.id,
        element: { ...toRecord(element), x: node.x, y: node.y },
      };
    });

    return toolOk({ patch: { operations } });
  },
);

// --- resize_container ---------------------------------------------------

const resizeContainerArgsSchema = z.object({
  elementId: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const resizeContainerTool = defineTool(
  'resize_container',
  1,
  resizeContainerArgsSchema,
  (ctx: ToolContext, args) => {
    const element = findElement(ctx.scene, args.elementId);
    if (!element) {
      return toolError(
        'element_not_found',
        `elementId "${args.elementId}" does not belong to the current diagram`,
      );
    }
    const updated = { ...toRecord(element), width: args.width, height: args.height };
    return toolOk({
      patch: {
        operations: [{ op: 'upsertElement' as const, elementId: args.elementId, element: updated }],
      },
    });
  },
);

// --- add_annotation ---------------------------------------------------

const addAnnotationArgsSchema = z.object({
  text: z.string().min(1),
  x: z.number(),
  y: z.number(),
  targetElementId: z.string().min(1).optional(),
});

export const addAnnotationTool = defineTool(
  'add_annotation',
  1,
  addAnnotationArgsSchema,
  (ctx: ToolContext, args) => {
    if (args.targetElementId && !elementExists(ctx.scene, args.targetElementId)) {
      return toolError(
        'element_not_found',
        `targetElementId "${args.targetElementId}" does not belong to the current diagram`,
      );
    }

    const annotation = buildTextElement({ x: args.x, y: args.y, text: args.text });
    return toolOk({
      annotationId: annotation.id,
      patch: {
        operations: [
          {
            op: 'upsertElement' as const,
            elementId: annotation.id,
            element: toPatchRecord(annotation),
          },
        ],
      },
    });
  },
);

// --- generate_ir ---------------------------------------------------

/**
 * Validates an LLM-proposed `diagram-ir/v1` document against `diagram-ir`'s
 * own schema (F2b) — the LLM fills it in, this tool only validates
 * (design.md's own phrasing). It does NOT touch the scene: its `patch` is
 * always empty. `compile_ir` (below) is the tool that turns a validated IR
 * into actual scene elements.
 */
export const generateIrTool = defineTool('generate_ir', 1, irDocumentSchema, (_ctx, args) => {
  try {
    const ir = validateIr(args);
    return toolOk({ ir, patch: { operations: [] } });
  } catch (error) {
    if (error instanceof IrValidationError) {
      return toolError('invalid_ir', error.message);
    }
    throw error;
  }
});

// --- compile_ir ---------------------------------------------------

export const compileIrTool = defineTool(
  'compile_ir',
  1,
  irDocumentSchema,
  async (ctx: ToolContext, args) => {
    let ir: IrDocument;
    try {
      ir = validateIr(args);
    } catch (error) {
      if (error instanceof IrValidationError) return toolError('invalid_ir', error.message);
      throw error;
    }

    try {
      const compiled = await compile(ir, [...ctx.library]);
      const operations: PatchOperation[] = compiled.elements.map((element) => ({
        op: 'upsertElement',
        elementId: element.id,
        element: element as unknown as Record<string, unknown>,
      }));
      return toolOk({ elementCount: compiled.elements.length, patch: { operations } });
    } catch (error) {
      if (error instanceof CompileError) return toolError('unresolved_component', error.message);
      throw error;
    }
  },
);

export const writeTools = [
  createElementTool,
  createComponentTool,
  createGroupTool,
  createFrameTool,
  updateElementTool,
  deleteElementsTool,
  duplicateElementsTool,
  connectElementsTool,
  updateConnectorTool,
  setSemanticMetadataTool,
  alignElementsTool,
  distributeElementsTool,
  autoLayoutTool,
  resizeContainerTool,
  addAnnotationTool,
  generateIrTool,
  compileIrTool,
];
