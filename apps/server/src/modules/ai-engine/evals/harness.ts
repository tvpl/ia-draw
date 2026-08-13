import {
  type AbstractPatch,
  createDefaultToolRegistry,
  type PatchOperation,
  type ToolContext,
  type ToolResult,
} from '@arch-canvas/ai-tools';
import type { CompiledElement, CompiledScene } from '@arch-canvas/diagram-ir';
import type { SceneElement } from '@arch-canvas/editor-adapter';

/**
 * Deterministic eval harness (T57, product-spec.md §8.6). Runs the same
 * PURE, DB-free half of the pipeline every eval case shares — the real
 * `packages/ai-tools` `ToolRegistry` (T51/T52) executing a deterministic,
 * fixed tool-call list keyed by prompt (the "mock provider" this task
 * calls for: a function from a fixed test prompt to a plausible
 * pre-programmed IR/patch, never a real network call). This file has NO
 * database dependency by design — the DB-backed state machine
 * (`ai_runs`/`ai_tool_calls`, T53-T55) is already covered by
 * `pipeline.int.spec.ts`/`preview.int.spec.ts`/`applyPatch.int.spec.ts`;
 * this harness exists to validate GENERATION QUALITY (geometry, semantic
 * fidelity) the way product-spec.md §8.6 describes, which needs none of
 * that persistence machinery.
 */

/** One deterministic "the model decided to call this tool" step. */
export interface DeterministicToolCall {
  name: string;
  args: unknown;
}

export interface EvalCaseInput {
  scene: SceneElement[];
  selection?: string[];
  library: ToolContext['library'];
  toolCalls: DeterministicToolCall[];
}

export interface EvalCaseResult {
  patch: AbstractPatch;
  /** Every tool call's result, in call order — inspected by cases that need to assert a specific failure (e.g. `unknown_tool`, `component_not_found`). */
  toolResults: ToolResult[];
}

/**
 * Executes `input.toolCalls` in order against the REAL default tool
 * registry (no DB, no network — `ToolRegistry.execute` is a pure
 * function), accumulating every successful call's patch operations. A
 * failing call still records its `ToolResult` but contributes no
 * operations — mirrors `pipeline.ts`'s own "not every attempted call
 * succeeds" reality, without needing that file's DB writes.
 */
export async function runEvalCase(input: EvalCaseInput): Promise<EvalCaseResult> {
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    scene: input.scene,
    selection: input.selection ?? [],
    library: input.library,
  };

  const operations: PatchOperation[] = [];
  const toolResults: ToolResult[] = [];

  for (const call of input.toolCalls) {
    const result = await registry.execute(ctx, call.name, 1, call.args);
    toolResults.push(result);
    if (result.ok) {
      const patch = (result.data as { patch?: AbstractPatch } | undefined)?.patch;
      if (patch) operations.push(...patch.operations);
    }
  }

  return { patch: { operations }, toolResults };
}

/**
 * Reinterprets an `AbstractPatch`'s `upsertElement` operations as a
 * `CompiledScene` for `geometryMetrics` (F2b). Structurally sound, not a
 * hack: every element a write tool builds (`packages/ai-tools/src/tools/
 * patchElements.ts`) mirrors diagram-ir's `compile.ts` field set exactly —
 * both are independent, deliberate plain-data copies of the same upstream
 * Excalidraw element shape (see either file's own docstring for the AD-008
 * rationale). `deleteElement`/`setMetadata` ops contribute nothing (no
 * eval case in this harness deletes generated content).
 */
export function toCompiledScene(patch: AbstractPatch): CompiledScene {
  const elements = patch.operations
    .filter(
      (op): op is Extract<PatchOperation, { op: 'upsertElement' }> => op.op === 'upsertElement',
    )
    .map((op) => op.element as unknown as CompiledElement);
  return { elements };
}

const DEFAULTS = {
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
} as const;

/** A minimal, but structurally complete, plain-data rectangle element — for hand-built eval fixtures (never through the tool registry), mirroring `patchElements.ts`'s own field set. */
export function fixtureRectangle(
  id: string,
  x: number,
  y: number,
  width = 140,
  height = 80,
): SceneElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    strokeColor: DEFAULTS.strokeColor,
    backgroundColor: DEFAULTS.backgroundColor,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roundness: null,
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: 1,
    version: 1,
    versionNonce: 1,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
  } as unknown as SceneElement;
}
