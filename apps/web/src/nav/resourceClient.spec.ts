import { describe, expect, it, vi } from 'vitest';
import { createResourceClient, type ResourceClientConfig } from './resourceClient.js';

interface Item {
  id: string;
  name: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Three configs shaped exactly like the real workspace/project/diagram resources (design.md) —
 * proving genuine parametrization, not a workspace-only implementation the other two never
 * exercise. `itemKey` and body shape differ per resource, matching the server's real routes.
 */
const configs: Array<{ label: string; config: ResourceClientConfig }> = [
  {
    label: 'workspace-shaped',
    config: {
      listUrl: '/workspaces',
      createUrl: '/workspaces',
      createBody: (name) => ({ name, slug: name.toLowerCase() }),
      itemUrl: (id) => `/workspaces/${id}`,
      renameBody: (name) => ({ name }),
      itemKey: 'workspace',
    },
  },
  {
    label: 'project-shaped',
    config: {
      listUrl: '/projects?workspaceId=ws-1',
      createUrl: '/projects',
      createBody: (name) => ({ workspaceId: 'ws-1', name }),
      itemUrl: (id) => `/projects/${id}`,
      renameBody: (name) => ({ name }),
      itemKey: 'project',
    },
  },
  {
    label: 'diagram-shaped',
    config: {
      listUrl: '/diagrams?projectId=proj-1',
      createUrl: '/diagrams',
      createBody: (name) => ({ projectId: 'proj-1', title: name }),
      itemUrl: (id) => `/diagrams/${id}`,
      renameBody: (name) => ({ title: name }),
      itemKey: 'diagram',
    },
  },
];

describe.each(configs)('createResourceClient ($label)', ({ config }) => {
  it('list() returns the items array on 200', async () => {
    const items = [{ id: '1', name: 'a' }];
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items })) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.list()).resolves.toEqual(items);
    expect(fetchImpl).toHaveBeenCalledWith(config.listUrl);
  });

  it('list() throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.list()).rejects.toThrow();
  });

  it('create() unwraps the item under itemKey on 201', async () => {
    const item = { id: '2', name: 'created' };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { [config.itemKey]: item }),
    ) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.create('created')).resolves.toEqual({ status: 'created', item });
    expect(fetchImpl).toHaveBeenCalledWith(
      config.createUrl,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(config.createBody('created')),
      }),
    );
  });

  it('create() reports conflict on 409', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, {})) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.create('dup')).resolves.toEqual({ status: 'conflict' });
  });

  it('create() reports a generic error on any other non-2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.create('nope')).resolves.toEqual({ status: 'error' });
  });

  it('create() reports a generic error on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.create('nope')).resolves.toEqual({ status: 'error' });
  });

  it('rename() unwraps the item under itemKey on 200', async () => {
    const item = { id: '3', name: 'renamed' };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { [config.itemKey]: item }),
    ) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.rename('3', 'renamed')).resolves.toEqual({ status: 'ok', item });
    expect(fetchImpl).toHaveBeenCalledWith(
      config.itemUrl('3'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(config.renameBody('renamed')),
      }),
    );
  });

  it('rename() reports conflict on 409', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, {})) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.rename('3', 'dup')).resolves.toEqual({ status: 'conflict' });
  });

  it('rename() reports a generic error on 403/404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.rename('missing', 'x')).resolves.toEqual({ status: 'error' });
  });

  it('archive() reports ok on 204', async () => {
    // A 204 response must have a null body per the Fetch spec (jsonResponse's
    // JSON.stringify(null) => "null" is a non-null body and throws on construction).
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.archive('3')).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith(config.itemUrl('3'), { method: 'DELETE' });
  });

  it('archive() reports a generic error on 403/404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createResourceClient<Item>(config, fetchImpl);

    await expect(client.archive('3')).resolves.toEqual({ status: 'error' });
  });
});
