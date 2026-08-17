# Membros e papéis do workspace — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: inline (Medium scope — no separate design.md; the spec's Assumptions table already resolved the one real architectural question: a dedicated `memberClient.ts`, not the `resourceClient` generic from `workspace-navigation`).
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling (`apps/server/src/modules/workspace/workspace.int.spec.ts`, `apps/web/src/nav/ConfirmArchiveDialog.spec.tsx`, `apps/web/src/nav/resourceClient.spec.ts`, `apps/web/src/a11y/shell.a11y.spec.tsx`) and this repo's coverage-floor convention (never lowered). Guidelines found: none beyond `CLAUDE.md`'s "Comandos" — strong default applied.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Server route (`GET /users:lookup`) | integration | Found (200, exact `{id,email,displayName}`) and not-found (404) branches; requires only a valid session, no workspace scoping | `apps/server/src/modules/auth/users.int.spec.ts` or a new file — worker decides based on where `users`-level routes conventionally live | `pnpm --filter @arch-canvas/server run test:integration` |
| Client (`memberClient`) | unit | Every documented status branch: lookup 200/404, add 201/409, role-change 200/403/404, remove 204/403/404 | `apps/web/src/nav/memberClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Component (`WorkspaceMembersPage`) | unit (RTL) | 1:1 to spec ACs MEM-01..18 (list, invite flow incl. lookup 404/already-member, role change incl. last-admin block, remove incl. last-admin block) | `apps/web/src/nav/WorkspaceMembersPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Accessibility (`WorkspaceMembersPage`) | unit (axe) | Zero serious/critical violations; MEM-19..21 | `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integration (routing + `ProjectListPage` link) | unit (RTL) | `/w/:workspaceId/members` renders the page; link appears in `ProjectListPage` for every role (read-only for non-admins) | `apps/web/src/App.spec.tsx`, `apps/web/src/nav/ProjectListPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After a task with unit tests only, scoped to one package | `pnpm --filter @arch-canvas/<pkg> run test:unit` |
| Full | After a task with integration tests, or closing the feature | `make lint && make typecheck && make test-unit` (+ `make test-integration` for the server task) |
| Build | Closing the feature | `make lint && make typecheck && make test-unit && make test-integration` |

---

## Execution Plan

6 tasks total — fits a single batch (≤ ~8), executed inline/by one worker, no sub-agent-batch split needed.

```
T1
T2
T3
T2 → T4
T3 → T4
T4 → T5
T4 → T6
```

---

## Task Breakdown

### T1: Add `GET /users:lookup` route

**What**: New route resolving `?email=` to `{user: {id, email, displayName}}` (200) or 404 if no account matches. Session-gated only, no workspace scoping.
**Where**: `apps/server/src/modules/auth/routes.ts` (or a new small `users` module if that fits the codebase's route-organization convention better — check how other cross-cutting, non-workspace-scoped routes like `/me` are organized before deciding)
**Depends on**: None
**Reuses**: `requireSession(db)` preHandler pattern used by every other session-gated route
**Requirement**: MEM-04..06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `GET /users:lookup?email=<email>` returns `200 {user: {id, email, displayName}}` for an existing account, `404` for a non-existent one
- [x] Requires only a valid session (`requireSession`) — no workspace/role check, since resolving an email to an identity reveals nothing more sensitive than what workspace-member lists already expose
- [x] Registered in the module's `routeSchemas` (OpenAPI wiring) alongside its Zod query schema
- [x] Integration tests cover both branches
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(auth): add GET /users:lookup by email`

---

### T2: Create `memberClient`

**What**: Dedicated client (not the `resourceClient` generic) — `lookupByEmail`, `add`, `changeRole`, `remove`.
**Where**: `apps/web/src/nav/memberClient.ts`
**Depends on**: None
**Reuses**: `fetchImpl`-injection style from `apps/web/src/nav/resourceClient.ts`/`apps/web/src/sync/syncClient.ts`; `WorkspaceMember` shape from the server's `members.ts` (mirror the fields, don't invent new ones)
**Requirement**: MEM-04..18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `lookupByEmail(email)` → `{status: 'found', user} | {status: 'not_found'} | {status: 'error'}`
- [x] `add(workspaceId, userId, role)` → `{status: 'added', member} | {status: 'conflict'} | {status: 'error'}`
- [x] `changeRole(workspaceId, userId, role)` → `{status: 'ok'} | {status: 'forbidden'} | {status: 'error'}`
- [x] `remove(workspaceId, userId)` → `{status: 'removed'} | {status: 'forbidden'} | {status: 'error'}`
- [x] `list(workspaceId)` → `WorkspaceMember[]` from `GET /workspaces/:id/members`
- [x] Unit tests cover every branch above
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add dedicated memberClient`

---

### T3: Add `nav.members` i18n keys (pt-BR, en)

**What**: Extend the existing `"nav"` block with a `members` subtree — title, invite form labels, role labels (5 roles), remove confirmation, last-admin-block messages, not-found/already-member messages.
**Where**: `apps/web/src/i18n/locales/en/translation.json`, `apps/web/src/i18n/locales/pt-BR/translation.json`
**Depends on**: None
**Reuses**: existing `nav.*` nesting convention from `workspace-navigation`
**Requirement**: MEM-19..21

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Both locale files have an identical key set under `nav.members`
- [x] Includes at minimum: `nav.members.title`, `invite`, `emailLabel`, `roleLabel`, `roleOptions.*` (5 roles), `notFound`, `alreadyMember`, `lastAdminBlock.{selfRemove,selfDowngrade}`, `remove`, `roleChanged`
- [x] `make lint` passes

**Tests**: none (build gate only)
**Gate**: quick (`make lint`)

**Commit**: `feat(web): add nav.members i18n keys for pt-BR and en`

---

### T4: Create `WorkspaceMembersPage`

**What**: The members screen — list, invite form (email → lookup → role select → add), per-row role change, per-row remove (via `ConfirmArchiveDialog`), last-admin client-side protections.
**Where**: `apps/web/src/nav/WorkspaceMembersPage.tsx`
**Depends on**: T2, T3
**Reuses**: `memberClient`, `ConfirmArchiveDialog` (as-is, no changes), `resourceListStore` (with an `id = userId` shim at the fetch boundary), `useAuth()` (to know the logged-in user's own id, for the last-admin checks), `can()` from `@arch-canvas/auth`
**Requirement**: MEM-01..18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Lists members from `GET /workspaces/:id/members` for any role (read is universal)
- [x] Invite/role-change/remove actions shown only when the caller's role grants `workspace:manage_members`
- [x] Invite flow: lookup first; 404 → "no account found", no `POST` emitted; found + already-a-member (cross-checked against the already-loaded list) → "already a member" message, no `POST` emitted; found + not-a-member → `POST` with the resolved `userId`; `409` on `POST` → conflict message
- [x] Role change: `PATCH`, reflects new value only after `200`; blocks (no request emitted) when the target is the logged-in user AND they are the workspace's sole `org_admin`/`workspace_admin` AND the new role is non-admin
- [x] Remove: `ConfirmArchiveDialog` with the member's display name; blocks (dialog never opens) when the target is the logged-in user AND they are the sole admin; on `204`, removes from the list
- [x] `aria-live="polite"` region announces invite/role-change/remove outcomes
- [x] Unit tests cover every bullet above, including the sole-admin-is-someone-else-being-removed-by-a-second-admin case (must NOT be blocked)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add WorkspaceMembersPage`

---

### T5: Add `WorkspaceMembersPage` accessibility test

**What**: `WorkspaceMembersPage.a11y.spec.tsx`, mirroring the established convention.
**Where**: `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx`
**Depends on**: T4
**Reuses**: `seriousOrCriticalViolations` helper pattern
**Requirement**: MEM-19..21

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `jest-axe` run against the page in at least 2 states (populated list, invite form open)
- [x] Zero serious/critical violations
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add WorkspaceMembersPage accessibility coverage`

---

### T6: Wire the members route and `ProjectListPage` link

**What**: Add `/w/:workspaceId/members` as a sibling route inside `AppShell`'s existing nested-route block; add a "Members" link in `ProjectListPage` next to the existing archive-workspace control, visible to every role (read is universal), leading into `WorkspaceMembersPage`.
**Where**: `apps/web/src/App.tsx`, `apps/web/src/nav/ProjectListPage.tsx`
**Depends on**: T4
**Reuses**: the nested-route pattern already established by `workspace-navigation`'s T11
**Requirement**: MEM-01..02 (integration point)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `/w/:workspaceId/members` renders `WorkspaceMembersPage` inside the same `ProtectedRoute`/`AppShell` chrome as the other nav pages
- [x] `ProjectListPage` shows a "Members" link for every role, not just admins
- [x] `repo-tools run audit` reflects the 4 original member routes plus the new lookup route as consumed
- [x] Full gate passes: `make lint && make typecheck && make test-unit`

**Tests**: unit (integration-style RTL)
**Gate**: full

**Commit**: `feat(web): wire WorkspaceMembersPage into routing and ProjectListPage`

---

## Phase Execution Map

```
T2 → T4
T3 → T4
T4 → T5
T4 → T6
```

T1, T2, T3 have no incoming edges.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: `GET /users:lookup` | 1 route | ✅ Granular |
| T2: `memberClient` | 1 file | ✅ Granular |
| T3: `nav.members` i18n keys | 2 files, 1 cohesive block | ✅ Granular |
| T4: `WorkspaceMembersPage` | 1 component | ✅ Granular |
| T5: a11y test | 1 test file | ✅ Granular |
| T6: wire routing + link | 2 files, 1 cohesive integration | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | No incoming edge | ✅ Match |
| T2 | None | No incoming edge | ✅ Match |
| T3 | None | No incoming edge | ✅ Match |
| T4 | T2, T3 | T2→T4, T3→T4 | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | T4 | T4→T6 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ----------------------------- | ----------------- | ----------- | ------ |
| T1 | Server route | integration | integration | ✅ OK |
| T2 | Client | unit | unit | ✅ OK |
| T3 | i18n JSON | none | none | ✅ OK |
| T4 | Component | unit | unit | ✅ OK |
| T5 | Accessibility | unit (axe) | unit | ✅ OK |
| T6 | Integration wiring | unit (integration-style RTL) | unit | ✅ OK |

---

## Tips

(carried from the skill template — not repeated here)
