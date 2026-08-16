import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerNotification,
  ServerRequest,
  TextResourceContents,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { McpClient } from '../client.js';
import { UNTRUSTED_CONTENT_DISCLAIMER } from '../untrustedContent.js';
import { registerListDiagramsResource } from './listDiagrams.js';

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

describe('registerListDiagramsResource (MCP-01, MCP-06)', () => {
  it('lists every diagram summary McpClient.listDiagrams resolves, as structured JSON', async () => {
    const items = [{ id: 'd1', projectId: 'p1', title: 'Diagram 1' }];
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerListDiagramsResource(server, client);
    const result = await registered.readCallback(
      new URL('diagrams://ws-1'),
      { workspaceId: 'ws-1' },
      noExtra,
    );

    const [, jsonEntry] = result.contents as [TextResourceContents, TextResourceContents];
    expect(JSON.parse(jsonEntry.text as string)).toEqual({ items });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/workspaces/ws-1/diagrams',
      expect.anything(),
    );
  });

  it('opens with the fixed MCP-06 disclaimer before any canvas-originated text', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [] }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerListDiagramsResource(server, client);
    const result = await registered.readCallback(
      new URL('diagrams://ws-1'),
      { workspaceId: 'ws-1' },
      noExtra,
    );

    const [disclaimerEntry] = result.contents as [TextResourceContents, TextResourceContents];
    expect(disclaimerEntry.text).toBe(UNTRUSTED_CONTENT_DISCLAIMER);
    expect(disclaimerEntry.mimeType).toBe('text/plain');
  });

  it('a workspace with no diagrams resolves an empty list, not an error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [] }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerListDiagramsResource(server, client);
    const result = await registered.readCallback(
      new URL('diagrams://ws-empty'),
      { workspaceId: 'ws-empty' },
      noExtra,
    );

    const [, jsonEntry] = result.contents as [TextResourceContents, TextResourceContents];
    expect(JSON.parse(jsonEntry.text as string)).toEqual({ items: [] });
  });
});
