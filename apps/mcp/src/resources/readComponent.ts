import {
  ResourceTemplate,
  type McpServer,
  type RegisteredResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpClient } from '../client.js';
import { wrapUntrustedResourceContent } from '../untrustedContent.js';

/**
 * MCP-03: `component://{diagramId}/{stableKey}` resolves every element
 * carrying `stableKey` as its `componentKey` in the given diagram, returning
 * their semantic metadata plus in/out relations via `McpClient.getComponent`
 * (T10). Same MCP-06 wrapper as `listDiagrams.ts`/`readDiagram.ts`.
 */
export function registerReadComponentResource(
  server: McpServer,
  client: McpClient,
): RegisteredResourceTemplate {
  return server.registerResource(
    'component',
    new ResourceTemplate('component://{diagramId}/{stableKey}', { list: undefined }),
    {
      title: 'Component metadata and relations',
      description:
        'Semantic metadata plus inbound/outbound relations for every element matching a stable_key in a diagram.',
    },
    async (uri, variables) => {
      const diagramId = variables.diagramId as string;
      const stableKey = variables.stableKey as string;
      const result = await client.getComponent(diagramId, stableKey);
      return wrapUntrustedResourceContent(uri.toString(), result);
    },
  );
}
