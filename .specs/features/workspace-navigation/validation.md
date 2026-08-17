# Workspace Navigation Validation

## Validation: workspace-navigation - FAIL ❌

**Date**: 2026-08-16
**Spec**: `.specs/features/workspace-navigation/spec.md`
**Diff range**: `a332f8b^..HEAD` (`d070287..ed63220`) — 11 feature commits + 1 spec-docs commit, no other feature's commits interleaved
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 — `role` in `GET /workspaces` | ✅ Done | All 4 "Done when" boxes checked; integration-verified |
| T2 — `role` in `GET /workspaces/:id` | ✅ Done | - |
| T3 — generic `resourceClient` | ✅ Done | Parametrization proven against 3 real configs |
| T4 — generic `resourceListStore` | ✅ Done | - |
| T5 — `ConfirmArchiveDialog` | ✅ Done | - |
| T6 — `nav` i18n keys (pt-BR, en) | ✅ Done | Key sets verified identical between locales |
| T7 — `WorkspaceListPage` | ✅ Done | - |
| T8 — `ProjectListPage` | ✅ Done | Archive scoped to child rows only — see NAV-21 |
| T9 — `DiagramListPage` | ✅ Done | Archive scoped to child rows only — see NAV-21 |
| T10 — a11y tests | ✅ Done | axe-only; no keyboard-reachability assertion — see NAV-24 |
| T11 — nested routing wiring | ⚠️ Partial (disclosed) | Audit bullet self-declared PARTIAL with a written deviation note; verified accurate below |

All 11 tasks are marked `[x]` in `tasks.md`.

---

## Spec-Anchored Acceptance Criteria

### P1: Ver e navegar (NAV-01..05)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-01 — `/` lists `GET /workspaces`, each a link to `/w/:workspaceId` | each item renders as a link whose href is `/w/<id>` | `apps/web/src/nav/WorkspaceListPage.spec.tsx:89` — `expect(await screen.findByRole('link', {name:'Alpha'})).toHaveProperty('href', expect.stringContaining('/w/ws-1'))` | ✅ PASS |
| NAV-02 — `/w/:workspaceId` lists `GET /projects?workspaceId=`, links to `/w/:wid/p/:pid`, shows workspace name | project links + current workspace name rendered | `apps/web/src/nav/ProjectListPage.spec.tsx:71` — `expect(await screen.findByText('Acme Workspace'))`; `:72` — `expect(getByRole('link',{name:'Project One'})).toHaveProperty('href', stringContaining('/w/ws-1/p/p-1'))` | ✅ PASS |
| NAV-03 — `/w/:wid/p/:pid` lists `GET /diagrams?projectId=`, links to `/w/:wid/d/:did`, shows project name | diagram links + current project name rendered | `apps/web/src/nav/DiagramListPage.spec.tsx:94` — `findByText('Project One')`; `:95` — `expect(getByRole('link',{name:'Diagram One'})).toHaveProperty('href', stringContaining('/w/ws-1/d/d-1'))` | ✅ PASS |
| NAV-04 — a `404` on the detail lookup shows "não existe ou sem acesso", never leaking the distinction | the single uniform message, identical for both causes | `apps/web/src/nav/ProjectListPage.spec.tsx:91` — `findByText('Este item não existe ou você não tem acesso a ele.')`; `:93` — `expect(fetchImpl).toHaveBeenCalledTimes(1)` (list never fetched); `apps/web/src/nav/DiagramListPage.spec.tsx:114` — same message | ✅ PASS |
| NAV-05 — every screen below `/` offers a path back one level | project page → `/`; diagram page → `/w/:workspaceId` | `apps/web/src/nav/ProjectListPage.spec.tsx:155` — click `link 'Voltar'` → `expect(getByTestId('workspace-list-page'))`; `apps/web/src/nav/DiagramListPage.spec.tsx:169` — → `expect(getByTestId('project-list-page'))` | ✅ PASS |

### P1: Criar (NAV-06..12)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-06 — workspace list always offers create, for any authenticated user | create action present regardless of list contents/role | `apps/web/src/nav/WorkspaceListPage.spec.tsx:142` — `expect(await findByRole('button',{name:'Criar workspace'}))` | ✅ PASS |
| NAV-07 — non-empty name → `POST /workspaces {name, slug}` (slug derived), navigate to `/w/:id` after `201` | exact body `{name:'New Workspace', slug:'new-workspace'}`; location `/w/ws-new` | `apps/web/src/nav/WorkspaceListPage.spec.tsx:167` — `expect(JSON.parse(init.body)).toEqual({name:'New Workspace', slug:'new-workspace'})`; `:184` — `expect(getByTestId('location').textContent).toBe('/w/ws-new')` | ✅ PASS |
| NAV-08 — `409` on create → conflict message, typed name preserved | conflict text shown, input still holds the typed value | `apps/web/src/nav/WorkspaceListPage.spec.tsx:200` — `expect((await findAllByText('Já existe um workspace com esse nome.')).length).toBe(2)`; `:201` — `expect(getByLabelText('Nome do workspace')).toHaveProperty('value','Dup')` | ✅ PASS |
| NAV-09 — project create offered only when the role grants `project:write` | shown for `editor`, absent for `viewer` | `apps/web/src/nav/ProjectListPage.spec.tsx:111` — `expect(getByRole('button',{name:'Criar projeto'}))` (editor); `:129` — `expect(queryByRole('button',{name:'Criar projeto'})).toBeNull()` (viewer) | ✅ PASS |
| NAV-10 — create project → `POST /projects {workspaceId, name}`, appears in list after `201` without reload | exact body; new row rendered in place | `apps/web/src/nav/ProjectListPage.spec.tsx:164` — `expect(JSON.parse(init.body)).toEqual({workspaceId:'ws-1', name:'New Project'})`; `:183` — `expect(await findByRole('link',{name:'New Project'}))` | ✅ PASS |
| NAV-11 — diagram create offered only when the role grants `diagram:write` | shown for `editor`, absent for `viewer` | `apps/web/src/nav/DiagramListPage.spec.tsx:129` / `:142` — `getByRole` vs `queryByRole(...).toBeNull()` for `'Criar diagrama'` | ✅ PASS |
| NAV-12 — create diagram → `POST /diagrams {projectId, title}`, navigate straight to the editor after `201` | exact body; location `/w/ws-1/d/d-new` | `apps/web/src/nav/DiagramListPage.spec.tsx:180` — `expect(JSON.parse(init.body)).toEqual({projectId:'p-1', title:'New Diagram'})`; `:198` — `expect(getByTestId('location').textContent).toBe('/w/ws-1/d/d-new')` | ✅ PASS |

### P1: Renomear (NAV-13..16)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-13 — rename shown at each level only where the role grants the level's write permission | present for a writing role, absent for `viewer` | `apps/web/src/nav/WorkspaceListPage.spec.tsx:117`/`:119` — per-item: `within(adminItem).getByRole('button',{name:'Renomear'})` vs `within(viewerItem).queryByRole(...).toBeNull()`; `ProjectListPage.spec.tsx:109`/`:127`; `DiagramListPage.spec.tsx:127`/`:140` | ✅ PASS |
| NAV-14 — non-empty confirm → `PATCH` (`{name}`/`{title}`), reflect the new value only after `200`, never before | body shape per resource; list shows the new value only post-`200` | body: `apps/web/src/nav/resourceClient.spec.ts:122` — `expect(fetchImpl).toHaveBeenCalledWith(config.itemUrl('3'), objectContaining({method:'PATCH', body: JSON.stringify(config.renameBody('renamed'))}))` (run for `{name}` and `{title}` configs); post-`200` commit: `WorkspaceListPage.spec.tsx:229` — `expect(await findByRole('link',{name:'Alpha 2'}))`. The "never before" half is defended transitively (sensor M6: an optimistic commit is killed by the 409/403 tests), though the mid-flight assertion at `:226` is itself weak — see Code Quality note. | ✅ PASS |
| NAV-15 — workspace `PATCH` `409` → conflict message, previous value stays visible | conflict text; old name still the persisted value | `apps/web/src/nav/WorkspaceListPage.spec.tsx:247` — `expect(await row.findByText('Esse nome já está em uso.'))`; `:250` — after cancel, `expect(getByRole('link',{name:'Alpha'}))` | ✅ PASS |
| NAV-16 — any `PATCH` `403`/`404` → failure message, previous value kept, new name never shown as saved | generic failure text; old value restored | `apps/web/src/nav/WorkspaceListPage.spec.tsx:268`/`:270` (403); `ProjectListPage.spec.tsx:207`/`:209` (403); `DiagramListPage.spec.tsx:221`/`:223` (404) | ✅ PASS |

### P1: Arquivar (NAV-17..21)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-17 — archive shown only where the role grants the level's write permission | present for a writing role, absent for `viewer` | `apps/web/src/nav/WorkspaceListPage.spec.tsx:118`/`:120`; `ProjectListPage.spec.tsx:110`/`:128`; `DiagramListPage.spec.tsx:128`/`:141` — all on `button 'Arquivar'` | ✅ PASS |
| NAV-18 — explicit confirmation citing the item name **and** stating the action cannot be undone | both the name and the irreversibility warning shown | name: `apps/web/src/nav/ConfirmArchiveDialog.spec.tsx:77` — `expect(getByTestId('confirm-archive-item-name').textContent).toBe('Project Atlas')`, also `WorkspaceListPage.spec.tsx:285`, `ProjectListPage.spec.tsx:227`, `DiagramListPage.spec.tsx:242`. Irreversibility half: rendered at `apps/web/src/nav/ConfirmArchiveDialog.tsx:33` (`t('nav.archiveConfirm.body')` = "Essa ação não pode ser desfeita.") but **no test asserts that text**. | ⚠️ Spec-precision gap (half-covered) |
| NAV-19 — confirm → `DELETE`; after `204` the item leaves the list without a page reload | row disappears once `204` resolves | `apps/web/src/nav/WorkspaceListPage.spec.tsx:288` — `await waitFor(() => expect(queryByRole('link',{name:'Alpha'})).toBeNull())`; `ProjectListPage.spec.tsx:230`; `DiagramListPage.spec.tsx:245` | ✅ PASS |
| NAV-20 — `DELETE` `403`/`404` → failure message, item stays in the list | failure text announced; row still present | `apps/web/src/nav/WorkspaceListPage.spec.tsx:305` — `expect(getByTestId('workspace-announcement').textContent).toBe('Algo deu errado. Tente novamente.')`; `:309` — `expect(getByRole('link',{name:'Alpha'}))` | ✅ PASS |
| NAV-21 — WHERE the archived item is the workspace/project currently being viewed, after `204` navigation goes up one level | archiving the current workspace from `/w/:wid` → `/`; the current project from `/w/:wid/p/:pid` → `/w/:wid` | **No evidence — behavior not implemented.** `apps/web/src/nav/ProjectListPage.tsx:259` only wires `requestArchive` to per-row project items inside `items.map(...)`; there is no archive control for the *current* workspace anywhere on the page. `apps/web/src/nav/DiagramListPage.tsx:262` is the same shape for diagram rows — no archive control for the current project. Neither page calls `useNavigate` for an archive outcome (`DiagramListPage.tsx:139` is the only `navigate(...)`, and it is the create flow). | ❌ GAP |

### P1: Primeiro acesso (NAV-22..23)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-22 — `{items: []}` → dedicated empty state with a prominent create CTA, not a generic empty list | dedicated copy + CTA label, and no list rendered | `apps/web/src/nav/WorkspaceListPage.spec.tsx:130` — `findByText('Você ainda não pertence a nenhum workspace.')`; `:131` — `getByRole('button',{name:'Criar seu primeiro workspace'})`; `:132` — `expect(queryByRole('list')).toBeNull()` | ✅ PASS |
| NAV-23 — creating from the empty state is the identical flow (same route, same result), no onboarding special-casing | same `POST /workspaces {name, slug}` + same `/w/:id` navigation as NAV-07 | `apps/web/src/nav/WorkspaceListPage.spec.tsx:177` — the create is driven from the empty-state CTA (`'Criar seu primeiro workspace'`) and asserts the same body at `:167` and the same navigation at `:184` | ✅ PASS |

### P2: Teclado e idioma (NAV-24..26)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-24 — every action (navigate, create, rename, archive, confirm) reachable by keyboard alone | tab-reachability of each action asserted | **No evidence.** The 4 `*.a11y.spec.tsx` files run `axe()` only (`WorkspaceListPage.a11y.spec.tsx:62`, `ProjectListPage.a11y.spec.tsx`, `DiagramListPage.a11y.spec.tsx`, `ConfirmArchiveDialog.a11y.spec.tsx:60`), which does not assert keyboard reachability. Implementation is structurally sound (every control is a native `<button>`/`<a>`/`<input>`; the dialog is a native `<dialog>`), but no assertion targets the AC. The repo already has the right pattern — `apps/web/src/ai-dock/AiDock.spec.tsx` covers DOCK-21 that way. | ❌ GAP |
| NAV-25 — create/rename/archive completion (success **or** failure) announced in an `aria-live="polite"` region | region attribute + result text on every list screen | `apps/web/src/nav/WorkspaceListPage.spec.tsx:338` — `expect(liveRegion.getAttribute('aria-live')).toBe('polite')`; `:343` — success text; `:305` — failure text. `ProjectListPage.tsx:216` and `DiagramListPage.tsx:219` render the same region and set the same announcements, but **no test asserts either**. | ⚠️ Spec-precision gap (1 of 3 screens asserted) |
| NAV-26 — all visible text from i18n keys, in `pt-BR` and `en`, no literal in the component | both locales complete; component renders in either | **No test evidence.** Verified by inspection: key sets under `nav` are identical in `apps/web/src/i18n/locales/en/translation.json` and `.../pt-BR/translation.json`, and the 4 components contain no visible-text literal. But every nav spec asserts pt-BR only — none calls `i18n.changeLanguage('en')`, and there is no locale-parity test. The repo's own precedent does this at `apps/web/src/ai-dock/AiDock.spec.tsx:692-698`. | ❌ GAP |

**Status**: ❌ Gaps present — 21/26 ✅ PASS, 2 ⚠️ spec-precision gaps (NAV-18, NAV-25), 3 ❌ gaps (NAV-21 unimplemented; NAV-24, NAV-26 uncovered).

---

## Discrimination Sensor

Scratch: `git worktree add <scratchpad>/sensor-wt HEAD` (and a second `sensor-wt2` for M6). Never `git stash`. Baseline in scratch: 11 files / 88 tests passing.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| M1 | `apps/web/src/nav/ProjectListPage.tsx:121` | Role gate removed: `can({role}, 'project:write', ...).allowed` → `true` (viewer would see write actions) | ✅ Killed (1 failed: "hides create/rename/archive … (viewer)") |
| M2 | `apps/web/src/nav/DiagramListPage.tsx:127` | Role gate removed: `can({role}, 'diagram:write', ...).allowed` → `true` | ✅ Killed (1 failed: "shows create/rename/archive only when … (editor vs viewer)") |
| M3 | `apps/web/src/nav/WorkspaceListPage.tsx:176` | Zero-workspaces gate disabled: `status === 'ready' && items.length === 0` → `false` | ✅ Killed (4 failed, incl. NAV-22) |
| M4 | `apps/web/src/nav/ProjectListPage.tsx:207` | 404 message leaks the existence distinction: `t('nav.notFound')` → "Workspace exists but you do not have access to it." | ✅ Killed (1 failed: NAV-04) |
| M5 | `apps/web/src/nav/resourceClient.ts:90` | `create()` 409 branch removed — conflict collapses into the generic error | ✅ Killed (4 failed: 3 × parametrized `resourceClient` + NAV-08) |
| M6 | `apps/web/src/nav/WorkspaceListPage.tsx:133` | Optimistic rename: `replaceItem` + `setRenamingId(null)` moved *before* awaiting the `PATCH` (probes NAV-14's "nunca antes") | ✅ Killed (2 failed: NAV-15, NAV-16) |

**Sensor depth**: P0-full (6 mutations — the role gates are the security-relevant surface, so the ≥5 tier was used)
**Sensor outcome**: 6/6 killed, 0 survived — the tests discriminate ✅

**Isolation verified**: `git status --porcelain` on the real worktree was empty before the sensor and empty after both worktrees were removed with `git worktree remove --force`. `git worktree list` shows only the real tree.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — one generic client/store shared by 3 pages instead of 3 copies; server change is a projected column, no new query |
| Surgical changes | ✅ — `AppShell` change is exactly `<main />` → `<main><Outlet/></main>`; the editor route is untouched |
| No scope creep | ✅ — status/description/pagination correctly left out per Out of Scope. One unused key (`nav.error.forbidden`) ships in both locales with no consumer — trivial dead weight, not a defect |
| Matches patterns | ✅ — `fetchImpl` injection mirrors `syncClient`/`aiDockClient`; store mirrors `createSaveStatusStore`; a11y specs mirror `shell.a11y.spec.tsx`; native `<dialog>` follows the "nativo antes de widget customizado" convention |
| Spec-anchored outcome check | ⚠️ — 21/26 assert the spec-defined outcome; NAV-18 and NAV-25 assert only part of it; NAV-24/NAV-26 assert none of it |
| Per-layer Coverage Expectation met | ⚠️ — server route, client, store, dialog and routing layers meet the matrix; the a11y layer does not deliver NAV-24..26 as the matrix claims (`tasks.md:29` says "Zero serious/critical violations per surface; NAV-24..26" — axe alone cannot evidence NAV-24 or NAV-26) |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — all 88 nav/App tests trace to an AC, a listed edge case, or a Done-when bullet |
| Documented guidelines followed | ✅ — `CLAUDE.md` (Node 22, gate commands, AD-008 no value-import of Excalidraw server-side: `apps/web` is client-side, unaffected) |
| Would a senior engineer approve? | ⚠️ — yes on structure and the server change; the NAV-21 omission and the two untested P2 ACs would come back in review |

**Notes**
- `apps/web/src/nav/WorkspaceListPage.spec.tsx:226` — the mid-flight assertion `expect(queryByRole('link',{name:'Alpha'})).toBeNull()` is labelled "in edit mode now" and therefore does **not** prove "old value until 200"; the discriminating assertion would be that `'Alpha 2'` is *not* yet a link. The sensor (M6) shows the behavior is nonetheless defended by the 409/403 tests, so this is a readability/precision weakness, not an uncovered behavior.
- **Audit disclosure verified accurate.** `pnpm --filter @arch-canvas/repo-tools run audit` re-run independently: `89 routes, 14 consumed, 75 pending-product`, and `docs/route-inventory.md:22-27` lists `GET/PATCH/DELETE /projects/:id` and `GET/PATCH/DELETE /workspaces/:id` as consumed by `ProjectListPage.tsx`/`DiagramListPage.tsx`. The remaining 8 (`GET/POST /workspaces`, `GET/POST /projects`, `GET/POST /diagrams`, `PATCH/DELETE /diagrams/:id`) are driven only through `resourceClient`'s `config.listUrl`-style property access, which the static extractor cannot resolve — the same pre-existing class of tool limitation as `AuthProvider.tsx`'s `/me`. Accepted as disclosed in `tasks.md`'s T11 deviation note; **not** counted as a gap. The audit run left the tree clean (route-inventory.md already committed at that content).

---

## Edge Cases

- [x] **Direct access to a non-member workspace/project → uniform `404` treatment, no leak.** `ProjectListPage.spec.tsx:91`, `DiagramListPage.spec.tsx:114`. Sensor M4 confirms the assertion discriminates.
- [x] **Role revoked while the screen is open → a now-`403` write fails gracefully without breaking the screen.** `WorkspaceListPage.spec.tsx:268`, `ProjectListPage.spec.tsx:207` (403 on `PATCH`; message shown, page still interactive, previous value restored).
- [⚠️] **Empty/whitespace-only name → no request emitted.** Asserted for workspaces only: `WorkspaceListPage.spec.tsx:159` — `expect(fetchImpl).toHaveBeenCalledTimes(1)` (the initial GET, never a POST). The spec's edge case names `POST /projects` **and** `POST /diagrams`; both are guarded in code (`ProjectListPage.tsx:127`, `DiagramListPage.tsx:131`) but neither has a test.
- [x] **Empty diagram list → simple empty state with the create action, not an error.** `DiagramListPage.spec.tsx:154` — `findByText('Este projeto ainda não tem diagramas.')`; `:155` — create button present; `:156` — no list rendered.
- [ ] **Archiving the only workspace returns to the zero-workspaces state (with CTA), not a CTA-less empty list.** Not asserted. `WorkspaceListPage.spec.tsx:288` asserts only that the row disappears; nothing asserts the dedicated empty state re-appears afterwards. The code path does reach it (`removeItem` → `items.length === 0` → `showEmptyState`, `WorkspaceListPage.tsx:176`), so this is a coverage gap rather than a behavior gap.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (tasks.md "Full"), plus `make test-integration` attempted for the Build gate
- **Result**: **1011 passed, 0 failed, 0 skipped** across 13 packages — exit code 0
  - `@arch-canvas/web`: 25 files / 206 tests · `@arch-canvas/server`: 39 files / 395 tests · plus 11 other packages
- **Integration**: `make test-integration` exits non-zero for the **documented environment reason only** — `@arch-canvas/backup > src/incremental.int.spec.ts` fails with `Error: spawnSync pg_lsclusters ENOENT` (the exact host-tooling gap recorded in `CLAUDE.md`), which aborted the rest of the turbo run (exit 130 propagation). Re-run in isolation, the feature's own integration suite is green: `apps/server/src/modules/workspace/workspace.int.spec.ts` — **13 passed**, including both NAV role tests (`workspace.int.spec.ts:199` — `expect(itemA?.role).toBe('editor')` / `:200` — `.toBe('viewer')`; `:229` — `expect(response.json().workspace).toMatchObject({id: workspaceId, role: 'reviewer'})`).
- **Test count before feature**: 923 unit (1011 − 88 new nav/App tests)
- **Test count after feature**: 1011 unit
- **Delta**: +88 new tests; no test deleted, no assertion weakened
- **Skipped tests**: none in the unit gate
- **Failures**: none in the mandated gate

---

## Fix Plans

### Fix 1: NAV-21 — no archive action for the container currently being viewed

- **Root cause**: T7-T9 each scoped archive to *rows in the list* (children). `ProjectListPage` archives projects, never the workspace it is showing; `DiagramListPage` archives diagrams, never the project it is showing. NAV-21's "subir um nível" behavior therefore has no trigger anywhere in the app — it was not descoped in `tasks.md`, it was simply never given a task.
- **Fix task**: Add a page-level archive action for the current container to `ProjectListPage` (archives `:workspaceId`, gated on `workspace:write`) and `DiagramListPage` (archives `:projectId`, gated on `project:write`), each routed through `ConfirmArchiveDialog` and, after `204`, `navigate('/')` / `navigate('/w/:workspaceId')` respectively. Tests: confirm-then-`204` lands on the parent route (assert via a `LocationProbe`), and a `403`/`404` keeps the user on the page with the failure announced (NAV-20 still applies).
- **Priority**: Major

### Fix 2: NAV-24 — keyboard reachability never asserted

- **Root cause**: The matrix (`tasks.md:29`) assigned NAV-24..26 to the axe a11y layer, but axe checks static a11y properties, not tab reachability.
- **Fix task**: Add a keyboard-reachability test per page (navigate, create, rename, archive, confirm all reached with Tab/Enter, no mouse), following `apps/web/src/ai-dock/AiDock.spec.tsx`'s DOCK-21 precedent.
- **Priority**: Minor (implementation uses native controls throughout; the risk is regression, not current breakage)

### Fix 3: NAV-26 — no test renders the nav surfaces in `en`

- **Root cause**: Every nav spec asserts pt-BR strings only; no locale switch and no key-parity assertion.
- **Fix task**: Add one locale test (switch to `en` via `i18n.changeLanguage('en')` and assert an `en` label on each page), or a locale key-parity test over the two `translation.json` files. Precedent: `apps/web/src/ai-dock/AiDock.spec.tsx:692-698`.
- **Priority**: Minor

### Fix 4: NAV-18 / NAV-25 / edge cases — partial assertions

- **Root cause**: Assertions stop at the first half of the criterion.
- **Fix task**: (a) assert the irreversibility copy in `ConfirmArchiveDialog.spec.tsx`, not just the item name; (b) assert the `aria-live` region + announcement on `ProjectListPage`/`DiagramListPage`, not only `WorkspaceListPage`; (c) assert the no-request-on-blank-name guard for `POST /projects` and `POST /diagrams`; (d) assert the zero-workspaces empty state re-appears after archiving the last workspace.
- **Priority**: Minor

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| NAV-01..NAV-17 | Pending | ✅ Verified |
| NAV-18 | Pending | ✅ Verified (⚠️ partial assertion — irreversibility copy unasserted) |
| NAV-19, NAV-20 | Pending | ✅ Verified |
| NAV-21 | Pending | ❌ Needs Fix |
| NAV-22, NAV-23 | Pending | ✅ Verified |
| NAV-24 | Pending | ❌ Needs Fix |
| NAV-25 | Pending | ✅ Verified (⚠️ partial — 1 of 3 screens asserted) |
| NAV-26 | Pending | ❌ Needs Fix |

---

## Summary

**Overall**: ❌ Not Ready

**Spec-anchored check**: 21/26 ACs matched the spec-defined outcome; 2 spec-precision gaps; 3 gaps
**Sensor**: 6/6 mutations killed
**Gate**: 1011 passed, 0 failed

**What works**: The whole `/` → `/w/:id` → `/w/:id/p/:id` → editor path navigates by click, with correct links at every level. The additive server `role` field is integration-verified per-workspace (a user who is `editor` in A and `viewer` in B sees both values distinctly). Role gating on create/rename/archive is real and discriminating — the sensor confirms an under-privileged role cannot be shown a write action by accident on any of the three pages. The `404` "not found or no access" message is uniform and sensor-confirmed non-leaking. Create/rename/archive each branch correctly on `201`/`200`/`204`/`409`/`403`/`404`, never committing optimistically. The zero-workspaces empty state and the empty-project state both work as specified.

**Issues found**:
1. NAV-21 is unimplemented — no archive action exists for the workspace/project currently being viewed, so the "navigate up one level after `204`" behavior has no trigger (Fix 1).
2. NAV-24 (keyboard reachability) and NAV-26 (both locales) have zero test evidence; the axe a11y layer was assigned to cover them but structurally cannot (Fix 2, Fix 3).
3. NAV-18, NAV-25 and two edge cases are half-asserted (Fix 4).

**Next steps**: Route Fix 1 (Major) and Fixes 2-4 (Minor) back to an implementer as fix tasks, then re-verify. Round 1 of a maximum of 3.
