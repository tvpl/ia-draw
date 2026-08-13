import { randomUUID } from 'node:crypto';
import {
  compile,
  type IrDocument,
  parseMermaidFlowchart,
  parseStructurizrDsl,
} from '@arch-canvas/diagram-ir';
import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { Db } from '../auth/db.js';
import { appendOperation } from '../diagram-sync/operations.js';
import { buildRestoreDeltas } from '../snapshot/index.js';
import { createDiagram, type Diagram } from '../workspace/index.js';

export type InteropFormat = 'mermaid' | 'structurizr';

export interface ImportDslInput {
  projectId: string;
  title?: string;
  ownerId: string;
  dsl: string;
}

export interface ImportDslResult {
  diagram: Diagram;
  limitations: string[];
}

function defaultTitle(format: InteropFormat): string {
  return format === 'mermaid' ? 'Imported Mermaid flowchart' : 'Imported Structurizr workspace';
}

/**
 * Parses `dsl` per `format`, always returning T60/T61's `{ ir, limitations }`
 * contract — unrecognized lines never abort the parse (they land in
 * `limitations`), so this never throws for a merely-partial DSL, only for
 * input `parseMermaidFlowchart`/`parseStructurizrDsl` themselves would reject
 * (a document that fails `validateIr`'s referential checks, e.g. an edge
 * whose endpoint line the parser genuinely could never resolve).
 */
function parseDsl(format: InteropFormat, dsl: string): { ir: IrDocument; limitations: string[] } {
  return format === 'mermaid' ? parseMermaidFlowchart(dsl) : parseStructurizrDsl(dsl);
}

/**
 * Imports a Mermaid flowchart or Structurizr DSL document as a brand-new
 * diagram (AAC-01) — same "create diagram, then seed its first revision"
 * write path `export/import.ts`'s `.excalidraw` `confirmImport` already
 * established (T31's `buildRestoreDeltas([], elements)` against an empty
 * "current scene", then `diagram-sync`'s own `appendOperation`, T22).
 *
 * `compile(ir, [])` is always safe with an empty library: neither T60's
 * Mermaid parser nor T61's Structurizr parser ever emits a node with a
 * `componentKey` (neither DSL has an equivalent concept), so `compile()`
 * never needs to resolve one.
 *
 * `limitations` is always returned, even when empty (AAC-01 "Done when":
 * the field must always be present) — collected purely from the parser,
 * never hidden from the caller.
 */
export async function importDiagramFromDsl(
  db: Db,
  format: InteropFormat,
  input: ImportDslInput,
): Promise<ImportDslResult> {
  const { ir, limitations } = parseDsl(format, input.dsl);

  const diagram = await createDiagram(db, {
    projectId: input.projectId,
    title: input.title ?? defaultTitle(format),
    ownerId: input.ownerId,
  });

  const { elements } = await compile(ir, []);
  // `CompiledElement` (diagram-ir/compile.ts) is a structural type matching
  // `SceneElement`'s field set exactly, hand-verified against
  // `@excalidraw/excalidraw`'s own shipped types (see compile.ts's top
  // comment) — this cast is type-only, never a runtime call into
  // `@excalidraw/excalidraw`/`@arch-canvas/editor-adapter` (AD-008).
  const sceneElements = elements as unknown as SceneElement[];

  const deltas = buildRestoreDeltas([], sceneElements);
  if (deltas.length > 0) {
    await appendOperation(db, diagram.id, input.ownerId, {
      clientMutationId: randomUUID(),
      baseRevision: 0,
      actorId: input.ownerId,
      deltas,
    });
  }

  return { diagram, limitations };
}
