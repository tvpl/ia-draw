import { readTools } from './readTools.js';
import { ToolRegistry } from './types.js';

/**
 * The registry the AI pipeline (T53, next wave) resolves tool calls against —
 * every read tool (T51) registered. `writeTools.ts` (T52) adds the
 * write/patch tools to this same registry once it lands.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of readTools) registry.register(tool);
  return registry;
}
