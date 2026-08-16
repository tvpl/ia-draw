import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { Db } from '../auth/db.js';
import { type ElementMetadataRow, listElementMetadata } from '../library/metadata.js';

/**
 * MCP-03: component lookup + relation expansion. Both functions here are a
 * server-side equivalent of `packages/ai-tools/src/tools/readTools.ts`'s
 * `get_neighbors` tool (which itself calls `sceneHelpers.ts`'s
 * `expandNeighborhood`/`collectEdges`) — reimplemented locally rather than
 * imported, because `ai-tools` is documented as "never touches DB/network"
 * and this module (a REST route, DB-backed) is exactly the boundary that
 * discipline exists to keep clean (design.md, "Arquitetura: apps/mcp como
 * cliente HTTP fino"). Only the one-hop direct in/out edges MCP-03's AC
 * asks for are needed here — no multi-hop `expandNeighborhood` traversal.
 */

function componentKeyOf(metadataJson: unknown): string | undefined {
  if (typeof metadataJson !== 'object' || metadataJson === null) return undefined;
  const value = (metadataJson as Record<string, unknown>).componentKey;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolves every `diagram_elements_meta` row for `diagramId` whose
 * `metadataJson.componentKey` equals `stableKey` — a diagram can legitimately
 * place the same library component more than once, so this returns every
 * match, never just the first. Reuses `listElementMetadata` (already reads
 * the whole table for the diagram) and filters in memory instead of a new
 * `metadataJson->>'componentKey'` SQL predicate — design.md explicitly
 * accepts a full scan here ("sem índice dedicado ainda... aceitável no
 * volume atual"), so a second query pattern against the same table buys
 * nothing a filter over the already-fetched rows doesn't.
 */
export async function findElementsByComponentKey(
  db: Db,
  diagramId: string,
  stableKey: string,
): Promise<ElementMetadataRow[]> {
  const rows = await listElementMetadata(db, diagramId);
  return rows.filter((row) => componentKeyOf(row.metadataJson) === stableKey);
}

export interface ComponentRelationEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface ComponentRelations {
  inbound: ComponentRelationEdge[];
  outbound: ComponentRelationEdge[];
}

interface RawArrowFields {
  id: string;
  type: string;
  isDeleted?: boolean;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
}

interface RawTextFields {
  id: string;
  type: string;
  text?: string;
  containerId?: string | null;
}

function asRaw<T>(element: SceneElement): T {
  return element as unknown as T;
}

/** Same resolution `ai-tools`'s `sceneHelpers.ts#resolveLabel` uses: an arrow's own bound text child, matched by `containerId`. Arrows never carry `.text` directly, so (unlike the ai-tools version, which also handles a text element being asked about directly) this only needs the bound-child branch. */
function resolveArrowLabel(arrowId: string, scene: readonly SceneElement[]): string | null {
  const boundText = scene.find((candidate) => {
    const raw = asRaw<RawTextFields>(candidate);
    return raw.type === 'text' && raw.containerId === arrowId && typeof raw.text === 'string';
  });
  return boundText ? (asRaw<RawTextFields>(boundText).text ?? null) : null;
}

/**
 * Direct (one-hop) inbound/outbound edges for `elementId` — every live arrow
 * in `scene` whose resolved `startBinding`/`endBinding` touches it, split by
 * direction. MCP-03's AC asks for "as relações de entrada e de saída daquele
 * componente", not a multi-hop neighborhood, so this only walks the scene
 * once and never expands beyond direct edges.
 */
export function expandComponentRelations(
  scene: readonly SceneElement[],
  elementId: string,
): ComponentRelations {
  const inbound: ComponentRelationEdge[] = [];
  const outbound: ComponentRelationEdge[] = [];

  for (const element of scene) {
    const raw = asRaw<RawArrowFields>(element);
    if (raw.isDeleted) continue;
    if (raw.type !== 'arrow') continue;

    const from = raw.startBinding?.elementId ?? null;
    const to = raw.endBinding?.elementId ?? null;
    if (!from || !to) continue;
    if (from !== elementId && to !== elementId) continue;

    const edge: ComponentRelationEdge = { from, to, label: resolveArrowLabel(raw.id, scene) };
    if (to === elementId) inbound.push(edge);
    if (from === elementId) outbound.push(edge);
  }

  return { inbound, outbound };
}
