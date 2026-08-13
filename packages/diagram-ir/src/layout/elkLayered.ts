import type { ElkNode } from 'elkjs';
import ElkConstructor from 'elkjs';
import type { IrContainer, IrDocument, IrNode } from '../schema.js';
import type { PositionedNode } from './types.js';

/**
 * Layered layout for flows/microservices/event-driven diagrams (T45), via
 * `elkjs`'s Sugiyama-based `layered` algorithm. Confirmed live (Knowledge
 * Verification Chain) that `elkjs`'s default import (`elkjs/lib/main.js`,
 * pure JS, no worker/browser dependency — `elk.bundled.js` is only needed
 * when a Web Worker is unavailable, which plain Node already provides
 * neither a need for nor a problem without) runs `elk.layout()` end-to-end
 * under plain Node with no DOM. `elkjs` ships MIT/EPL-licensed pure JS with
 * zero runtime dependencies of its own.
 *
 * `elkjs`'s own shipped `main.d.ts` re-exports its default constructor via
 * `import ElkConstructor from './elk-api'; export default ElkConstructor;`
 * — under this project's `moduleResolution: NodeNext`, that indirection
 * makes `tsc` mis-resolve the imported binding's type to the module's
 * namespace type instead of the constructor type (`TS2351: not
 * constructable`), even though the runtime value is exactly right (the
 * plain `new ELK()` call above was confirmed working directly in Node).
 * `ElkInstance` below re-declares just the one method this file calls,
 * typed against `elkjs`'s own real `ElkNode` type, and the constructor
 * itself is cast through that local shape to route around the .d.ts's
 * resolution bug without hand-rolling the graph types too.
 */
interface ElkInstance {
  layout(graph: ElkNode): Promise<ElkNode>;
}
const ELK = ElkConstructor as unknown as new () => ElkInstance;

const NODE_WIDTH = 140;
const NODE_HEIGHT = 80;
const CONTAINER_PADDING = 24;
const CONTAINER_HEADER = 32;
const CONTAINER_PADDING_SPEC = `[top=${CONTAINER_HEADER + CONTAINER_PADDING},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`;

/**
 * Builds one ELK graph node per IR id. A leaf `IrNode` becomes a plain
 * sized node; an `IrContainer` becomes a "compound node" — an ELK node
 * with its own `children` array — so ELK lays out its contents as a
 * nested sub-graph, padded to leave room for the container's label.
 */
function buildElkNode(
  id: string,
  nodeById: Map<string, IrNode>,
  containerById: Map<string, IrContainer>,
): ElkNode {
  if (nodeById.has(id)) {
    return { id, width: NODE_WIDTH, height: NODE_HEIGHT };
  }
  const container = containerById.get(id);
  if (!container) {
    // Defensive only: validateIr() already rejects dangling child ids
    // before compile() ever reaches a layout engine (see gridZones.ts's
    // matching guard for the full rationale).
    return { id, width: 0, height: 0 };
  }
  return {
    id,
    layoutOptions: { 'elk.padding': CONTAINER_PADDING_SPEC },
    children: container.children.map((childId) => buildElkNode(childId, nodeById, containerById)),
  };
}

/**
 * ELK reports each node's `x`/`y` relative to its own immediate parent's
 * origin (standard ELK convention for compound layouts), not in absolute
 * graph coordinates. This walk accumulates parent offsets down the tree so
 * the `PositionedNode`s this engine returns are absolute, like the other
 * two layout engines.
 */
function collectAbsolutePositions(
  node: ElkNode,
  originX: number,
  originY: number,
  out: PositionedNode[],
): void {
  for (const child of node.children ?? []) {
    const x = originX + (child.x ?? 0);
    const y = originY + (child.y ?? 0);
    out.push({ id: child.id, x, y, width: child.width ?? 0, height: child.height ?? 0 });
    collectAbsolutePositions(child, x, y, out);
  }
}

/**
 * Positions every node and container in `ir` using ELK's `layered`
 * algorithm (left-to-right layers, per `elk.direction: RIGHT`), appropriate
 * for microservices/event-driven/network-topology/business-flow diagrams.
 * `IrEdge`s become ELK edges (`sources`/`targets`); their `mode`/`direction`
 * semantics don't affect the geometric layout, only how `compile()` later
 * renders arrowheads.
 */
export async function layoutElkLayered(ir: IrDocument): Promise<PositionedNode[]> {
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const containerById = new Map(ir.containers.map((container) => [container.id, container]));
  const containedIds = new Set(ir.containers.flatMap((container) => container.children));

  const rootIds = [
    ...ir.containers.filter((container) => !containedIds.has(container.id)).map((c) => c.id),
    ...ir.nodes.filter((node) => !containedIds.has(node.id)).map((n) => n.id),
  ];

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    },
    children: rootIds.map((id) => buildElkNode(id, nodeById, containerById)),
    edges: ir.edges.map((edge, index) => ({
      id: `e${index}`,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };

  const elk = new ELK();
  const result = await elk.layout(graph);

  const out: PositionedNode[] = [];
  collectAbsolutePositions(result, 0, 0, out);
  return out;
}
