# Workspace Navigation Validation

## Validation: workspace-navigation - PASS ✅ (round 2)

**Date**: 2026-08-16
**Spec**: `.specs/features/workspace-navigation/spec.md`
**Diff range**: `a332f8b^..HEAD` (`d070287..30fe7cf`) — 11 feature commits + 5 fix-round commits (`c9103aa`, `d215d57`, `c7fea3e`, `84bcdb3`, `30fe7cf`)
**Verifier**: independent sub-agent (author ≠ verifier)

> **Supersedes round 1** (verdict FAIL, 5 gaps: NAV-21 unimplemented; NAV-24/NAV-26 uncovered;
> NAV-18/NAV-25 half-asserted; 2 edge cases unasserted). All 26 ACs were re-derived fresh this
> round — not carried over — and the sensor was re-run from a clean scratch worktree with 8 new
> mutations, 5 of them aimed at the code the fix round introduced.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 — `role` in `GET /workspaces` | ✅ Done | Unchanged since round 1; integration-verified |
| T2 — `role` in `GET /workspaces/:id` | ✅ Done | Unchanged since round 1 |
| T3 — generic `resourceClient` | ✅ Done | Unchanged |
| T4 — generic `resourceListStore` | ✅ Done | Unchanged |
| T5 — `ConfirmArchiveDialog` | ✅ Done | Unchanged; irreversibility copy now asserted |
| T6 — `nav` i18n keys (pt-BR, en) | ✅ Done | +2 keys (`nav.{workspaces,projects}.archiveCurrent`); key sets re-verified identical |
| T7 — `WorkspaceListPage` | ✅ Done | Component unchanged; +4 tests |
| T8 — `ProjectListPage` | ✅ Done | NAV-21 archive-current-workspace control added |
| T9 — `DiagramListPage` | ✅ Done | NAV-21 archive-current-project control added |
| T10 — a11y tests | ✅ Done | axe layer unchanged; NAV-24/26 now carried by the page specs instead |
| T11 — nested routing wiring | ⚠️ Partial (disclosed) | Audit bullet's written deviation note re-confirmed accurate; unchanged this round |

All 11 tasks are marked `[x]` in `tasks.md`.

---

## Spec-Anchored Acceptance Criteria

### P1: Ver e navegar (NAV-01..05)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-01 — `/` lists `GET /workspaces`, each a link to `/w/:workspaceId` | each item renders as a link whose href is `/w/<id>` | `apps/web/src/nav/WorkspaceListPage.spec.tsx:93` — `expect(await screen.findByRole('link',{name:'Alpha'})).toHaveProperty('href', expect.stringContaining('/w/ws-1'))`; `:97` same for `ws-2` | ✅ PASS |
| NAV-02 — `/w/:workspaceId` lists `GET /projects?workspaceId=`, links to `/w/:wid/p/:pid`, shows workspace name | project links + current workspace name rendered | `apps/web/src/nav/ProjectListPage.spec.tsx:75` — `expect(await screen.findByText('Acme Workspace'))`; `:76` — `expect(getByRole('link',{name:'Project One'})).toHaveProperty('href', stringContaining('/w/ws-1/p/p-1'))` | ✅ PASS |
| NAV-03 — `/w/:wid/p/:pid` lists `GET /diagrams?projectId=`, links to `/w/:wid/d/:did`, shows project name | diagram links + current project name rendered | `apps/web/src/nav/DiagramListPage.spec.tsx:98` — `findByText('Project One')`; `:99` — `expect(getByRole('link',{name:'Diagram One'})).toHaveProperty('href', stringContaining('/w/ws-1/d/d-1'))` | ✅ PASS |
| NAV-04 — a `404` on the detail lookup shows "não existe ou sem acesso", never leaking the distinction | the single uniform message, identical for both causes | `apps/web/src/nav/ProjectListPage.spec.tsx:95` — `findByText('Este item não existe ou você não tem acesso a ele.')`; `:97` — `expect(fetchImpl).toHaveBeenCalledTimes(1)` (list never fetched); `apps/web/src/nav/DiagramListPage.spec.tsx:118` — same message | ✅ PASS |
| NAV-05 — every screen below `/` offers a path back one level | project page → `/`; diagram page → `/w/:workspaceId` | `apps/web/src/nav/ProjectListPage.spec.tsx:159-160` — click `link 'Voltar'` → `expect(getByTestId('workspace-list-page'))`; `apps/web/src/nav/DiagramListPage.spec.tsx:173-174` — → `expect(getByTestId('project-list-page'))` | ✅ PASS |

### P1: Criar (NAV-06..12)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-06 — workspace list always offers create, for any authenticated user | create action present regardless of list contents/role | `apps/web/src/nav/WorkspaceListPage.spec.tsx:146` — `expect(await findByRole('button',{name:'Criar workspace'}))` | ✅ PASS |
| NAV-07 — non-empty name → `POST /workspaces {name, slug}` (slug derived), navigate to `/w/:id` after `201` | exact body `{name:'New Workspace', slug:'new-workspace'}`; location `/w/ws-new` | `apps/web/src/nav/WorkspaceListPage.spec.tsx:171` — `expect(JSON.parse(init.body)).toEqual({name:'New Workspace', slug:'new-workspace'})`; `:188` — `expect(getByTestId('location').textContent).toBe('/w/ws-new')` | ✅ PASS |
| NAV-08 — `409` on create → conflict message, typed name preserved | conflict text shown, input still holds the typed value | `apps/web/src/nav/WorkspaceListPage.spec.tsx:204` — `expect((await findAllByText('Já existe um workspace com esse nome.')).length).toBe(2)`; `:205` — `expect(getByLabelText('Nome do workspace')).toHaveProperty('value','Dup')` | ✅ PASS |
| NAV-09 — project create offered only when the role grants `project:write` | shown for `editor`, absent for `viewer` | `apps/web/src/nav/ProjectListPage.spec.tsx:115` — `expect(getByRole('button',{name:'Criar projeto'}))` (editor); `:133` — `expect(queryByRole('button',{name:'Criar projeto'})).toBeNull()` (viewer) | ✅ PASS |
| NAV-10 — create project → `POST /projects {workspaceId, name}`, appears in list after `201` without reload | exact body; new row rendered in place | `apps/web/src/nav/ProjectListPage.spec.tsx:168` — `expect(JSON.parse(init.body)).toEqual({workspaceId:'ws-1', name:'New Project'})`; `:187` — `expect(await findByRole('link',{name:'New Project'}))` | ✅ PASS |
| NAV-11 — diagram create offered only when the role grants `diagram:write` | shown for `editor`, absent for `viewer` | `apps/web/src/nav/DiagramListPage.spec.tsx:133` / `:146` — `getByRole` vs `queryByRole(...).toBeNull()` for `'Criar diagrama'` | ✅ PASS |
| NAV-12 — create diagram → `POST /diagrams {projectId, title}`, navigate straight to the editor after `201` | exact body; location `/w/ws-1/d/d-new` | `apps/web/src/nav/DiagramListPage.spec.tsx:184` — `expect(JSON.parse(init.body)).toEqual({projectId:'p-1', title:'New Diagram'})`; `:202` — `expect(getByTestId('location').textContent).toBe('/w/ws-1/d/d-new')` | ✅ PASS |

### P1: Renomear (NAV-13..16)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-13 — rename shown at each level only where the role grants the level's write permission | present for a writing role, absent for `viewer` | `apps/web/src/nav/WorkspaceListPage.spec.tsx:121`/`:123` — per-item `within(adminItem).getByRole('button',{name:'Renomear'})` vs `within(viewerItem).queryByRole(...).toBeNull()`; `ProjectListPage.spec.tsx:113`/`:131`; `DiagramListPage.spec.tsx:131`/`:144` | ✅ PASS |
| NAV-14 — non-empty confirm → `PATCH` (`{name}`/`{title}`), reflect the new value only after `200`, never before | body shape per resource; list shows the new value only post-`200` | body: `apps/web/src/nav/resourceClient.spec.ts:122` — `expect(fetchImpl).toHaveBeenCalledWith(config.itemUrl('3'), objectContaining({method:'PATCH', body: JSON.stringify(config.renameBody('renamed'))}))` (run against all 3 configs); post-`200` commit: `WorkspaceListPage.spec.tsx:231-233` — `resolvePatch(...)` then `expect(await findByRole('link',{name:'Alpha 2'}))`. The "never before" half is defended transitively by the 409/403 tests (round-1 sensor M6), not by the mid-flight assertion at `:230` — see Code Quality note. | ✅ PASS |
| NAV-15 — workspace `PATCH` `409` → conflict message, previous value stays visible | conflict text; old name still the persisted value | `apps/web/src/nav/WorkspaceListPage.spec.tsx:251` — `expect(await row.findByText('Esse nome já está em uso.'))`; `:254` — after cancel, `expect(getByRole('link',{name:'Alpha'}))` | ✅ PASS |
| NAV-16 — any `PATCH` `403`/`404` → failure message, previous value kept, new name never shown as saved | generic failure text; old value restored | `apps/web/src/nav/WorkspaceListPage.spec.tsx:272`/`:274` (403); `ProjectListPage.spec.tsx:211`/`:213` (403); `DiagramListPage.spec.tsx:225`/`:227` (404) | ✅ PASS |

### P1: Arquivar (NAV-17..21)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-17 — archive shown only where the role grants the level's write permission | present for a writing role, absent for `viewer` | Row level: `apps/web/src/nav/WorkspaceListPage.spec.tsx:122`/`:124`; `ProjectListPage.spec.tsx:114`/`:132`; `DiagramListPage.spec.tsx:132`/`:145`. Container level: `ProjectListPage.spec.tsx:285`/`:297`; `DiagramListPage.spec.tsx:298`/`:308` | ✅ PASS |
| NAV-18 — explicit confirmation citing the item name **and** stating the action cannot be undone | both the name and the irreversibility warning shown | name: `apps/web/src/nav/ConfirmArchiveDialog.spec.tsx:77` — `expect(getByTestId('confirm-archive-item-name').textContent).toBe('Project Atlas')`; irreversibility: `ConfirmArchiveDialog.spec.tsx:132` — `expect(screen.getByText('Essa ação não pode ser desfeita.')).toBeTruthy()` (real rendered text, not a snapshot). Per-page name assertions: `WorkspaceListPage.spec.tsx:289`, `ProjectListPage.spec.tsx:231`/`:312`, `DiagramListPage.spec.tsx:246`/`:325` | ✅ PASS (round 1: ⚠️ half-covered) |
| NAV-19 — confirm → `DELETE`; after `204` the item leaves the list without a page reload | row disappears once `204` resolves | `apps/web/src/nav/WorkspaceListPage.spec.tsx:292` — `await waitFor(() => expect(queryByRole('link',{name:'Alpha'})).toBeNull())`; `ProjectListPage.spec.tsx:234`; `DiagramListPage.spec.tsx:249` | ✅ PASS |
| NAV-20 — `DELETE` `403`/`404` → failure message, item stays in the list | failure text announced; row still present | `apps/web/src/nav/WorkspaceListPage.spec.tsx:309` — `expect(getByTestId('workspace-announcement').textContent).toBe('Algo deu errado. Tente novamente.')`; `:313` — row still present. Container-level: `ProjectListPage.spec.tsx:333`/`:337`; `DiagramListPage.spec.tsx:348`/`:352` | ✅ PASS |
| NAV-21 — WHERE the archived item is the workspace/project currently being viewed, after `204` navigation goes up one level | archiving the current workspace from `/w/:wid` → `/`; the current project from `/w/:wid/p/:pid` → `/w/:wid` | **Implemented and covered.** Control + role gate: `apps/web/src/nav/ProjectListPage.tsx:246-250` (`{canWriteWorkspace && <button …>{t('nav.workspaces.archiveCurrent')}</button>}`, `canWriteWorkspace` = `can({role},'workspace:write',{workspaceId}).allowed` at `:133-135`) and `DiagramListPage.tsx:247-251` (`canWriteProject`, `project:write`, `:136-137`). DELETE targets the container: `ProjectListPage.tsx:212` — `await fetchImpl(\`/workspaces/${workspaceId}\`, {method:'DELETE'})`; `DiagramListPage.tsx:213` — `\`/projects/${projectId}\``. Navigation strictly post-`204`: both guard `if (response.status === 204) { closeDialog(); navigate(…) }` (`ProjectListPage.tsx:213-217`, `DiagramListPage.tsx:214-218`) — the `navigate` is downstream of the awaited response, never optimistic. Tests: gating `ProjectListPage.spec.tsx:285`/`:297` (admin sees it, `editor` — who *has* `project:write` — does not), `DiagramListPage.spec.tsx:298`/`:308`; nav-up `ProjectListPage.spec.tsx:315` — `await waitFor(() => expect(getByTestId('workspace-list-page')).toBeTruthy())` with the fetch mock accepting a `DELETE` only on `/workspaces/ws-1` (`:304`), `DiagramListPage.spec.tsx:328` — `expect(getByTestId('location').textContent).toBe('/w/ws-1')`; failure path `ProjectListPage.spec.tsx:333-337`, `DiagramListPage.spec.tsx:348-352` (announced failure, user stays put) | ✅ PASS (round 1: ❌ GAP) |

### P1: Primeiro acesso (NAV-22..23)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-22 — `{items: []}` → dedicated empty state with a prominent create CTA, not a generic empty list | dedicated copy + CTA label, and no list rendered | `apps/web/src/nav/WorkspaceListPage.spec.tsx:134` — `findByText('Você ainda não pertence a nenhum workspace.')`; `:135` — `getByRole('button',{name:'Criar seu primeiro workspace'})`; `:136` — `expect(queryByRole('list')).toBeNull()` | ✅ PASS |
| NAV-23 — creating from the empty state is the identical flow (same route, same result), no onboarding special-casing | same `POST /workspaces {name, slug}` + same `/w/:id` navigation as NAV-07 | `apps/web/src/nav/WorkspaceListPage.spec.tsx:186` — the create is driven from the empty-state CTA (`'Criar seu primeiro workspace'`) and asserts the same body at `:171` and the same navigation at `:188` | ✅ PASS |

### P2: Teclado e idioma (NAV-24..26)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| NAV-24 — every action (navigate, create, rename, archive, confirm) reachable by keyboard alone | each control is a focusable element the keyboard can land on | `apps/web/src/nav/WorkspaceListPage.spec.tsx:338-357` — for link / create / rename / archive / dialog-confirm: `el.focus(); expect(document.activeElement).toBe(el)`; `ProjectListPage.spec.tsx:248-275` — back link, project link, create, rename, row-archive, **archive-current-workspace**, dialog-confirm; `DiagramListPage.spec.tsx:261-288` — same set incl. **archive-current-project**; `ConfirmArchiveDialog.spec.tsx:117-127` — confirm + cancel. These are real focus assertions, not existence checks: sensor M4 (a `<span role="button">` that `getByRole` still finds, but jsdom refuses to focus) killed the `ProjectListPage` test. | ✅ PASS (round 1: ❌ GAP) |
| NAV-25 — create/rename/archive completion (success **or** failure) announced in an `aria-live="polite"` region | region attribute + result text on every list screen, both outcomes | `WorkspaceListPage.spec.tsx:371` — `expect(liveRegion.getAttribute('aria-live')).toBe('polite')`, `:376` — success text `'Arquivar'`, `:309` — failure text; `ProjectListPage.spec.tsx:373` — `aria-live` = `'polite'` on `project-announcement`, `:378` — success, `:333` — failure; `DiagramListPage.spec.tsx:386` — `aria-live` = `'polite'` on `diagram-announcement`, `:391` — success, `:348` — failure | ✅ PASS (round 1: ⚠️ 1 of 3 screens) |
| NAV-26 — all visible text from i18n keys, in `pt-BR` and `en`, no literal in the component | both locales complete; components render correctly in either | Genuine locale switch + English assertion on each page: `WorkspaceListPage.spec.tsx:384` — `await i18n.changeLanguage('en')`, `:387-389` — `getByRole('button',{name:'Create workspace'})` / `'Rename'` / `'Archive'`; `ProjectListPage.spec.tsx:350`, `:353-355` — `'Back'` / `'Create project'` / `'Archive this workspace'`; `DiagramListPage.spec.tsx:362`, `:365-367` — `'This project has no diagrams yet.'` / `'Create diagram'` / `'Archive this project'`. Each file restores `pt-BR` in `afterEach` (`:34`/`:34`/`:40`). Key-set parity re-verified programmatically: the 30 keys under `nav` are identical between `apps/web/src/i18n/locales/en/translation.json` and `.../pt-BR/translation.json` (zero en-only, zero pt-only). Sensor M5 (hardcoded pt-BR literals in place of two `t()` calls) killed the `DiagramListPage` locale test — the assertion is not a no-op. | ✅ PASS (round 1: ❌ GAP) |

**Status**: ✅ All 26 ACs covered and matched to their spec-defined outcome — 26/26 ✅ PASS, 0 spec-precision gaps, 0 gaps.

---

## Discrimination Sensor

Scratch: `git worktree add <scratchpad>/sensor-wt HEAD` (workspace `node_modules` symlinked in; never `git stash`). Baseline in scratch: **10 files / 99 tests passing** under `apps/web/src/nav/`. Each mutation was applied, run, then reverted with `git checkout -- .` inside the scratch before the next one.

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| M1 | `apps/web/src/nav/ProjectListPage.tsx:246` | **NAV-21 role gate removed**: `{canWriteWorkspace && (` → `{true && (` — the archive-current-workspace control renders for any role | ✅ Killed (1 failed: `offers "archive this workspace" only when the resolved role grants workspace:write (NAV-21)`) |
| M2 | `apps/web/src/nav/ProjectListPage.tsx:212-217` | **NAV-21 optimistic navigation**: `closeDialog(); navigate('/')` hoisted *above* the awaited `DELETE`, so nav fires before the response resolves | ✅ Killed (1 failed: `archiving the current workspace on 403/404 … keeps the user on the page`) |
| M3 | `apps/web/src/nav/DiagramListPage.tsx:213` | **NAV-21 wrong DELETE target**: `/projects/${projectId}` → `/workspaces/${workspaceId}` (archives the wrong container) | ✅ Killed (1 failed: `archiving the current project DELETEs /projects/:id and navigates to /w/:workspaceId on 204 (NAV-21)`) |
| M4 | `apps/web/src/nav/ProjectListPage.tsx:247-249` | **NAV-24 focusability**: native `<button>` → `<span role="button">` (still discoverable via `getByRole`, but not focusable) | ✅ Killed (1 failed: the `ProjectListPage` NAV-24 keyboard-focusable test) — proves the `.focus()`/`activeElement` assertions test focusability, not mere presence |
| M5 | `apps/web/src/nav/DiagramListPage.tsx:249, :258` | **NAV-26 i18n bypass**: two `t()` calls replaced with hardcoded pt-BR literals (pt-BR rendering unchanged) | ✅ Killed (1 failed: `renders in the en locale as well as pt-BR (NAV-26)`) — the locale test really switches locale |
| M6 | `apps/web/src/nav/ConfirmArchiveDialog.tsx:33` | **NAV-18 irreversibility copy**: `{t('nav.archiveConfirm.body')}` removed from the dialog body | ✅ Killed (1 failed: `states the action cannot be undone (NAV-18)`) |
| M7 | `apps/web/src/nav/ProjectListPage.tsx:140`, `DiagramListPage.tsx:142` | **Blank-name edge case**: both `if (!name) return;` / `if (!title) return;` guards deleted | ✅ Killed (2 failed: `never submits POST /projects …` + `never submits POST /diagrams …`) |
| M8 | `apps/web/src/nav/resourceListStore.ts:36` | **Last-workspace edge case**: `removeItem` additionally sets `status: 'error'`, so the post-archive render is the error branch instead of the zero-workspaces state | ✅ Killed (1 failed, and *only* that one: `archiving the only remaining workspace returns to the zero-workspaces empty state`) — confirms that test exercises the transition itself, not just the initial-load empty state |

**Sensor depth**: P0-full (8 mutations — 5 targeting the fix round's new NAV-21 code and the three
previously-uncovered ACs, 3 targeting the newly-claimed edge cases; role gating is the
security-relevant surface, so the ≥5 tier applies). Round 1's 6 mutations (M1-M6 there) all
remain valid; none of the code they targeted changed.

**Result**: 8/8 killed, 0 survived — the tests discriminate ✅

**Isolation verified**: `git status --porcelain` on the real worktree was empty before the sensor
and empty after `git worktree remove --force`. `git worktree list` shows only the real tree.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — the NAV-21 fix adds no new abstraction: an `ArchiveTarget` discriminated union reuses the *existing* `ConfirmArchiveDialog` + `archiveTarget` state rather than a second dialog, and the container `DELETE` goes through the page's already-present `fetchImpl` instead of bending `resourceClient`'s row-scoped config |
| Surgical changes | ✅ — 8 files touched in the fix round, all under `apps/web` (2 components, 4 spec files, 2 locale files). Server, routing, `resourceClient`, `resourceListStore` and `ConfirmArchiveDialog` untouched |
| No scope creep | ✅ — no restore path invented, no status/description/pagination added. One pre-existing dead key (`nav.error.forbidden`) still ships in both locales with no consumer — unchanged trivial dead weight, not a new defect |
| Matches patterns | ✅ — the container-archive control follows the same `can()`-gated conditional render as every other write action; the new tests follow the file's existing `mockFetch`/`LocationProbe`/`jsonResponse` helpers and the `i18n.changeLanguage` + `afterEach` restore precedent from `AiDock.spec.tsx` |
| Spec-anchored outcome check | ✅ — 26/26 assert the spec-defined outcome (round 1: 21/26) |
| Per-layer Coverage Expectation met | ✅ — the matrix's NAV-24..26 assignment to the axe layer is now satisfied in substance: axe still runs on all 4 surfaces, and NAV-24/NAV-26 are carried by explicit focus- and locale-assertions in the page specs, which is where they can actually be evidenced. The matrix row text (`tasks.md:29`) is now conservative rather than overstated |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — all 99 nav tests + the 5 `App.spec.tsx` routing tests trace to an AC, a listed edge case, or a Done-when bullet; every one of the 19 tests added this round names its AC in the test title |
| Documented guidelines followed | ✅ — `CLAUDE.md` (Node 22 for the gate; AD-008 no value-import of Excalidraw server-side — `apps/web` is client-side, unaffected) |
| Would a senior engineer approve? | ✅ — the two round-1 blockers are genuinely closed, and the fix is behavior-first (M1-M3 prove the new control is gated, targets the right resource, and never navigates optimistically) rather than test-only papering |

**Notes**
- `apps/web/src/nav/WorkspaceListPage.spec.tsx:230` — the mid-flight assertion
  `expect(queryByRole('link',{name:'Alpha'})).toBeNull() // in edit mode now` is unchanged from
  round 1 and still does not by itself prove "old value until 200" (the discriminating form would
  be asserting `'Alpha 2'` is *not yet* a link). Round-1 sensor M6 showed the behavior is
  nonetheless defended by the 409/403 tests, so this remains a readability/precision weakness, not
  an uncovered behavior. Not escalated to a gap in either round.
- **Accessible-name collision check (NAV-21 fix concern):** no collision. The container controls use
  distinct labels — `nav.workspaces.archiveCurrent` = "Arquivar este workspace" / "Archive this
  workspace" and `nav.projects.archiveCurrent` = "Arquivar este projeto" / "Archive this project" —
  against the row-level `nav.archive` = "Arquivar" / "Archive". Testing Library's string `name`
  matcher is exact-full-string, so `getByRole('button',{name:'Arquivar'})` resolves uniquely even on
  a page rendering both (`ProjectListPage.spec.tsx:264` and `:268` pick them apart in the same
  render). Both keys exist in both locale files.
- **Audit disclosure (T11) unchanged and still accurate** — the fix round touched no route-consuming
  call sites in a way the extractor could see (`ProjectListPage`/`DiagramListPage` still call
  `fetchImpl` with literal template strings), so `docs/route-inventory.md`'s consumed count and the
  written deviation note stand as verified in round 1. Not counted as a gap.

---

## Edge Cases

- [x] **Direct access to a non-member workspace/project → uniform `404` treatment, no leak.** `ProjectListPage.spec.tsx:95` + `:97` (list never fetched), `DiagramListPage.spec.tsx:118`. Round-1 sensor M4 confirms the assertion discriminates.
- [x] **Role revoked while the screen is open → a now-`403` write fails gracefully without breaking the screen.** `WorkspaceListPage.spec.tsx:272`, `ProjectListPage.spec.tsx:211` (403 on `PATCH`; message shown, page still interactive, previous value restored); container-level `403`: `ProjectListPage.spec.tsx:333-337` — announcement set and the page still renders its list state.
- [x] **Empty/whitespace-only name → no request emitted.** Now asserted at all three levels: `WorkspaceListPage.spec.tsx:163` — `expect(fetchImpl).toHaveBeenCalledTimes(1)`; `ProjectListPage.spec.tsx:396` — `toHaveBeenCalledTimes(2)` (the two initial GETs, never a POST); `DiagramListPage.spec.tsx:409` — `toHaveBeenCalledTimes(3)`. Sensor M7 killed both new tests when the guards were removed.
- [x] **Empty diagram list → simple empty state with the create action, not an error.** `DiagramListPage.spec.tsx:158` — `findByText('Este projeto ainda não tem diagramas.')`; `:159` — create button present; `:160` — no list rendered.
- [x] **Archiving the only workspace returns to the zero-workspaces state (with CTA), not a CTA-less empty list.** `WorkspaceListPage.spec.tsx:392-408` — starts from a one-item list, archives it through the dialog, then asserts `:405` `findByText('Você ainda não pertence a nenhum workspace.')`, `:406` `getByRole('button',{name:'Criar seu primeiro workspace'})`, `:407` `queryByRole('list')` is null. Sensor M8 confirms this test — and only this test — detects a broken post-archive transition, so it exercises the transition rather than the initial-load empty state.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (tasks.md "Full") — exit code **0**
- **Result**: **1030 passed, 0 failed, 0 skipped** across 13 packages
  - `@arch-canvas/web`: 25 files / **225** tests · `@arch-canvas/server`: 39 files / 395 tests · plus 11 other packages
- **Integration**: `pnpm --filter @arch-canvas/server run test:integration` — **346 passed,
  13 skipped, 3 files failed**. All 3 failures are the host-tooling gaps documented in `CLAUDE.md`,
  none of them in this feature's surface: `backup/restoreTest.int.spec.ts` (needs
  `pg_lsclusters`) and `ws-gateway/{presenceBroadcaster,crossInstancePresence}.int.spec.ts`
  (`Error: redis-server on port 27286 did not answer PING within 10000ms` — no `redis-server` on
  this host). The feature's own suite is green: `apps/server/src/modules/workspace/workspace.int.spec.ts`
  — **13 passed**, including `:199`/`:200` (`expect(itemA?.role).toBe('editor')` / `.toBe('viewer')`)
  and `:231` (`toMatchObject({… role: 'reviewer'})`). Server code is byte-identical to round 1's
  verification (`git diff 35ed0e9..HEAD` touches `apps/web` only).
- **Test count before this round**: 1011 unit
- **Test count after this round**: 1030 unit
- **Delta**: **+19 new tests**, all in the fix round's 4 spec files; no test deleted, no assertion weakened or loosened (verified against `git diff 35ed0e9..HEAD` — the diff is additive except for the 2 locale files gaining a key each)
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

None — all four round-1 fix plans are discharged:

| Round-1 fix | Status |
| ----------- | ------ |
| Fix 1 — NAV-21 archive-current-container + navigate up | ✅ Implemented (`c9103aa`) and sensor-confirmed (M1, M2, M3) |
| Fix 2 — NAV-24 keyboard reachability | ✅ Covered (`d215d57`) and sensor-confirmed (M4) |
| Fix 3 — NAV-26 both locales | ✅ Covered (`c7fea3e`) and sensor-confirmed (M5) |
| Fix 4 — NAV-18/NAV-25 + 2 edge cases | ✅ Covered (`84bcdb3`, `30fe7cf`) and sensor-confirmed (M6, M7, M8) |

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| NAV-01..NAV-17 | ✅ Verified | ✅ Verified (re-derived fresh) |
| NAV-18 | ✅ Verified (⚠️ parcial) | ✅ Verified |
| NAV-19, NAV-20 | ✅ Verified | ✅ Verified |
| NAV-21 | ❌ Needs Fix | ✅ Verified |
| NAV-22, NAV-23 | ✅ Verified | ✅ Verified |
| NAV-24 | ❌ Needs Fix | ✅ Verified |
| NAV-25 | ✅ Verified (⚠️ parcial) | ✅ Verified |
| NAV-26 | ❌ Needs Fix | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 26/26 ACs matched the spec-defined outcome; 0 spec-precision gaps
**Sensor**: 8/8 mutations killed
**Gate**: 1030 passed, 0 failed

**What works**: Everything round 1 confirmed, plus the five gaps it opened. NAV-21 is now a real
behavior, not a test: `ProjectListPage` offers "Arquivar este workspace" only to a role holding
`workspace:write` (an `editor` — who *can* archive project rows — is explicitly asserted not to see
it), issues `DELETE /workspaces/:id` against the container itself, and lands on `/` strictly after
the `204` resolves; `DiagramListPage` mirrors this with `project:write`, `DELETE /projects/:id`, and
`/w/:workspaceId`. On `403`/`404` both stay put and announce the failure. Keyboard reachability is
asserted by real focus checks that a `role="button"` `<span>` cannot pass; both nav locales are
exercised by an actual `changeLanguage('en')` with English assertions; the archive dialog's
irreversibility sentence, the `aria-live` region on all three screens, the blank-name guards on
`POST /projects` and `POST /diagrams`, and the archive-the-last-workspace → zero-workspaces
transition are each covered by an assertion the sensor proved discriminating.

**Issues found**: none blocking. Two carried, non-blocking notes: the mid-flight rename assertion at
`WorkspaceListPage.spec.tsx:230` remains imprecise (behavior itself defended transitively), and
`nav.error.forbidden` is still a consumer-less key in both locales.

**Next steps**: Feature is done. Close the wave; route the two carried notes to a future cleanup task
only if the team wants them, and keep the T11 route-inventory extractor limitation on the
`repo-tools` follow-up list as already disclosed.
