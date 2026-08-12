import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { LibraryItem } from '@arch-canvas/library-content';

/**
 * Compact context builder for the AI agent (T50, AIG-01/AIE-04). Pure
 * function — no DB/network access — so the pipeline (T53) resolves the
 * diagram/library/metadata rows first and hands the plain data in here.
 *
 * The foundational security property (AIE-04): `context.sceneData` is the
 * ONLY place any text that came from inside the canvas (element labels,
 * arrow labels) ever appears. `context.instructions` carries exclusively
 * the user's own request/language/diagramKind — literal values the caller
 * supplied, never anything read out of `scene`. A caller that later builds
 * a system/user prompt for the model MUST serialize `sceneData` as an
 * inert data field (e.g. a JSON string inside a "here is the current
 * diagram" user-turn), never splice it into the instruction text itself.
 */

/** Only these keys are ever forwarded from an element's metadata record — mirrors diagram-ir's node semantics shape. Anything else (comments, attachment URLs, ...) is silently dropped, never reaching the model (design.md §8.2). */
export interface ElementSemanticMetadata {
  technology?: string;
  provider?: string;
  environment?: string;
  dataClassification?: string;
  criticality?: string;
}

export interface ElementMetadataInput {
  elementId: string;
  semantics?: ElementSemanticMetadata;
}

export interface WorkspaceArchitecturalRule {
  id: string;
  description: string;
}

export interface LibrarySummary {
  stableKey: string;
  name: string;
  category: string;
  aliases: readonly string[];
}

/** One scene element, serialized as inert data — `label` may contain arbitrary (including adversarial) text; it is never treated as an instruction by anything that consumes `AiContext`. */
export interface SceneDataElement {
  elementId: string;
  type: string;
  label: string | null;
  semantics?: ElementSemanticMetadata;
}

export interface SceneDataEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface BuildContextInput {
  diagramId: string;
  diagramKind: string;
  userRequest: string;
  language: string;
  scene: readonly SceneElement[];
  /** ElementIds currently selected on the canvas. Empty/omitted means "no selection" — the whole scene is included. */
  selection?: readonly string[];
  library: readonly LibraryItem[];
  workspaceRules?: readonly WorkspaceArchitecturalRule[];
  metadata?: readonly ElementMetadataInput[];
}

export interface BuildContextOptions {
  /** How many edge-hops of neighborhood to pull in around a selection. Defaults to 1. */
  neighborhoodDepth?: number;
}

export interface AiContext {
  diagramId: string;
  /** The ONLY trusted, instruction-shaped content — literal caller-supplied values, never scene text. */
  instructions: {
    userRequest: string;
    language: string;
    diagramKind: string;
  };
  library: LibrarySummary[];
  workspaceRules: WorkspaceArchitecturalRule[];
  /** Untrusted DATA field (AIE-04) — scene content serialized as data, never instructions. */
  sceneData: {
    scope: 'full-scene' | 'selection-neighborhood';
    elements: SceneDataElement[];
    edges: SceneDataEdge[];
  };
}

function isNonDeleted(element: SceneElement): boolean {
  return !(element as { isDeleted?: boolean }).isDeleted;
}

/** Resolves the visible label for `element`: its own `.text` if it's a text element, else the text of a bound text child (found by `containerId`), else `null`. */
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

/** All non-deleted arrows in `scene`, resolved to `{ from, to, label }` — the "relações" the context carries alongside elements. */
function collectEdges(scene: readonly SceneElement[]): { from: string; to: string; label: string | null }[] {
  const edges: { from: string; to: string; label: string | null }[] = [];
  for (const element of scene) {
    if (!isNonDeleted(element)) continue;
    const binding = arrowBinding(element);
    if (!binding?.fromId || !binding.toId) continue;
    edges.push({ from: binding.fromId, to: binding.toId, label: resolveLabel(element, scene) });
  }
  return edges;
}

/** Elements directly connected (either arrow endpoint) to any id in `ids`, expanded `depth` hops. */
function expandNeighborhood(
  ids: ReadonlySet<string>,
  scene: readonly SceneElement[],
  depth: number,
): Set<string> {
  const edges = collectEdges(scene);
  let frontier = new Set(ids);
  const visited = new Set(ids);

  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.from) && !visited.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !visited.has(edge.from)) next.add(edge.from);
    }
    for (const id of next) visited.add(id);
    frontier = next;
    if (frontier.size === 0) break;
  }

  return visited;
}

/**
 * Resolves `elementId`'s semantic metadata, explicitly copying ONLY the five
 * known keys — never a passthrough of the raw input object. `semantics` may
 * originate from an untyped `jsonb` column upstream, so a stray `comments`/
 * `attachmentUrl` key (TypeScript can't stop that at runtime) is silently
 * dropped here rather than forwarded into the model's context.
 */
function metadataFor(
  elementId: string,
  metadata: readonly ElementMetadataInput[],
): ElementSemanticMetadata | undefined {
  const semantics = metadata.find((entry) => entry.elementId === elementId)?.semantics;
  if (!semantics) return undefined;

  const cleaned: ElementSemanticMetadata = {};
  if (semantics.technology !== undefined) cleaned.technology = semantics.technology;
  if (semantics.provider !== undefined) cleaned.provider = semantics.provider;
  if (semantics.environment !== undefined) cleaned.environment = semantics.environment;
  if (semantics.dataClassification !== undefined) cleaned.dataClassification = semantics.dataClassification;
  if (semantics.criticality !== undefined) cleaned.criticality = semantics.criticality;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * Builds the compact `AiContext` a run sends to the model. When `selection`
 * is non-empty, `sceneData` includes ONLY the selection plus its
 * edge-connected neighborhood (never the whole scene, regardless of scene
 * size) — matching the "seleção → vizinhança" strategy. When there is no
 * selection, the whole (non-deleted) scene is included; a hierarchical
 * summary for very large unselected scenes is intentionally NOT implemented
 * here (documented TODO — the "resumo hierárquico" tier from design.md §8.2
 * is deferred, per T50's own scope note, to a future task).
 */
export function buildContext(input: BuildContextInput, options: BuildContextOptions = {}): AiContext {
  const depth = options.neighborhoodDepth ?? 1;
  const liveScene = input.scene.filter(isNonDeleted);
  const selection = (input.selection ?? []).filter((id) => id.length > 0);
  const metadata = input.metadata ?? [];

  const includedIds =
    selection.length > 0 ? expandNeighborhood(new Set(selection), liveScene, depth) : null;

  const includedElements = includedIds
    ? liveScene.filter((element) => includedIds.has((element as { id: string }).id))
    : liveScene;
  const includedIdSet = new Set(includedElements.map((element) => (element as { id: string }).id));

  const sceneElements: SceneDataElement[] = includedElements
    // Bound label/annotation text elements are surfaced via their container's `label` above, not
    // as their own top-level entry (avoids double-reporting the same text under two ids).
    .filter((element) => {
      const el = element as { type: string; containerId?: string | null };
      return !(el.type === 'text' && el.containerId);
    })
    .map((element) => {
      const el = element as { id: string; type: string };
      return {
        elementId: el.id,
        type: el.type,
        label: resolveLabel(element, liveScene),
        semantics: metadataFor(el.id, metadata),
      };
    });

  const sceneEdges: SceneDataEdge[] = collectEdges(liveScene).filter(
    (edge) => includedIdSet.has(edge.from) && includedIdSet.has(edge.to),
  );

  return {
    diagramId: input.diagramId,
    instructions: {
      userRequest: input.userRequest,
      language: input.language,
      diagramKind: input.diagramKind,
    },
    library: input.library.map((item) => ({
      stableKey: item.stableKey,
      name: item.name,
      category: item.category,
      aliases: item.aliases,
    })),
    workspaceRules: [...(input.workspaceRules ?? [])],
    sceneData: {
      scope: includedIds ? 'selection-neighborhood' : 'full-scene',
      elements: sceneElements,
      edges: sceneEdges,
    },
  };
}
