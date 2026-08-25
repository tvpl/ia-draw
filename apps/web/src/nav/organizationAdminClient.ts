/** Mirrors the server's `OrganizationAdmin` shape (`apps/server/src/modules/workspace/organizationAdmins.ts`) — never invents new fields. */
export interface OrganizationAdmin {
  userId: string;
  email: string;
  displayName: string;
}

export type AddOrgAdminResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'error' };

export type RemoveOrgAdminResult =
  | { status: 'ok' }
  | { status: 'conflict' }
  | { status: 'forbidden' }
  | { status: 'error' };

export interface OrganizationAdminClient {
  list(workspaceId: string): Promise<OrganizationAdmin[]>;
  add(workspaceId: string, email: string): Promise<AddOrgAdminResult>;
  remove(workspaceId: string, userId: string): Promise<RemoveOrgAdminResult>;
}

interface ListResponseBody {
  items: OrganizationAdmin[];
}

/**
 * Dedicated organization-admin HTTP client (design.md's "Cliente web") — same shape as
 * `memberClient.ts`: `fetchImpl` injection, one branch per documented status, no throwing on an
 * expected non-2xx response (design.md's Assumption: `add` delegates the email lookup to the
 * server's `POST /workspaces/:id/organization-admins`, which resolves the email itself — no
 * separate client-side `/users:lookup` round trip, unlike `memberClient.add`).
 */
export function createOrganizationAdminClient(
  fetchImplOption?: typeof fetch,
): OrganizationAdminClient {
  const fetchImpl = fetchImplOption ?? fetch.bind(globalThis);

  async function list(workspaceId: string): Promise<OrganizationAdmin[]> {
    const response = await fetchImpl(`/workspaces/${workspaceId}/organization-admins`);
    if (!response.ok) throw new Error(`list organization admins failed: ${response.status}`);
    const body = (await response.json()) as ListResponseBody;
    return body.items;
  }

  async function add(workspaceId: string, email: string): Promise<AddOrgAdminResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/workspaces/${workspaceId}/organization-admins`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 404) return { status: 'not_found' };
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status !== 201) return { status: 'error' };
    return { status: 'ok' };
  }

  async function remove(workspaceId: string, userId: string): Promise<RemoveOrgAdminResult> {
    let response: Response;
    try {
      response = await fetchImpl(`/workspaces/${workspaceId}/organization-admins/${userId}`, {
        method: 'DELETE',
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 409) return { status: 'conflict' };
    if (response.status === 403) return { status: 'forbidden' };
    if (response.status !== 204) return { status: 'error' };
    return { status: 'ok' };
  }

  return { list, add, remove };
}
