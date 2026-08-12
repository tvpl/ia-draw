/**
 * Pure RBAC policy engine (docs/product-spec.md §9.2, design.md `packages/auth`).
 * No runtime dependency: no DB, no HTTP. Callers resolve the actor's role
 * (e.g. from `workspace_members`) and pass it in.
 */

/** Roles, ordered from highest to lowest privilege. */
export type Role = 'org_admin' | 'workspace_admin' | 'editor' | 'reviewer' | 'viewer';

/**
 * Minimal action set (AUTH-02). `diagram:write` covers diagram *metadata*
 * (title/description/status/tags); `diagram:mutate` covers canvas content
 * writes and is intentionally a separate action — never derived from
 * `diagram:write` — so a role can hold one without automatically holding
 * the other.
 */
export type Action =
  | 'workspace:read'
  | 'workspace:write'
  | 'workspace:manage_members'
  | 'project:read'
  | 'project:write'
  | 'diagram:read'
  | 'diagram:write'
  | 'diagram:mutate';

export interface Actor {
  role: Role;
}

export interface Resource {
  workspaceId: string;
  /** Reserved for future ownership-based overrides; not evaluated by `can()` today. */
  ownerId?: string;
}

export interface Decision {
  allowed: boolean;
  reason: string;
}

/**
 * Role -> granted actions. `org_admin` and `workspace_admin` hold every
 * action (org_admin ⊇ workspace_admin). `workspace_admin` ⊇ `editor`.
 * `editor` holds every write action including `diagram:mutate`.
 *
 * `reviewer` and `viewer` hold only `*:read` actions in this minimal action
 * set — the spec's "editor > reviewer > viewer" ordering is a privilege
 * ranking (reviewer sits above viewer organizationally, e.g. for future
 * comment/approval actions in F3's CMT-01), not a claim that reviewer holds
 * any of the 8 actions below that viewer lacks. Critically, `diagram:mutate`
 * is denied to reviewer unconditionally — never inferred from `diagram:write`
 * (AUTH-03: viewer/reviewer canvas mutations are always rejected).
 */
const READ_ACTIONS: readonly Action[] = ['workspace:read', 'project:read', 'diagram:read'];

const WRITE_ACTIONS: readonly Action[] = [
  'workspace:write',
  'workspace:manage_members',
  'project:write',
  'diagram:write',
  'diagram:mutate',
];

const ALL_ACTIONS: readonly Action[] = [...READ_ACTIONS, ...WRITE_ACTIONS];

const ROLE_GRANTS: Readonly<Record<Role, ReadonlySet<Action>>> = {
  org_admin: new Set(ALL_ACTIONS),
  workspace_admin: new Set(ALL_ACTIONS),
  editor: new Set([...READ_ACTIONS, 'project:write', 'diagram:write', 'diagram:mutate']),
  reviewer: new Set(READ_ACTIONS),
  viewer: new Set(READ_ACTIONS),
};

/**
 * Evaluates whether `actor` may perform `action` on `resource`.
 * `resource` is accepted (not just `action`) to keep the signature stable
 * for future resource-scoped rules (e.g. ownership overrides); it is not
 * yet consulted by the decision below.
 */
export function can(actor: Actor, action: Action, _resource: Resource): Decision {
  const grants = ROLE_GRANTS[actor.role];
  const allowed = grants.has(action);
  return {
    allowed,
    reason: allowed
      ? `role '${actor.role}' grants '${action}'`
      : `role '${actor.role}' does not grant '${action}'`,
  };
}

export const ROLES: readonly Role[] = ['org_admin', 'workspace_admin', 'editor', 'reviewer', 'viewer'];
export const ACTIONS: readonly Action[] = ALL_ACTIONS;
