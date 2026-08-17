import { describe, expect, it, vi } from 'vitest';
import { createWebhookClient, WEBHOOK_EVENT_TYPES, type WebhookEndpoint } from './webhookClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const webhook: WebhookEndpoint = {
  id: 'wh-1',
  workspaceId: 'ws-1',
  url: 'https://example.com/hook',
  events: ['diagram.created'],
  enabled: true,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('WEBHOOK_EVENT_TYPES (WHK-05)', () => {
  it('mirrors the server’s 5 event types in the same order', () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      'diagram.created',
      'diagram.updated',
      'diagram.published',
      'spec.generated',
      'comment.mentioned',
    ]);
  });
});

describe('createWebhookClient — list (WHK-01, WHK-03)', () => {
  it('returns the items array on 200 from GET /workspaces/:id/webhooks', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [webhook] }),
    ) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.list('ws-1')).resolves.toEqual([webhook]);
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks');
  });

  it('throws on 403 so the page can render the shared no-access message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.list('ws-1')).rejects.toThrow();
  });

  it('throws on 404 (IDOR convention — indistinguishable from 403 to the caller)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.list('ws-1')).rejects.toThrow();
  });
});

describe('createWebhookClient — create (WHK-08..10)', () => {
  it('POSTs {url, events} and returns {status: "created", webhook, secret} on 201', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { webhookEndpoint: webhook, secret: 'raw-secret-1' }),
    ) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(
      client.create('ws-1', { url: 'https://example.com/hook', events: ['diagram.created'] }),
    ).resolves.toEqual({ status: 'created', webhook, secret: 'raw-secret-1' });

    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['diagram.created'] }),
    });
  });

  it('returns {status: "error"} on 400 (server-side validation refusal)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {})) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(
      client.create('ws-1', { url: 'https://example.com/hook', events: ['diagram.created'] }),
    ).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} when the request itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(
      client.create('ws-1', { url: 'https://example.com/hook', events: ['diagram.created'] }),
    ).resolves.toEqual({ status: 'error' });
  });
});

describe('createWebhookClient — update (WHK-18, WHK-20..22)', () => {
  it('PATCHes the given fields and returns the updated webhook on 200', async () => {
    const updated = { ...webhook, url: 'https://example.com/new', enabled: false };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { webhookEndpoint: updated }),
    ) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(
      client.update('ws-1', 'wh-1', { url: 'https://example.com/new', enabled: false }),
    ).resolves.toEqual({ status: 'ok', webhook: updated });

    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/new', enabled: false }),
    });
  });

  it('returns {status: "error"} on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.update('ws-1', 'wh-1', { enabled: false })).resolves.toEqual({
      status: 'error',
    });
  });

  it('returns {status: "error"} when the request itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.update('ws-1', 'wh-1', { enabled: false })).resolves.toEqual({
      status: 'error',
    });
  });
});

describe('createWebhookClient — remove (WHK-29..30)', () => {
  it('DELETEs and returns {status: "removed"} on 204', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(204, null)) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.remove('ws-1', 'wh-1')).resolves.toEqual({ status: 'removed' });
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {
      method: 'DELETE',
    });
  });

  it('returns {status: "error"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.remove('ws-1', 'wh-1')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} when the request itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.remove('ws-1', 'wh-1')).resolves.toEqual({ status: 'error' });
  });
});

describe('createWebhookClient — rotateSecret (WHK-24..26)', () => {
  it('PATCHes the :rotate-secret sub-resource and returns the new secret on 200', async () => {
    const rotated = { ...webhook, updatedAt: '2026-02-02T00:00:00.000Z' };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { webhookEndpoint: rotated, secret: 'raw-secret-2' }),
    ) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.rotateSecret('ws-1', 'wh-1')).resolves.toEqual({
      status: 'rotated',
      webhook: rotated,
      secret: 'raw-secret-2',
    });

    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1:rotate-secret', {
      method: 'PATCH',
    });
  });

  it('returns {status: "error"} on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.rotateSecret('ws-1', 'wh-1')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} when the request itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createWebhookClient(fetchImpl);

    await expect(client.rotateSecret('ws-1', 'wh-1')).resolves.toEqual({ status: 'error' });
  });
});
