# Recolher o painel do editor Validation

**Date**: 2026-08-25
**Spec**: `.specs/features/editor-panel-collapse/spec.md`
**Diff range**: `e261446..e2de877` (commits c1f2967, 07ba46c, e2de877 for this feature)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | `c1f2967` — `panelCollapsed` state + conditional `<aside>`/strip in `DiagramEditorPage.tsx`; tab selection lifted to `sidePanelTab` and passed as controlled `activeTab`/`onActiveTabChange` to `EditorSidePanel`. |
| T2   | ✅ Done | `07ba46c` — `diagram.panel.collapse`/`diagram.panel.expand` added to both `en` and `pt-BR` locales, referenced via `t(...)` in T1's code (not literal text). |
| T3   | ✅ Done | `e2de877` — `ui-foundations/spec.md`'s UIF-17 row corrected to `✅ Verified` with a reference to this feature; `ui-foundations/validation.md` has a closure note referencing `editor-panel-collapse` (R25/T1). |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -------------------------- | --------------------- | ------------------------ | ------ |
| EPC-01: acionar o controle de recolher deixa de renderizar o painel com largura própria, canvas ocupa o espaço | nenhum elemento com `role="complementary"` (o `<aside>`); coluna do canvas mantém `flex-1` | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:141-153` — `expect(screen.queryByRole('complementary')).toBeNull(); expect(strip.tagName).not.toBe('ASIDE'); expect(canvasColumnAfter.className).toContain('flex-1')` | ✅ PASS |
| EPC-02: enquanto recolhido, controle visível e alcançável por teclado para expandir | um `<button type="button">` real, não `disabled` | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:164-167` — `expect(expandButton.tagName).toBe('BUTTON'); expect(expandButton.getAttribute('type')).toBe('button'); expect(expandButton.hasAttribute('disabled')).toBe(false)` | ✅ PASS |
| EPC-03: acionar o controle de expandir devolve o painel com a MESMA largura de antes (`w-96`) | `className` contém `w-96` | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:186-189` — `expect(sidebar.className).toContain('w-96')` | ✅ PASS |
| EPC-04: expandir de volta preserva a aba interna ativa antes de recolher | a mesma aba (`Comentários`, escolhida deliberadamente antes de recolher, não a aba default `IA`) continua `aria-selected="true"` depois de expandir | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:178-194` — `expect(screen.getByRole('tab', { name: 'Comentários' }).getAttribute('aria-selected')).toBe('true'); expect(screen.getByRole('tab', { name: 'IA' }).getAttribute('aria-selected')).toBe('false')` (asserted both AFTER collapse+expand, with the non-default tab explicitly selected first — rules out "it just always shows the default") | ✅ PASS |
| EPC-05: rótulo acessível distinto por estado (nunca o mesmo texto) | `collapseButton.textContent !== expandButton.textContent`; `aria-expanded` flips `true`→`false` | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:203-213` — `expect(collapseButton.getAttribute('aria-expanded')).toBe('true'); expect(expandButton.getAttribute('aria-expanded')).toBe('false'); expect(expandLabel).not.toBe(collapseLabel)` | ✅ PASS |
| EPC-05 (i18n half): rótulos vêm de `t(...)`, não texto literal | o locale `en` mostra o texto `en`, não pt-BR nem a chave crua | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:216-227` — `screen.getByRole('button', { name: 'Collapse panel' })` then `screen.getByRole('button', { name: 'Expand panel' })` after switching `i18n.changeLanguage('en')` | ✅ PASS |
| Edge case: recolher durante um run de IA em andamento não cancela o run | não testado diretamente (nenhum teste monta um run de IA em `awaiting_approval` e depois recolhe) | — | ⚠️ Spec-precision gap — plausible by construction (collapsing only stops rendering `<aside>`/`EditorSidePanel`; `AiDock`'s own run state lives in its own component tree/API calls untouched by this toggle, per `EditorSidePanel.tsx`'s own doc comment that all three panels stay mounted while expanded and only unmount together with the whole `<aside>`), but not directly asserted by a test |
| Edge case: viewport redimensionado enquanto recolhido não religa o painel sozinho | não testado (no test resizes the viewport) | — | ⚠️ Spec-precision gap — `panelCollapsed` is plain React state with nothing in `DiagramEditorPage.tsx` wired to a resize/media-query listener, so by construction nothing could re-open it on resize, but this is inferred from absence of code, not demonstrated by a test |

**Status**: ✅ All 5 numbered ACs covered with precise, non-shallow evidence; 2 edge cases plausible by construction but not directly tested — flagged, not silently passed.

---

## Discrimination Sensor

Isolated in the same temporary `git worktree` used for `shared-resource-frame-fix` (`git worktree add`, never `git stash`). Baseline `git status --porcelain` on the real tree was empty before sensor work and confirmed empty again after `git worktree remove --force` — real tree untouched throughout, verified once for both features' sensor work combined.

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| 1 | `apps/web/src/diagram/DiagramEditorPage.tsx:348-349` | Removed `activeTab={sidePanelTab}` / `onActiveTabChange={setSidePanelTab}` (the EPC-04 tab-lift wiring), leaving `EditorSidePanel` to fall back to its uncontrolled internal state | ✅ Killed — `DiagramEditorPage.spec.tsx`'s EPC-03/04 test failed: `expected 'false' to be 'true'` (the "Comentários" tab no longer stayed selected after expand, silently reverting to the "IA" default) |
| 2 | `apps/web/src/diagram/DiagramEditorPage.tsx:322` | Flipped the collapse condition `panelCollapsed ? ... : ...` → `!panelCollapsed ? ... : ...` | ✅ Killed — all 5 EPC-01..05 tests failed (the collapsed/expanded branches were now swapped, so every assertion about which state shows what failed) |

**Sensor depth**: lightweight (2 targeted mutations covering the two riskiest behaviors: the AC4 tab-preservation state lift, which is the one non-trivial piece of new logic, and the core show/hide toggle itself)
**Result**: 2/2 killed — ✅ PASS

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — one boolean + one nullable tab-id state, a conditional branch, and a controlled/uncontrolled sentinel in `EditorSidePanel` (`activeTab: TabId | null | undefined`, `undefined` meaning "opt out of control", preserving every pre-existing consumer's behavior unchanged) |
| Surgical changes | ✅ — only `DiagramEditorPage.tsx`, `EditorSidePanel.tsx`, two locale files, and the two documentation files T3 targets |
| No scope creep | ✅ — no localStorage persistence, no keyboard shortcut, no `<details>` redesign, matching spec.md's Out of Scope table exactly |
| Matches existing patterns | ✅ — reuses `css.buttonQuiet` (AD-014), same `t('diagram.*')` namespace convention as `diagram.loading` |
| Spec-anchored outcome check (asserted values match spec) | ✅ — see table above; every numbered AC has a precise assertion, not just "something rendered" |
| Per-layer Coverage Expectation met | ✅ — this is UI-layer logic with 1:1 AC-to-test mapping (5 ACs, 6 tests including the i18n half of EPC-05) |
| Every test maps to a spec requirement | ✅ — every new test's name carries its EPC-NN tag |
| Documented guidelines followed | AD-014 (Tailwind tokens/utilities, no inline `style`/literal colors — `panelCollapsed`'s strip and button use only `css.buttonQuiet` and Tailwind utility classes, consistent with `tokenSweep.spec.ts`'s enforcement, confirmed green in the full gate run below) |

---

## Edge Cases

- [x] Recolher some com a largura do painel, canvas cresce (EPC-01, tested)
- [x] Expandir devolve a mesma aba (EPC-04, tested — deliberately switched off the default tab first to make the assertion meaningful)
- [ ] IA run em andamento sobrevive a recolher — plausible by construction (`AiDock`'s own state is untouched by this toggle; panels stay mounted while the `<aside>` is expanded), not directly tested — see Spec-Anchored table
- [ ] Resize não religa o painel sozinho — plausible by construction (`panelCollapsed` has no resize/media-query listener anywhere in the diff), not directly tested — see Spec-Anchored table

---

## Gate Check

- **Gate command (Build)**: `make ci`
- **Result**: ✅ 0 failed. Lint: 646 files, 0 issues. Typecheck: 25/25 tasks. Unit: `@arch-canvas/web` 100 files / 962 tests passed (was 951 pre-`ui-foundations` baseline). Integration: server 394/394, database 36/36.
- **Test count before feature**: `apps/web` unit — pre-EPC baseline not separately isolated from SRF in this diff range (both features share the `e261446..e2de877` range), but `ui-foundations/validation.md`'s recorded baseline is 951.
- **Test count after feature**: 962 (net +11 combined across both features in this range; EPC alone contributes 6 new `describe('collapse/expand the side panel (EPC-01..05)')` tests, confirmed present at `apps/web/src/diagram/DiagramEditorPage.spec.tsx:129-228`)
- **Skipped tests**: none
- **Failures**: none — EPC's own unit tests and the full `make ci` gate both pass cleanly, unlike SRF's e2e gate (see `shared-resource-frame-fix/validation.md`, a separate and unrelated finding — EPC has no e2e component and no storage dependency)

---

## Fix Plans

None. No surviving mutants, no failing gate, no undelivered numbered AC.

---

## Requirement Traceability Update

`spec.md`'s table already marks EPC-01..05 as `Done` — confirmed accurate, left unchanged.

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ---------- |
| EPC-01 | Done | ✅ Verified |
| EPC-02 | Done | ✅ Verified |
| EPC-03 | Done | ✅ Verified |
| EPC-04 | Done | ✅ Verified |
| EPC-05 | Done | ✅ Verified |

`ui-foundations/spec.md`'s UIF-17 row and `ui-foundations/validation.md`'s closure note (both edited by T3, `e2de877`) were checked against the real code and are accurate: `DiagramEditorPage.tsx` genuinely has the collapse/expand control now, and the tab-preservation claim in `validation.md`'s closure note matches EPC-04's real, tested behavior. No further edit needed to either file.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 6/6 asserted criteria (5 numbered ACs + the i18n half of EPC-05) matched their spec-defined outcome with precise, non-shallow evidence; 2 edge cases are plausible by construction but not directly tested, flagged as spec-precision gaps rather than silently passed.
**Sensor**: 2/2 mutations killed.
**Gate**: `make ci` passes, 0 failed.

**What works**: A real control now collapses/expands the whole `<aside>` at the same tree position (`row.children[1]`), the canvas reclaims the freed width automatically via its existing `flex-1`, the previously-selected internal tab survives a collapse/expand round-trip because its state was correctly lifted to the parent with a backward-compatible controlled/uncontrolled sentinel (`activeTab: undefined` vs `null` vs a real `TabId`), and the two control labels are textually distinct, i18n-driven, and keyboard-reachable. `ui-foundations/spec.md`'s previously-false `✅ Verified` claim for UIF-17 is now genuinely true, closing exactly the documentation-integrity gap this feature exists to close.

**Issues found**: None blocking. Two edge cases (in-flight AI run survives collapse; resize doesn't auto-reopen) are correct by construction/code-reading but have no direct test — worth a follow-up test, not a fix.

**Next steps**: None required to close this feature. Optional: add direct tests for the two untested edge cases if a future change touches `panelCollapsed` or `AiDock`'s mount lifecycle, so a regression there would be caught mechanically rather than by re-reading the code.
