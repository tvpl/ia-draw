import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { McpApiError, McpClient } from '../client.js';
import { UNTRUSTED_CONTENT_DISCLAIMER } from '../untrustedContent.js';
import { registerReadComponentResource } from './readComponent.js';

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

describe('registerReadComponentResource (MCP-03, MCP-06)', () => {
  it('returns metadata plus inbound/outbound relations for a resolved stableKey', async () => {
    const body = {
      metadata: [{ diagramId: 'diagram-1', elementId: 'n1', semanticType: null, metadataJson: {}, revision: 1 }],
      inbound: [{ from: 'n0', to: 'n1', label: null }],
      outbound: [],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, body));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerReadComponentResource(server, client);
    const result = await registered.readCallback(
      new URL('component://diagram-1/generic.compute.server'),
      { diagramId: 'diagram-1', stableKey: 'generic.compute.server' },
      noExtra,
    );

    const [, jsonEntry] = result.contents;
    expect(JSON.parse(jsonEntry.text as string)).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/diagrams/diagram-1/components/generic.compute.server',
      expect.anything(),
    );
  });

  it('opens with the fixed MCP-06 disclaimer before any canvas-originated text', async () => {
    const body = { metadata: [], inbound: [], outbound: [] };
    const fetchImpl = vi.fn(async () => jsonResponse(200, body));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerReadComponentResource(server, client);
    const result = await registered.readCallback(
      new URL('component://diagram-1/generic.compute.server'),
      { diagramId: 'diagram-1', stableKey: 'generic.compute.server' },
      noExtra,
    );

    const [disclaimerEntry] = result.contents;
    expect(disclaimerEntry.text).toBe(UNTRUSTED_CONTENT_DISCLAIMER);
    expect(disclaimerEntry.mimeType).toBe('text/plain');
  });

  it('a stableKey with no match rejects with a typed McpApiError, never an uncaught exception', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    const registered = registerReadComponentResource(server, client);

    await expect(
      registered.readCallback(
        new URL('component://diagram-1/no-such-key'),
        { diagramId: 'diagram-1', stableKey: 'no-such-key' },
        noExtra,
      ),
    ).rejects.toBeInstanceOf(McpApiError);
  });
});
