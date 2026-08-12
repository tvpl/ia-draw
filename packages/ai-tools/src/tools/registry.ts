import { readTools } from './readTools.js';
import { ToolRegistry } from './types.js';
import { writeTools } from './writeTools.js';

/**
 * The registry the AI pipeline (T53, next wave) resolves tool calls
 * against — every read tool (T51) and write/patch tool (T52) registered.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of readTools) registry.register(tool);
  for (const tool of writeTools) registry.register(tool);
  return registry;
}
