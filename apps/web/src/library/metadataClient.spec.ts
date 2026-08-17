import { describe, expect, it, vi } from 'vitest';
import { createMetadataClient, type ElementMetadata, type InventoryRow } from './metadataClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const METADATA: ElementMetadata = {
  diagramId: 'diagram-1',
  elementId: 'el-1',
  semanticType: 'service',
  metadataJson: { owner: 'team-a' },
  revision: 3,
};

describe('createMetadataClient — get (CLIB-08/09)', () => {
  it('get() returns the metadata object on 200', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { metadata: METADATA }),
    ) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.get('diagram-1', 'el-1')).resolves.toEqual(METADATA);
    expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/elements/el-1/metadata');
  });

  it('get() resolves null on 404 (CLIB-09: "not classified yet", never a thrown error)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.get('diagram-1', 'el-missing')).resolves.toBeNull();
  });

  it('get() throws on an undocumented non-2xx status (not 200/404)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.get('diagram-1', 'el-1')).rejects.toThrow('get metadata failed: 500');
  });
});

describe('createMetadataClient — patch (CLIB-10)', () => {
  it('patch() reflects exactly the metadata object the server returns on 200 (never optimistic)', async () => {
    const serverMetadata: ElementMetadata = { ...METADATA, semanticType: 'database', revision: 4 };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { metadata: serverMetadata }),
    ) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.patch('diagram-1', 'el-1', { semanticType: 'database' })).resolves.toEqual({
      status: 'ok',
      metadata: serverMetadata,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/diagrams/diagram-1/elements/el-1/metadata',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ semanticType: 'database' }),
      }),
    );
  });

  it('patch() reports a generic error on 403 (role revoked mid-session, design.md Error Handling Strategy: treated like any other write error)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.patch('diagram-1', 'el-1', { semanticType: 'x' })).resolves.toEqual({
      status: 'error',
    });
  });

  it('patch() reports a generic error on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.patch('diagram-1', 'el-1', { semanticType: 'x' })).resolves.toEqual({
      status: 'error',
    });
  });
});

describe('createMetadataClient — inventory (CLIB-14/16)', () => {
  const ROWS: InventoryRow[] = [
    {
      elementId: 'el-1',
      elementType: 'rectangle',
      semanticType: 'service',
      metadataJson: {},
      revision: 1,
    },
    {
      elementId: 'el-2',
      elementType: null,
      semanticType: 'database',
      metadataJson: {},
      revision: 2,
    },
  ];

  it("inventory(id, 'json') resolves the parsed rows and requests format=json", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: ROWS }),
    ) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.inventory('diagram-1', 'json')).resolves.toEqual(ROWS);
    expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/inventory?format=json');
  });

  it("inventory(id, 'csv') resolves the raw CSV text and requests format=csv", async () => {
    const csvText =
      'elementId,elementType,semanticType,revision,metadataJson\nel-1,rectangle,service,1,{}';
    const fetchImpl = vi.fn(
      async () => new Response(csvText, { status: 200, headers: { 'content-type': 'text/csv' } }),
    ) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.inventory('diagram-1', 'csv')).resolves.toBe(csvText);
    expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/inventory?format=csv');
  });

  it('inventory() throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createMetadataClient(fetchImpl);

    await expect(client.inventory('diagram-missing', 'json')).rejects.toThrow(
      'inventory failed: 404',
    );
  });
});
