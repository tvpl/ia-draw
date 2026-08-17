# Navegação de workspace, projetos e diagramas — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/workspace-navigation/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling (`apps/server/src/modules/workspace/workspace.int.spec.ts`, `rbac-matrix.int.spec.ts`, `apps/web/src/sync/syncClient.spec.ts`, `apps/web/src/a11y/shell.a11y.spec.tsx`) and this repo's coverage-floor convention (never lowered). Guidelines found: none beyond `CLAUDE.md`'s "Comandos" — strong default applied.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Server route (`role` in workspace list/detail) | integration | Every role in `ROLE_VALUES` returns its own value, never a hardcoded/wrong role; existing fields byte-for-byte unchanged | `apps/server/src/modules/workspace/workspace.int.spec.ts` | `pnpm --filter @arch-canvas/server run test:integration` |
| Client (`resourceClient`) | unit | Every documented status branch (list success/error, create 201/409/error, rename 200/409/error, archive 204/error) — parametrized test run against all 3 resource configs | `apps/web/src/nav/resourceClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Store (`resourceListStore`) | unit | Every action exercised (setItems/setError/addItem/removeItem/replaceItem) | `apps/web/src/nav/resourceListStore.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`ConfirmArchiveDialog`) | unit (RTL) | Opens with item name, confirm/cancel both call the right callback, native `<dialog>` keyboard (Esc) closes without confirming | `apps/web/src/nav/ConfirmArchiveDialog.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`WorkspaceListPage`) | unit (RTL) | 1:1 to NAV-01, NAV-06..08, NAV-13..16 (workspace-level rename/archive), NAV-17..21 (archive), NAV-22..23 (empty state) | `apps/web/src/nav/WorkspaceListPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`ProjectListPage`) | unit (RTL) | 1:1 to NAV-02, NAV-09..11, role-gated create/rename/archive, NAV-04 (404 handling) | `apps/web/src/nav/ProjectListPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`DiagramListPage`) | unit (RTL) | 1:1 to NAV-03, NAV-12, role-gated create/rename/archive, NAV-04, Edge Case (empty diagram list) | `apps/web/src/nav/DiagramListPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Accessibility (3 pages + dialog) | unit (axe) | Zero serious/critical violations per surface; NAV-24..26 | `apps/web/src/nav/*.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Integration (`App.tsx`/`AppShell` wiring) | unit (RTL) | Nested routing renders the right page per URL depth; `/w/:id/d/:id` still renders `DiagramEditorPage` unnested | `apps/web/src/App.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After a task with unit tests only, scoped to one package | `pnpm --filter @arch-canvas/<pkg> run test:unit` |
| Full | After a task with integration tests, or closing a phase | `make lint && make typecheck && make test-unit` (+ `make test-integration` for server tasks) |
| Build | Closing the feature | `make lint && make typecheck && make test-unit && make test-integration` |

---

## Execution Plan

### Phase 1: Servidor

```
T1
T2
```

### Phase 2: Genéricos (cliente, store, diálogo, i18n)

```
T3
T4
T5
T6
```

### Phase 3: Páginas

```
T7
T8
T9
```

### Phase 4: Integração

```
T10
T11
```

---

## Task Breakdown

### T1: Add `role` to `GET /workspaces` list items

**What**: Extend `listWorkspacesForUser`'s select to project `workspaceMembers.role`, and the route handler's response shape accordingly.
**Where**: `apps/server/src/modules/workspace/workspaces.ts`, `apps/server/src/modules/workspace/routes.ts`
**Depends on**: None
**Reuses**: the `innerJoin(workspaceMembers)` already present in `listWorkspacesForUser` (only the `WHERE`, not the `SELECT`, needs to change)
**Requirement**: NAV-13, NAV-17 (workspace-level rename/archive gating)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Each item in `GET /workspaces`'s `{items: [...]}` includes `role: WorkspaceRole` sourced from the caller's own `workspace_members` row
- [x] Every other existing field (`id`, `organizationId`, `name`, `slug`, `accessPolicy`, `createdAt`, `updatedAt`) unchanged
- [x] Integration test: a user who is `editor` in workspace A and `viewer` in workspace B sees the correct distinct `role` per item
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(workspace): add role to the GET /workspaces list response`

---

### T2: Add `role` to `GET /workspaces/:id` detail

**What**: Same extension as T1, for the single-item detail route.
**Where**: `apps/server/src/modules/workspace/workspaces.ts` (`getWorkspaceById`), `apps/server/src/modules/workspace/routes.ts`
**Depends on**: None
**Reuses**: T1's pattern (separate function, same idea)
**Requirement**: NAV-09..12 (project/diagram-page role gating)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `GET /workspaces/:id`'s `{workspace}` includes `role: WorkspaceRole` for the requesting user
- [x] `getWorkspaceById` gains the necessary join without changing its 404 behavior for non-members
- [x] Integration test covers the role value for a non-admin member
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(workspace): add role to the GET /workspaces/:id response`

---

### T3: Create generic `resourceClient`

**What**: `createResourceClient<T>(config, fetchImpl?)` per design.md's interface — list/create/rename/archive, parametrized by URL/body-shape config.
**Where**: `apps/web/src/nav/resourceClient.ts`
**Depends on**: None
**Reuses**: `fetchImpl`-injection style from `apps/web/src/sync/syncClient.ts`
**Requirement**: NAV-06..21 (the CRUD substrate all three pages build on)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `list()`, `create()`, `rename()`, `archive()` implemented exactly per design.md's type signature
- [x] Status branching: 200/201/204 success paths, 409 conflict (create/rename), any other non-2xx treated as a generic error
- [x] Unit test runs the same test suite against 3 different configs (workspace-shaped, project-shaped, diagram-shaped body/URL) to prove genuine parametrization, not a workspace-only implementation with the others unexercised
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add generic resourceClient for workspace/project/diagram CRUD`

---

### T4: Create generic `resourceListStore`

**What**: `createResourceListStore<T>()` Zustand factory per design.md's interface.
**Where**: `apps/web/src/nav/resourceListStore.ts`
**Depends on**: None
**Reuses**: `createSaveStatusStore` structural template
**Requirement**: NAV-01..03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `setItems`, `setError`, `addItem`, `removeItem`, `replaceItem` all implemented and independently tested
- [x] `status` transitions correctly (`loading` → `ready`/`error`)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add generic resourceListStore`

---

### T5: Create `ConfirmArchiveDialog`

**What**: Native `<dialog>`-based confirmation component per design.md.
**Where**: `apps/web/src/nav/ConfirmArchiveDialog.tsx`
**Depends on**: None
**Reuses**: none — first dialog surface in the app
**Requirement**: NAV-18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Renders the item's name in the confirmation message
- [x] Confirm click calls `onConfirm`; cancel click (or native Esc-to-close) calls `onCancel`, never both
- [x] Uses `<dialog>`'s `showModal()`/`close()` imperatively (React 19 ref pattern), not a custom overlay div
- [x] Unit tests cover confirm, cancel, and Esc-dismiss
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add ConfirmArchiveDialog`

---

### T6: Add `nav` i18n keys (pt-BR, en)

**What**: New top-level `"nav": {...}` block — labels/actions for all 3 list pages plus the archive dialog and the zero-workspaces empty state.
**Where**: `apps/web/src/i18n/locales/en/translation.json`, `apps/web/src/i18n/locales/pt-BR/translation.json`
**Depends on**: None
**Reuses**: existing nesting convention (`aiDock`, `auth` blocks)
**Requirement**: NAV-24..26

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Both locale files have an identical key set under `nav`
- [ ] Includes at minimum: `nav.workspaces.title/create/emptyState/emptyStateCta`, `nav.projects.title/create`, `nav.diagrams.title/create/empty`, `nav.rename`, `nav.archive`, `nav.archiveConfirm.{title,body,confirm,cancel}`, `nav.notFound`
- [ ] `make lint` passes

**Tests**: none (build gate only)
**Gate**: quick (`make lint`)

**Commit**: `feat(web): add nav i18n keys for pt-BR and en`

---

### T7: Create `WorkspaceListPage`

**What**: The `/` index route — lists workspaces (with per-item rename/archive gated by that item's own `role`), create-workspace form (always shown), zero-workspaces empty state.
**Where**: `apps/web/src/nav/WorkspaceListPage.tsx`
**Depends on**: T1, T3, T4, T5, T6
**Reuses**: `resourceClient`, `resourceListStore`, `ConfirmArchiveDialog`, `can()` from `@arch-canvas/auth` (add as a new `apps/web` dependency in this task, first consumer)
**Requirement**: NAV-01, NAV-06..08, NAV-13..21 (workspace-level), NAV-22..23

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Lists workspaces from `GET /workspaces`, each item linking to `/w/:workspaceId`
- [ ] Create action always visible; empty/whitespace name never submits; 409 shows conflict message with name preserved
- [ ] Rename/archive shown per item only when that item's `role` grants `workspace:write` (via `can()`); archive routes through `ConfirmArchiveDialog`
- [ ] `items.length === 0` renders the dedicated empty state (NAV-22) with the create CTA, not the normal empty list
- [ ] `apps/web/package.json` gains `@arch-canvas/auth: workspace:*`
- [ ] Unit tests cover all bullets above
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add WorkspaceListPage`

---

### T8: Create `ProjectListPage`

**What**: `/w/:workspaceId` route — resolves workspace name + role via `GET /workspaces/:id`, lists projects, role-gated create/rename/archive.
**Where**: `apps/web/src/nav/ProjectListPage.tsx`
**Depends on**: T2, T3, T4, T5, T6
**Reuses**: everything from T3-T6, `can()` (already a dependency after T7)
**Requirement**: NAV-02, NAV-04, NAV-09..11

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Resolves and displays the current workspace's name via `GET /workspaces/:id`; a 404 renders the "not found or no access" message (NAV-04), never distinguishing the two
- [ ] Lists projects from `GET /projects?workspaceId=`, each linking to `/w/:workspaceId/p/:projectId`
- [ ] Create/rename/archive shown only when the resolved `role` grants `project:write`
- [ ] Back-navigation to `/` present
- [ ] Unit tests cover all bullets above, including the 403-not-shown and 404 cases
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add ProjectListPage`

---

### T9: Create `DiagramListPage`

**What**: `/w/:workspaceId/p/:projectId` route — resolves workspace role (own `GET /workspaces/:id` call) and project name (`GET /projects/:id`), lists diagrams, role-gated create/rename/archive, links into the existing editor route.
**Where**: `apps/web/src/nav/DiagramListPage.tsx`
**Depends on**: T2, T3, T4, T5, T6
**Reuses**: everything from T3-T6, `can()`
**Requirement**: NAV-03, NAV-04, NAV-12, Edge Case (empty diagram list)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Resolves and displays the current project's name via `GET /projects/:id`; resolves role via `GET /workspaces/:workspaceId`; a 404 on either renders the "not found or no access" message
- [ ] Lists diagrams from `GET /diagrams?projectId=`, each linking to `/w/:workspaceId/d/:diagramId` (the existing, unmodified editor route)
- [ ] Create/rename/archive shown only when `role` grants `diagram:write`; creating navigates straight into the new diagram's editor on `201`
- [ ] Empty project (zero diagrams) renders a simple empty state with the create action, not an error
- [ ] Back-navigation to `/w/:workspaceId` present
- [ ] Unit tests cover all bullets above
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add DiagramListPage`

---

### T10: Add accessibility tests for the 3 pages and the dialog

**What**: `*.a11y.spec.tsx` for `WorkspaceListPage`, `ProjectListPage`, `DiagramListPage`, `ConfirmArchiveDialog`, mirroring `shell.a11y.spec.tsx`'s convention.
**Where**: `apps/web/src/nav/WorkspaceListPage.a11y.spec.tsx`, `ProjectListPage.a11y.spec.tsx`, `DiagramListPage.a11y.spec.tsx`, `ConfirmArchiveDialog.a11y.spec.tsx`
**Depends on**: T7, T8, T9
**Reuses**: `seriousOrCriticalViolations` helper pattern from `shell.a11y.spec.tsx`
**Requirement**: NAV-24..26

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `jest-axe` run against each of the 4 surfaces in at least one populated state
- [ ] Zero serious/critical violations in every case
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add accessibility coverage for nav pages and archive dialog`

---

### T11: Wire nested routing into `AppShell`/`App.tsx`

**What**: `AppShell`'s `<main />` becomes `<main><Outlet/></main>`; `App.tsx`'s `/` route gains `index`/`w/:workspaceId`/`w/:workspaceId/p/:projectId` children rendering the 3 new pages. The diagram-editor route stays an unnested sibling.
**Where**: `apps/web/src/app-shell/AppShell.tsx`, `apps/web/src/App.tsx`
**Depends on**: T7, T8, T9
**Reuses**: `ProtectedRoute` (unchanged, still wraps `/`)
**Requirement**: NAV-01..05 (integration point)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `AppShell` renders `<Outlet/>` inside `<main>`
- [ ] `/` renders `WorkspaceListPage` (index), `/w/:workspaceId` renders `ProjectListPage`, `/w/:workspaceId/p/:projectId` renders `DiagramListPage`, all inside the existing `ProtectedRoute`
- [ ] `/w/:workspaceId/d/:diagramId` still renders bare `DiagramEditorPage` (no `AppShell` chrome) — unchanged
- [ ] New/updated `App.spec.tsx` asserts the right page renders per URL depth
- [ ] `repo-tools run audit` reflects the workspace/project/diagram routes as consumed (no longer `pending-product`)
- [ ] Full gate passes: `make lint && make typecheck && make test-unit`

**Tests**: unit (integration-style RTL)
**Gate**: full

**Commit**: `feat(web): wire nested workspace/project/diagram routes into AppShell`

---

## Phase Execution Map

Only real `Depends on` edges shown:

```
T1 → T7
T2 → T8
T2 → T9
T3 → T7
T3 → T8
T3 → T9
T4 → T7
T4 → T8
T4 → T9
T5 → T7
T5 → T8
T5 → T9
T6 → T7
T6 → T8
T6 → T9
T7 → T10
T8 → T10
T9 → T10
T7 → T11
T8 → T11
T9 → T11
```

T1-T6 have no incoming edges.

**Batching for sub-agent delegation** (11 tasks > ~8 → offer, already pre-authorized this session): Batch 1 = Phase 1 + Phase 2 (T1-T6, 6 tasks). Batch 2 = Phase 3 + Phase 4 (T7-T11, 5 tasks) — depends on Batch 1's outputs.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: `role` in workspace list | 2 files, 1 concept | ✅ Granular |
| T2: `role` in workspace detail | 2 files, 1 concept | ✅ Granular |
| T3: `resourceClient` | 1 file, 1 concept (parametrized, not 3 concepts) | ✅ Granular |
| T4: `resourceListStore` | 1 file | ✅ Granular |
| T5: `ConfirmArchiveDialog` | 1 component | ✅ Granular |
| T6: `nav` i18n keys | 2 files, 1 cohesive key block (locale pair) | ✅ Granular |
| T7: `WorkspaceListPage` | 1 component (+1 dependency line) | ✅ Granular |
| T8: `ProjectListPage` | 1 component | ✅ Granular |
| T9: `DiagramListPage` | 1 component | ✅ Granular |
| T10: a11y tests | 4 test files, 1 cohesive concern | ✅ Granular |
| T11: wire routing | 2 files, 1 cohesive integration | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | No incoming edge | ✅ Match |
| T2 | None | No incoming edge | ✅ Match |
| T3 | None | No incoming edge | ✅ Match |
| T4 | None | No incoming edge | ✅ Match |
| T5 | None | No incoming edge | ✅ Match |
| T6 | None | No incoming edge | ✅ Match |
| T7 | T1, T3, T4, T5, T6 | T1→T7, T3→T7, T4→T7, T5→T7, T6→T7 | ✅ Match |
| T8 | T2, T3, T4, T5, T6 | T2→T8, T3→T8, T4→T8, T5→T8, T6→T8 | ✅ Match |
| T9 | T2, T3, T4, T5, T6 | T2→T9, T3→T9, T4→T9, T5→T9, T6→T9 | ✅ Match |
| T10 | T7, T8, T9 | T7→T10, T8→T10, T9→T10 | ✅ Match |
| T11 | T7, T8, T9 | T7→T11, T8→T11, T9→T11 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ----------------------------- | ----------------- | ----------- | ------ |
| T1 | Server route | integration | integration | ✅ OK |
| T2 | Server route | integration | integration | ✅ OK |
| T3 | Client | unit | unit | ✅ OK |
| T4 | Store | unit | unit | ✅ OK |
| T5 | Component | unit | unit | ✅ OK |
| T6 | i18n JSON | none | none | ✅ OK |
| T7 | Component | unit | unit | ✅ OK |
| T8 | Component | unit | unit | ✅ OK |
| T9 | Component | unit | unit | ✅ OK |
| T10 | Accessibility | unit (axe) | unit | ✅ OK |
| T11 | Integration wiring | unit (integration-style RTL) | unit | ✅ OK |

---

## Tips

(carried from the skill template — not repeated here)
