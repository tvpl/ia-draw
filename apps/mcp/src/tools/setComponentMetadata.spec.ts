import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { McpClient } from '../client.js';
import { UNTRUSTED_CONTENT_DISCLAIMER } from '../untrustedContent.js';
import { registerSetComponentMetadataTool } from './setComponentMetadata.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchImpl: typeof fetch): McpClient {
  return new McpClient({ apiUrl: 'https://api.example.test', token: 'test-token', fetchImpl });
}

const noExtra = {} as unknown as RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * `RegisteredTool.handler`'s declared type is a union with `ToolTaskHandler`
 * (task-based tools, not used here), which TS won't let you call directly.
 * This server never registers a task-based tool, so narrowing via a cast is
 * safe — mirrors the `as unknown as X` convention this repo's tests already
 * use for SDK-shaped stubs.
 */
function callTool(
  registered: RegisteredTool,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const handler = registered.handler as (
    args: Record<string, unknown>,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => Promise<CallToolResult>;
  return handler(args, noExtra);
}

describe('registerSetComponentMetadataTool (MCP-07, MCP-06)', () => {
  it('registers set_component_metadata on the server, discoverable via listTools over a real transport', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { snapshotId: 'snap-1', revision: 1 }));
    const mcpClient = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerSetComponentMetadataTool(server, mcpClient);

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const sdkClient = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), sdkClient.connect(clientTransport)]);

    const { tools } = await sdkClient.listTools();
    expect(tools.map((tool) => tool.name)).toContain('set_component_metadata');

    await sdkClient.close();
  });

  it('a successful call wraps { snapshotId, revision } in structuredContent behind the MCP-06 disclaimer', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { snapshotId: 'snap-1', revision: 4 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerSetComponentMetadataTool(server, client);
    const result = await callTool(registered, {
      diagramId: 'diagram-1',
      elementId: 'n1',
      sourceRevision: 3,
      metadata: { componentKey: 'generic.compute.server' },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ snapshotId: 'snap-1', revision: 4 });
    expect(result.content).toEqual([{ type: 'text', text: UNTRUSTED_CONTENT_DISCLAIMER }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/diagrams/diagram-1/mcp-patch',
      expect.anything(),
    );
  });

  it('a server error (e.g. stale revision, 409) becomes a structured tool error, never an uncaught exception', async () => {
    const fetchImpl = vi.fn(async () => new Response('conflict', { status: 409 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerSetComponentMetadataTool(server, client);
    const result = await callTool(registered, {
      diagramId: 'diagram-1',
      elementId: 'n1',
      sourceRevision: 1,
      metadata: { componentKey: 'stale' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });

  it('a non-McpApiError failure (e.g. a network error) also becomes a structured tool error, never an uncaught exception', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network unreachable');
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerSetComponentMetadataTool(server, client);
    const result = await callTool(registered, {
      diagramId: 'diagram-1',
      elementId: 'n1',
      sourceRevision: 1,
      metadata: { componentKey: 'unreachable' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'set_component_metadata failed with an unexpected error',
    });
  });
});
