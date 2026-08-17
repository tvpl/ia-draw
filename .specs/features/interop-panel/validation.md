# Interop Mermaid/Structurizr no painel de export/import — Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/interop-panel/spec.md`
**Diff range**: `41cc792..b0be301` (feature/interop-panel, 4 commits on top of the merged R1-R11/R15-R16 base)
**Verifier**: standalone fresh-eyes pass by the implementing session — no Task/Agent sub-agent tool
is exposed in this harness (confirmed via `ToolSearch`; only a heavyweight cross-container
`mcp__Claude_Code_Remote__create_session` exists, which would require pushing the unpublished
local branch to be reachable, forbidden by this task's hard constraints). Per SKILL.md's
"Standalone fallback: Without sub-agents, run validate.md as an independent fresh-eyes pass ...
including the spec-anchored check and discrimination sensor," this report was produced by
re-deriving every AC's expected outcome from `spec.md` fresh (not from implementation memory),
citing `file:line` evidence-or-zero, and running a real discrimination sensor in an isolated git
worktree. This substitutes for, but does not equal, a truly independent author. Flagged
explicitly for the parent orchestrator per the task's own instructions.

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1: `exportClient.ts` extension (`exportDsl`/`importDsl`) | Done | commit `178163e` |
| T2: `ExportMenu` Mermaid/Structurizr export | Done | commit `0b82d8c` |
| T3: `ImportDialog` Mermaid/Structurizr import | Done | commit `385a41c`, label fix `b0be301` |

---

## Spec-Anchored Acceptance Criteria

### P1: Exportar a cena como Mermaid ou Structurizr DSL

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| INT-01: click "Exportar Mermaid" → 1 POST `export:mermaid`, `200` triggers Blob download `diagram-<id>.mmd` | exactly 1 call, filename `diagram-diagram-1.mmd`, Blob content = returned `dsl` | `apps/web/src/export/ExportMenu.spec.tsx:191-204` — `expect(fetchImpl).toHaveBeenCalledTimes(1)`, `expect(appendedAnchors[0]?.download).toBe('diagram-diagram-1.mmd')`, `expect(blobArg.text()).resolves.toBe(dsl)`; route-shape unit-covered at `apps/web/src/export/exportClient.spec.ts:243-262` | ✅ PASS |
| INT-02: click "Exportar Structurizr" → 1 POST `export:structurizr`, `200` triggers download `diagram-<id>.dsl` | filename `diagram-diagram-1.dsl` | `apps/web/src/export/ExportMenu.spec.tsx:236-243` — `expect(appendedAnchors[0]?.download).toBe('diagram-diagram-1.dsl')` | ✅ PASS |
| INT-03: non-empty `limitations` shown next to that format's button; empty shows explicit "no limitations" | exact limitation text visible; exact pt-BR "no limitations" string visible | `apps/web/src/export/ExportMenu.spec.tsx:274` — `expect(screen.getByText("edge 'conn' mode 'data' has no Mermaid equivalent"))`; `:298` — `expect(screen.getByText('Nenhuma limitação de round-trip relatada.'))` | ✅ PASS |
| INT-04: non-`200` → generic error in the shared `aria-live` region, no download | exact pt-BR error string in `export-menu-announcement`; `createObjectURL` never called | `apps/web/src/export/ExportMenu.spec.tsx:318-322` — `.textContent` equality + `expect(createObjectURL).not.toHaveBeenCalled()` | ✅ PASS |
| INT-05: each DSL button disables independently of the other and of "Gerar exports" | Mermaid `disabled:true` while in flight; Structurizr and "Gerar exports" stay `false` | `apps/web/src/export/ExportMenu.spec.tsx:350-352` | ✅ PASS |

### P1: Importar um arquivo Mermaid ou Structurizr com prévia

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| INT-06: dialog opens with `.excalidraw` selected by default | `.excalidraw` radio `checked:true`; Mermaid/Structurizr `checked:false`; `Arquivo` label present | `apps/web/src/export/ImportDialog.spec.tsx:351-354` | ✅ PASS |
| INT-07: selecting Mermaid/Structurizr swaps `accept` and discards prior preview | prior `.excalidraw` preview text gone; `Arquivo` label gone; `accept` = `.mmd,.txt` | `apps/web/src/export/ImportDialog.spec.tsx:373-376` | ✅ PASS |
| INT-08: selecting a DSL file shows raw content as read-only preview, no server call | preview textarea value === file content verbatim; `fetchImpl` never called | `apps/web/src/export/ImportDialog.spec.tsx:392-397` | ✅ PASS |
| INT-09: confirm sends `POST /projects/:id/import:<format>` once with `{dsl, title?}` | exact body `JSON.stringify({dsl, title})`, or `{dsl}` alone when title blank | `apps/web/src/export/ImportDialog.spec.tsx:423-429` (with title) and `:461-465` (blank title, body has no `title` key); route-shape at `apps/web/src/export/exportClient.spec.ts:298-325` | ✅ PASS |
| INT-10: `201` shows `limitations` (even empty) and navigates to `/w/:workspaceId/d/:diagramId` | exact target path `/w/ws-1/d/diagram-9` | `apps/web/src/export/ImportDialog.spec.tsx:430` — `expect(getCapturedPath()).toBe('/w/ws-1/d/diagram-9')` | ✅ PASS — see note below |
| INT-11: `400` shows server message, never navigates | exact server `title` text in `role="alert"`; `getCapturedPath()` stays `null` | `apps/web/src/export/ImportDialog.spec.tsx:492-494` | ✅ PASS |
| INT-12: any other non-`201` status shows generic error, never navigates | exact pt-BR generic string in `role="alert"`; `getCapturedPath()` stays `null` | `apps/web/src/export/ImportDialog.spec.tsx:519-521` | ✅ PASS |
| INT-13: empty-content DSL file keeps confirm disabled, no request sent | `disabled:true`; `fetchImpl` never called | `apps/web/src/export/ImportDialog.spec.tsx:537-541` | ✅ PASS |
| INT-14: blank title permitted for Mermaid/Structurizr (unlike `.excalidraw`) | confirm button `disabled:false` with blank title; request body omits `title` key entirely | `apps/web/src/export/ImportDialog.spec.tsx:454` and `:461-465` | ✅ PASS |
| INT-15: `canImport:false` hides the trigger for all 3 formats | trigger button absent | `apps/web/src/export/ImportDialog.spec.tsx:308-312` (pre-existing XPRT-12 test, still valid evidence — `canImport` gates the component's entire return, including the format `<fieldset>`, at `ImportDialog.tsx:210`) | ✅ PASS |

**Note on INT-10:** spec.md's AC5 also requires displaying `limitations` before/at the moment of
navigating. The implementation sets the `aria-live` announcement text to include the limitations
summary (`dslSuccessAnnouncement`, `ImportDialog.tsx:90-97`) immediately before `navigate()` fires
— the same "observe text right before unmount" pattern the pre-existing XPRT-17 test already uses
for the `.excalidraw` flow. No dedicated assertion targets the announcement text specifically for
the DSL success path in this diff (the navigation-path test above only asserts the final route).
**Flagged as a coverage gap**, not a functional gap — see Fix Plans below.

### P2: Operável por teclado e nos dois idiomas

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| INT-16: format selector, DSL preview, both new export buttons, and DSL confirm button are keyboard-focusable | `document.activeElement` equals each control after `.focus()` | `apps/web/src/export/ImportDialog.spec.tsx:551,563,567`; `apps/web/src/export/ExportMenu.spec.tsx:385-393`; zero serious/critical axe violations at `apps/web/src/export/ImportDialog.a11y.spec.tsx:91-119` and `apps/web/src/export/ExportMenu.a11y.spec.tsx:82-110` | ✅ PASS |
| INT-17: every new visible string comes from i18n keys (pt-BR + en), no literal in component | no hardcoded string literals in JSX; both locale files carry the same 13 new keys | Verified by inspection: `grep -n '>Export\|>Import\|>Mermaid\|>Structurizr' apps/web/src/export/ExportMenu.tsx apps/web/src/export/ImportDialog.tsx` → no matches; key-set parity confirmed programmatically (13 new keys in both `en/translation.json` and `pt-BR/translation.json`, zero one-sided keys) | ⚠️ Spec-precision gap — no dedicated runtime locale-switch test (same treatment R7's XPRT-18 already received: no such test exists there either; verified structurally, not at runtime) |

**Status**: ✅ All 17 ACs covered with `file:line` evidence — 16 PASS outright, 1 (INT-17) verified
by structural inspection rather than a runtime test (consistent with the existing R7 precedent for
its equivalent i18n requirement), 1 (INT-10) has a minor coverage gap noted above.

---

## Discrimination Sensor

Isolated scratch: `git worktree add <scratch> HEAD` under the session scratchpad (never the real
tree), `pnpm install --frozen-lockfile` + `pnpm -w build` run there to resolve workspace packages,
mutation applied, targeted spec file run, mutation reverted, worktree removed. Real-tree
`git status --porcelain` confirmed empty both before and after (baseline preserved).

| # | File:line | Description | Killed? |
| - | --------- | ------------ | ------- |
| 1 | `apps/web/src/export/exportClient.ts:302` | Changed `importDsl`'s success-status check from `response.status !== 201` to `response.status !== 200` | ✅ Killed — 2 tests in `exportClient.spec.ts` failed (expected `status:'ok'`, got `status:'error'`) |
| 2 | `apps/web/src/export/ImportDialog.tsx:215` | Widened the DSL `canConfirm` boundary from `(fileContent?.length ?? 0) > 0` to `>= 0` | ✅ Killed — `ImportDialog.spec.tsx`'s INT-13 test failed (confirm button `disabled` expected `true`, got `false`) |
| 3 | `apps/web/src/export/ExportMenu.tsx:74` | Removed the `URL.revokeObjectURL(url)` call from `triggerDslDownload` | ✅ Killed — `ExportMenu.spec.tsx`'s INT-01 test failed (`revokeObjectURL` expected 1 call, got 0) |

**Sensor depth**: lightweight (3 targeted mutations, one per task/file touched by this feature).
**Result**: 3/3 killed — PASS ✅

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code (no speculative features: no clipboard copy, no inline DSL editing, no format auto-detect) | ✅ |
| Surgical changes (only `exportClient.ts`, `ExportMenu.tsx`, `ImportDialog.tsx`, their tests, and the 2 locale files touched) | ✅ |
| No scope creep (`BundleButton.tsx`, the 4-format export flow, and R7's `.excalidraw` behavior are untouched — diffed and confirmed identical) | ✅ |
| Matches existing patterns (Blob download mirrors `InventoryView.tsx`'s CSV export exactly; client status-branching mirrors `generateExports`/`confirmImport`) | ✅ |
| Spec-anchored outcome check (asserted values match spec-defined outcomes, not just "an assertion exists") | ✅ |
| Every test maps to a spec AC or edge case — no unclaimed tests (spot-checked: all 39 new/modified test names cite an `INT-NN` or reuse an existing `XPRT-NN`) | ✅ |
| Documented guideline conformance | none beyond `CLAUDE.md`'s "Comandos" — same as R7, strong defaults applied |

---

## Edge Cases (spec.md)

- [x] Switching format after selecting a file discards the prior preview/file — `ImportDialog.spec.tsx:357-376` (INT-07 test)
- [x] Navigating away mid-export is not separately tested in this diff, but the mechanism is identical to R7's already-verified "discard the response" pattern (no new async-orphan risk introduced — `handleExportDsl`/`handleConfirmDsl` follow the exact same fire-and-await-then-setState shape as the pre-existing `handleGenerate`/`handleConfirmExcalidraw`)
- [x] Empty `limitations` shows an explicit confirmation, never an empty section — `ExportMenu.spec.tsx:298` (export side); `ImportDialog.tsx:95-96`'s `dslSuccessAnnouncement` always appends either the limitations list or the "no limitations" string (import side, see INT-10 coverage-gap note above for why this isn't independently asserted)

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (substitute per this environment's known sandbox trap — `pg_lsclusters`/`redis-server` absent — documented in `CLAUDE.md`; `make test-integration` not exercised since this feature touches no server code)
- **Result**: lint 0 errors (6 pre-existing warnings in `tools/repo-tools`, unrelated to this diff), typecheck 25/25 tasks green, test-unit 71/71 files green
- **Test count before feature**: 695 (`apps/web` unit suite, measured via `pnpm --filter @arch-canvas/web run test:unit` run against a scratch worktree checked out at the pre-feature commit `41cc792`)
- **Test count after feature**: 720
- **Delta**: +25 new tests (8 net new in `exportClient.spec.ts`, 8 net new across `ExportMenu.spec.tsx`/`.a11y.spec.tsx`, 9 net new across `ImportDialog.spec.tsx`/`.a11y.spec.tsx`)
- **Skipped tests**: none
- **Failures**: none on the final run; one flaky, pre-existing, unrelated failure observed twice during this session (`DiagramEditorPage.spec.tsx`'s `DOCK-13` full-flow test, timing-sensitive under full-suite load) — passed in isolation and on retry both times, not touched by this diff's files

---

## Fix Plans

### Fix 1: INT-10's DSL success announcement has no dedicated assertion

- **Root cause**: the navigation-path test (`ImportDialog.spec.tsx:400-430`) only asserts the final
  route, not the `import-announcement` text at the moment of success — unlike the `.excalidraw`
  flow, which has a dedicated XPRT-17 test for exactly this (`ImportDialog.spec.tsx:210-254`,
  pre-existing).
- **Fix task**: add one test asserting `screen.getByTestId('import-announcement').textContent`
  equals the expected `dslSuccessAnnouncement` output (both the empty-limitations and
  non-empty-limitations cases) right before the route changes, mirroring the existing XPRT-17
  test's structure (render outside a matched `<Route>` to observe text before unmount).
- **Priority**: Minor — the underlying behavior is implemented and correct (traced by reading
  `ImportDialog.tsx:184-188`); this is a coverage gap, not a functional gap.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| INT-01 | Implementing | ✅ Verified |
| INT-02 | Implementing | ✅ Verified |
| INT-03 | Implementing | ✅ Verified |
| INT-04 | Implementing | ✅ Verified |
| INT-05 | Implementing | ✅ Verified |
| INT-06 | Implementing | ✅ Verified |
| INT-07 | Implementing | ✅ Verified |
| INT-08 | Implementing | ✅ Verified |
| INT-09 | Implementing | ✅ Verified |
| INT-10 | Implementing | ⚠️ Verified with a noted coverage gap (see Fix 1) |
| INT-11 | Implementing | ✅ Verified |
| INT-12 | Implementing | ✅ Verified |
| INT-13 | Implementing | ✅ Verified |
| INT-14 | Implementing | ✅ Verified |
| INT-15 | Implementing | ✅ Verified |
| INT-16 | Implementing | ✅ Verified |
| INT-17 | Implementing | ⚠️ Verified structurally (spec-precision gap, same as R7's precedent) |

---

## Summary

**Overall**: ✅ Ready (PASS, with one minor coverage-gap fix task recorded for future work, not
blocking)

**Spec-anchored check**: 17/17 ACs covered with `file:line` evidence; 15 matched the spec-defined
outcome outright, 1 (INT-10) matched but with a noted coverage gap, 1 (INT-17) verified by
structural inspection instead of a runtime test (same treatment as R7's equivalent requirement)

**Sensor**: 3/3 mutations killed

**Gate**: 71/71 test files passed, 720/720 tests passed, lint clean, typecheck clean

**What works**: Export Mermaid/Structurizr (independent buttons, Blob download, limitations
display, independent disable state, shared error announcement) and import Mermaid/Structurizr
(format selector, client-side preview since no dry-run route exists, direct-create confirm with
optional title, limitations announced, navigation on success, 400/other-error handling) — all
built inside R7's existing `ExportMenu`/`ImportDialog`, zero new UI surface, matching R8's roadmap
scope exactly.

**Issues found**: A traceability defect (several `INT-NN` labels in `ImportDialog.spec.tsx`/`.tsx`
drifted from `spec.md`'s actual AC-to-ID mapping during T3) was caught during this pass and fixed
in commit `b0be301` before this report was written — see the Lessons entry recorded alongside this
report. One minor coverage gap (Fix 1 above) remains open, non-blocking.

**Next steps**: Optionally implement Fix 1 in a follow-up task. No AD-level backend change was
needed for this feature (spec.md's Problem Statement documents the three real contract
differences from R7 that shaped the design — no gap required patching).
