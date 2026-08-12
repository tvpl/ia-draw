import type { IrContainer, IrDocument, IrNode } from '../schema.js';
import type { PositionedNode } from './types.js';

/**
 * Deterministic grid layout for cloud-zone / C4 diagrams (T44). Every node
 * gets a fixed-size cell; containers wrap their children's grid with
 * padding that grows by nesting depth, plus a fixed header band reserved
 * for the container's own label. Sibling items (nodes or containers) at
 * the same level are laid out in a roughly-square grid, each column/row
 * sized to the max of the items placed in it, with a fixed gap between
 * cells — this is what keeps siblings (and, by induction, whole subtrees)
 * from ever overlapping. Purely geometric: no rendering dependency.
 */
const NODE_WIDTH = 140;
const NODE_HEIGHT = 80;
const GRID_GAP = 24;
const BASE_PADDING = 24;
const PADDING_STEP = 12;
const HEADER_HEIGHT = 32;

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

function paddingForDepth(depth: number): number {
  return BASE_PADDING + depth * PADDING_STEP;
}

function gridColumns(count: number): number {
  return count === 0 ? 0 : Math.max(1, Math.ceil(Math.sqrt(count)));
}

interface GridLayout extends Size {
  positions: Map<string, Point>;
}

/**
 * Places `items` (each already sized) into a roughly-square grid, columns
 * left-to-right then rows top-to-bottom in the given array order. Returns
 * each item's offset relative to the grid's own (0, 0) origin, plus the
 * grid's total bounding size.
 */
function layoutGrid(items: readonly { id: string; size: Size }[]): GridLayout {
  const cols = gridColumns(items.length);
  if (cols === 0) return { width: 0, height: 0, positions: new Map() };
  const rows = Math.ceil(items.length / cols);

  const colWidths = new Array<number>(cols).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  items.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    colWidths[col] = Math.max(colWidths[col] ?? 0, item.size.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, item.size.height);
  });

  const colOffsets: number[] = [];
  let x = 0;
  for (const colWidth of colWidths) {
    colOffsets.push(x);
    x += colWidth + GRID_GAP;
  }
  const rowOffsets: number[] = [];
  let y = 0;
  for (const rowHeight of rowHeights) {
    rowOffsets.push(y);
    y += rowHeight + GRID_GAP;
  }

  const positions = new Map<string, Point>();
  items.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions.set(item.id, { x: colOffsets[col] ?? 0, y: rowOffsets[row] ?? 0 });
  });

  const width = colWidths.reduce((sum, w) => sum + w, 0) + GRID_GAP * Math.max(0, cols - 1);
  const height = rowHeights.reduce((sum, h) => sum + h, 0) + GRID_GAP * Math.max(0, rows - 1);
  return { width, height, positions };
}

interface ComputedLayout {
  size: Size;
  /** Present only for containers: each child's offset within this container's own grid. */
  childOffsets?: Map<string, Point>;
}

function computeLayout(
  id: string,
  depth: number,
  nodeById: Map<string, IrNode>,
  containerById: Map<string, IrContainer>,
  cache: Map<string, ComputedLayout>,
): ComputedLayout {
  const cached = cache.get(id);
  if (cached) return cached;

  if (nodeById.has(id)) {
    const result: ComputedLayout = { size: { width: NODE_WIDTH, height: NODE_HEIGHT } };
    cache.set(id, result);
    return result;
  }

  const container = containerById.get(id);
  if (!container) {
    // Defensive only: an id referenced by a parent's `children` but not a
    // known node/container. validateIr() already rejects this at the IR
    // level (dangling child reference) before compile() ever calls a
    // layout engine, so this path is unreachable from validated input —
    // degrade to zero-size rather than throw on an already-invalid IR.
    const result: ComputedLayout = { size: { width: 0, height: 0 } };
    cache.set(id, result);
    return result;
  }

  const childItems = container.children.map((childId) => ({
    id: childId,
    size: computeLayout(childId, depth + 1, nodeById, containerById, cache).size,
  }));
  const grid = layoutGrid(childItems);
  const padding = paddingForDepth(depth);
  const result: ComputedLayout = {
    size: {
      width: grid.width + padding * 2,
      height: grid.height + padding * 2 + HEADER_HEIGHT,
    },
    childOffsets: grid.positions,
  };
  cache.set(id, result);
  return result;
}

function place(
  id: string,
  origin: Point,
  depth: number,
  containerById: Map<string, IrContainer>,
  cache: Map<string, ComputedLayout>,
  out: PositionedNode[],
): void {
  const layout = cache.get(id);
  if (!layout) return;
  out.push({ id, x: origin.x, y: origin.y, width: layout.size.width, height: layout.size.height });

  if (!layout.childOffsets) return;
  const container = containerById.get(id);
  if (!container) return;
  const padding = paddingForDepth(depth);
  for (const childId of container.children) {
    const offset = layout.childOffsets.get(childId);
    if (!offset) continue;
    place(
      childId,
      { x: origin.x + padding + offset.x, y: origin.y + padding + HEADER_HEIGHT + offset.y },
      depth + 1,
      containerById,
      cache,
      out,
    );
  }
}

/**
 * Positions every node and container in `ir` on a deterministic grid.
 * Top-level items (not referenced as a child by any container) are laid
 * out at depth 0; nested items recurse with growing padding per level.
 */
export function layoutGridZones(ir: IrDocument): PositionedNode[] {
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const containerById = new Map(ir.containers.map((container) => [container.id, container]));
  const containedIds = new Set(ir.containers.flatMap((container) => container.children));

  const rootIds = [
    ...ir.containers.filter((container) => !containedIds.has(container.id)).map((c) => c.id),
    ...ir.nodes.filter((node) => !containedIds.has(node.id)).map((n) => n.id),
  ];

  const cache = new Map<string, ComputedLayout>();
  const rootItems = rootIds.map((id) => ({
    id,
    size: computeLayout(id, 0, nodeById, containerById, cache).size,
  }));
  const rootGrid = layoutGrid(rootItems);

  const out: PositionedNode[] = [];
  for (const id of rootIds) {
    const offset = rootGrid.positions.get(id);
    if (!offset) continue;
    place(id, offset, 0, containerById, cache, out);
  }
  return out;
}
