import { z } from 'zod';
import {
  collectEdges,
  elementExists,
  elementId,
  elementType,
  expandNeighborhood,
  findElement,
  isNonDeleted,
  resolveLabel,
} from './sceneHelpers.js';
import { defineTool, toolError, toolOk, type ToolContext } from './types.js';

/**
 * Read-only inspection/search tools (T51, AIE-01). Every one is a pure
 * function over `ToolContext` — no `fetch`/`fs`/`child_process` anywhere in
 * this file (auditable by grep, per the task's "Done when"). `search_library`
 * and `get_library_component` resolve exclusively against `ctx.library`
 * (the workspace's authorized library), never a hardcoded/global manifest.
 */

interface ElementSummary {
  elementId: string;
  type: string;
  label: string | null;
}

function summarize(scene: ToolContext['scene'], id: string): ElementSummary | null {
  const element = findElement(scene, id);
  if (!element) return null;
  return { elementId: id, type: elementType(element), label: resolveLabel(element, scene) };
}

// --- inspect_diagram ---------------------------------------------------

const inspectDiagramArgsSchema = z.object({});

export interface InspectDiagramResult {
  elementCount: number;
  byType: Record<string, number>;
  elements: ElementSummary[];
}

export const inspectDiagramTool = defineTool(
  'inspect_diagram',
  1,
  inspectDiagramArgsSchema,
  (ctx: ToolContext) => {
    const live = ctx.scene.filter(isNonDeleted);
    const byType: Record<string, number> = {};
    for (const element of live) {
      const type = elementType(element);
      byType[type] = (byType[type] ?? 0) + 1;
    }
    const elements = live.map((element) => ({
      elementId: elementId(element),
      type: elementType(element),
      label: resolveLabel(element, ctx.scene),
    }));
    return toolOk<InspectDiagramResult>({ elementCount: live.length, byType, elements });
  },
);

// --- get_selection -------------------------------------------------------

const getSelectionArgsSchema = z.object({});

export interface GetSelectionResult {
  elements: ElementSummary[];
}

export const getSelectionTool = defineTool('get_selection', 1, getSelectionArgsSchema, (ctx: ToolContext) => {
  const elements = ctx.selection
    .map((id) => summarize(ctx.scene, id))
    .filter((el): el is ElementSummary => el !== null);
  return toolOk<GetSelectionResult>({ elements });
});

// --- search_elements -------------------------------------------------------

const searchElementsArgsSchema = z.object({
  query: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).default(50),
});

export interface SearchElementsResult {
  elements: ElementSummary[];
  totalMatches: number;
}

export const searchElementsTool = defineTool(
  'search_elements',
  1,
  searchElementsArgsSchema,
  (ctx: ToolContext, args) => {
    const live = ctx.scene.filter(isNonDeleted);
    const queryLower = args.query?.toLowerCase();

    const matches = live.filter((element) => {
      if (args.type && elementType(element) !== args.type) return false;
      if (queryLower) {
        const label = resolveLabel(element, ctx.scene)?.toLowerCase() ?? '';
        if (!label.includes(queryLower)) return false;
      }
      return true;
    });

    const elements = matches.slice(0, args.limit).map((element) => ({
      elementId: elementId(element),
      type: elementType(element),
      label: resolveLabel(element, ctx.scene),
    }));

    return toolOk<SearchElementsResult>({ elements, totalMatches: matches.length });
  },
);

// --- get_neighbors -------------------------------------------------------

const getNeighborsArgsSchema = z.object({
  elementId: z.string().min(1),
  depth: z.number().int().positive().max(10).default(1),
});

export interface GetNeighborsResult {
  neighbors: ElementSummary[];
  edges: { from: string; to: string; label: string | null }[];
}

export const getNeighborsTool = defineTool(
  'get_neighbors',
  1,
  getNeighborsArgsSchema,
  (ctx: ToolContext, args) => {
    if (!elementExists(ctx.scene, args.elementId)) {
      return toolError<GetNeighborsResult>(
        'element_not_found',
        `elementId "${args.elementId}" does not belong to the current diagram`,
      );
    }

    const live = ctx.scene.filter(isNonDeleted);
    const expanded = expandNeighborhood(new Set([args.elementId]), live, args.depth);
    const involved = new Set(expanded); // seed elementId + every reached neighbor
    expanded.delete(args.elementId);

    const neighbors = [...expanded]
      .map((id) => summarize(ctx.scene, id))
      .filter((el): el is ElementSummary => el !== null);

    const edges = collectEdges(live)
      .filter((edge) => edge.from && edge.to && involved.has(edge.from) && involved.has(edge.to))
      .map((edge) => ({ from: edge.from as string, to: edge.to as string, label: edge.label }));

    return toolOk<GetNeighborsResult>({ neighbors, edges });
  },
);

// --- search_library -------------------------------------------------------

const searchLibraryArgsSchema = z.object({
  query: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
});

export interface LibrarySearchItem {
  stableKey: string;
  name: string;
  category: string;
  description: string;
  aliases: readonly string[];
  tags: readonly string[];
}

export interface SearchLibraryResult {
  items: LibrarySearchItem[];
}

export const searchLibraryTool = defineTool(
  'search_library',
  1,
  searchLibraryArgsSchema,
  (ctx: ToolContext, args) => {
    const queryLower = args.query?.toLowerCase();
    const items = ctx.library
      .filter((item) => {
        if (args.category && item.category !== args.category) return false;
        if (!queryLower) return true;
        const haystack = [item.name, item.stableKey, item.description, ...item.aliases, ...item.tags]
          .join(' ')
          .toLowerCase();
        return haystack.includes(queryLower);
      })
      .map((item) => ({
        stableKey: item.stableKey,
        name: item.name,
        category: item.category,
        description: item.description,
        aliases: item.aliases,
        tags: item.tags,
      }));

    return toolOk<SearchLibraryResult>({ items });
  },
);

// --- get_library_component -------------------------------------------------------

const getLibraryComponentArgsSchema = z.object({
  stableKey: z.string().min(1),
});

export const getLibraryComponentTool = defineTool(
  'get_library_component',
  1,
  getLibraryComponentArgsSchema,
  (ctx: ToolContext, args) => {
    const item = ctx.library.find((candidate) => candidate.stableKey === args.stableKey);
    if (!item) {
      return toolError('not_found', `no library component with stableKey "${args.stableKey}" is authorized`);
    }
    return toolOk(item);
  },
);

export const readTools = [
  inspectDiagramTool,
  getSelectionTool,
  searchElementsTool,
  getNeighborsTool,
  searchLibraryTool,
  getLibraryComponentTool,
];
