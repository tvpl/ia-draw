# Administradores de organização Validation

## Validation: organization-admins - PASS ✅ (after Fix 1)

**Date**: 2026-08-25
**Spec**: `.specs/features/organization-admins/spec.md`
**Diff range**: `f515387^..44b7d95` (13 commits, T1-T13), plus a follow-up fix commit for Fix 1
**Verifier**: independent sub-agent (author ≠ verifier)

All 14 ORG requirements verified with precise spec-anchored evidence. ORG-14's confirmed real
defect (see Fix 1) was fixed and independently re-checked: the legacy `org_admin` row now renders
the read-only badge instead of an empty `<select>` for a workspace manager, with a new test
(`WorkspaceMembersPage.spec.tsx`, "even when the caller can manage members") that fails against
the pre-fix code and passes against the fix. Every other AC, the discrimination sensor, and the
full gate remain solid.

### Fix 1 — Resolved

`WorkspaceMembersPage.tsx`'s per-row action cell now branches on `ASSIGNABLE_ROLE_VALUES.includes(item.role)`:
when true, the `<select>` renders as before; when false (a legacy `org_admin` row), the read-only
badge renders instead, even though `canManage` is true — matching the same fallback the
`!canManage` branch already used. The "Remover" button is unaffected either way. Verified: the new
test fails without the fix (`git stash` round-trip on the implementation file alone, confirmed
manually) and passes with it; `make lint` (exit 0), `TURBO_FORCE=true make typecheck` (25/25), and
the full `WorkspaceMembersPage.spec.tsx` file (32/32) all green.

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | `organizationMembers` in `packages/database/src/schema.ts:140`; `infra/migrations/0012_fuzzy_human_robot.sql` creates the table + unique index |
| T2   | ✅ Done | `infra/migrations/0013_backfill_organization_admins.sql`; dedicated migration test at `packages/database/src/organizationMembersBackfill.int.spec.ts` |
| T3   | ✅ Done | `resolveOrganizationRole` in `apps/server/src/modules/workspace/effectiveRole.ts:46-68` reads only `organization_members` |
| T4   | ✅ Done | `hasOrgAdminMembership` in `apps/server/src/modules/ai-provider/routes.ts:46-52` reads only `organization_members` |
| T5   | ✅ Done | `administeredOrgs` in `apps/server/src/modules/workspace/workspaces.ts:77-84` reads only `organization_members` |
| T6   | ✅ Done | `apps/server/src/modules/auth/firstRun.ts:124-129` additive insert in the same transaction |
| T7   | ✅ Done | `apps/server/src/modules/workspace/organizationAdmins.ts` — list/add/remove + `withLastOrgAdminGuard` |
| T8   | ✅ Done | REST routes in `apps/server/src/modules/workspace/routes.ts:343-428` |
| T9   | ✅ Done | `apps/web/src/nav/organizationAdminClient.ts` |
| T10  | ✅ Done | Section in `apps/web/src/nav/WorkspaceMembersPage.tsx`; see deviation note below |
| T11  | ✅ Done (with a real, confirmed gap) | `ASSIGNABLE_ROLE_VALUES` reduced to 4; see Gap 1 below |
| T12  | ✅ Done | `docs/adr/0017-organization-members-table.md` names all three call sites and the selector decision |
| T13  | ✅ Done | Roadmap R28 marked closed; `.specs/STATE.md` AD-016 references AD-017; "Aberto e sem dono" no longer lists the consequence |

---

## Spec-Anchored Acceptance Criteria

### P1: A organização tem uma fonte única de quem a administra

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| ORG-01: persist org admin in own table | dedicated `organization_members` table, distinct from `workspace_members` | `packages/database/src/schema.ts:140-152` (table def); `infra/migrations/0012_fuzzy_human_robot.sql` (DDL) | ✅ PASS |
| ORG-02: backfill preserves exact admin set | exact set from `workspace_members.role='org_admin'`, deduped per `(org,user)`, no gain/loss | `packages/database/src/organizationMembersBackfill.int.spec.ts:132-142` — `expect(byOrgAndUser.size).toBe(3)`, explicit per-user presence/absence assertions, Alice's 2-workspace dedupe asserted `toHaveLength(1)` | ✅ PASS |
| ORG-03: all 3 call sites read the single table, none scan `workspace_members` for `org_admin` | `resolveEffectiveRole`, `hasOrgAdminMembership`, `listWorkspacesForUser` all read only `organization_members`; a legacy `workspace_members.role='org_admin'` row alone confers nothing | `apps/server/src/modules/workspace/rbac-matrix.int.spec.ts:334-364` — legacy row asserted `expect(response.statusCode).toBe(404)`; `apps/server/src/modules/ai-provider/ai-provider.int.spec.ts:89-110` (role-driven seed helper reads only `organizationMembers` for `org_admin`); `apps/server/src/modules/workspace/workspace.int.spec.ts:263+` — legacy row does NOT widen `GET /workspaces` | ✅ PASS |
| ORG-04: first-run additionally inserts into the new table, same transaction | founder gets an `organization_members` row in the same tx as the `workspace_members` row | `apps/server/src/modules/auth/firstRun.int.spec.ts:113-123` — `expect(orgMembers).toHaveLength(1)`, `expect(orgMembers[0]?.userId).toBe(account?.id)` | ✅ PASS |

### P1: Um formulário concede e revoga administrador de organização

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| ORG-05: list visible to org admin viewer | GET returns admin list for a workspace member | `apps/server/src/modules/workspace/organizationAdmins.int.spec.ts:92-107` — `expect(response.statusCode).toBe(200)`, owner present in `items` | ✅ PASS |
| ORG-06: grant by email + audit event (actor+target) | 201, row inserted, audit event with `actorId`/`resourceId`/`metadataJson.targetUserId` | `organizationAdmins.int.spec.ts:145-180` — status `201`, DB row count `1`, `event?.actorId`/`resourceType`/`resourceId` all asserted to exact values | ✅ PASS |
| ORG-07: nonexistent email refused, nothing created | clear error, no row created | `organizationAdmins.int.spec.ts:182-200` — `404`, `response.json().title` truthy, row count unchanged at `1` (only the seed owner) | ✅ PASS |
| ORG-08 (web): section shown only for org_admin | section renders only when `workspace.role === 'org_admin'` | `apps/web/src/nav/WorkspaceMembersPage.spec.tsx:674-705` — text found for org_admin caller (688: never fetched for workspace_admin) | ✅ PASS |
| ORG-09: revoke + audit event (actor+target) | 204, row removed, audit event with actor/target | `organizationAdmins.int.spec.ts:202-237` — `204`, row count `0`, event actor/resource asserted | ✅ PASS |
| ORG-10: last-admin revoke → 409, nothing removed | `409` naming the reason, row count unchanged | `organizationAdmins.int.spec.ts:239-255` — `409`, `title` truthy, row count still `1` | ✅ PASS |
| ORG-11: non-org_admin actor → 403 | POST/DELETE both `403` for workspace_admin (not org_admin) | `organizationAdmins.int.spec.ts:109-143` — both `403`, and POST confirmed to have created no row | ✅ PASS |

### P2: O papel de workspace para de prometer alcance que não confere mais

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| ORG-12: invite selector offers exactly 4 workspace-scoped roles | `workspace_admin, editor, reviewer, viewer`, never `org_admin` | `WorkspaceMembersPage.spec.tsx:869-888` — `optionLabels` asserted `toEqual([...4 labels])`, exact array, not a substring/contains check | ✅ PASS |
| ORG-13: per-row role-change selector offers the same reduced set | same 4 options | `WorkspaceMembersPage.spec.tsx:890-907` — same exact-array assertion | ✅ PASS |
| ORG-14: a legacy `org_admin` row continues to display that role with fidelity | role shown correctly even though not reassignable | `WorkspaceMembersPage.spec.tsx:909-939` — **only exercises the `!canManage` (badge) rendering path**; the `canManage` (per-row `<select>`) path is never exercised for a legacy `org_admin` row | ⚠️ Spec-precision gap → confirmed real defect, see Gap 1 |

**Status**: ⚠️ 13/14 pass with a precise spec-anchored assertion; ORG-14 has a confirmed real gap (not merely untested — traced to a code-level defect, see Gap 1).

---

## Self-Reported Deviations — Verifier Findings

### T10: reload-via-GET instead of optimistic append

The author's self-report claims design.md left the optimistic-vs-reload UI decision "to Tasks." Re-reading `design.md`'s "Cliente web" section: it only defers the **email-lookup delegation** decision to Tasks ("decidido em Tasks pela forma mais simples de testar") — it says nothing about optimistic append vs. reload. **The self-report's citation is imprecise.**

That said, the actual behavior is spec-compliant on its own merits: `tasks.md` T10's Done-when literally requires "Conceder atualiza a lista sem recarregar a página" (grant updates the list **without reloading the page**) — not "without a new GET." `WorkspaceMembersPage.tsx:293-295` calls `loadOrgAdmins()` (a fetch, not `location.reload()`/navigation), which satisfies that criterion. `WorkspaceMembersPage.spec.tsx:740-771` asserts the row appears with the correct name after a second GET call (`listCalls` === 2), with no page navigation involved.

**Verdict**: not a gap. Behavior is correct; only the self-report's citation of design.md is inaccurate (documentation nit, not a code defect — no fix task needed).

### T11: legacy `org_admin` row + role-change `<select>` — CONFIRMED REAL GAP

The self-report flagged this as an "untested spec-precision gap." Verifier traced it further: it is not merely untested, it is a **real, reachable defect**.

`WorkspaceMembersPage.tsx:183-185` computes `canManage` from `can({role: me.role}, 'workspace:manage_members', ...)`, true for both `workspace_admin` and `org_admin` callers. When `canManage` is true, `WorkspaceMembersPage.tsx:368-381` renders a `<select value={item.role}>` populated only from `ASSIGNABLE_ROLE_VALUES` (4 entries, no `org_admin`) for **every** row, including a legacy row whose `item.role === 'org_admin'`. Because no `<option value="org_admin">` exists, the control structurally cannot render "Admin da organização" — React sets `selectedIndex` to no match, and the widget shows a blank or default state instead of the actual role. Only the `!canManage` branch (`WorkspaceMembersPage.tsx:390-393`, plain badge) can display the label faithfully.

`WorkspaceMembersPage.spec.tsx:909-939`'s ORG-14 test seeds the caller as `role: 'viewer'` — i.e., `canManage === false` — so it only ever exercises the badge path. The `canManage === true` + legacy-`org_admin`-row combination (a workspace_admin or org_admin looking at another admin's row) is never tested, and is where ORG-14 ("SHALL continue displaying that role with fidelity") actually breaks.

**Verdict**: real gap, ranked as Fix 1 below. Not acceptable to leave as "documented and fine" — it is a live violation of ORG-14 for the exact audience (workspace managers) who need to see the row correctly.

---

## Discrimination Sensor

Isolated scratch: `git worktree add <scratch> HEAD` at `/tmp/.../scratchpad/sensor-worktree` (never `git stash`). Pre-sensor real-tree baseline: `git status --porcelain` empty. Post-cleanup real-tree baseline: `git status --porcelain` empty — unchanged.

| # | File:line | Mutation | Test run | Killed? |
| - | --------- | -------- | -------- | ------- |
| 1 | `apps/server/src/modules/workspace/effectiveRole.ts:67` | `resolveOrganizationRole` always returns `null` (simulates removing the `organization_members` check) | `rbac-matrix.int.spec.ts` | ✅ Killed — 3 failures (200→404, 201→404, 201→403) |
| 2 | `apps/server/src/modules/workspace/organizationAdmins.ts:83` | `withLastOrgAdminGuard`'s `otherAdmins.length > 0` → `>= 0` (guard always allows) | `organizationAdmins.spec.ts` | ✅ Killed — 2 failures (guard no longer throws `LastOrgAdminError`; concurrent-revocation invariant broken, `admins.length` → 0) |
| 3 | `apps/server/src/modules/workspace/organizationAdmins.ts:42` | `addOrganizationAdmin` drops `.onConflictDoNothing()` | `organizationAdmins.spec.ts` | ✅ Killed — 1 failure (unique-constraint violation `23505` on the idempotent-grant test) |
| 4 | `apps/web/src/nav/WorkspaceMembersPage.tsx:42` | `ASSIGNABLE_ROLE_VALUES` regains `'org_admin'` | `WorkspaceMembersPage.spec.tsx` | ✅ Killed — 2 failures (ORG-12, ORG-13 exact-array assertions now include `"Admin da organização"`) |

**Sensor depth**: lightweight (4 targeted mutations across the highest-risk new code: authorization read-path, last-admin guard, idempotency, and the client-facing role-selector exclusion).
**Sensor outcome**: 4/4 mutations killed — the test suite discriminates correctly on every mutation attempted.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ — new files follow existing `lastAdmin.ts`/`memberClient.ts` templates, no invented abstractions |
| Surgical changes | ✅ — all three call sites changed their single existing query, no second read path introduced |
| No scope creep | ✅ — `org_admin` enum value untouched per spec's Out of Scope; no new RBAC `Action` added (design.md's stated rationale holds) |
| Matches patterns | ✅ — `organizationAdmins.ts` mirrors `lastAdmin.ts`; `organizationAdminClient.ts` mirrors `memberClient.ts` |
| Spec-anchored outcome check | ✅ — 13/14 ACs matched exactly; ORG-14 flagged and traced to a real defect, not silently passed |
| Per-layer Coverage Expectation met | ✅ — domain logic (`organizationAdmins.ts`) has 1:1 AC mapping; routes cover happy + 403 + 404 + 409 + concurrent edge case |
| Every test maps to a spec requirement | ✅ — no unclaimed tests found in the four spec'd test files |
| Documented guidelines followed | ✅ — AD-007 (PGlite), AD-013 (route prefix), AD-014 (Tailwind tokens, `css.*` reuse) all honored; `// SPEC_DEVIATION` comments present and honest where PGlite substitutes testcontainers |

---

## Edge Cases

- [x] Two concurrent revocations leaving org with zero admins → resolved to at most one success: `organizationAdmins.spec.ts:116-138` (unit, `Promise.allSettled`) and `organizationAdmins.int.spec.ts:257-287` (integration, `Promise.all` over PGlite, explicitly scoped as accepting PGlite's single-connection limitation per `// SPEC_DEVIATION` at file top — genuine concurrent-connection proof is out of scope, correctly deferred to `concurrency-proof`/R27)
- [x] Idempotent grant (already admin) → no error, no duplicate: `organizationAdmins.spec.ts:65-73`
- [x] First-run never leaves the org without an admin, not even for an instant: guaranteed by transactional atomicity — both `workspace_members` and `organization_members` inserts are in the same `tx` (`firstRun.ts:118-129`); no intermediate committed state can exist without the founder in both

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit`, then `TURBO_FORCE=true make ci` (forced to rule out stale-cache false passes, per `.specs/STATE.md`'s lesson "gate que passa por cache do turbo não é gate que passou")
- **Result**:
  - `make lint`: exit 0 (10 pre-existing warnings in unrelated `tools/repo-tools/src/webConsumers.spec.ts`, not touched by this diff)
  - `TURBO_FORCE=true make typecheck`: exit 0, 25/25 tasks, 0 cached (genuine)
  - `TURBO_FORCE=true make test-unit`: exit 0, 24/24 tasks, 0 cached — server 410/410, web 993/993, all other packages green
  - `TURBO_FORCE=true make ci`: exit 0, 13/13 tasks (lint+typecheck+unit+integration), 0 cached — server integration 54 files / 405 tests passed (includes `oidc.int.spec.ts`, `presenceBroadcaster.int.spec.ts` with real redis-server); database integration 8 files / 38 tests passed, including `organizationMembersBackfill.int.spec.ts` (2/2)
- **Test count before feature**: not independently re-derived (pre-feature commit not checked out) — the diff range (`f515387^..44b7d95`) adds the feature's dedicated test files (`organizationAdmins.spec.ts`, `organizationAdmins.int.spec.ts`, `organizationMembersBackfill.int.spec.ts`, `organizationAdminClient.spec.ts`, plus extensions to `rbac-matrix.int.spec.ts`, `ai-provider.int.spec.ts`, `workspace.int.spec.ts`, `firstRun.int.spec.ts`, `WorkspaceMembersPage.spec.tsx`) — strictly additive, no test deleted or weakened
- **Skipped tests**: none observed
- **Failures**: none

---

## Fix Plans

### Fix 1: Legacy `org_admin` row's role-change `<select>` cannot display its own value (ORG-14)

- **Root cause**: `WorkspaceMembersPage.tsx:368-381` renders a `<select value={item.role}>` for every row when `canManage` is true, but its `<option>` list is `ASSIGNABLE_ROLE_VALUES` (4 entries) — `org_admin` is excluded by ORG-12/13 design, so a legacy row's actual value has no matching `<option>`. The control cannot render "Admin da organização" in that state, breaking ORG-14's fidelity requirement for exactly the audience (workspace managers) who see the `<select>` instead of the read-only badge.
- **Fix task**: For a row whose `item.role === 'org_admin'`, render the read-only badge (same as `!canManage`'s branch, `WorkspaceMembersPage.tsx:390-393`) instead of the `<select>`, even when `canManage` is true — a legacy value can be displayed and removed (the "Remover" button, unaffected) but not reassigned away from `org_admin` via the role selector, consistent with design.md's stated intent ("não pode ser reatribuída de volta a ele pelo seletor"). Add a test seeding the caller as `workspace_admin`/`org_admin` (canManage=true) alongside a legacy `org_admin` peer row, asserting the badge (not a `<select>`) renders for that peer.
- **Priority**: Major (a real spec-precision violation of a P2 AC, user-visible to a legitimate audience, though not a security issue — the row is still removable and no elevated access is granted).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| ORG-01 | Tasks | ✅ Verified |
| ORG-02 | Tasks | ✅ Verified |
| ORG-03 | Tasks | ✅ Verified |
| ORG-04 | Tasks | ✅ Verified |
| ORG-05 | Tasks | ✅ Verified |
| ORG-06 | Tasks | ✅ Verified |
| ORG-07 | Tasks | ✅ Verified |
| ORG-08 | Tasks | ✅ Verified |
| ORG-09 | Tasks | ✅ Verified |
| ORG-10 | Tasks | ✅ Verified |
| ORG-11 | Tasks | ✅ Verified |
| ORG-12 | Tasks | ✅ Verified |
| ORG-13 | Tasks | ✅ Verified |
| ORG-14 | Tasks | ✅ Verified (Fix 1 applied) |

---

## Summary

**Overall**: ✅ Ready — Fix 1 applied and independently confirmed; all 14 ACs now hold.

**Spec-anchored check**: 14/14 ACs matched the spec-defined outcome with precise `file:line` evidence.
**Sensor**: 4/4 mutations killed, all discriminating correctly (unaffected by Fix 1, a display-only change).
**Gate**: all green, forced (no stale-cache false pass) — lint 0, typecheck 25/25, unit 24/24 (1403 tests, +1 after Fix 1's new test), full `make ci` 13/13 (443 integration tests across server+database).

**What works**: The core of this feature — the single-source `organization_members` table, its backfill migration, the three migrated call sites (with explicit negative tests proving the legacy `workspace_members.role='org_admin'` read no longer grants org-wide reach), the grant/revoke REST routes with last-admin guard and audit events, and the reduced workspace role selector — is solid, precisely tested, and matches spec.md/design.md exactly. Documentation closure (ADR-0017, roadmap R28, STATE.md AD-016→AD-017) is accurate against what was actually built, not just present.

**Issues found and resolved**: Fix 1 — a legacy `org_admin` workspace-member row was not displayed with fidelity when viewed by a workspace manager (only when viewed by a non-manager), because the per-row `<select>` had no option matching that value. Fixed by falling back to the read-only badge for any row whose role isn't in `ASSIGNABLE_ROLE_VALUES`, even when `canManage` is true. New regression test added and confirmed to fail pre-fix, pass post-fix.

**Next steps**: None outstanding for this feature. R28 (and the whole R24-R28 wave) can close.
