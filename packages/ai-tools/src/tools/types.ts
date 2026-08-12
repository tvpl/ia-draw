import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { LibraryItem } from '@arch-canvas/library-content';
import { z } from 'zod';

/**
 * Domain tool registry (T51/T52, design.md "packages/ai-tools"): the ONLY
 * surface the AI agent acts through (AIE-01 — "o agente age exclusivamente
 * através de ferramentas de domínio versionadas, nunca escrevendo cena
 * bruta, SQL ou URLs arbitrárias"). Every tool here is a pure function:
 * `{scene, selection, library} + args -> ToolResult`. Read tools (T51)
 * never mutate anything they're given; write tools (T52) never write
 * anywhere — they return an `AbstractPatch`, a list of proposed operations
 * the pipeline (T53/T55, next wave) previews and applies atomically.
 *
 * AD-008 discipline: this whole package runs server-side, so no file in
 * `tools/` imports `@excalidraw/excalidraw` or `@arch-canvas/editor-adapter`
 * BY VALUE — only `import type` (erased at compile time, zero runtime
 * import), exactly like `packages/diagram-domain`'s `structuralDiff.ts`/
 * `mergeScene.ts` already established. Elements a write tool CREATES are
 * built as local, hand-assembled plain data (`patchElements.ts`), mirroring
 * `packages/diagram-ir/src/compile.ts`'s own convention — never via
 * `restoreElements`/`convertToExcalidrawElements`.
 */

export interface ToolContext {
  /** The current (non-deleted and deleted alike — tools decide what to look at) scene. */
  scene: readonly SceneElement[];
  /** Currently selected elementIds. */
  selection: readonly string[];
  /** The workspace's authorized component library — the ONLY library any tool may resolve a `componentKey` against. */
  library: readonly LibraryItem[];
}

export interface ToolErrorInfo {
  code: string;
  message: string;
}

export type ToolResult<TData = unknown> =
  | { ok: true; data: TData }
  | { ok: false; error: ToolErrorInfo };

export function toolOk<TData>(data: TData): ToolResult<TData> {
  return { ok: true, data };
}

export function toolError<TData = never>(code: string, message: string): ToolResult<TData> {
  return { ok: false, error: { code, message } };
}

/**
 * One proposed scene mutation. `upsertElement` covers both create and
 * update (a create is an upsert of a brand-new `elementId`) — the same
 * split `packages/diagram-domain`'s `ElementDelta` uses, so T55 (next wave)
 * can translate `PatchOperation[]` into `ElementDelta[]` for
 * `operations:batch` without re-deriving the mapping. `setMetadata` is a
 * separate op kind because semantic metadata lives in its own table
 * (`diagram_elements_meta`, LIB-02), never mixed into the Excalidraw
 * element itself.
 */
export type PatchOperation =
  | { op: 'upsertElement'; elementId: string; element: Record<string, unknown> }
  | { op: 'deleteElement'; elementId: string }
  | { op: 'setMetadata'; elementId: string; metadata: Record<string, unknown> };

export interface AbstractPatch {
  operations: PatchOperation[];
}

export type ToolExecute<TArgs, TData> = (
  ctx: ToolContext,
  args: TArgs,
) => ToolResult<TData> | Promise<ToolResult<TData>>;

export interface ToolDefinition<TArgs = unknown, TData = unknown> {
  name: string;
  version: number;
  /** JSON Schema (draft 2020-12, via zod's native `z.toJSONSchema()`) — the tool-calling contract handed to the provider. */
  schema: unknown;
  execute: ToolExecute<TArgs, TData>;
}

/** Builds a `ToolDefinition` from a zod args schema — `execute` receives already-validated, typed `args`; the registry (below) runs the validation and never lets an invalid-args call reach `execute`. */
export function defineTool<TArgsSchema extends z.ZodType, TData>(
  name: string,
  version: number,
  argsSchema: TArgsSchema,
  execute: ToolExecute<z.infer<TArgsSchema>, TData>,
): ToolDefinition<z.infer<TArgsSchema>, TData> & { argsSchema: TArgsSchema } {
  return {
    name,
    version,
    schema: z.toJSONSchema(argsSchema),
    argsSchema,
    execute,
  };
}

/**
 * A heterogeneous registry needs a type-erased entry shape at its storage
 * boundary — each tool's own `execute` stays fully typed via `defineTool`;
 * only this internal map's value type erases to `any`, the standard pattern
 * for a registry of otherwise-unrelated function signatures (function
 * parameters are contravariant, so `unknown` args would reject every
 * concrete tool at `register()`).
 */
// biome-ignore lint/suspicious/noExplicitAny: see doc comment above
type AnyToolDefinition = ToolDefinition<any, any> & { argsSchema: z.ZodType<any, any> };

/**
 * Resolves and safely invokes tools by `name@version`. `execute()` never
 * throws to its caller — an unknown tool, schema-invalid args, or an
 * unexpected internal error all resolve as a structured `ToolResult`
 * failure (AIE-01's "código estruturado, nunca lança").
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition): void {
    this.tools.set(`${tool.name}@${tool.version}`, tool);
  }

  /** Matches design.md's literal `ToolRegistry.get(name, version): ToolExecutor` interface. */
  get(name: string, version: number): AnyToolDefinition | undefined {
    return this.tools.get(`${name}@${version}`);
  }

  list(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(
    ctx: ToolContext,
    name: string,
    version: number,
    rawArgs: unknown,
  ): Promise<ToolResult> {
    const tool = this.get(name, version);
    if (!tool) {
      return toolError('unknown_tool', `no tool registered as "${name}"@${version}`);
    }

    const parsed = tool.argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return toolError(
        'invalid_args',
        `arguments for "${name}"@${version} failed schema validation: ${parsed.error.message}`,
      );
    }

    try {
      return await tool.execute(ctx, parsed.data);
    } catch (error) {
      return toolError(
        'internal_error',
        error instanceof Error ? error.message : `unexpected error executing "${name}"@${version}`,
      );
    }
  }
}
