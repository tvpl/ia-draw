import { describe, expect, it, vi } from 'vitest';
import { createShareLinkClient, type ShareLink } from './shareLinkClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const shareLink: ShareLink = {
  id: 'sl-1',
  resourceType: 'diagram',
  resourceId: 'd-1',
  role: 'viewer',
  expiresAt: '2026-12-31T00:00:00.000Z',
  revokedAt: null,
  createdBy: 'u-1',
  createdAt: '2026-08-17T00:00:00.000Z',
};

describe('createShareLinkClient — createForDiagram (SHR-04..07)', () => {
  it('POSTs {role, expiresAt} to /diagrams/:id/share-links and returns the one-shot token on 201', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { shareLink, token: 'plain-token-abc' }),
    ) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(
      client.createForDiagram('d-1', 'viewer', '2026-12-31T00:00:00.000Z'),
    ).resolves.toEqual({ status: 'created', shareLink, token: 'plain-token-abc' });
    expect(fetchImpl).toHaveBeenCalledWith('/diagrams/d-1/share-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer', expiresAt: '2026-12-31T00:00:00.000Z' }),
    });
  });

  it('returns {status: "forbidden"} on 403 (role ceiling or no diagram:mutate)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(
      client.createForDiagram('d-1', 'org_admin', '2026-12-31T00:00:00.000Z'),
    ).resolves.toEqual({ status: 'forbidden' });
  });

  it('returns {status: "error"} on any other non-201 status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(
      client.createForDiagram('d-1', 'viewer', '2026-12-31T00:00:00.000Z'),
    ).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} when a 201 body carries no token (never a half-built URL)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { shareLink }),
    ) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(
      client.createForDiagram('d-1', 'viewer', '2026-12-31T00:00:00.000Z'),
    ).resolves.toEqual({ status: 'error' });
  });
});

describe('createShareLinkClient — revoke (SHR-09..11)', () => {
  it('POSTs to /share-links/:id:revoke and returns the revoked link on 200', async () => {
    const revoked = { ...shareLink, revokedAt: '2026-08-17T01:00:00.000Z' };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { shareLink: revoked }),
    ) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(client.revoke('sl-1')).resolves.toEqual({
      status: 'revoked',
      shareLink: revoked,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/share-links/sl-1:revoke', { method: 'POST' });
  });

  it('returns {status: "forbidden"} on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(client.revoke('sl-1')).resolves.toEqual({ status: 'forbidden' });
  });

  it('returns {status: "not_found"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(client.revoke('sl-1')).resolves.toEqual({ status: 'not_found' });
  });
});

describe('createShareLinkClient — resolve (SHR-14..16, SHR-27, SHR-28)', () => {
  it('GETs /share/:token and returns the diagram scene and revision', async () => {
    const scene = [{ id: 'el-1' }];
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { resourceType: 'diagram', role: 'viewer', scene, revision: 7 }),
    ) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(client.resolve('tok-1')).resolves.toEqual({
      status: 'diagram',
      role: 'viewer',
      scene,
      revision: 7,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/share/tok-1');
  });

  it('returns only id, name and frameCount for a presentation — no notes, no navLinksJson', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        resourceType: 'presentation',
        role: 'editor',
        presentation: {
          id: 'p-1',
          name: 'Roadmap',
          diagramId: 'd-1',
          settingsJson: { secret: true },
        },
        frames: [
          { id: 'f-1', position: 0, notes: 'private speaker note', navLinksJson: [] },
          { id: 'f-2', position: 1, notes: null, navLinksJson: [] },
        ],
      }),
    ) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    const result = await client.resolve('tok-1');

    expect(result).toEqual({
      status: 'presentation',
      role: 'editor',
      presentation: { id: 'p-1', name: 'Roadmap' },
      frameCount: 2,
    });
    expect(JSON.stringify(result)).not.toContain('private speaker note');
  });

  it('returns {status: "not_found"} on 404, with no reason attached', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(client.resolve('tok-1')).resolves.toEqual({ status: 'not_found' });
  });

  it('returns {status: "error"} when the request itself fails (network)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createShareLinkClient(fetchImpl);

    await expect(client.resolve('tok-1')).resolves.toEqual({ status: 'error' });
  });
});
