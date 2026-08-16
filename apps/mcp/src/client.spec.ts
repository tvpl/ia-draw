import { describe, expect, it, vi } from 'vitest';
import { McpApiError, McpClient } from './client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchImpl: typeof fetch) {
  return new McpClient({
    apiUrl: 'https://api.example.test',
    token: 'test-token',
    fetchImpl,
  });
}

describe('McpClient', () => {
  it('listDiagrams resolves the items array from GET /workspaces/:id/diagrams', async () => {
    const items = [{ id: 'd1', projectId: 'p1', title: 'Diagram 1' }];
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const result = await client.listDiagrams('ws-1');

    expect(result).toEqual(items);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/workspaces/ws-1/diagrams',
      expect.anything(),
    );
  });

  it('getDiagramIr resolves the IrDocument body from GET /diagrams/:id/ir', async () => {
    const document = { version: 'v1', kind: 'microservices', nodes: [], containers: [], edges: [] };
    const fetchImpl = vi.fn(async () => jsonResponse(200, document));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const result = await client.getDiagramIr('diagram-1');

    expect(result).toEqual(document);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/diagrams/diagram-1/ir',
      expect.anything(),
    );
  });

  it('getComponent resolves { metadata, inbound, outbound } from GET /diagrams/:id/components/:stableKey', async () => {
    const body = { metadata: [{ elementId: 'n1' }], inbound: [], outbound: [] };
    const fetchImpl = vi.fn(async () => jsonResponse(200, body));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const result = await client.getComponent('diagram-1', 'generic.compute.server');

    expect(result).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/diagrams/diagram-1/components/generic.compute.server',
      expect.anything(),
    );
  });

  it('setComponentMetadata POSTs sourceRevision/op and resolves { snapshotId, revision }', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { snapshotId: 'snap-1', revision: 3 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const result = await client.setComponentMetadata('diagram-1', {
      sourceRevision: 2,
      elementId: 'n1',
      metadata: { componentKey: 'generic.compute.server' },
    });

    expect(result).toEqual({ snapshotId: 'snap-1', revision: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/diagrams/diagram-1/mcp-patch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      sourceRevision: 2,
      op: {
        op: 'setMetadata',
        elementId: 'n1',
        metadata: { componentKey: 'generic.compute.server' },
      },
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('a non-2xx response (404) throws a typed McpApiError, never a partial object', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.getDiagramIr('missing-diagram')).rejects.toBeInstanceOf(McpApiError);
    await expect(client.getDiagramIr('missing-diagram')).rejects.toMatchObject({
      status: 404,
      url: 'https://api.example.test/diagrams/missing-diagram/ir',
    });
  });

  it('every method injects the Authorization: Bearer header', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { items: [] }),
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await client.listDiagrams('ws-1');
    await client.getDiagramIr('diagram-1');
    await client.getComponent('diagram-1', 'key');

    for (const call of fetchImpl.mock.calls) {
      const init = call[1];
      expect(init).toBeDefined();
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-token');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('defaults to the global fetch when no fetchImpl override is provided', () => {
    // Construction alone never issues a network call — this only proves the
    // `config.fetchImpl ?? fetch` fallback branch doesn't throw when the
    // override is omitted, the counterpart to every other test above (which
    // all supply an explicit fetchImpl).
    expect(
      () => new McpClient({ apiUrl: 'https://api.example.test', token: 'test-token' }),
    ).not.toThrow();
  });

  it('throws a plain configuration error when ARCH_CANVAS_API_URL/ARCH_CANVAS_MCP_TOKEN are missing', () => {
    const previousUrl = process.env.ARCH_CANVAS_API_URL;
    const previousToken = process.env.ARCH_CANVAS_MCP_TOKEN;
    // biome-ignore lint/performance/noDelete: test-only env cleanup, not a hot path
    delete process.env.ARCH_CANVAS_API_URL;
    // biome-ignore lint/performance/noDelete: test-only env cleanup, not a hot path
    delete process.env.ARCH_CANVAS_MCP_TOKEN;

    try {
      expect(() => new McpClient()).toThrow('ARCH_CANVAS_API_URL is not set');
      expect(() => new McpClient({ apiUrl: 'https://api.example.test' })).toThrow(
        'ARCH_CANVAS_MCP_TOKEN is not set',
      );
    } finally {
      if (previousUrl !== undefined) process.env.ARCH_CANVAS_API_URL = previousUrl;
      if (previousToken !== undefined) process.env.ARCH_CANVAS_MCP_TOKEN = previousToken;
    }
  });
});
