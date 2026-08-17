import { describe, expect, it, vi } from 'vitest';
import {
  createPresentationClient,
  type FrameSummary,
  type PresentationSummary,
} from './presentationClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const presentation: PresentationSummary = {
  id: 'p-1',
  diagramId: 'd-1',
  name: 'Roadmap',
  publishedSnapshotId: null,
  settingsJson: {},
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
};

const frame: FrameSummary = {
  id: 'f-1',
  presentationId: 'p-1',
  elementId: null,
  frameId: 'logical-1',
  position: 0,
  notes: null,
  navLinksJson: [],
  createdAt: '2026-08-17T00:00:00.000Z',
};

describe('createPresentationClient — list (T3)', () => {
  it('GETs /presentations?diagramId= and returns the array on 200', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { presentations: [{ presentation, frames: [frame] }] }),
    ) as unknown as typeof fetch;
    const client = createPresentationClient(fetchImpl);

    await expect(client.list('d-1')).resolves.toEqual({
      status: 'ok',
      presentations: [{ presentation, frames: [frame] }],
    });
    expect(fetchImpl).toHaveBeenCalledWith('/presentations?diagramId=d-1');
  });

  it('returns {status: "not_found"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).list('d-1')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('returns {status: "error"} on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).list('d-1')).resolves.toEqual({
      status: 'error',
    });
  });
});

describe('createPresentationClient — create', () => {
  it('POSTs {diagramId, name} and returns the presentation on 201', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { presentation }),
    ) as unknown as typeof fetch;
    const client = createPresentationClient(fetchImpl);

    await expect(client.create('d-1', 'Roadmap')).resolves.toEqual({
      status: 'ok',
      presentation,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/presentations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diagramId: 'd-1', name: 'Roadmap' }),
    });
  });

  it('returns {status: "forbidden"} on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).create('d-1', 'x')).resolves.toEqual({
      status: 'forbidden',
    });
  });
});

describe('createPresentationClient — get', () => {
  it('GETs /presentations/:id and returns presentation + frames on 200', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { presentation, frames: [frame] }),
    ) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).get('p-1')).resolves.toEqual({
      status: 'ok',
      presentation,
      frames: [frame],
    });
  });

  it('returns {status: "not_found"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).get('p-1')).resolves.toEqual({
      status: 'not_found',
    });
  });
});

describe('createPresentationClient — addFrame', () => {
  it('POSTs the frame input and returns the created frame on 201', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { frame })) as unknown as typeof fetch;
    const client = createPresentationClient(fetchImpl);

    await expect(client.addFrame('p-1', { frameId: 'logical-1', position: 0 })).resolves.toEqual({
      status: 'ok',
      frame,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frameId: 'logical-1', position: 0 }),
    });
  });

  it('returns {status: "invalid"} on 400 (InvalidNavLinkError)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {})) as unknown as typeof fetch;
    await expect(
      createPresentationClient(fetchImpl).addFrame('p-1', { position: 0 }),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('returns {status: "forbidden"} on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    await expect(
      createPresentationClient(fetchImpl).addFrame('p-1', { position: 0 }),
    ).resolves.toEqual({ status: 'forbidden' });
  });
});

describe('createPresentationClient — updateFrame', () => {
  it('PATCHes the frame input and returns the updated frame on 200', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { frame })) as unknown as typeof fetch;
    const client = createPresentationClient(fetchImpl);

    await expect(client.updateFrame('p-1', 'f-1', { notes: 'hi' })).resolves.toEqual({
      status: 'ok',
      frame,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames/f-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'hi' }),
    });
  });

  it('returns {status: "invalid"} on 400', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {})) as unknown as typeof fetch;
    await expect(
      createPresentationClient(fetchImpl).updateFrame('p-1', 'f-1', {}),
    ).resolves.toEqual({ status: 'invalid' });
  });
});

describe('createPresentationClient — deleteFrame', () => {
  it('DELETEs and returns {status: "ok"} on 204', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(204, undefined)) as unknown as typeof fetch;
    const client = createPresentationClient(fetchImpl);

    await expect(client.deleteFrame('p-1', 'f-1')).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames/f-1', { method: 'DELETE' });
  });

  it('returns {status: "not_found"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).deleteFrame('p-1', 'f-1')).resolves.toEqual({
      status: 'not_found',
    });
  });
});

describe('createPresentationClient — reorderFrames', () => {
  it('PATCHes {frames: updates} in bulk and returns the reordered frames on 200', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { frames: [frame] }),
    ) as unknown as typeof fetch;
    const client = createPresentationClient(fetchImpl);

    await expect(
      client.reorderFrames('p-1', [
        { id: 'f-1', position: 1 },
        { id: 'f-2', position: 0 },
      ]),
    ).resolves.toEqual({ status: 'ok', frames: [frame] });
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1/frames', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        frames: [
          { id: 'f-1', position: 1 },
          { id: 'f-2', position: 0 },
        ],
      }),
    });
  });

  it('returns {status: "invalid"} on 400 (UnknownFrameIdError)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {})) as unknown as typeof fetch;
    await expect(
      createPresentationClient(fetchImpl).reorderFrames('p-1', [{ id: 'f-1', position: 0 }]),
    ).resolves.toEqual({ status: 'invalid' });
  });
});

describe('createPresentationClient — publish', () => {
  it('POSTs /presentations/:id:publish and returns the presentation on 200', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { presentation: { ...presentation, publishedSnapshotId: 'snap-1' } }),
    ) as unknown as typeof fetch;
    const client = createPresentationClient(fetchImpl);

    await expect(client.publish('p-1')).resolves.toEqual({
      status: 'ok',
      presentation: { ...presentation, publishedSnapshotId: 'snap-1' },
    });
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1:publish', { method: 'POST' });
  });

  it('returns {status: "forbidden"} on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).publish('p-1')).resolves.toEqual({
      status: 'forbidden',
    });
  });
});

describe('createPresentationClient — exportPdf', () => {
  it('POSTs /presentations/:id:export-pdf and returns {url, sizeBytes, pageCount} on 200', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { url: 'https://x/pdf', sizeBytes: 1234, pageCount: 3 }),
    ) as unknown as typeof fetch;
    const client = createPresentationClient(fetchImpl);

    await expect(client.exportPdf('p-1')).resolves.toEqual({
      status: 'ok',
      url: 'https://x/pdf',
      sizeBytes: 1234,
      pageCount: 3,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/presentations/p-1:export-pdf', { method: 'POST' });
  });

  it('returns {status: "no_frames"} on 400', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {})) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).exportPdf('p-1')).resolves.toEqual({
      status: 'no_frames',
    });
  });

  it('returns {status: "not_published"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    await expect(createPresentationClient(fetchImpl).exportPdf('p-1')).resolves.toEqual({
      status: 'not_published',
    });
  });
});
