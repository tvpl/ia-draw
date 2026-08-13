import type { SceneElement } from '@arch-canvas/editor-adapter';

/**
 * SPEC_DEVIATION (deliberate, T58/L-003 of tasks-f3.md): this is a fresh,
 * independent reimplementation of the same "compact semantic representation"
 * problem `apps/server/src/modules/ai-engine/buildContext.ts` (F2c) already
 * solves (label resolution via own `.text`/bound-text child, arrow-binding
 * resolution) — it is intentionally NOT imported from here. Importing
 * `buildContext.ts` from a shared domain package would couple docgen/lint/aac
 * (F3) to the AI-engine module for an implementation detail, and would risk
 * touching already-verified F2c code. The ~40 lines of overlap are duplicated
 * on purpose, in the same spirit as the LWW tie-break duplicated between
 * `diagram-domain` and `editor-adapter` (AD-008, see `mergeScene.ts`).
 *
 * AD-008: dependency-free, server-safe. `SceneElement` is only ever used as a
 * type (`import type` above, erased at compile time) — this module never
 * imports `@excalidraw/excalidraw` or `@arch-canvas/editor-adapter` by value.
 */

export interface SemanticElement {
  elementId: string;
  type: string;
  label: string | null;
  semantics?: Record<string, unknown>;
}

export interface SemanticEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface SceneSemanticsMetadataInput {
  elementId: string;
  semantics?: Record<string, unknown>;
}

export interface SceneSemantics {
  elements: SemanticElement[];
  edges: SemanticEdge[];
}

function isNonDeleted(element: SceneElement): boolean {
  return !(element as { isDeleted?: boolean }).isDeleted;
}

/** Resolves `element`'s label: its own `.text` if it's a `text` element, else the text of a bound `text` child (found by `containerId`), else `null`. */
function resolveLabel(element: SceneElement, all: readonly SceneElement[]): string | null {
  const el = element as { type: string; text?: string; id: string };
  if (el.type === 'text' && typeof el.text === 'string') return el.text;
  const boundText = all.find((candidate) => {
    const c = candidate as { type: string; containerId?: string | null; text?: string };
    return c.type === 'text' && c.containerId === el.id && typeof c.text === 'string';
  }) as { text?: string } | undefined;
  return boundText?.text ?? null;
}

interface ArrowBinding {
  fromId: string | null;
  toId: string | null;
}

function arrowBinding(element: SceneElement): ArrowBinding | null {
  const el = element as {
    type: string;
    startBinding?: { elementId: string } | null;
    endBinding?: { elementId: string } | null;
  };
  if (el.type !== 'arrow') return null;
  return { fromId: el.startBinding?.elementId ?? null, toId: el.endBinding?.elementId ?? null };
}

function metadataFor(
  elementId: string,
  metadata: readonly SceneSemanticsMetadataInput[],
): Record<string, unknown> | undefined {
  return metadata.find((entry) => entry.elementId === elementId)?.semantics;
}

/**
 * Extracts a compact, pure-data semantic representation from a raw scene:
 * `{ elementId, type, label, semantics? }` for every non-deleted element, and
 * `{ from, to, label }` for every non-deleted `arrow` whose both bindings
 * resolve to an element id. Arrows missing either binding are omitted, never
 * guessed. Deleted elements are excluded from both `elements` and `edges`
 * (an arrow referencing a deleted element via a binding is only excluded if
 * the binding itself is unresolved on the deleted side — deletion is judged
 * per-element, this function does not additionally cross-check that an
 * edge's endpoints are themselves non-deleted beyond being present in the
 * live scene it was asked to describe).
 *
 * Pure function, no I/O. `metadata` is optional per-element `semantics`,
 * looked up by `elementId` and attached verbatim when present.
 */
export function extractSceneSemantics(
  scene: readonly SceneElement[],
  metadata?: readonly SceneSemanticsMetadataInput[],
): SceneSemantics {
  const meta = metadata ?? [];
  const liveScene = scene.filter(isNonDeleted);
  const liveIds = new Set(liveScene.map((element) => (element as { id: string }).id));

  const elements: SemanticElement[] = liveScene.map((element) => {
    const el = element as { id: string; type: string };
    const semantics = metadataFor(el.id, meta);
    return {
      elementId: el.id,
      type: el.type,
      label: resolveLabel(element, liveScene),
      ...(semantics !== undefined ? { semantics } : {}),
    };
  });

  const edges: SemanticEdge[] = [];
  for (const element of liveScene) {
    const binding = arrowBinding(element);
    if (!binding?.fromId || !binding.toId) continue;
    if (!liveIds.has(binding.fromId) || !liveIds.has(binding.toId)) continue;
    edges.push({
      from: binding.fromId,
      to: binding.toId,
      label: resolveLabel(element, liveScene),
    });
  }

  return { elements, edges };
}
