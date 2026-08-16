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
import { registerReadDiagramResource } from './readDiagram.js';

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

describe('registerReadDiagramResource (MCP-01, MCP-02, MCP-06)', () => {
  it('returns the structured diagram-ir/v1 document as JSON, never a rendered image, and never leaks canvas text into the disclaimer', async () => {
    const document = {
      version: 'v1',
      kind: 'microservices',
      nodes: [{ id: 'n1', label: 'user-authored node label' }],
      containers: [],
      edges: [],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, document));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerReadDiagramResource(server, client);
    const result = await registered.readCallback(
      new URL('diagram://diagram-1'),
      { diagramId: 'diagram-1' },
      noExtra,
    );

    const [disclaimerEntry, jsonEntry] = result.contents as [
      TextResourceContents,
      TextResourceContents,
    ];
    expect(jsonEntry.mimeType).toBe('application/json');
    expect(JSON.parse(jsonEntry.text as string)).toEqual(document);
    expect(disclaimerEntry.text).not.toContain('user-authored node label');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/diagrams/diagram-1/ir',
      expect.anything(),
    );
  });

  it('opens with the fixed MCP-06 disclaimer before any canvas-originated text', async () => {
    const document = { version: 'v1', kind: 'microservices', nodes: [], containers: [], edges: [] };
    const fetchImpl = vi.fn(async () => jsonResponse(200, document));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerReadDiagramResource(server, client);
    const result = await registered.readCallback(
      new URL('diagram://diagram-1'),
      { diagramId: 'diagram-1' },
      noExtra,
    );

    const [disclaimerEntry] = result.contents as [TextResourceContents, TextResourceContents];
    expect(disclaimerEntry.text).toBe(UNTRUSTED_CONTENT_DISCLAIMER);
    expect(disclaimerEntry.mimeType).toBe('text/plain');
  });
});
