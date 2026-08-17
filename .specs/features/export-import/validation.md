# Export, bundle e import — Validation

## Validation: export-import - PASS ✅

**Date**: 2026-08-16
**Spec**: `.specs/features/export-import/spec.md`
**Diff range**: `85d2f42~1..HEAD` (8 commits, `85d2f42..88b1909`)
**Verifier**: independent sub-agent (author ≠ verifier) — RE-VERIFICATION pass over a prior FAIL

**Context**: a previous fresh Verifier ran on `7e4aa90` and returned FAIL — 261/261 tests green,
15/18 ACs precisely covered, one surviving discrimination-sensor mutant
(`ImportDialog.tsx`'s blank-title guard, only exercised through the disabled submit button), plus
partial coverage on XPRT-16 (keyboard focus), XPRT-17 (success-path `aria-live`), and XPRT-18
(en-locale) — all logged as small, additive test-only fix tasks. Commit `88b1909` ("test(export-
import): close Verifier gaps for XPRT-11/16/17/18") adds the missing assertions across
`ExportMenu.spec.tsx`, `BundleButton.spec.tsx`, `ImportDialog.spec.tsx`, and
`WorkspaceListPage.spec.tsx` — no production code touched. This report re-derives every AC and
re-runs the sensor from scratch, independent of the prior report's conclusions.

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | `exportClient.ts` — all 4 operations, all documented status branches |
| T2   | ✅ Done | `ExportMenu.tsx` |
| T3   | ✅ Done | `BundleButton.tsx` |
| T4   | ✅ Done | `ImportDialog.tsx` |
| T5   | ✅ Done | Workspace bundle action in `WorkspaceListPage.tsx` |
| T6   | ✅ Done | i18n keys, `en`/`pt-BR` parity confirmed (94/94 flattened keys match across both locale files, independently re-verified with a Python key-set diff) |
| T7   | ✅ Done | Integration into `DiagramEditorPage.tsx`/`ProjectListPage.tsx` + a11y specs |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -------------------------- | --------------------- | ------------------------ | ------ |
| XPRT-01: abrir menu + confirmar → 1 POST, 4 links c/ sizeBytes formatado | Exactly 1 call to `POST /diagrams/:id/exports`, 4 links (.excalidraw/SVG/PNG/PDF) w/ formatted size | `apps/web/src/export/ExportMenu.spec.tsx:57-85` — `expect(fetchImpl).toHaveBeenCalledTimes(1)`, `expect(screen.getAllByRole('link')).toHaveLength(4)`, formatted-size text assertions (`512 B`, `2.0 KB`, `1.5 MB`, `4.0 KB`) | ✅ PASS |
| XPRT-02: clicar num link → abre `url` assinada sem passar pelo servidor | `href` equals the signed storage URL, not a same-origin path | `apps/web/src/export/ExportMenu.spec.tsx:87-111` — asserts all 4 `href`s start with `https://storage.example/` | ✅ PASS |
| XPRT-03: `429` → mensagem de aguardar, sem travar editor | Wait message shown; rest of page stays interactive | `apps/web/src/export/ExportMenu.spec.tsx:113-139` — asserts wait message text + sibling button still rendered; `exportClient.spec.ts` asserts `{status:'rate_limited'}` | ✅ PASS |
| XPRT-04: geração em andamento → botão desabilitado | `generate` button `disabled` while in flight, re-enabled after | `apps/web/src/export/ExportMenu.spec.tsx:141-164` — `expect(button).toHaveProperty('disabled', true)` then `false` | ✅ PASS |
| XPRT-05: clicar "baixar bundle" → `POST .../bundle`, abre `url` na resposta 200 | 1 POST, `openUrl` called with returned `url` | `apps/web/src/export/BundleButton.spec.tsx:22-52` — `expect(openUrl).toHaveBeenCalledWith('https://storage.example/bundle-1.zip')`, 1 call | ✅ PASS |
| XPRT-06: geração em andamento → indicador de carregamento | Loading label + `disabled` while generating | `apps/web/src/export/BundleButton.spec.tsx:54-91` — button renders loading label with `disabled:true`, then reverts | ✅ PASS |
| XPRT-07: selecionar arquivo → lê como texto, `POST` sem `confirm`, exibe prévia | `file.text()` sent raw as `fileContent`, `elementCount` shown | `apps/web/src/export/ImportDialog.spec.tsx:92-113` — body `JSON.stringify({fileContent: ...})` (no `confirm`), `screen.getByText('3 elementos serão importados')` | ✅ PASS |
| XPRT-08: JSON inválido/não reconhecido → erro 400, bloqueia confirmação | Server `title` message shown, no title field/confirm button rendered | `apps/web/src/export/ImportDialog.spec.tsx:115-134` — exact server message text asserted, `queryByLabelText`/`queryByRole` for confirm controls return `null` | ✅ PASS |
| XPRT-09: limite de elementos excedido → erro 400, nunca trunca | Exact server limit message shown, no confirm button | `apps/web/src/export/ImportDialog.spec.tsx:136-161` — exact "25000 elements... 20000-element limit" message asserted, confirm button absent | ✅ PASS |
| XPRT-10: confirmar c/ título → `confirm:true`+`title`, navega p/ `/w/:workspaceId/d/:diagramId` | Body has `confirm:true`+`title`; route navigates to created diagram's editor | `apps/web/src/export/ImportDialog.spec.tsx:163-208` — body equality assertion + `getCapturedPath()` equals `/w/ws-1/d/diagram-9` | ✅ PASS |
| XPRT-11: confirmar sem título → nunca emite requisição | No additional fetch call when confirm attempted with blank title | `apps/web/src/export/ImportDialog.spec.tsx:256-278` (via disabled button) **and** `apps/web/src/export/ImportDialog.spec.tsx:280-306` (`fireEvent.submit(form)` bypassing the disabled button entirely, exercising `handleConfirm`'s own `if (!trimmedTitle \|\| !fileContent) return;` guard directly) — call count unchanged in both | ✅ PASS — gap closed, confirmed by re-running the sensor (see below) |
| XPRT-12: `role` sem `diagram:write` → ação de importar ausente | Trigger button entirely absent | `apps/web/src/export/ImportDialog.spec.tsx:308-312` — `queryByRole('button',{name:'Importar diagrama'})` is `null`; integration also in `apps/web/src/nav/ProjectListPage.spec.tsx:419-433` | ✅ PASS |
| XPRT-13: `role` `org_admin`/`workspace_admin` → ação de bundle de workspace visível por item | Button present only for admin-role rows | `apps/web/src/nav/WorkspaceListPage.spec.tsx:418-442` — present for `workspace_admin` row, `queryByRole` returns `null` for `editor` row | ✅ PASS |
| XPRT-14: confirmar solicitação → `POST /workspaces/:id/bundles`, msg explícita de "sem acompanhamento" | Exact confirmation text (no-tracking wording) shown on 200 | `apps/web/src/nav/WorkspaceListPage.spec.tsx:444-463` — exact text `'Bundle solicitado — este produto não mostra quando termina ou onde baixar; trate como item de acompanhamento operacional.'` | ✅ PASS |
| XPRT-15: `503` → indisponibilidade, sem retry automático | Unavailable message shown, exactly 1 POST call (no retry) | `apps/web/src/nav/WorkspaceListPage.spec.tsx:465-487` — exact unavailable text + call-count assertion of `1` | ✅ PASS |
| XPRT-16: toda ação alcançável só por teclado | Every action in this spec is keyboard-focusable (`.focus()`/`activeElement`) | `ExportMenu.spec.tsx:166-189` (generate button + all 4 links), `ImportDialog.spec.tsx:314-330` (file input + confirm button), `WorkspaceListPage.spec.tsx:354-359` (bundle-request button), `DiagramEditorPage.spec.tsx:474` (BundleButton), `ProjectListPage.spec.tsx:414` (import trigger) | ✅ PASS — gap closed, all ~8 interactive controls named in the prior report's gap now individually asserted |
| XPRT-17: geração/bundle/confirmação completa (sucesso ou falha) → anuncia em `aria-live="polite"` | Both success and failure outcomes announced in the region | Success: `ExportMenu.spec.tsx:81-83` (`export-menu-announcement` = `'Exports prontos'`), `BundleButton.spec.tsx:49-50` (`bundle-button-announcement` = `'Bundle pronto'`), `ImportDialog.spec.tsx:210-254` (`import-announcement` = `'Diagrama importado'`). Failure: `DiagramEditorPage.spec.tsx:479-515` (BundleButton), `ProjectListPage.spec.tsx:435-475` (ImportDialog) | ✅ PASS — gap closed, both success and failure paths now asserted for all 3 components |
| XPRT-18: todo texto visível vem de i18n, `pt-BR`+`en`, sem literal | No hardcoded strings in components; same key set in both locales | Manual grep of `ExportMenu.tsx`/`BundleButton.tsx`/`ImportDialog.tsx`/`WorkspaceListPage.tsx` — zero string literals outside `t(...)` calls; Python key-set diff of both `translation.json` files — 0 keys different (94/94 flattened keys match); en-locale rendering: `DiagramEditorPage.spec.tsx:447-477`, `ProjectListPage.spec.tsx:435-475`, and now `WorkspaceListPage.spec.tsx:385-401` (`'Request workspace bundle'` asserted in the `en`-locale NAV-26 test, closing the specific gap the prior report flagged) | ✅ PASS — gap closed |

**Status**: ✅ 18/18 ACs fully covered with a precise spec-anchored assertion. All 4 gaps flagged in
the prior report (XPRT-11 sensor gap, XPRT-16, XPRT-17, XPRT-18) are closed by commit `88b1909`;
none of the other 14 ACs regressed.

---

## Discrimination Sensor

**Isolated scratch**: `git worktree add /tmp/sensor-scratch-xprt2 HEAD` (detached at `88b1909`),
`node_modules` symlinked back to the real worktree's at root/`apps/web`/each `packages/*` (no
package content mutated, only symlinks). Baseline `git status --porcelain` on the real tree was
`?? .specs/features/export-import/validation.md` (the file this report itself replaces) before the
sensor ran, and identical after `git worktree remove --force`.

Re-injected the exact mutation that survived in the prior Verifier's run, to specifically confirm
the fix:

| # | File:line | Description | Killed? |
| - | --------- | ------------ | ------- |
| 1 | `apps/web/src/export/ImportDialog.tsx:91` | Removed the `if (!trimmedTitle \|\| !fileContent) return;` guard in `handleConfirm` — blank titles no longer blocked at the handler level | ✅ **Killed** — `ImportDialog.spec.tsx`'s new test `'submitting the form directly with a blank title still never sends the confirmation request (XPRT-11)'` (line 280) fails: `fireEvent.submit(form)` bypasses the disabled button and reaches `handleConfirm` directly, so with the guard removed the request fires and `fetchImpl.mock.calls.length` goes from 1 to 2 (`expected 2 to be 1`). Verified by reading `ImportDialog.tsx:144` — the `<form onSubmit={(event) => void handleConfirm(event)}>` wiring means the raw `submit` event on the form element reaches the handler regardless of the button's `disabled` attribute. |

**Sensor depth**: lightweight (1 targeted re-injection of the previously-surviving mutation — this
was a re-verification pass focused on confirming the specific prior gap; the prior Verifier's
other 4 mutations, unrelated to this commit's changes, are not re-run here since they were already
confirmed killed and no production code changed in `88b1909`)
**Result**: 1/1 killed — ✅ PASS

---

## Interactive UAT Results

Not performed — out of scope for this Verifier run per the calling instructions (read-only,
report-only). This is a user-facing feature; interactive UAT is recommended as a follow-up but was
not requested for this pass.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — fix commit adds only test assertions, no production code touched |
| Surgical changes | ✅ — only the 4 spec files named in the fix plan were touched |
| No scope creep | ✅ — no new components, no new i18n keys, no behavior change |
| Matches patterns | ✅ — new assertions follow the same `.focus()`/`activeElement`, `aria-live` testid, and `fireEvent.submit` conventions already used elsewhere in the suite |
| Spec-anchored outcome check (asserted values match spec) | ✅ 18/18 fully precise |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ `exportClient.ts` covers every documented status branch (200/429/503/400/201) |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — every new `it(...)` title in `88b1909` cites an `XPRT-NN` label matching its assertion |
| Documented guidelines followed | none beyond `CLAUDE.md`'s "Comandos" — strong defaults applied, consistent with tasks.md's own note |

---

## Edge Cases

- [x] Navegar para fora durante geração em andamento → resposta simplesmente descartada (no explicit test, but no cleanup/cancellation logic exists that would contradict this — the fetch promise resolves into component state via `setState`, which React silently no-ops on an unmounted component; acceptable per spec's own framing of "just let it happen")
- [x] Arquivo sem extensão `.excalidraw` mas JSON válido → aceito, pois a validação é por conteúdo — confirmed by design: `ImportDialog.tsx`'s `<input accept=".excalidraw">` is only a file-picker filter hint, not a validation gate; `handleFileChange` calls `previewImport` on whatever `File` object arrives regardless of name — content-only validation confirmed by reading, not directly tested with a mismatched extension (unchanged from prior report; not a gap this fix commit was scoped to close)
- [x] Lista de workspaces sem nenhum item admin → ação de bundle nunca aparece — `WorkspaceListPage.spec.tsx:418-442` confirms per-item conditional rendering (`canManageMembers &&`), and there's no separate "no admin items" empty-section branch in the JSX to render unexpectedly

---

## Gate Check

- **Gate command**: `pnpm --filter @arch-canvas/web run test:unit` (Quick) + `pnpm --filter @arch-canvas/web run typecheck` + `pnpm -w exec biome check apps/web/src` (substituted for `make lint`/`make ci`, which fail in this sandbox on missing `pg_lsclusters`/`redis-server`, per `CLAUDE.md`'s documented environment trap — confirmed unrelated to this feature)
- **Result**: 265 tests passed, 0 failed, 0 skipped (31 test files); typecheck clean (`tsc --noEmit`, no output); biome clean on `apps/web/src` (`Checked 58 files in 59ms. No fixes applied.`)
- **Test count before fix commit** (at `7e4aa90`, per prior Verifier report): 261
- **Test count after fix commit** (`88b1909`, this run): 265
- **Delta**: +4 new test cases (`ExportMenu.spec.tsx` XPRT-16 focus test; `ImportDialog.spec.tsx` XPRT-17 success-announcement test + XPRT-11 direct-submit test + XPRT-16 focus test; `BundleButton.spec.tsx` and `WorkspaceListPage.spec.tsx` gained assertions inside existing tests, not new `it()` blocks), matching the commit diff (`git show --stat 88b1909`: 4 files changed, 138 insertions, 0 deletions, no file added/removed)
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

None. All 4 gaps from the prior FAIL report are closed:

1. ~~Surviving mutant — `ImportDialog.tsx`'s blank-title guard untested independently of the disabled button~~ → closed by `ImportDialog.spec.tsx:280-306` (`fireEvent.submit(form)`); re-confirmed killed by re-running the exact same mutation in an isolated scratch worktree (see Discrimination Sensor above).
2. ~~XPRT-16 — incomplete keyboard-focus coverage~~ → closed by `ExportMenu.spec.tsx:166-189`, `ImportDialog.spec.tsx:314-330`, `WorkspaceListPage.spec.tsx:354-359`.
3. ~~XPRT-17 — success-path announcements untested~~ → closed by `ExportMenu.spec.tsx:81-83`, `BundleButton.spec.tsx:49-50`, `ImportDialog.spec.tsx:210-254`.
4. ~~XPRT-18 — missing en-locale test for the workspace bundle button~~ → closed by `WorkspaceListPage.spec.tsx:396-398`.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ---------- |
| XPRT-01..15 | ✅ Verified (7e4aa90 pass) | ✅ Verified |
| XPRT-16 | ⚠️ Verified with gap | ✅ Verified |
| XPRT-17 | ⚠️ Verified with gap | ✅ Verified |
| XPRT-18 | ⚠️ Verified with gap | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 18/18 ACs matched spec outcome precisely, 0 gaps
**Sensor**: 1/1 re-injected mutation killed (the specific mutant that survived the prior pass);
0 survived
**Gate**: 265 passed, 0 failed (test:unit, up from 261 at the prior pass); typecheck clean; biome
clean on `apps/web/src`

**What works**: All 4 export formats generate in a single call with correct download-link behavior
(XPRT-01/02), rate-limiting and in-flight disabling (XPRT-03/04), diagram bundle download with
loading state (XPRT-05/06), the full import preview→confirm→navigate flow including both 400 error
shapes and a client-side blank-title guard now proven independent of the disabled button
(XPRT-07..11), the project-role gate for import (XPRT-12), the workspace-admin-only bundle-request
action with its explicit no-tracking messaging and 503 handling (XPRT-13..15), full keyboard
reachability of every interactive control in the feature (XPRT-16), success- and failure-path
`aria-live` announcements for all three generation/import flows (XPRT-17), and correct i18n key
structure/parity with zero hardcoded literals and en-locale rendering confirmed for every new
string including the workspace bundle button (XPRT-18).

**Issues found**: none.

**Next steps**: Feature is verified complete. Interactive UAT (human-in-the-loop walkthrough) is
still recommended as an optional follow-up for this user-facing feature, per the Verifier's normal
scope note, but is not required to consider the feature done.
