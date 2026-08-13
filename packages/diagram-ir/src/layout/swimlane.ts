import type { IrDocument } from '../schema.js';
import type { PositionedNode } from './types.js';

/**
 * Swimlane layout for business flows (T46). Each `IrContainer` with
 * `kind: 'swimlane'` becomes one horizontal lane (documented choice —
 * lanes stack top-to-bottom, nodes flow left-to-right within a lane,
 * matching how business-process diagrams are conventionally read).
 * Nodes inside a lane are ordered by a topological sort (BFS layering
 * from in-degree-0 nodes, restricted to edges between nodes of that same
 * lane) — an approximation, not a full graph layout, per the task's own
 * "não precisa ser um layout de grafo completo" allowance. Nodes not
 * assigned to any swimlane container are placed in one implicit trailing
 * lane, ordered the same way, so every node always gets a position.
 */
const MIN_LANE_WIDTH = 1200;
const LANE_HEIGHT = 160;
const LANE_GAP = 24;
const LANE_HEADER = 32;
const LANE_PADDING = 24;
const NODE_WIDTH = 140;
const NODE_HEIGHT = 80;
const NODE_GAP = 40;

/**
 * Orders `nodeIds` by BFS layering over `dependencyEdges` restricted to
 * this lane: nodes with no incoming edge (within the lane) start at
 * position 0, then each edge's target is placed after its source. Nodes
 * untouched by any in-lane edge keep their original relative order,
 * appended after the BFS-reachable ones — this is what "aproximação por
 * BFS/DFS a partir dos nodes sem edges de entrada" means in practice for
 * a lane that isn't a single connected chain.
 */
function topologicalOrder(
  nodeIds: string[],
  edges: readonly { from: string; to: string }[],
): string[] {
  const inLane = new Set(nodeIds);
  const laneEdges = edges.filter((edge) => inLane.has(edge.from) && inLane.has(edge.to));
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));

  for (const edge of laneEdges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const visited = new Set<string>();
  const ordered: string[] = [];

  let i = 0;
  while (i < queue.length) {
    // biome-ignore lint/style/noNonNullAssertion: i stays within queue.length by the loop condition
    const current = queue[i]!;
    i++;
    if (visited.has(current)) continue;
    visited.add(current);
    ordered.push(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next) && !queue.includes(next)) queue.push(next);
    }
  }

  // Nodes never reached (isolated within a cycle, or simply edge-free) keep
  // their original relative order, appended after the BFS result.
  for (const id of nodeIds) {
    if (!visited.has(id)) ordered.push(id);
  }
  return ordered;
}

/**
 * Positions every node in `ir` into horizontal swimlanes. `IrContainer`s
 * with `kind: 'swimlane'` each become one lane, in document order;
 * top-level nodes with no swimlane parent are collected into one implicit
 * trailing lane. Lanes stack top-to-bottom at a fixed height; nodes within
 * a lane are ordered left-to-right by `topologicalOrder` over
 * `mode: 'dependency'` edges (and any other edge, since ordering by any
 * edge direction is a reasonable flow approximation) connecting nodes in
 * that same lane.
 */
export function layoutSwimlane(ir: IrDocument): PositionedNode[] {
  const swimlanes = ir.containers.filter((container) => container.kind === 'swimlane');
  const laneNodeIds = new Set(swimlanes.flatMap((lane) => lane.children));
  const unassignedNodeIds = ir.nodes.map((node) => node.id).filter((id) => !laneNodeIds.has(id));

  const lanes: { id: string | null; nodeIds: string[] }[] = [
    ...swimlanes.map((lane) => ({ id: lane.id, nodeIds: lane.children })),
    ...(unassignedNodeIds.length > 0 ? [{ id: null, nodeIds: unassignedNodeIds }] : []),
  ];

  const out: PositionedNode[] = [];
  let laneY = 0;

  for (const lane of lanes) {
    const ordered = topologicalOrder(lane.nodeIds, ir.edges);

    // The lane's own rectangle must always be at least as wide as the row of
    // nodes it encloses — a fixed width alone would let a lane with enough
    // nodes overflow past its own right edge (a real defect T48's overlap
    // metric caught: an overflowing node stops being fully nested inside its
    // lane, so it registers as genuinely overlapping the lane rectangle).
    const contentWidth =
      ordered.length > 0 ? ordered.length * NODE_WIDTH + (ordered.length - 1) * NODE_GAP : 0;
    const laneWidth = Math.max(MIN_LANE_WIDTH, contentWidth + LANE_PADDING * 2);

    if (lane.id !== null) {
      out.push({ id: lane.id, x: 0, y: laneY, width: laneWidth, height: LANE_HEIGHT });
    }

    let nodeX = LANE_PADDING;
    const nodeY = laneY + LANE_HEADER + Math.max(0, (LANE_HEIGHT - LANE_HEADER - NODE_HEIGHT) / 2);
    for (const nodeId of ordered) {
      out.push({ id: nodeId, x: nodeX, y: nodeY, width: NODE_WIDTH, height: NODE_HEIGHT });
      nodeX += NODE_WIDTH + NODE_GAP;
    }

    laneY += LANE_HEIGHT + LANE_GAP;
  }

  return out;
}
