/**
 * A node (or container) placed at absolute coordinates by a layout engine.
 * Shared shape across all three engines (grid-zones, elk-layered, swimlane)
 * so `compile()` (T47) can consume any of them uniformly.
 */
export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
