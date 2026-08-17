import { describe, expect, it, vi } from 'vitest';
import { createMemberClient, type WorkspaceMember } from './memberClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const member: WorkspaceMember = {
  userId: 'u-1',
  workspaceId: 'ws-1',
  role: 'editor',
  email: 'bob@example.com',
  displayName: 'Bob',
};

describe('createMemberClient — list', () => {
  it('list() returns the items array on 200 from GET /workspaces/:id/members', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [member] }),
    ) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.list('ws-1')).resolves.toEqual([member]);
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/members');
  });

  it('list() throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.list('ws-1')).rejects.toThrow();
  });
});

describe('createMemberClient — lookupByEmail', () => {
  it('returns {status: "found", user} on 200', async () => {
    const user = { id: 'u-2', email: 'bob@example.com', displayName: 'Bob' };
    const fetchImpl = vi.fn(async () => jsonResponse(200, { user })) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.lookupByEmail('bob@example.com')).resolves.toEqual({
      status: 'found',
      user,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/users:lookup?email=bob%40example.com');
  });

  it('returns {status: "not_found"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.lookupByEmail('nobody@example.com')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('returns {status: "error"} on any other non-2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.lookupByEmail('bob@example.com')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.lookupByEmail('bob@example.com')).resolves.toEqual({ status: 'error' });
  });
});

describe('createMemberClient — add', () => {
  it('returns {status: "added", member} on 201, POSTing {userId, role}', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { member }),
    ) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.add('ws-1', 'u-1', 'editor')).resolves.toEqual({
      status: 'added',
      member,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/workspaces/ws-1/members',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'u-1', role: 'editor' }),
      }),
    );
  });

  it('returns {status: "conflict"} on 409', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.add('ws-1', 'u-1', 'editor')).resolves.toEqual({ status: 'conflict' });
  });

  it('returns {status: "error"} on any other non-2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.add('ws-1', 'u-1', 'editor')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.add('ws-1', 'u-1', 'editor')).resolves.toEqual({ status: 'error' });
  });
});

describe('createMemberClient — changeRole', () => {
  it('returns {status: "ok"} on 200, PATCHing {role}', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true }),
    ) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.changeRole('ws-1', 'u-1', 'viewer')).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/workspaces/ws-1/members/u-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) }),
    );
  });

  it('returns {status: "forbidden"} on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.changeRole('ws-1', 'u-1', 'viewer')).resolves.toEqual({
      status: 'forbidden',
    });
  });

  it('returns {status: "error"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.changeRole('ws-1', 'missing', 'viewer')).resolves.toEqual({
      status: 'error',
    });
  });

  it('returns {status: "error"} on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.changeRole('ws-1', 'u-1', 'viewer')).resolves.toEqual({
      status: 'error',
    });
  });
});

describe('createMemberClient — remove', () => {
  it('returns {status: "removed"} on 204', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.remove('ws-1', 'u-1')).resolves.toEqual({ status: 'removed' });
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/members/u-1', { method: 'DELETE' });
  });

  it('returns {status: "forbidden"} on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.remove('ws-1', 'u-1')).resolves.toEqual({ status: 'forbidden' });
  });

  it('returns {status: "error"} on 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.remove('ws-1', 'missing')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createMemberClient(fetchImpl);

    await expect(client.remove('ws-1', 'u-1')).resolves.toEqual({ status: 'error' });
  });
});
