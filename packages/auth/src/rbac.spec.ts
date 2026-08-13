import { describe, expect, it } from 'vitest';
import { type Action, can, type Role } from './rbac.js';

const resource = { workspaceId: 'ws-1' };

/**
 * Explicit role × action decision table (AUTH-02, T12 "Done when": "Tabela de
 * decisão cobre as 5×N combinações papel×ação relevantes"). Every one of the
 * 5 roles × 10 actions is asserted here — no case is left to inference.
 * `comment:create`/`comment:resolve` (T69, CMT-01/02) were added to the
 * action set after the original 8; they are granted to every role (see the
 * `Action` docstring in rbac.ts), so they add rows to every role's block
 * below rather than only reviewer's.
 *
 * org_admin ⊇ workspace_admin ⊇ editor: all three hold every action.
 * reviewer and viewer hold only `*:read` + `comment:*` in this action set —
 * see the comment on ROLE_GRANTS in rbac.ts for why reviewer does not gain
 * any *write* action here (editor > reviewer > viewer is a privilege
 * ranking, not a claim reviewer holds a write action viewer lacks).
 */
const MATRIX: Array<[Role, Action, boolean]> = [
  // org_admin — full access
  ['org_admin', 'workspace:read', true],
  ['org_admin', 'workspace:write', true],
  ['org_admin', 'workspace:manage_members', true],
  ['org_admin', 'project:read', true],
  ['org_admin', 'project:write', true],
  ['org_admin', 'diagram:read', true],
  ['org_admin', 'diagram:write', true],
  ['org_admin', 'diagram:mutate', true],
  ['org_admin', 'comment:create', true],
  ['org_admin', 'comment:resolve', true],
  // workspace_admin — full access (org_admin ⊇ workspace_admin)
  ['workspace_admin', 'workspace:read', true],
  ['workspace_admin', 'workspace:write', true],
  ['workspace_admin', 'workspace:manage_members', true],
  ['workspace_admin', 'project:read', true],
  ['workspace_admin', 'project:write', true],
  ['workspace_admin', 'diagram:read', true],
  ['workspace_admin', 'diagram:write', true],
  ['workspace_admin', 'diagram:mutate', true],
  ['workspace_admin', 'comment:create', true],
  ['workspace_admin', 'comment:resolve', true],
  // editor — read + content write + canvas mutate, no workspace admin actions
  ['editor', 'workspace:read', true],
  ['editor', 'workspace:write', false],
  ['editor', 'workspace:manage_members', false],
  ['editor', 'project:read', true],
  ['editor', 'project:write', true],
  ['editor', 'diagram:read', true],
  ['editor', 'diagram:write', true],
  ['editor', 'diagram:mutate', true],
  ['editor', 'comment:create', true],
  ['editor', 'comment:resolve', true],
  // reviewer — read only, plus comment:* (CMT-02)
  ['reviewer', 'workspace:read', true],
  ['reviewer', 'workspace:write', false],
  ['reviewer', 'workspace:manage_members', false],
  ['reviewer', 'project:read', true],
  ['reviewer', 'project:write', false],
  ['reviewer', 'diagram:read', true],
  ['reviewer', 'diagram:write', false],
  ['reviewer', 'diagram:mutate', false],
  ['reviewer', 'comment:create', true],
  ['reviewer', 'comment:resolve', true],
  // viewer — read only, plus comment:* (CMT-01: "a user" comments, no role restriction)
  ['viewer', 'workspace:read', true],
  ['viewer', 'workspace:write', false],
  ['viewer', 'workspace:manage_members', false],
  ['viewer', 'project:read', true],
  ['viewer', 'project:write', false],
  ['viewer', 'diagram:read', true],
  ['viewer', 'diagram:write', false],
  ['viewer', 'diagram:mutate', false],
  ['viewer', 'comment:create', true],
  ['viewer', 'comment:resolve', true],
];

describe('can() — role x action decision matrix (AUTH-02)', () => {
  it.each(MATRIX)('role=%s action=%s -> allowed=%s', (role, action, expected) => {
    const decision = can({ role }, action, resource);
    expect(decision.allowed).toBe(expected);
  });

  it('covers every role and every action at least once', () => {
    const roles = new Set(MATRIX.map(([role]) => role));
    const actions = new Set(MATRIX.map(([, action]) => action));
    expect(roles.size).toBe(5);
    expect(actions.size).toBe(10);
    expect(MATRIX).toHaveLength(50);
  });
});

describe('can() — comment:create/comment:resolve are permitted for reviewer while diagram:mutate stays denied (T69, CMT-02)', () => {
  it('the same isolated (no-HTTP) assertion the task requires: reviewer allowed on comment:*, denied on diagram:mutate', () => {
    const createDecision = can({ role: 'reviewer' }, 'comment:create', resource);
    const resolveDecision = can({ role: 'reviewer' }, 'comment:resolve', resource);
    const mutateDecision = can({ role: 'reviewer' }, 'diagram:mutate', resource);

    expect(createDecision.allowed).toBe(true);
    expect(resolveDecision.allowed).toBe(true);
    expect(mutateDecision.allowed).toBe(false);
  });
});

describe('can() — diagram:mutate is never derived from diagram:write (T12 edge case)', () => {
  it('reviewer never receives diagram:mutate, independent of diagram:write', () => {
    const writeDecision = can({ role: 'reviewer' }, 'diagram:write', resource);
    const mutateDecision = can({ role: 'reviewer' }, 'diagram:mutate', resource);

    // reviewer holds neither in this minimal action set — the point of this
    // test is that mutate is evaluated on its own table entry, not derived
    // by implication from write, so a future change granting reviewer
    // diagram:write would not silently unlock diagram:mutate too.
    expect(writeDecision.allowed).toBe(false);
    expect(mutateDecision.allowed).toBe(false);
  });

  it('editor holding diagram:write does not imply diagram:mutate by construction alone (both are independently true)', () => {
    const writeDecision = can({ role: 'editor' }, 'diagram:write', resource);
    const mutateDecision = can({ role: 'editor' }, 'diagram:mutate', resource);

    expect(writeDecision.allowed).toBe(true);
    expect(mutateDecision.allowed).toBe(true);
  });

  it('viewer never receives diagram:mutate', () => {
    expect(can({ role: 'viewer' }, 'diagram:mutate', resource).allowed).toBe(false);
  });
});

describe('can() — viewer only receives *:read actions (T12 edge case)', () => {
  const nonReadActions: Action[] = [
    'workspace:write',
    'workspace:manage_members',
    'project:write',
    'diagram:write',
    'diagram:mutate',
  ];

  it.each(nonReadActions)('viewer is denied %s', (action) => {
    expect(can({ role: 'viewer' }, action, resource).allowed).toBe(false);
  });

  it.each(['workspace:read', 'project:read', 'diagram:read'] as const)(
    'viewer is granted %s',
    (action) => {
      expect(can({ role: 'viewer' }, action, resource).allowed).toBe(true);
    },
  );
});
