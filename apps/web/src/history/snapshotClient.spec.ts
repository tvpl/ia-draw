import { describe, expect, it, vi } from 'vitest';
import { createSnapshotClient } from './snapshotClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('snapshotClient (T1, SNAP-01/03/06/11)', () => {
  describe('list', () => {
    it('SNAP-01: GETs /diagrams/:id/snapshots and returns the snapshots as the server sent them (kind/name/createdAt)', async () => {
      const snapshots = [
        {
          id: 'snap-2',
          revision: 2,
          kind: 'named',
          name: 'checkpoint',
          createdAt: '2026-08-16T10:00:00.000Z',
        },
        {
          id: 'snap-1',
          revision: 1,
          kind: 'auto',
          name: null,
          createdAt: '2026-08-16T09:00:00.000Z',
        },
      ];
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(200, { snapshots })),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.list('diagram-1');

      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/snapshots');
      expect(result).toEqual(snapshots);
    });

    it('throws on a non-ok response', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      await expect(client.list('diagram-1')).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('SNAP-03: with a name, POSTs {name} and returns the created snapshot from the 201 body', async () => {
      const created = {
        id: 'snap-3',
        revision: 3,
        kind: 'named',
        name: 'checkpoint',
        createdAt: '2026-08-16T11:00:00.000Z',
      };
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(201, { snapshot: created })),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.create('diagram-1', 'checkpoint');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/snapshots',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'checkpoint' }),
        }),
      );
      expect(result).toEqual(created);
    });

    it('SNAP-04: without a name, POSTs a body with no name field at all', async () => {
      const created = {
        id: 'snap-4',
        revision: 4,
        kind: 'named',
        name: null,
        createdAt: '2026-08-16T12:00:00.000Z',
      };
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(201, { snapshot: created })),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      await client.create('diagram-1');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/snapshots',
        expect.objectContaining({ body: JSON.stringify({}) }),
      );
    });

    it('a blank (whitespace-only) name is treated as no name', async () => {
      const created = {
        id: 'snap-5',
        revision: 5,
        kind: 'named',
        name: null,
        createdAt: '2026-08-16T12:30:00.000Z',
      };
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(201, { snapshot: created })),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      await client.create('diagram-1', '   ');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/snapshots',
        expect.objectContaining({ body: JSON.stringify({}) }),
      );
    });

    it('throws on a non-201 response', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(403, {})),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      await expect(client.create('diagram-1', 'x')).rejects.toThrow();
    });
  });

  describe('restore', () => {
    it('SNAP-06/07: POSTs .../:snapshotId:restore with the given clientMutationId', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, { currentRevision: 9, restoredFromSnapshotId: 'snap-1' }),
        ),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.restore('diagram-1', 'snap-1', 'mutation-abc');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/snapshots/snap-1:restore',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ clientMutationId: 'mutation-abc' }),
        }),
      );
      expect(result).toEqual({
        status: 'ok',
        currentRevision: 9,
        restoredFromSnapshotId: 'snap-1',
      });
    });

    it('SNAP-09: 404 -> { status: "not_found" }', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(404, { title: 'snapshot not found' })),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.restore('diagram-1', 'gone', 'mutation-x');

      expect(result).toEqual({ status: 'not_found' });
    });

    it('403 -> { status: "forbidden" }', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(403, {})),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.restore('diagram-1', 'snap-1', 'mutation-y');

      expect(result).toEqual({ status: 'forbidden' });
    });

    it('a network failure -> { status: "error" }, never throws', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.reject(new Error('offline')),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.restore('diagram-1', 'snap-1', 'mutation-z');

      expect(result).toEqual({ status: 'error' });
    });

    it('an undocumented status (e.g. 500) -> { status: "error" }', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.restore('diagram-1', 'snap-1', 'mutation-w');

      expect(result).toEqual({ status: 'error' });
    });
  });

  describe('diff', () => {
    it('SNAP-11: GETs .../diff?from=&to= and returns the four categorized lists', async () => {
      const diffBody = {
        from: '1',
        to: '3',
        added: ['el-a'],
        removed: ['el-b'],
        moved: ['el-c'],
        modified: ['el-d'],
      };
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(200, diffBody)),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.diff('diagram-1', '1', '3');

      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/diff?from=1&to=3');
      expect(result).toEqual({
        status: 'ok',
        diff: { added: ['el-a'], removed: ['el-b'], moved: ['el-c'], modified: ['el-d'] },
      });
    });

    it('SNAP-13: 404 -> { status: "not_found", message } carrying the server\'s own title', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          jsonResponse(404, {
            title: 'diff target "bogus" is neither a known revision nor a known snapshot id',
          }),
        ),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.diff('diagram-1', 'bogus', '3');

      expect(result).toEqual({
        status: 'not_found',
        message: 'diff target "bogus" is neither a known revision nor a known snapshot id',
      });
    });

    it('a network failure -> { status: "error" }, never throws', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.reject(new Error('offline')),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.diff('diagram-1', '1', '3');

      expect(result).toEqual({ status: 'error' });
    });

    it('an undocumented status (e.g. 500) -> { status: "error" }', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const client = createSnapshotClient({ fetchImpl });

      const result = await client.diff('diagram-1', '1', '3');

      expect(result).toEqual({ status: 'error' });
    });
  });
});
