# Tentar novamente nas listas Validation

**Date**: 2026-08-25
**Spec**: `.specs/features/list-retry-action/spec.md`
**Diff range**: `3ddb4c0..b6929df` (commits `b9ef09f`, `6687ce8` for this feature's code; `bbcd2f7`
on top of the stated range is an unrelated doc-only STATE.md cleanup, confirmed by `git show
--stat` — touches only `.specs/STATE.md`, not this feature's files)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Validation: list-retry-action - PASS ✅

All 5 requirement ACs (LRA-01..05) are covered with spec-matching assertions across all four list
pages, the discrimination sensor's 3 targeted mutations were all killed, and `make ci` passes
13/13 with the Postgres cluster fully stopped. One minor, pre-existing (not newly introduced)
edge-case coverage gap is noted below — see "Edge Cases".

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | `b9ef09f` — `WorkspaceListPage.tsx`, `ProjectListPage.tsx`, `DiagramListPage.tsx` each extract the async list-load body into a named, `useCallback`-memoized function (`loadWorkspaces`/`loadProjects`/`loadDiagrams`), shared by the initial-load effect and a new "Tentar novamente" button rendered next to `css.errorBox` only when `status`/`listStatus === 'error'`. The existing per-effect `cancelled` boolean became a shared `cancelledRef`, read by both callers. `nav.error.retry` added to both `en` and `pt-BR`. |
| T2   | ✅ Done | `6687ce8` — `WorkspaceMembersPage.tsx`'s `loadMembers` follows the same pattern; the retry button renders in the `notFound` branch (where all load failures already land per MEM-03); success additionally calls `setNotFound(false)` (a change T1's three pages didn't need, since none of them fold errors into a `notFound` branch). |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -------------------------- | --------------------- | ------------------------ | ------ |
| LRA-01: carga de workspaces/projetos/diagramas falha → botão "Tentar novamente" junto da mensagem de erro | botão visível ao lado de `css.errorBox`, só em `status === 'error'` | `apps/web/src/nav/WorkspaceListPage.spec.tsx:491-509` — `screen.findByText('Algo deu errado...')` then `screen.getByRole('button', {name: 'Tentar novamente'})`; identical pattern at `ProjectListPage.spec.tsx:520-543`, `DiagramListPage.spec.tsx:414-437` | ✅ PASS |
| LRA-02: acionar o botão refaz a mesma requisição, mesmo cliente/parâmetros | uma nova chamada a `client.list()` (mesma função, sem parâmetros novos) | `WorkspaceListPage.spec.tsx:491-509` — `fireEvent.click(retryButton)` then `expect(callCount).toBe(2)` against the same `fetchImpl` mock; `ProjectListPage.spec.tsx:520-543` and `DiagramListPage.spec.tsx:414-437` assert the identical URL (`/projects?workspaceId=ws-1`, `/diagrams?projectId=p-1`) is hit again, not a different endpoint | ✅ PASS |
| LRA-03: retry bem-sucedido substitui a mensagem de erro pela lista, como uma carga inicial | lista renderizada, botão/mensagem de erro desaparecem | `WorkspaceListPage.spec.tsx:502-506` — `screen.findByRole('link', {name: 'Alpha'})` then `expect(screen.queryByRole('button', {name: 'Tentar novamente'})).toBeNull()`; same shape at `ProjectListPage.spec.tsx:534-538`, `DiagramListPage.spec.tsx:427-431` | ✅ PASS |
| LRA-04: carga de membros falha → mesma ação de retry na tela "não encontrado", sem revelar rede/permissão/inexistência | botão na ramificação `notFound`; retry bem-sucedido popula a lista e reseta `notFound`; retry falho mantém a MESMA mensagem genérica | `WorkspaceMembersPage.spec.tsx:122-153` (success path: `screen.findByText('Me')`, `queryByText('Este item não existe...')` is null) and `:155-174` (repeated-failure path: `getAllByText('Este item não existe...')` has length 1, never a network/permission-specific string) | ✅ PASS |
| LRA-05: cliques repetidos disparam uma requisição por clique, sem duplicar mensagens | N cliques → N novas chamadas; a mensagem de erro nunca aparece duplicada | `WorkspaceListPage.spec.tsx:511-524` — two clicks, `waitFor` asserts call count 2 then 3, then `expect(screen.getAllByText(...)).toHaveLength(1)` and `getAllByRole('button', ...)).toHaveLength(1)`; identical two-click pattern at `ProjectListPage.spec.tsx:544-561`, `DiagramListPage.spec.tsx:438-457`, and the failure-repeats variant at `WorkspaceMembersPage.spec.tsx:155-174` | ✅ PASS |

**Status**: ✅ All 5 requirement ACs covered with spec-matching assertions.

---

## Edge Cases

- [x] Cliques rápidos em sequência: uma requisição por clique, sem travar o botão — covered by
  LRA-05's evidence above (the button is never disabled; each click fires independently).
- [ ] ⚠️ **Desmontagem durante um retry em voo descarta o resultado (guarda `cancelled`)**: the
  code correctly reuses the SAME `cancelledRef` the initial-load effect always used (confirmed by
  reading the diff — `cancelledRef.current = false` is set in the effect, checked by both the
  effect body and `loadX`, and set back to `true` in the effect's cleanup, so an unmount during a
  retry sets the guard exactly like an unmount during initial load). **No new automated test
  exercises this specific case** (unmount a component while its retry-triggered promise is still
  pending, then assert no `act()`-outside-of-render warning / no state update). This is
  **pre-existing test debt, not something this feature introduced or worsened** — grepping
  `apps/web/src/nav/*.spec.tsx` for `unmount`/`cancelled` finds no test for the ORIGINAL
  initial-load cancellation guard either, in any of these four files, before or after this
  feature. Flagged as a minor, pre-existing gap rather than a new regression.

---

## Discrimination Sensor

Isolated in a temporary `git worktree` (`git worktree add /tmp/.../scratchpad/lra-wt HEAD`), never
`git stash`. Baseline `git status --porcelain` on the real tree was empty before sensor work;
confirmed empty again after `git worktree remove --force` and `git checkout --` of the mutated
files inside the scratch worktree (the mutations were made and tested entirely inside the scratch
copy, never in `/home/user/ia-draw`).

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| 1 | `apps/web/src/nav/WorkspaceListPage.tsx` retry button `onClick` | Replaced `onClick={() => loadWorkspaces()}` with `onClick={() => {}}` — removes the retry button's wiring entirely | ✅ Killed — `WorkspaceListPage.spec.tsx`'s two new LRA tests both failed (click never re-fetches, `waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))` times out) |
| 2 | `apps/web/src/nav/WorkspaceMembersPage.tsx:93` | Removed the `setNotFound(false)` call on a successful retry (success still calls `setItems`, but the `notFound` screen never clears) | ✅ Killed — the success-path LRA-04 test failed: `screen.findByText('Me')` never resolves because the component stays on the not-found branch |
| 3 | `apps/web/src/nav/ProjectListPage.tsx:117` | Changed the success branch of `loadProjects` to `setItems([])` instead of `setItems(list)` — retry "succeeds" (no error) but silently returns an empty list instead of the real data | ✅ Killed — the success-path LRA test failed: `screen.findByRole('link', {name: 'Project One'})` never resolves |

**Sensor depth**: lightweight (3 targeted mutations covering wiring-removal, wrong-branch/state-reset, and wrong-return-value — three of the four fault classes `validate.md` names, across three of the four changed files; the fourth file, `DiagramListPage.tsx`, follows the identical pattern to the mutated `WorkspaceListPage.tsx`/`ProjectListPage.tsx` and was not separately mutated to avoid redundant sensor runs)
**Result**: 3/3 killed — the new tests genuinely discriminate the behaviors LRA-01..05 require.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — extraction of an existing async body into a named `useCallback`, plus a button; no new abstraction created (the spec's Out-of-Scope table explicitly rejects a shared `useResourceList` hook, and the implementation correctly does not add one) |
| Surgical changes | ✅ — only the four target list pages, their specs, and the two locale files changed |
| No scope creep | ✅ — no retry-with-backoff, no distinct "retrying" visual state, no change to `WorkspaceMembersPage`'s IDOR-preserving MEM-03 behavior (verified: failure always renders the same generic not-found text, retry or not) |
| Matches existing patterns | ✅ — reuses `css.errorBox`/`css.buttonSecondary` tokens (AD-014 compliant, no inline styles), same `cancelled`-guard idiom as before, same i18n key nesting under `nav.error.*` |
| Spec-anchored outcome check (asserted values match spec) | ✅ — see Spec-Anchored Acceptance Criteria table above; every assertion targets the exact spec-defined outcome, not a vague "something rendered" |
| Per-layer Coverage Expectation met | ✅ — matches `tasks.md`'s Test Coverage Matrix exactly: two tests per page covering "shows button + retry succeeds" and "repeated clicks, no duplication" |
| Every test maps to a spec requirement | ✅ — every new `describe`/`it` title is explicitly tagged with its LRA-NN requirement ID |
| Documented guidelines followed | AD-014 (Tailwind tokens, no inline `style={{}}` — confirmed: the new `<div className="flex flex-wrap items-center gap-3">` and buttons use only Tailwind utility classes and `css.*` tokens) |

---

## Gate Check

- **Gate command (Build)**: `make ci` — run with the Postgres cluster **stopped** (`pg_ctlcluster
  16 main stop`, all three local clusters down, `DATABASE_URL` unset), since this feature's own
  Build gate is `make ci` and the repo's other concurrent feature (`concurrency-proof`) claims `make
  ci` has zero real-Postgres dependency; running LRA's gate in that exact condition doubles as
  confirmation of that claim.
- **Result**: ✅ 13/13 turbo tasks successful, 0 failed (lint, typecheck, unit, integration across
  every package). `@arch-canvas/server` integration: 53 test files / 394 tests passed (PGlite-only,
  as expected). `@arch-canvas/web` unit: 100 files / 970 tests passed.
- **Test count before feature**: `apps/web` unit 962 (per `shared-resource-frame-fix/validation.md`,
  the prior feature verified in this same wave)
- **Test count after feature**: `apps/web` unit 970
- **Delta**: +8 new tests — exactly 2 per page × 4 pages (`WorkspaceListPage`, `ProjectListPage`,
  `DiagramListPage`, `WorkspaceMembersPage`), matching `tasks.md`'s Test Coverage Matrix precisely
- **Skipped tests**: none
- **Failures**: none

---

## Requirement Traceability Update

`spec.md`'s table already marks LRA-01..05 as `✅ Verified` — left unchanged; independently
confirmed correct by this validation (see Spec-Anchored Acceptance Criteria above).

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ---------- |
| LRA-01 | ✅ Verified | ✅ Verified (independently confirmed) |
| LRA-02 | ✅ Verified | ✅ Verified (independently confirmed) |
| LRA-03 | ✅ Verified | ✅ Verified (independently confirmed) |
| LRA-04 | ✅ Verified | ✅ Verified (independently confirmed) |
| LRA-05 | ✅ Verified | ✅ Verified (independently confirmed) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 5/5 criteria matched the spec-defined outcome with passing evidence.
**Sensor**: 3/3 mutations killed — wiring removal, wrong-state-reset, and wrong-return-value faults
are all genuinely caught by the new tests.
**Gate**: `make ci` passes 13/13 with Postgres fully stopped (0 failed); `apps/web` unit 970/970.

**What works**: All four list pages now offer a "Tentar novamente" action exactly where the AC
requires it, reusing the existing named load function and cancellation guard rather than
introducing new state or an unneeded shared hook (matching the spec's explicit Out-of-Scope
decisions). `WorkspaceMembersPage` correctly keeps its MEM-03 IDOR-preserving convention — a repeated
failure never reveals cause, verified directly by test and by the discrimination sensor's mutation
2 attempt to break exactly that guarantee.

**Issues found**: One minor, pre-existing gap — the spec's "page unmounted with a retry in flight"
edge case is provably handled by the code (shared `cancelledRef`) but has no dedicated automated
test, in any of the four files, before or after this feature. Not a regression introduced by this
feature; not blocking.

**Next steps**: Optional follow-up (not blocking): add one unmount-during-retry test per page (or
at least one representative page) to close the pre-existing edge-case coverage gap.
