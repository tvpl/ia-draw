import {
  type McpServer,
  type RegisteredResourceTemplate,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpClient } from '../client.js';
import { wrapUntrustedResourceContent } from '../untrustedContent.js';

/**
 * MCP-01: `diagrams://{workspaceId}` lists every diagram in a workspace via
 * `McpClient.listDiagrams` (T10). `{ list: undefined }` is the SDK's
 * required-but-optional resource-listing callback (design.md's SDK section)
 * — this server exposes no separate "browse all workspaces" listing, only
 * direct reads by a known `workspaceId`.
 */
export function registerListDiagramsResource(
  server: McpServer,
  client: McpClient,
): RegisteredResourceTemplate {
  return server.registerResource(
    'diagrams',
    new ResourceTemplate('diagrams://{workspaceId}', { list: undefined }),
    {
      title: 'Diagrams in a workspace',
      description: 'Every diagram belonging to the given workspace.',
    },
    async (uri, variables) => {
      const workspaceId = variables.workspaceId as string;
      const items = await client.listDiagrams(workspaceId);
      return wrapUntrustedResourceContent(uri.toString(), { items });
    },
  );
}
