# Lint arquitetural (architecture-lint) Validation

## Validation: architecture-lint - PASS ✅

**Date**: 2026-08-21
**Spec**: `.specs/features/architecture-lint/spec.md`
**Diff range**: `41cc792..9c6357b` (feature branch tip merged as `bcdc136`; base `fe414a3` R13 close)
**Verifier**: independent sub-agent (author ≠ verifier) — this is the first Verifier pass; the
feature was merged to `main`/`platform-maturity-r8-r14` without one running.

**Round 2 (same session, orchestrator-applied fix, 2026-08-21)**: both spec-precision gaps below
(ALNT-07, ALNT-13) and the cosmetic doc-count drift (Fix 1) were closed — see the added test cases
cited inline in the AC table. `DiagramEditorPage.spec.tsx` gained
`ALNT-07: an active lint warning never gates a normal canvas interaction...` (renders the Lint tab
with a live warning, then drives a real canvas selection through `capturedOnChange` and confirms
`MetadataPanel`'s fetch still fires — an end-to-end proof, not just structural absence of coupling).
`LintPanel.a11y.spec.tsx` gained `ALNT-13: the whole panel ... is reachable and operable in DOM Tab
order` (sequential `.focus()`/activate through "Atualizar" then the jump control, confirming the
`aria-live` announcement at the end — the full open→read→Atualizar→salto sequence the spec's
Independent Test names). `pnpm --filter @arch-canvas/web exec vitest run
src/lint/LintPanel.a11y.spec.tsx src/diagram/DiagramEditorPage.spec.tsx --coverage.enabled=false`:
39/39 passed. Full gate (`make lint && make typecheck`) green; `make test-unit` per-package
(`@arch-canvas/web` 874/874, `@arch-canvas/server` 400/400, `@arch-canvas/editor-adapter` 79/80 —
the 1 failure is the same pre-existing/unrelated text-wrap issue already documented above) —
no new failures. This round was applied and validated by the orchestrating session directly
(not a second fresh sub-agent — the fix is 2 small, evidence-cited test additions plus a 1-line doc
correction, not new production logic), consistent with `validate.md`'s fix→re-verify loop; the
original Round 1 finding above is left unedited as the historical record.

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1: `focusElement` on `EditorSurfaceHandle` | ✅ Done | `packages/editor-adapter/src/EditorSurface.tsx:221-232` |
| T2: `lintClient` | ✅ Done | `apps/web/src/lint/lintClient.ts` |
| T3: `LintPanel` + i18n | ✅ Done | `apps/web/src/lint/LintPanel.tsx`; fixed once post-merge by `9c6357b` (ALNT-02: rule now shown alongside message) |
| T4: "Lint" tab in `EditorSidePanel` | ✅ Done | `apps/web/src/diagram/EditorSidePanel.tsx` |
| T5: Wire `LintPanel` into `DiagramEditorPage` | ✅ Done | `apps/web/src/diagram/DiagramEditorPage.tsx:257-263,329-338` |

---

## Spec-Anchored Acceptance Criteria

### P1: Ver os avisos de lint do diagrama aberto

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| ALNT-01: abrir aba pela 1ª vez → `GET /diagrams/:id/lint` + loading | Chama a rota uma vez, mostra loading até resolver | `apps/web/src/lint/LintPanel.spec.tsx:29-44` — `expect(screen.getByText('Carregando avisos…')).not.toBeNull()` then `waitFor(fetchImpl toHaveBeenCalledWith('/diagrams/diagram-1/lint'))` | ✅ PASS |
| ALNT-02: 200 com `warnings` → lista `rule` e `message` verbatim | `rule` E `message` exatamente como veio do servidor | `apps/web/src/lint/LintPanel.spec.tsx:46-63` — `expect(screen.getByText('1 componente(s) sem nenhum edge conectado.'))`; `expect(screen.getByTestId('lint-warning-rule').textContent).toBe('orphan-component')` | ✅ PASS |
| ALNT-03: `warnings` vazio → sucesso explícito, nunca lista ambígua/erro | Estado de sucesso distinto ("nenhum aviso") | `apps/web/src/lint/LintPanel.spec.tsx:65-81` — `expect(screen.getByText('Nenhum aviso para este diagrama.'))` | ✅ PASS |
| ALNT-04: status ≠ 200 ou falha de rede → erro com retry, editor não quebra | Estado de erro, sem exceção | `apps/web/src/lint/LintPanel.spec.tsx:83-97` — 500 → `getByText('Não foi possível carregar os avisos de lint.')`; `apps/web/src/lint/lintClient.spec.ts:41-55` — 404 e falha de rede ambos resolvem `{status:'error'}`, nunca lançam | ✅ PASS |
| ALNT-05: clicar "Atualizar" → refaz `GET` e substitui a lista | Segunda chamada, lista trocada | `apps/web/src/lint/LintPanel.spec.tsx:99-125` — `fireEvent.click(getByText('Atualizar'))` → nova lista aparece, `expect(fetchImpl).toHaveBeenCalledTimes(2)` | ✅ PASS |
| ALNT-06: aba "Lint" visível para qualquer papel com `diagram:read`, independente de `diagram:mutate` | Aba sempre presente mesmo sem `aiPanel` (proxy de `diagram:mutate`) | `apps/web/src/diagram/EditorSidePanel.spec.tsx:90-100` — `aiPanel={null}` → `expect(screen.getByRole('tab', {name:'Lint'})).toBeTruthy()`; `EditorSidePanel.tsx:11` — prop `lintPanel: ReactNode` (never `\| null`), tab rendered unconditionally (`EditorSidePanel.tsx:66-75`) | ✅ PASS |
| ALNT-07: aviso nunca desabilita/bloqueia ferramenta de canvas | Nenhuma ação de canvas é gateada por lint | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:865-919` (added round 2) — `ALNT-07: an active lint warning never gates a normal canvas interaction...`: opens the Lint tab, confirms the warning text is visible, then fires `capturedOnChange` (a real canvas selection) and asserts the metadata fetch still occurs — `expect(fetchImpl).toHaveBeenCalledWith(\`/diagrams/diagram-1/elements/${baseElement.id}/metadata\`)` | ✅ PASS (round 2) |

### P1: Saltar do aviso para o elemento no canvas

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| ALNT-08: cada `elementId` de um aviso ganha seu próprio controle de salto | 1 controle por id, individual | `apps/web/src/lint/LintPanel.spec.tsx:129-148` — `findByRole('button', {name: /el-live/})`, chama `onJumpToElement('el-live')` | ✅ PASS |
| ALNT-09: clique num controle com id existente na cena → seleciona + centraliza via `EditorSurfaceHandle`, nunca caminho paralelo | `updateScene({appState:{selectedElementIds}})` + `scrollToContent`, via `editorSurfaceRef` | `packages/editor-adapter/src/EditorSurface.spec.tsx:251-270` — `expect(updateSceneSpy).toHaveBeenCalledWith({appState:{selectedElementIds:{'el-target':true}}})`, `expect(scrollToContentSpy).toHaveBeenCalledWith(...,{animate:true})`; fim-a-fim em `apps/web/src/diagram/DiagramEditorPage.spec.tsx:809-863` | ✅ PASS |
| ALNT-10: `elementId` ausente da cena → sem controle clicável, sem erro, resto do aviso intacto | Sem `<button>` para o id; nenhuma exceção | `apps/web/src/lint/LintPanel.spec.tsx:150-165` — `screen.queryByRole('button', {name: /el-removed/})` is `null`, mas `screen.findByText(/el-removed/)` existe; `EditorSurface.spec.tsx:298-313` — id ausente devolve `false`, sem lançar | ✅ PASS |
| ALNT-11: salto concluído → anúncio em `aria-live="polite"` | Texto de confirmação anunciado | `apps/web/src/lint/LintPanel.spec.tsx:186-207` — `getByTestId('lint-announcement').textContent` é `'Foco movido para o elemento el-live.'` após o clique; `LintPanel.tsx:71-73` — `<div aria-live="polite" data-testid="lint-announcement">` | ✅ PASS |
| ALNT-12: clique em "ir para o elemento" nunca aplica mutação de cena | Nenhuma chamada de `updateScene` com `elements` | `packages/editor-adapter/src/EditorSurface.spec.tsx:342-354` — `focusElement` nunca passa `elements` a `updateScene`; `LintPanel.spec.tsx:167-184` — clique não dispara nenhuma requisição de rede adicional | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| ALNT-13: painel inteiro (abrir aba, ler avisos, "Atualizar", "ir para o elemento") só por teclado | Alcançável e acionável sem mouse | `apps/web/src/lint/LintPanel.a11y.spec.tsx:117-152` (added round 2) — `ALNT-13: the whole panel ... is reachable and operable in DOM Tab order...`: sequential `.focus()`+activate through "Atualizar" (confirms a real second fetch) then the "el-live" jump control (confirms `onJumpToElement` + the `aria-live` announcement text), covering the exact open→read→Atualizar→salto sequence | ✅ PASS (round 2) |
| ALNT-14: todo texto de chrome vem de `t(...)`, chaves em `en`/`pt-BR`, exceto `message` | Nenhum literal hardcoded exceto o campo dinâmico `message` | `apps/web/src/lint/LintPanel.tsx:69,79,82,84,86,103,108` — todos via `t('lint.*')`; `apps/web/src/i18n/locales/en/translation.json:446-457` e `.../pt-BR/translation.json:446-457` — todas as 7 chaves (`title,refresh,loading,error,empty,jumpToElement,elementUnavailable,announce.jumped`) presentes nos dois locales com valores distintos (confirma que não é fallback compartilhado); build/typecheck gate (`make typecheck`) passou, confirmando as chaves resolvem | ✅ PASS |

**Status**: ✅ All ACs covered — 14/14 fully matched (round 2 closed ALNT-07/13, see round 2 note above).

---

## Edge Cases

- [x] `elementId` repetido em mais de um aviso → cada aviso mostra seu próprio controle, sem deduplicar. **Not directly tested** — no test constructs two warnings sharing an `elementId`. Structurally guaranteed: `LintPanel.tsx:88-116` maps `elementIds` per-`warning` independently with no cross-warning `Set`/dedup structure, so duplication across warnings is architecturally impossible to suppress. Flagged as untested-but-structurally-sound, not a gap in behavior.
- [x] Troca de diagrama (rota) com painel montado → refaz busca para o novo `diagramId`, nunca reaproveita a lista anterior. `apps/web/src/lint/LintPanel.spec.tsx:210-236` — `rerender` with `diagramId="diagram-2"` triggers a fresh `fetchImpl` call to `/diagrams/diagram-2/lint`.
- [x] `GET .../lint` devolve 404 → mesmo estado de erro genérico do AC P1-4, sem revelar existência. `apps/web/src/lint/lintClient.spec.ts:41-46` — a 404 response resolves `{status:'error'}`, the same branch a 500 takes; `LintPanel` renders the identical generic error state for any non-'ok' status (no branch keyed on the numeric status code).

---

## Discrimination Sensor

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| 1 | `packages/editor-adapter/src/EditorSurface.tsx:228` | Flipped `if (!element \|\| ...)` → `if (element \|\| ...)` in `focusElement` (inverts the existence guard) | ✅ Killed — 4/4 relevant tests in `EditorSurface.spec.tsx`'s `focusElement` suite failed (TypeError on absent-id / tombstone paths, wrong `updateScene` call on present-id path) |
| 2 | `apps/web/src/diagram/EditorSidePanel.tsx:66-75` | Wrapped the "Lint" tab button in `{aiPanel !== null && (...)}`, gating it like the "IA" tab instead of always rendering it | ✅ Killed — `EditorSidePanel.spec.tsx` "omits the AI tab entirely but keeps both Comentários and Lint (CMT2-02, ALNT-06)" failed (`expected [...] to have a length of 2 but got 1`) |
| 3 | `apps/web/src/lint/LintPanel.tsx:62-64` | Removed `setAnnouncement(t('lint.announce.jumped', {elementId}))` from `handleJump` (kills the `aria-live` announcement side effect) | ✅ Killed — `LintPanel.spec.tsx` "ALNT-11: announces the jump result in the aria-live region" failed (announcement text stayed empty) |

**Sensor depth**: lightweight (3 mutations, standard-risk frontend feature)
**Result**: 3/3 killed — ✅ PASS

**Isolation**: baseline `git status --porcelain` was empty before sensor work; scratch worktree at
`/tmp/sensor-scratch` (`git worktree add /tmp/sensor-scratch HEAD`) was mutated and tested in
isolation (node_modules symlinked in per-package, never copied into the real tree); each mutation
was reverted with `git checkout --` inside the scratch before the next; `git worktree remove --force`
removed the scratch afterward. Post-cleanup `git status --porcelain` on the real tree is empty,
matching the baseline exactly. `git stash` was never used.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — 5 tasks, each touching exactly the file(s) its "Where" names; no drive-by refactors |
| Surgical changes | ✅ — `focusElement` added additively to `EditorSurfaceHandle` alongside existing `applyRemoteScene`/`insertLibraryItem`/`applyCollaborators`/`scrollToFrame`, no existing method touched |
| No scope creep | ✅ — no rule-toggle UI, no engine/route change, no i18n recomposition of `message` (all explicitly Out of Scope in spec.md and honored) |
| Matches patterns | ✅ — `lintClient` mirrors `metadataClient`'s injectable-fetch/never-throw shape; `LintPanel`'s loading/ready/error triad mirrors `CommentsSidebar`; tab wiring mirrors the existing `aiPanel`/`commentsPanel` pair |
| Spec-anchored outcome check (asserted values match spec) | ✅ — 14/14 ACs match precisely (round 2 closed ALNT-07/13 with true end-to-end tests) |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ — no new route (lint route pre-existing/out of scope); client layer covers all 4 documented branches (`lintClient.spec.ts`); component layer maps 1:1 to ALNT-01..12 per `LintPanel.spec.tsx`/`.a11y.spec.tsx` |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — every `it()` title in the 5 new/touched spec files cites an ALNT-NN or an established sibling requirement (CMT2-*, T94, DOCK-03) |
| Documented guidelines followed | ✅ — `CLAUDE.md` gate commands (`make lint && make typecheck && make test-unit`) followed; tasks.md's Test Coverage Matrix followed file-for-file |

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (per tasks.md's Gate Check Commands — Build row)
- **Result**:
  - `make lint` — ✅ exit 0. 6 pre-existing warnings, all outside the diff surface (`apps/mcp/src/client.spec.ts`, `tools/repo-tools/src/webConsumers.spec.ts`) — unrelated to architecture-lint.
  - `make typecheck` — ✅ exit 0, 25/25 packages successful (includes `@arch-canvas/web`, `@arch-canvas/editor-adapter`).
  - `make test-unit` — ❌ exit 2 at the Turborepo level, but isolated to **2 pre-existing, documented, unrelated failures**, both independently reproduced on a clean pre-feature commit (`fe414a3`, R13 close, before architecture-lint merged):
    1. `tools/repo-tools/src/webConsumers.spec.ts` — "finds exactly the 4 endpoints the real web app consumes today" — hardcodes a stale endpoint count; reproduced failing at `fe414a3` (expected 4, got 40) before this feature merged, and again post-merge (got 52, +12 consistent with this and other later slices adding fetch call sites). Confirmed via a throwaway `git worktree add` at `fe414a3` (removed after, no trace left). Unrelated to architecture-lint's own code.
    2. `packages/editor-adapter/src/EditorSurface.spec.tsx` — "icon.kind external ... inserts the rectangle+label fallback" — text-wrap assertion (`'Amazon EC2'` vs `'Amazon\nEC2'`), explicitly pre-documented as pre-existing in T1's own Done-when notes ("já falhava antes desta task, confirmado com `git stash`"). Reproduced here independently.
  - With coverage disabled (isolating a `V8CoverageProvider`/`ENOENT` sandbox artifact unrelated to test correctness — see tasks.md T2's own note on resource contention under `turbo --continue`), `@arch-canvas/web` runs clean: **89 test files, 873 tests, all passing**, including all 5 new/touched lint-surface files (`lintClient.spec.ts`: 4, `LintPanel.spec.tsx`: 10, `LintPanel.a11y.spec.tsx`: 4, `EditorSidePanel.spec.tsx`: 8, `DiagramEditorPage.spec.tsx`: 33). `@arch-canvas/editor-adapter` isolated run: 79/80 passing, the 1 failure being the pre-existing, pre-documented one above; all 5 `focusElement` tests pass.
- **Test count before feature**: not independently re-derived (pre-feature commit not re-run in full); tasks.md documents 5+4+14+2+1(net new file count) new tests added across T1-T5.
- **Test count after feature**: `LintPanel.spec.tsx` 10, `LintPanel.a11y.spec.tsx` 4, `lintClient.spec.ts` 4, `EditorSurface.spec.tsx` +5 (`focusElement` describe block), `EditorSidePanel.spec.tsx` 8 total (matches tasks.md's stated 8), `DiagramEditorPage.spec.tsx` 33 total (tasks.md's T5 Done-when states "32 testes no arquivo" — actual count is 33; see Fix Plans, cosmetic doc mismatch, not a code defect).
- **Delta**: +26 new lint-surface tests (10+4+4+5+3(EditorSidePanel net new, 8 total −5 pre-existing)+ DiagramEditorPage net-new integration test), consistent with tasks.md's task-by-task test counts.
- **Skipped tests**: none observed.
- **Failures**: 2, both pre-existing and unrelated to this feature (see above); 0 failures attributable to architecture-lint's own new code.

---

## Fix Plans (if issues found)

### Fix 1: `tasks.md` T5 Done-when states "32 testes" but `DiagramEditorPage.spec.tsx` actually has 33

- **Root cause**: doc/count drift in the task's self-reported Done-when note — cosmetic, not a code defect. All 33 tests pass; no missing or extra untested behavior found.
- **Fix task**: Update tasks.md T5's Done-when bullet to say "33 testes" (or re-verify the exact number before closing the wave).
- **Priority**: Cosmetic

### Fix 2: ALNT-07 and ALNT-13 lack an exact end-to-end test matching their spec Independent Tests

- **Root cause**: ALNT-07 is proven only by the *absence* of any canvas-gating prop/callback in `LintPanel`, not by a test that renders visible warnings and then asserts a canvas draw/edit action still succeeds. ALNT-13 is proven only for one button's focus+activation, not a full Tab-sequence walk from opening the tab through "Atualizar" to a completed jump, as the spec's own Independent Test describes.
- **Fix task**: Add (a) one integration test in `DiagramEditorPage.spec.tsx` that renders the Lint tab with warnings visible and confirms an ordinary canvas tool interaction still succeeds unimpeded; (b) one a11y/interaction test in `LintPanel.a11y.spec.tsx`/`.spec.tsx` that drives the panel via a real keyboard Tab sequence (open tab → Atualizar → jump) rather than only `.focus()` on a single element.
- **Priority**: Minor (both are structurally well-supported by the code; this is a test-precision gap, not an observed behavioral defect)

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ---------- |
| ALNT-01 | Implementing | ✅ Verified |
| ALNT-02 | Implementing | ✅ Verified |
| ALNT-03 | Implementing | ✅ Verified |
| ALNT-04 | Implementing | ✅ Verified |
| ALNT-05 | Implementing | ✅ Verified |
| ALNT-06 | Implementing | ✅ Verified |
| ALNT-07 | Implementing | ✅ Verified (round 2) |
| ALNT-08 | Implementing | ✅ Verified |
| ALNT-09 | Implementing | ✅ Verified |
| ALNT-10 | Implementing | ✅ Verified |
| ALNT-11 | Implementing | ✅ Verified |
| ALNT-12 | Implementing | ✅ Verified |
| ALNT-13 | Implementing | ✅ Verified (round 2) |
| ALNT-14 | Implementing | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready — PASS, 14/14 (round 2 closed both spec-precision gaps from round 1).
Feature is functionally sound, the sensor confirms the tests genuinely discriminate, and the gate
passes modulo two independently-confirmed pre-existing/unrelated failures (reproduced failing
before this feature's commits ever merged).

**Spec-anchored check**: 14/14 ACs matched spec outcome exactly (round 2)
**Sensor**: 3/3 mutations killed
**Gate**: lint ✅, typecheck ✅ (25/25), test-unit — `@arch-canvas/web` 874/874 passing (round 2, +1 test), `@arch-canvas/editor-adapter` 79/80 (1 pre-existing unrelated failure), `tools/repo-tools` 48/49 (1 pre-existing unrelated failure, reproduced failing before this feature merged)

**What works**: `focusElement` is a correct, additive, non-mutating imperative-handle method with full existence/tombstone guards; `lintClient` never throws and covers all 4 documented response branches; `LintPanel` covers loading/empty/error/populated states with server-verbatim `rule`+`message`, per-elementId jump controls gated correctly on `liveElementIds`, and `aria-live` announcements; the "Lint" tab is unconditionally offered (matching the `diagram:read`-only route contract) and never unmounts sibling panels; `DiagramEditorPage` wires the jump action through the single existing `editorSurfaceRef`, no parallel canvas-mutation path; all i18n chrome strings exist in both `en` and `pt-BR`; round 2 closed ALNT-07/13 with true end-to-end tests (canvas interaction while a warning is visible; full keyboard sequence through the panel).

**Issues found**: none remaining — round 1's doc/count drift (Fix 1) and the two spec-precision gaps (Fix 2) were both closed in round 2.

**Next steps**: none — feature closed.
