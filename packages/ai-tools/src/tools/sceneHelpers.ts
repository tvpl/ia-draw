import type { SceneElement } from '@arch-canvas/editor-adapter';

/** Small, shared, read-only helpers over a `ToolContext.scene` — used by both the read tools (T51) and the write tools (T52). Every function here is pure and touches nothing outside its arguments. */

export function isNonDeleted(element: SceneElement): boolean {
  return !(element as { isDeleted?: boolean }).isDeleted;
}

export function elementId(element: SceneElement): string {
  return (element as { id: string }).id;
}

export function elementType(element: SceneElement): string {
  return (element as { type: string }).type;
}

export function findElement(scene: readonly SceneElement[], id: string): SceneElement | undefined {
  return scene.find((element) => elementId(element) === id && isNonDeleted(element));
}

export function elementExists(scene: readonly SceneElement[], id: string): boolean {
  return findElement(scene, id) !== undefined;
}

/** Every id in `ids` that is NOT a live element of `scene` — the "every ID must belong to the diagram" check every write tool that references existing elements runs first. */
export function missingIds(scene: readonly SceneElement[], ids: readonly string[]): string[] {
  return ids.filter((id) => !elementExists(scene, id));
}

/** Resolves the visible label for `element`: its own `.text` if it's a text element, else the text of a bound text child (matched by `containerId`), else `null`. */
export function resolveLabel(element: SceneElement, scene: readonly SceneElement[]): string | null {
  const el = element as { type: string; text?: string; id: string };
  if (el.type === 'text' && typeof el.text === 'string') return el.text;
  const boundText = scene.find((candidate) => {
    const c = candidate as { type: string; containerId?: string | null; text?: string };
    return c.type === 'text' && c.containerId === el.id && typeof c.text === 'string';
  }) as { text?: string } | undefined;
  return boundText?.text ?? null;
}

export interface SceneEdge {
  id: string;
  from: string | null;
  to: string | null;
  label: string | null;
}

/** All non-deleted arrows in `scene`, resolved to `{id, from, to, label}` via their `startBinding`/`endBinding`. */
export function collectEdges(scene: readonly SceneElement[]): SceneEdge[] {
  const edges: SceneEdge[] = [];
  for (const element of scene) {
    if (!isNonDeleted(element) || elementType(element) !== 'arrow') continue;
    const el = element as {
      id: string;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
    };
    edges.push({
      id: el.id,
      from: el.startBinding?.elementId ?? null,
      to: el.endBinding?.elementId ?? null,
      label: resolveLabel(element, scene),
    });
  }
  return edges;
}

/** Elements directly connected (either arrow endpoint) to any id in `ids`, expanded `depth` edge-hops. Never includes the seed ids' own... it DOES include them (the neighborhood is inclusive of the seed selection, matching `buildContext`'s "selection + neighborhood" semantics). */
export function expandNeighborhood(
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
      if (!edge.from || !edge.to) continue;
      if (frontier.has(edge.from) && !visited.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !visited.has(edge.from)) next.add(edge.from);
    }
    for (const id of next) visited.add(id);
    frontier = next;
    if (frontier.size === 0) break;
  }

  return visited;
}
