import { z } from 'zod';

/**
 * `diagram-ir/v1` — the declarative intermediate representation an LLM emits
 * (via tool calling in the F2c `ai-engine` module) and `compile()` (T47)
 * turns into a scene. Shape per tasks-f2b.md T43.
 */
export const IR_KINDS = [
  'aws-multi-az',
  'c4-context',
  'c4-container',
  'microservices',
  'event-driven',
  'business-flow',
  'wireframe',
  'network-topology',
] as const;

export type IrKind = (typeof IR_KINDS)[number];

export const CONTAINER_KINDS = [
  'vpc',
  'zone',
  'boundedContext',
  'swimlane',
  'trustBoundary',
  'group',
] as const;

export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export const EDGE_MODES = ['sync', 'async', 'data', 'dependency'] as const;
export type EdgeMode = (typeof EDGE_MODES)[number];

export const EDGE_DIRECTIONS = ['oneway', 'bidirectional'] as const;
export type EdgeDirection = (typeof EDGE_DIRECTIONS)[number];

const irNodeSemanticsSchema = z.object({
  technology: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
  dataClassification: z.string().min(1).optional(),
  criticality: z.string().min(1).optional(),
});

export const irNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  componentKey: z.string().min(1).optional(),
  semantics: irNodeSemanticsSchema.optional(),
});

export type IrNode = z.infer<typeof irNodeSchema>;

export const irContainerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(CONTAINER_KINDS),
  children: z.array(z.string().min(1)),
});

export type IrContainer = z.infer<typeof irContainerSchema>;

const irEdgeSemanticsSchema = z.object({
  mode: z.enum(EDGE_MODES),
  protocol: z.string().min(1).optional(),
  direction: z.enum(EDGE_DIRECTIONS),
  label: z.string().min(1).optional(),
});

export const irEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  semantics: irEdgeSemanticsSchema,
});

export type IrEdge = z.infer<typeof irEdgeSchema>;

/**
 * Pure structural schema — no cross-field referential checks. Kept separate
 * from `validateIr`'s referential-integrity pass (dangling `from`/`to`,
 * dangling `children`) so `IR_JSON_SCHEMA` (below) exports a clean JSON
 * Schema of the document *shape* only. JSON Schema itself has no standard
 * way to express "this string must equal some other node's id", so that
 * check could never be represented there anyway.
 */
export const irDocumentSchema = z.object({
  version: z.literal('v1'),
  kind: z.enum(IR_KINDS),
  nodes: z.array(irNodeSchema),
  containers: z.array(irContainerSchema),
  edges: z.array(irEdgeSchema),
  layoutHints: z.record(z.string(), z.unknown()).optional(),
});

export type IrDocument = z.infer<typeof irDocumentSchema>;

/** One structured validation failure, pointing at the exact invalid field. */
export interface IrValidationIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Thrown by `validateIr` on any failure — shape errors (from Zod) and
 * referential-integrity errors (dangling edge endpoints, dangling container
 * children) alike, both reported as the same structured `issues` shape.
 */
export class IrValidationError extends Error {
  readonly issues: IrValidationIssue[];

  constructor(issues: IrValidationIssue[]) {
    super(`invalid diagram-ir/v1 document: ${issues.map((issue) => issue.message).join('; ')}`);
    this.name = 'IrValidationError';
    this.issues = issues;
  }
}

/**
 * Validates referential integrity that the Zod shape schema can't express:
 * every edge's `from`/`to` must resolve to a known node id, and every
 * container's `children` must resolve to a known node or container id
 * (nesting is allowed — a container's child can be another container).
 */
function checkReferentialIntegrity(doc: IrDocument): IrValidationIssue[] {
  const issues: IrValidationIssue[] = [];
  const nodeIds = new Set(doc.nodes.map((node) => node.id));
  const containerIds = new Set(doc.containers.map((container) => container.id));
  const knownIds = new Set([...nodeIds, ...containerIds]);

  doc.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) {
      issues.push({
        path: ['edges', index, 'from'],
        message: `edge references unknown node id "${edge.from}"`,
      });
    }
    if (!nodeIds.has(edge.to)) {
      issues.push({
        path: ['edges', index, 'to'],
        message: `edge references unknown node id "${edge.to}"`,
      });
    }
  });

  doc.containers.forEach((container, containerIndex) => {
    container.children.forEach((childId, childIndex) => {
      if (!knownIds.has(childId)) {
        issues.push({
          path: ['containers', containerIndex, 'children', childIndex],
          message: `container "${container.id}" references unknown child id "${childId}"`,
        });
      }
    });
  });

  return issues;
}

/**
 * Validates an unknown JSON payload against `diagram-ir/v1` and returns the
 * parsed, typed `IrDocument` on success. Throws `IrValidationError` — never
 * a generic exception — with structured `issues` (each pointing at the
 * offending field's `path`) on any shape or referential-integrity failure.
 */
export function validateIr(json: unknown): IrDocument {
  const result = irDocumentSchema.safeParse(json);
  if (!result.success) {
    const issues: IrValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path as (string | number)[],
      message: issue.message,
    }));
    throw new IrValidationError(issues);
  }

  const referentialIssues = checkReferentialIntegrity(result.data);
  if (referentialIssues.length > 0) {
    throw new IrValidationError(referentialIssues);
  }

  return result.data;
}

/**
 * JSON Schema equivalent of `irDocumentSchema`, generated via zod v4's
 * native `z.toJSONSchema()` (confirmed current API — no separate
 * `zod-to-json-schema` package needed as of zod v4; that package targets
 * zod v3's introspection internals). Draft 2020-12 dialect (zod's default).
 * Intended as the tool-calling contract the F2c LLM agent is constrained to.
 */
export const IR_JSON_SCHEMA = z.toJSONSchema(irDocumentSchema);
