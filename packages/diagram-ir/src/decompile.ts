import { extractSceneSemantics } from '@arch-canvas/diagram-domain';
import {
  EDGE_MODES,
  type EdgeDirection,
  type EdgeMode,
  type IrContainer,
  type IrDocument,
  type IrEdge,
  type IrNode,
} from './schema.js';

/**
 * `decompile()`'s scene parameter is typed structurally off
 * `extractSceneSemantics`'s own parameter type (`readonly SceneElement[]`
 * from `@arch-canvas/editor-adapter`) instead of importing `SceneElement`
 * directly — this package only takes on the new `@arch-canvas/diagram-domain`
 * dependency (per design.md/tasks.md T1), not `editor-adapter` itself.
 */
type DecompileSceneElement = Parameters<typeof extractSceneSemantics>[0][number];

/**
 * Shape-compatible with `apps/server`'s `ElementMetadataRow`
 * (`library/metadata.ts`) — only the two fields `decompile()` reads.
 * Declared locally rather than imported: `packages/diagram-ir` never
 * depends on `apps/server`.
 */
export interface DecompileMetadataInput {
  elementId: string;
  metadataJson: unknown;
}

/** Fields `decompile()` reads off a raw scene element, cast the same way `packages/diagram-domain/src/sceneSemantics.ts` casts (`SceneElement` is a big readonly union; a narrow local shape is enough for property access). */
interface RawSceneFields {
  id: string;
  type: string;
  isDeleted?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  startArrowhead?: string | null;
}

function asRaw(element: DecompileSceneElement): RawSceneFields {
  return element as unknown as RawSceneFields;
}

/** The only keys `IrNode.semantics` ever carries — mirrors `irNodeSemanticsSchema` (`schema.ts`) and `ai-engine/buildContext.ts`'s `ElementSemanticMetadata`. */
const NODE_SEMANTIC_KEYS = [
  'technology',
  'provider',
  'environment',
  'dataClassification',
  'criticality',
] as const;

/**
 * `decompile()` never invents a document `kind` — nothing in a compiled
 * scene records the original `IrDocument.kind` (it only ever steers which
 * layout engine `compile()` picked; no trace survives into the scene
 * itself). `'microservices'` is the same "kind unknown, pick a generic
 * default" value `packages/ai-tools/src/tools/writeTools.ts`'s
 * `auto_layout` tool already uses when it builds a throwaway IR document
 * for layout purposes only — reused here for the same reason, not a new
 * convention. Disclosed limitation, not hidden: callers that need the
 * genuine original `kind` cannot recover it from a decompiled document.
 */
const UNKNOWN_KIND: IrDocument['kind'] = 'microservices';

/** Minimum tolerance for bounding-box containment, absorbing floating point rounding from the layout engines — never enough to let a sibling box "leak" into a nearby container. */
const CONTAINMENT_MARGIN = 1;

interface Box {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `a` geometrically contains `b` when `b`'s box lies entirely inside `a`'s box (within `CONTAINMENT_MARGIN`). Equal boxes count as containment; callers exclude `a === b` themselves. */
function boxContains(a: Box, b: Box): boolean {
  return (
    b.x >= a.x - CONTAINMENT_MARGIN &&
    b.y >= a.y - CONTAINMENT_MARGIN &&
    b.x + b.width <= a.x + a.width + CONTAINMENT_MARGIN &&
    b.y + b.height <= a.y + a.height + CONTAINMENT_MARGIN
  );
}

function area(box: Box): number {
  return box.width * box.height;
}

/**
 * For every box, finds its *direct* (innermost) containing box — the
 * smallest-area box among all boxes that geometrically contain it. This is
 * what lets nesting come out right: if `A` contains `B` contains `C`, `C`'s
 * direct parent is `B` (not `A`), so `B` ends up as `A`'s child and `C` as
 * `B`'s child, never both flattened under `A`.
 */
function inferDirectParents(boxes: readonly Box[]): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const candidate of boxes) {
    let best: Box | undefined;
    for (const other of boxes) {
      if (other.id === candidate.id) continue;
      if (!boxContains(other, candidate)) continue;
      if (!best || area(other) < area(best)) best = other;
    }
    if (best) parentOf.set(candidate.id, best.id);
  }
  return parentOf;
}

function metadataJsonFor(
  elementId: string,
  metadata: readonly DecompileMetadataInput[],
): Record<string, unknown> | undefined {
  const row = metadata.find((entry) => entry.elementId === elementId);
  if (!row) return undefined;
  const json = row.metadataJson;
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  return json as Record<string, unknown>;
}

function componentKeyFor(
  elementId: string,
  metadata: readonly DecompileMetadataInput[],
): string | undefined {
  const value = metadataJsonFor(elementId, metadata)?.componentKey;
  return typeof value === 'string' ? value : undefined;
}

function nodeSemanticsFor(
  elementId: string,
  metadata: readonly DecompileMetadataInput[],
): IrNode['semantics'] {
  const json = metadataJsonFor(elementId, metadata);
  if (!json) return undefined;
  const semantics: Record<string, string> = {};
  for (const key of NODE_SEMANTIC_KEYS) {
    const value = json[key];
    if (typeof value === 'string') semantics[key] = value;
  }
  return Object.keys(semantics).length > 0 ? (semantics as IrNode['semantics']) : undefined;
}

/**
 * `IrEdge.semantics.mode` is a required field (`irEdgeSemanticsSchema`,
 * `schema.ts`) but `compile()` never encodes it into the scene (only
 * `direction`, via `startArrowhead`, and `label`, via a bound text child,
 * survive compilation — confirmed against `compile.ts`'s `buildArrowElement`).
 * When no `update_connector`-style metadata recorded a `mode` for this
 * arrow, `'dependency'` is used — the same "unknown edge, pick a generic
 * mode" default `writeTools.ts`'s `auto_layout` tool already uses for a
 * synthetic edge whose real mode was never captured either.
 */
const DEFAULT_EDGE_MODE: EdgeMode = 'dependency';

function isEdgeMode(value: unknown): value is EdgeMode {
  return typeof value === 'string' && (EDGE_MODES as readonly string[]).includes(value);
}

function edgeModeFor(elementId: string, metadata: readonly DecompileMetadataInput[]): EdgeMode {
  const value = metadataJsonFor(elementId, metadata)?.mode;
  return isEdgeMode(value) ? value : DEFAULT_EDGE_MODE;
}

function edgeProtocolFor(
  elementId: string,
  metadata: readonly DecompileMetadataInput[],
): string | undefined {
  const value = metadataJsonFor(elementId, metadata)?.protocol;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reverse compiler: rebuilds a `diagram-ir/v1` document from an already
 * compiled/saved scene, closing the gap `docs/adr/0004-diagram-ir-v1.md`
 * left open (only `compile()`, `IrDocument -> scene`, existed before this).
 *
 * Nodes and edges reuse `extractSceneSemantics` (`@arch-canvas/diagram-domain`)
 * for element identity, label resolution, and arrow-binding resolution — the
 * same logic `lint`/`docgen`/`interop-export` already rely on, not
 * reimplemented here. `componentKey` and node `semantics` come from
 * `metadata` (`diagram_elements_meta` rows) when present, never guessed.
 *
 * Containers have no explicit trace in a compiled scene (`compile()` always
 * emits a container as a plain `rectangle`, and never populates
 * `groupIds`/`frameId` on its children — see `compile.ts:159-192` and
 * `design.md`'s MCP-01/02 section) — so containment is inferred purely
 * geometrically: rectangle `A` is `B`'s container when `B`'s bounding box
 * lies entirely inside `A`'s. `kind` is always `'group'` for an inferred
 * container — the original semantic intent (`vpc`/`zone`/`swimlane`/...)
 * never survives the geometric path, a disclosed limitation, not a guess.
 * A rectangle with zero contained rectangles is always a plain `IrNode`,
 * never an empty container.
 */
export function decompile(
  scene: readonly DecompileSceneElement[],
  metadata: readonly DecompileMetadataInput[],
): IrDocument {
  const semantics = extractSceneSemantics(scene);
  const semanticById = new Map(semantics.elements.map((element) => [element.elementId, element]));

  const rectBoxes: Box[] = [];
  for (const element of scene) {
    const raw = asRaw(element);
    if (raw.isDeleted) continue;
    if (raw.type !== 'rectangle') continue;
    const label = semanticById.get(raw.id)?.label;
    if (!label) continue; // no resolved label: not a node/container candidate (design.md step 1)
    rectBoxes.push({ id: raw.id, label, x: raw.x, y: raw.y, width: raw.width, height: raw.height });
  }

  const parentOf = inferDirectParents(rectBoxes);
  const containerIds = new Set(parentOf.values());

  const childrenByParent = new Map<string, string[]>();
  for (const [childId, parentId] of parentOf) {
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(childId);
    childrenByParent.set(parentId, siblings);
  }

  const containers: IrContainer[] = rectBoxes
    .filter((box) => containerIds.has(box.id))
    .map((box) => ({
      id: box.id,
      label: box.label,
      kind: 'group',
      children: childrenByParent.get(box.id) ?? [],
    }));

  const nodes: IrNode[] = rectBoxes
    .filter((box) => !containerIds.has(box.id))
    .map((box) => {
      const componentKey = componentKeyFor(box.id, metadata);
      const nodeSemantics = nodeSemanticsFor(box.id, metadata);
      return {
        id: box.id,
        label: box.label,
        ...(componentKey !== undefined ? { componentKey } : {}),
        ...(nodeSemantics !== undefined ? { semantics: nodeSemantics } : {}),
      };
    });

  // Raw arrows, filtered identically to `extractSceneSemantics`'s internal
  // edge loop (live, type 'arrow', both bindings resolved to a live element
  // id) and walked in the same scene order — so this list lines up
  // index-for-index with `semantics.edges` below, letting each `SemanticEdge`
  // (from/to/label, already resolved) be paired back to the raw arrow that
  // produced it for `direction` (`startArrowhead`) and metadata lookup.
  const liveArrows: { id: string; startArrowhead: string | null | undefined }[] = [];
  for (const element of scene) {
    const raw = asRaw(element);
    if (raw.isDeleted) continue;
    if (raw.type !== 'arrow') continue;
    const fromId = raw.startBinding?.elementId;
    const toId = raw.endBinding?.elementId;
    if (!fromId || !toId) continue;
    if (!semanticById.has(fromId) || !semanticById.has(toId)) continue;
    liveArrows.push({ id: raw.id, startArrowhead: raw.startArrowhead });
  }

  const edges: IrEdge[] = semantics.edges.map((edge, index) => {
    const arrow = liveArrows[index];
    const direction: EdgeDirection = arrow?.startArrowhead ? 'bidirectional' : 'oneway';
    const mode = arrow ? edgeModeFor(arrow.id, metadata) : DEFAULT_EDGE_MODE;
    const protocol = arrow ? edgeProtocolFor(arrow.id, metadata) : undefined;
    return {
      from: edge.from,
      to: edge.to,
      semantics: {
        mode,
        direction,
        ...(protocol !== undefined ? { protocol } : {}),
        ...(edge.label !== null ? { label: edge.label } : {}),
      },
    };
  });

  return {
    version: 'v1',
    kind: UNKNOWN_KIND,
    nodes,
    containers,
    edges,
  };
}
