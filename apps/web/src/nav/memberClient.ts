import type { Role } from '@arch-canvas/auth';

/** Mirrors the server's `WorkspaceMember` shape (`apps/server/src/modules/workspace/members.ts`) — never invents new fields. */
export interface WorkspaceMember {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
  displayName: string;
}

/** The `GET /users:lookup` response shape — an account identity, never a workspace membership. */
export interface LookupUser {
  id: string;
  email: string;
  displayName: string;
}

export type LookupResult =
  | { status: 'found'; user: LookupUser }
  | { status: 'not_found' }
  | { status: 'error' };

export type AddResult =
  | { status: 'added'; member: WorkspaceMember }
  | { status: 'conflict' }
  | { status: 'error' };

export type ChangeRoleResult = { status: 'ok' } | { status: 'forbidden' } | { status: 'error' };

export type RemoveResult = { status: 'removed' } | { status: 'forbidden' } | { status: 'error' };

export interface MemberClient {
  list(workspaceId: string): Promise<WorkspaceMember[]>;
  lookupByEmail(email: string): Promise<LookupResult>;
  add(workspaceId: string, userId: string, role: Role): Promise<AddResult>;
  changeRole(workspaceId: string, userId: string, role: Role): Promise<ChangeRoleResult>;
  remove(workspaceId: string, userId: string): Promise<RemoveResult>;
}

interface ListResponseBody {
  items: WorkspaceMember[];
}

/**
 * Dedicated workspace-member HTTP client (design.md's Assumptions table) — deliberately NOT the
 * generic `resourceClient`: invite (`{userId, role}`, two fields), role change (`PATCH` returns
 * `{ok:true}`, no item), and email lookup (an entirely different resource, `/users:lookup`) don't
 * fit `resourceClient`'s single-string-body / wrapped-item-response shape. Same `fetchImpl`
 * injection and one-branch-per-documented-status style as `resourceClient.ts`/`syncClient.ts`.
 */
export function createMemberClient(fetchImpl?: typeof fetch): MemberClient {
  const doFetch = fetchImpl ?? fetch.bind(globalThis);

  async function list(workspaceId: string): Promise<WorkspaceMember[]> {
    const response = await doFetch(`/workspaces/${workspaceId}/members`);
    if (!response.ok) throw new Error(`list members failed: ${response.status}`);
    const body = (await response.json()) as ListResponseBody;
    return body.items;
  }

  async function lookupByEmail(email: string): Promise<LookupResult> {
    let response: Response;
    try {
      response = await doFetch(`/users:lookup?email=${encodeURIComponent(email)}`);
    } catch {
      return { status: 'error' };
    }

    if (response.status === 404) return { status: 'not_found' };
    if (response.status !== 200) return { status: 'error' };

    const body = (await response.json()) as { user: LookupUser };
    return { status: 'found', user: body.user };
  }

  async function add(workspaceId: string, userId: string, role: Role): Promise<AddResult> {
    let response: Response;
    try {
      response = await doFetch(`/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 409) return { status: 'conflict' };
    if (response.status !== 201) return { status: 'error' };

    const body = (await response.json()) as { member: WorkspaceMember };
    return { status: 'added', member: body.member };
  }

  async function changeRole(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<ChangeRoleResult> {
    let response: Response;
    try {
      response = await doFetch(`/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 403) return { status: 'forbidden' };
    if (response.status !== 200) return { status: 'error' };
    return { status: 'ok' };
  }

  async function remove(workspaceId: string, userId: string): Promise<RemoveResult> {
    let response: Response;
    try {
      response = await doFetch(`/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      });
    } catch {
      return { status: 'error' };
    }

    if (response.status === 403) return { status: 'forbidden' };
    if (response.status !== 204) return { status: 'error' };
    return { status: 'removed' };
  }

  return { list, lookupByEmail, add, changeRole, remove };
}
