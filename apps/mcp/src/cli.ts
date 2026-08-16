#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpClient } from './client.js';
import { registerListDiagramsResource } from './resources/listDiagrams.js';
import { registerReadComponentResource } from './resources/readComponent.js';
import { registerReadDiagramResource } from './resources/readDiagram.js';

/**
 * Stdio entrypoint (MCP-01) — the `bin` `package.json` points `npx
 * @arch-canvas/mcp` (or `arch-canvas-mcp` once installed) at, after `build`.
 * Registers the three read-only resources from T11/T12 and connects over
 * stdio, the transport local MCP clients (Cursor, Claude Code) expect
 * (design.md, "Onde vive o servidor MCP?"). `McpClient` reads
 * `ARCH_CANVAS_API_URL`/`ARCH_CANVAS_MCP_TOKEN` from the environment itself
 * (`client.ts`, T10) — this file never touches those env vars directly.
 */
export async function main(): Promise<void> {
  const client = new McpClient();
  const server = new McpServer({ name: '@arch-canvas/mcp', version: '0.0.0' });

  registerListDiagramsResource(server, client);
  registerReadDiagramResource(server, client);
  registerReadComponentResource(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-run when executed directly (`node dist/cli.js`) — importing this
// module from a test never starts a real stdio server on its own.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error('arch-canvas-mcp failed to start:', error);
    process.exitCode = 1;
  });
}
