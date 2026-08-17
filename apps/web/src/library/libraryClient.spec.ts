import { describe, expect, it, vi } from 'vitest';
import { createLibraryClient, type LibraryRow } from './libraryClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const GLOBAL_ROW: LibraryRow = {
  id: 'lib-global',
  workspaceId: null,
  name: 'architecture-canvas-core',
  version: '1.0.0',
  license: 'CC0-1.0',
  manifestJson: { name: 'architecture-canvas-core', version: '1.0.0', items: [] },
  enabled: true,
};

describe('createLibraryClient (CLIB-01)', () => {
  it('list() with no workspaceId requests GET /libraries (unscoped) and returns items on 200', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW] }),
    ) as unknown as typeof fetch;
    const client = createLibraryClient(fetchImpl);

    await expect(client.list()).resolves.toEqual([GLOBAL_ROW]);
    expect(fetchImpl).toHaveBeenCalledWith('/libraries');
  });

  it('list(workspaceId) requests GET /libraries?workspaceId=<id> and returns both global + workspace rows on 200', async () => {
    const workspaceRow: LibraryRow = { ...GLOBAL_ROW, id: 'lib-ws', workspaceId: 'ws-1' };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [GLOBAL_ROW, workspaceRow] }),
    ) as unknown as typeof fetch;
    const client = createLibraryClient(fetchImpl);

    await expect(client.list('ws-1')).resolves.toEqual([GLOBAL_ROW, workspaceRow]);
    expect(fetchImpl).toHaveBeenCalledWith('/libraries?workspaceId=ws-1');
  });

  it('list() throws on a non-2xx response (CLIB-07: LibraryPanel renders the error-with-retry state from this rejection)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const client = createLibraryClient(fetchImpl);

    await expect(client.list()).rejects.toThrow('list failed: 500');
  });

  it('list() URL-encodes a workspaceId containing special characters', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [] }),
    ) as unknown as typeof fetch;
    const client = createLibraryClient(fetchImpl);

    await client.list('ws/with space');
    expect(fetchImpl).toHaveBeenCalledWith('/libraries?workspaceId=ws%2Fwith%20space');
  });
});
