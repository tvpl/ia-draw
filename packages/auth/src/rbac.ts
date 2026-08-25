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
 *
 * `comment:create`/`comment:resolve` (T69, CMT-01/02) are a THIRD
 * independent axis, deliberately never derived from `diagram:write`/
 * `diagram:mutate` either: spec.md's CMT-01 AC is "WHEN a user comments...
 * THEN the system SHALL persist" (no role restriction) and CMT-02
 * specifically requires `reviewer` to be accepted for commenting while
 * canvas mutation stays rejected — commenting is async review, not a canvas
 * edit, so every role that can view a diagram can also comment on it.
 */
export type Action =
  | 'workspace:read'
  | 'workspace:write'
  | 'workspace:manage_members'
  | 'project:read'
  | 'project:write'
  | 'diagram:read'
  | 'diagram:write'
  | 'diagram:mutate'
  | 'comment:create'
  | 'comment:resolve';

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
 * `reviewer` holds `*:read` plus both comment actions; `viewer` holds `*:read` plus
 * `comment:create` only (RBAC-03) — the spec's "editor > reviewer > viewer"
 * ordering is a privilege ranking (reviewer sits above viewer
 * organizationally), not a claim that reviewer holds any *write* action
 * viewer lacks. Critically, `diagram:mutate` is denied to reviewer
 * unconditionally — never inferred from `diagram:write` or from holding
 * `comment:create`/`comment:resolve` (AUTH-03/CMT-02: viewer/reviewer canvas
 * mutations are always rejected, even though both may freely comment).
 */
const READ_ACTIONS: readonly Action[] = ['workspace:read', 'project:read', 'diagram:read'];

const WRITE_ACTIONS: readonly Action[] = [
  'workspace:write',
  'workspace:manage_members',
  'project:write',
  'diagram:write',
  'diagram:mutate',
];

/**
 * T69 (CMT-01/02): a third axis, never derived from `diagram:write`/`diagram:mutate` — see
 * the `Action` docstring above.
 *
 * RBAC-02/03/04 (AD-016) splits the axis in two. Commenting stays open to every role,
 * because CMT-01 says "a user comments" with no role restriction. Resolving a thread is
 * closing a discussion, which is what separates reviewing from viewing — and until this
 * change `reviewer` and `viewer` held byte-identical grant sets, which made the five roles
 * three and the ranking decorative.
 */
const COMMENT_ACTIONS: readonly Action[] = ['comment:create', 'comment:resolve'];
const VIEWER_COMMENT_ACTIONS: readonly Action[] = ['comment:create'];

const ALL_ACTIONS: readonly Action[] = [...READ_ACTIONS, ...WRITE_ACTIONS, ...COMMENT_ACTIONS];

const ROLE_GRANTS: Readonly<Record<Role, ReadonlySet<Action>>> = {
  org_admin: new Set(ALL_ACTIONS),
  workspace_admin: new Set(ALL_ACTIONS),
  editor: new Set([
    ...READ_ACTIONS,
    'project:write',
    'diagram:write',
    'diagram:mutate',
    ...COMMENT_ACTIONS,
  ]),
  reviewer: new Set([...READ_ACTIONS, ...COMMENT_ACTIONS]),
  viewer: new Set([...READ_ACTIONS, ...VIEWER_COMMENT_ACTIONS]),
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

export const ROLES: readonly Role[] = [
  'org_admin',
  'workspace_admin',
  'editor',
  'reviewer',
  'viewer',
];
export const ACTIONS: readonly Action[] = ALL_ACTIONS;
