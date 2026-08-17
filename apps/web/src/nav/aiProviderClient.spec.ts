import { describe, expect, it, vi } from 'vitest';
import { createAiProviderClient, type ProviderConfig } from './aiProviderClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const config: ProviderConfig = {
  id: 'cfg-1',
  scope: 'global',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  capabilitiesJson: {},
  enabled: true,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
};

/** Reads the JSON body a `fetchImpl` mock was called with, as a plain object. */
function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('createAiProviderClient — list (PROV-01/02)', () => {
  it('requests the scope as a query parameter and returns the items array', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [config] }),
    ) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.list('global')).resolves.toEqual([config]);
    expect(fetchImpl).toHaveBeenCalledWith('/admin/ai-providers?scope=global');
  });

  it('url-encodes a workspace scope', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [] }),
    ) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await client.list('ws-1');
    expect(fetchImpl).toHaveBeenCalledWith('/admin/ai-providers?scope=ws-1');
  });

  it('throws on a non-2xx response so the page can route 403/404 to its not-found state (PROV-04)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.list('global')).rejects.toThrow();
  });
});

describe('createAiProviderClient — create (PROV-09/10/12)', () => {
  it('POSTs {scope, baseUrl, model, token} and returns the created config on 201', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { config })) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(
      client.create({
        scope: 'global',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        token: 'sk-secret',
      }),
    ).resolves.toEqual({ status: 'created', config });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/ai-providers');
    expect(init.method).toBe('POST');
    expect(bodyOf(vi.mocked(fetchImpl).mock.calls[0] as unknown[])).toEqual({
      scope: 'global',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      token: 'sk-secret',
    });
  });

  it('returns {status: "rejected"} on 400 (baseUrl refused by the SSRF guard)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { message: 'baseUrl rejected' }),
    ) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(
      client.create({
        scope: 'global',
        baseUrl: 'http://169.254.169.254/v1',
        model: 'gpt-4o-mini',
        token: 'sk-secret',
      }),
    ).resolves.toEqual({ status: 'rejected' });
  });

  it('returns {status: "error"} on any other non-201', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(
      client.create({ scope: 'global', baseUrl: 'https://x/v1', model: 'm', token: 't' }),
    ).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} when the request itself rejects (network failure)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(
      client.create({ scope: 'global', baseUrl: 'https://x/v1', model: 'm', token: 't' }),
    ).resolves.toEqual({ status: 'error' });
  });
});

describe('createAiProviderClient — update (PROV-13/14/16/21)', () => {
  it('omits `token` from the serialized body when the patch has no token (PROV-13)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { config: { ...config, model: 'gpt-4o' } }),
    ) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await client.update('cfg-1', { model: 'gpt-4o' });

    const body = bodyOf(vi.mocked(fetchImpl).mock.calls[0] as unknown[]);
    expect(body).toEqual({ model: 'gpt-4o' });
    expect('token' in body).toBe(false);
  });

  it('includes `token` when the patch carries one (PROV-14)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { config })) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await client.update('cfg-1', { model: 'gpt-4o', token: 'sk-rotated' });

    expect(bodyOf(vi.mocked(fetchImpl).mock.calls[0] as unknown[])).toEqual({
      model: 'gpt-4o',
      token: 'sk-rotated',
    });
  });

  it('PATCHes {enabled: true} to the config id and returns the updated config (PROV-21)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { config })) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.update('cfg-1', { enabled: true })).resolves.toEqual({
      status: 'ok',
      config,
    });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/ai-providers/cfg-1');
    expect(init.method).toBe('PATCH');
    expect(bodyOf(vi.mocked(fetchImpl).mock.calls[0] as unknown[])).toEqual({ enabled: true });
  });

  it('returns {status: "error"} on a non-200 (PROV-16)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.update('cfg-1', { enabled: true })).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} when the request itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.update('cfg-1', { enabled: true })).resolves.toEqual({ status: 'error' });
  });
});

describe('createAiProviderClient — testConnection (PROV-17/18/19/20)', () => {
  it('POSTs to /:id:test and returns the successful result body', async () => {
    const result = { success: true, modelAvailable: true, toolCallingSupported: true };
    const fetchImpl = vi.fn(async () => jsonResponse(200, result)) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.testConnection('cfg-1')).resolves.toEqual({ status: 'done', result });

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/admin/ai-providers/cfg-1:test');
    expect(init.method).toBe('POST');
  });

  it('a 200 carrying success:false is still "done", with the failure preserved in the body (PROV-19)', async () => {
    const result = {
      success: false,
      modelAvailable: false,
      toolCallingSupported: false,
      error: 'provider responded with status 401',
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, result)) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.testConnection('cfg-1')).resolves.toEqual({ status: 'done', result });
  });

  it('returns {status: "rate_limited"} on 429 (PROV-20)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, {})) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.testConnection('cfg-1')).resolves.toEqual({ status: 'rate_limited' });
  });

  it('returns {status: "error"} on any other non-200', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.testConnection('cfg-1')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} when the request itself rejects (network failure)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const client = createAiProviderClient(fetchImpl);

    await expect(client.testConnection('cfg-1')).resolves.toEqual({ status: 'error' });
  });
});
