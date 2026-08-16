import {
  ResourceTemplate,
  type McpServer,
  type RegisteredResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpClient } from '../client.js';
import { wrapUntrustedResourceContent } from '../untrustedContent.js';

/**
 * MCP-01/02: `diagram://{diagramId}` reads a single diagram's
 * `diagram-ir/v1` representation via `McpClient.getDiagramIr` (T10) — nodes,
 * containers, edges, metadata, never a rendered image. Same MCP-06 wrapper
 * as `listDiagrams.ts` (T11).
 */
export function registerReadDiagramResource(
  server: McpServer,
  client: McpClient,
): RegisteredResourceTemplate {
  return server.registerResource(
    'diagram',
    new ResourceTemplate('diagram://{diagramId}', { list: undefined }),
    {
      title: 'Diagram (diagram-ir/v1)',
      description: 'The structured diagram-ir/v1 representation of a saved diagram.',
    },
    async (uri, variables) => {
      const diagramId = variables.diagramId as string;
      const document = await client.getDiagramIr(diagramId);
      return wrapUntrustedResourceContent(uri.toString(), document);
    },
  );
}
