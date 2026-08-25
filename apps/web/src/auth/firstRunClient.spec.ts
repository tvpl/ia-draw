import { describe, expect, it, vi } from 'vitest';
import { createFirstRunClient, type FirstRunInput } from './firstRunClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const INPUT: FirstRunInput = {
  email: 'admin@example.com',
  displayName: 'Admin',
  password: 'correct horse battery staple',
  workspaceName: 'Arquitetura',
};

describe('firstRunClient (BOOT-13)', () => {
  describe('checkAvailability', () => {
    it('reports available on a 200 that says so', async () => {
      const client = createFirstRunClient(
        vi.fn(async () => jsonResponse(200, { available: true })),
      );

      expect(await client.checkAvailability()).toEqual({ available: true });
    });

    it('reports unavailable on 404', async () => {
      const client = createFirstRunClient(vi.fn(async () => jsonResponse(404, {})));

      expect(await client.checkAvailability()).toEqual({ available: false });
    });

    it('reports unavailable on a network failure, never throwing', async () => {
      const client = createFirstRunClient(
        vi.fn(async () => {
          throw new Error('offline');
        }),
      );

      expect(await client.checkAvailability()).toEqual({ available: false });
    });
  });

  describe('submit', () => {
    it('returns the created account and workspace on 201', async () => {
      const client = createFirstRunClient(
        vi.fn(async () =>
          jsonResponse(201, {
            user: { id: 'u-1', email: 'admin@example.com', displayName: 'Admin' },
            workspaceId: 'w-1',
          }),
        ),
      );

      expect(await client.submit(INPUT)).toEqual({
        status: 'created',
        user: { id: 'u-1', email: 'admin@example.com', displayName: 'Admin' },
        workspaceId: 'w-1',
      });
    });

    it('names the refused field on 400', async () => {
      const client = createFirstRunClient(
        vi.fn(async () => jsonResponse(400, { title: 'Invalid password' })),
      );

      expect(await client.submit(INPUT)).toEqual({ status: 'invalid', field: 'password' });
    });

    it('falls back to a named unknown field when the 400 carries no usable title', async () => {
      const client = createFirstRunClient(vi.fn(async () => jsonResponse(400, {})));

      expect(await client.submit(INPUT)).toEqual({ status: 'invalid', field: 'unknown' });
    });

    it('treats 404 as the instance no longer being empty', async () => {
      const client = createFirstRunClient(vi.fn(async () => jsonResponse(404, {})));

      expect(await client.submit(INPUT)).toEqual({ status: 'already_initialized' });
    });

    it('treats 409 the same way — someone else bootstrapped first', async () => {
      const client = createFirstRunClient(vi.fn(async () => jsonResponse(409, {})));

      expect(await client.submit(INPUT)).toEqual({ status: 'already_initialized' });
    });

    it('reports the rate limit on 429', async () => {
      const client = createFirstRunClient(vi.fn(async () => jsonResponse(429, {})));

      expect(await client.submit(INPUT)).toEqual({ status: 'rate_limited' });
    });

    it('reports an error on any other status', async () => {
      const client = createFirstRunClient(vi.fn(async () => jsonResponse(503, {})));

      expect(await client.submit(INPUT)).toEqual({ status: 'error' });
    });

    it('reports an error on a network failure, never throwing', async () => {
      const client = createFirstRunClient(
        vi.fn(async () => {
          throw new Error('offline');
        }),
      );

      expect(await client.submit(INPUT)).toEqual({ status: 'error' });
    });

    it('sends the payload as JSON to the first-run route', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(201, { user: { id: 'u-1', email: 'a', displayName: 'A' }, workspaceId: 'w' }),
      );
      const client = createFirstRunClient(fetchImpl);

      await client.submit(INPUT);

      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/auth/first-run');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual(INPUT);
    });
  });
});
