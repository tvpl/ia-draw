import { describe, expect, it, vi } from 'vitest';
import {
  createOrganizationAdminClient,
  type OrganizationAdmin,
} from './organizationAdminClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const admin: OrganizationAdmin = {
  userId: 'u-1',
  email: 'ann@example.com',
  displayName: 'Ann',
};

describe('createOrganizationAdminClient — list (ORG-05)', () => {
  it('list() returns the items array on 200 from GET /workspaces/:id/organization-admins', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [admin] }),
    ) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.list('ws-1')).resolves.toEqual([admin]);
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/organization-admins');
  });

  it('list() throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.list('ws-1')).rejects.toThrow();
  });
});

describe('createOrganizationAdminClient — add (ORG-06, ORG-07, ORG-10)', () => {
  it('returns {status: "ok"} on 201, POSTing {email}', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { ok: true })) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.add('ws-1', 'ann@example.com')).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/workspaces/ws-1/organization-admins',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'ann@example.com' }),
      }),
    );
  });

  it('returns {status: "not_found"} on 404 (ORG-07: email matches no existing user)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.add('ws-1', 'nobody@example.com')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('returns {status: "forbidden"} on 403 (ORG-10: caller is not org-wide org_admin)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.add('ws-1', 'ann@example.com')).resolves.toEqual({ status: 'forbidden' });
  });

  it('returns {status: "error"} on any other non-2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.add('ws-1', 'ann@example.com')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} on a network failure, without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.add('ws-1', 'ann@example.com')).resolves.toEqual({ status: 'error' });
  });
});

describe('createOrganizationAdminClient — remove (ORG-08, ORG-09, ORG-10)', () => {
  it('returns {status: "ok"} on 204, DELETing /workspaces/:id/organization-admins/:userId', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.remove('ws-1', 'u-1')).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/organization-admins/u-1', {
      method: 'DELETE',
    });
  });

  it('returns {status: "conflict"} on 409 (ORG-09: would leave the organization with no administrator)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, {})) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.remove('ws-1', 'u-1')).resolves.toEqual({ status: 'conflict' });
  });

  it('returns {status: "forbidden"} on 403 (ORG-10: caller is not org-wide org_admin)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {})) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.remove('ws-1', 'u-1')).resolves.toEqual({ status: 'forbidden' });
  });

  it('returns {status: "error"} on any other non-2xx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.remove('ws-1', 'missing')).resolves.toEqual({ status: 'error' });
  });

  it('returns {status: "error"} on a network failure, without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createOrganizationAdminClient(fetchImpl);

    await expect(client.remove('ws-1', 'u-1')).resolves.toEqual({ status: 'error' });
  });
});
