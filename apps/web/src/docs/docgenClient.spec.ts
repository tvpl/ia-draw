import { describe, expect, it, vi } from 'vitest';
import { createDocgenClient } from './docgenClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SPEC = {
  id: 'spec-1',
  diagramId: 'diagram-1',
  sourceRevision: 3,
  version: 1,
  markdownKey: 'diagrams/diagram-1/specs/1.md',
  status: 'current' as const,
  generatedBy: 'user-1',
  createdAt: '2026-08-17T10:00:00.000Z',
  markdownUrl: 'https://fake-storage.test/exports/diagrams/diagram-1/specs/1.md',
};

describe('docgenClient (T2, LDC-01/03/05/07/09/10/20/23/25/26)', () => {
  describe('list', () => {
    it('LDC-01: GETs /diagrams/:id/specs with no cursor and returns specs + nextCursor from a 200', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(200, { specs: [SPEC], nextCursor: null })),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      const result = await client.list('diagram-1');

      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/specs');
      expect(result).toEqual({ status: 'ok', specs: [SPEC], nextCursor: null });
    });

    it('LDC-05: with a cursor, GETs /diagrams/:id/specs?cursor=<value>', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(200, { specs: [], nextCursor: null })),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await client.list('diagram-1', 5);

      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/specs?cursor=5');
    });

    it('a non-200 response resolves to {status: "error"}, never throws', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.list('diagram-1')).resolves.toEqual({ status: 'error' });
    });

    it('a network error resolves to {status: "error"}, never throws', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.reject(new Error('network down')),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.list('diagram-1')).resolves.toEqual({ status: 'error' });
    });
  });

  describe('generate', () => {
    it('LDC-07: POSTs /diagrams/:id/specs:generate with no body', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(201, { spec: SPEC })),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await client.generate('diagram-1');

      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/specs:generate', {
        method: 'POST',
      });
    });

    it('LDC-08: a 201 resolves to {status: "created", spec}', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(201, { spec: SPEC })),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.generate('diagram-1')).resolves.toEqual({
        status: 'created',
        spec: SPEC,
      });
    });

    it('LDC-09: a 403 resolves to {status: "forbidden"}', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(403, {})),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.generate('diagram-1')).resolves.toEqual({ status: 'forbidden' });
    });

    it('LDC-10: any other status resolves to {status: "error"}', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.generate('diagram-1')).resolves.toEqual({ status: 'error' });
    });
  });

  describe('regenerateSection', () => {
    it('LDC-20/22: POSTs /diagrams/:id/specs/:version:regenerate-section with {section}', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(201, { spec: SPEC })),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await client.regenerateSection('diagram-1', 1, 'components');

      expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/specs/1:regenerate-section', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section: 'components' }),
      });
    });

    it('LDC-23: a 201 resolves to {status: "created", spec}', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(201, { spec: SPEC })),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.regenerateSection('diagram-1', 1, 'components')).resolves.toEqual({
        status: 'created',
        spec: SPEC,
      });
    });

    it('LDC-25: a 403 resolves to {status: "forbidden"}', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(403, {})),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.regenerateSection('diagram-1', 1, 'components')).resolves.toEqual({
        status: 'forbidden',
      });
    });

    it('LDC-26: a 404 resolves to {status: "not_found"}', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(404, {})),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.regenerateSection('diagram-1', 1, 'components')).resolves.toEqual({
        status: 'not_found',
      });
    });

    it('any other status resolves to {status: "error"}', async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse(500, {})),
      ) as unknown as typeof fetch;
      const client = createDocgenClient(fetchImpl);

      await expect(client.regenerateSection('diagram-1', 1, 'components')).resolves.toEqual({
        status: 'error',
      });
    });
  });
});
