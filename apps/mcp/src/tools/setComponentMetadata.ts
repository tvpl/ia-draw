import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { McpApiError, type McpClient } from '../client.js';
import { wrapUntrustedToolContent } from '../untrustedContent.js';

const inputSchema = {
  diagramId: z.string().min(1),
  elementId: z.string().min(1),
  sourceRevision: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()),
};

const outputSchema = {
  snapshotId: z.string(),
  revision: z.number(),
};

/**
 * MCP-07 (write behind a flag): the single write tool this server exposes —
 * `set_component_metadata` proposes one `setMetadata` op via
 * `McpClient.setComponentMetadata`, which lands on `POST
 * /diagrams/:id/mcp-patch` (T14). Only ever registered by `cli.ts` when
 * `MCP_WRITE_ENABLED=true` on the `apps/mcp` side — mirroring the server's
 * own flag so the tool never appears in the capability list a client sees
 * when the backend would reject it anyway.
 *
 * A rejected call (stale revision, no permission, the server-side flag off,
 * etc.) is reported as a structured tool error (`isError: true`) rather than
 * an uncaught exception — the MCP convention for tool-level failures
 * (`CallToolResult`'s own doc comment: errors SHOULD be reported inside the
 * result, not as a protocol-level error, so the calling agent can see and
 * self-correct).
 */
export function registerSetComponentMetadataTool(
  server: McpServer,
  client: McpClient,
): RegisteredTool {
  return server.registerTool(
    'set_component_metadata',
    {
      title: 'Set component metadata',
      description:
        'Proposes a single setMetadata edit to one diagram element, behind the pre_ai approval snapshot.',
      inputSchema,
      outputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await client.setComponentMetadata(args.diagramId, {
          sourceRevision: args.sourceRevision,
          elementId: args.elementId,
          metadata: args.metadata,
        });
        return wrapUntrustedToolContent({
          snapshotId: result.snapshotId,
          revision: result.revision,
        });
      } catch (error) {
        const message =
          error instanceof McpApiError
            ? `set_component_metadata failed: ${error.message}`
            : 'set_component_metadata failed with an unexpected error';
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );
}
