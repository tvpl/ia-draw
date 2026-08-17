# Biblioteca de componentes e metadados — Validation

**Date**: 2026-08-16
**Spec**: `.specs/features/component-library/spec.md`
**Diff range**: `c78864d..ebef339`
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Validation: component-library — FAIL ❌

One discrimination-sensor mutation survived (see Sensor below), tracing to the same untested
branch as the CLIB-19 spec gap. Both are test-coverage gaps on already-correct implementation
code (confirmed by direct source read), not incorrect product behavior — see Fix Plans for the
one-test remediation. 18/20 ACs are clean PASS with solid `file:line` evidence.

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | `EditorSurfaceHandle.insertLibraryItem` — `packages/editor-adapter/src/EditorSurface.tsx:116-184` |
| T2   | ✅ Done | `libraryClient.ts` — `apps/web/src/library/libraryClient.ts` |
| T3   | ✅ Done | `metadataClient.ts` — `apps/web/src/library/metadataClient.ts` |
| T4   | ✅ Done | `LibraryPanel.tsx` |
| T5   | ✅ Done | `MetadataPanel.tsx` |
| T6   | ✅ Done | `InventoryView.tsx` |
| T7   | ✅ Done | i18n keys, both locales, key sets match |
| T8   | ✅ Done | `DiagramEditorPage.tsx` + `InventoryPage.tsx` + `App.tsx` wiring, a11y specs |

All 8 commits present in `c78864d..ebef339`, one per task, Conventional-Commit-shaped.

---

## Spec-Anchored Acceptance Criteria

| ID | Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------------- | --------------------- | ------------------------ | ------ |
| CLIB-01 | Painel abre → lista global+workspace via `GET /libraries?workspaceId=`, agrupado por categoria | items grouped under category headings | `apps/web/src/library/LibraryPanel.spec.tsx:77-93` — asserts `fetchImpl` called with exact URL, `getByText('Server')`/`'Message queue'`, `getByRole('heading',{name:'compute'/'messaging'})` | ✅ PASS |
| CLIB-02 | Busca filtra por `name`/`aliases`/`tags`, sem nova chamada de rede | filtered list, `fetchImpl` called exactly once | `LibraryPanel.spec.tsx:95-111` — filters by alias `'broker'`, `expect(fetchImpl).toHaveBeenCalledTimes(1)` | ✅ PASS |
| CLIB-03 | Inserir item `icon.kind==='inline'` → elemento imagem renderizando o SVG, centrado, com `name` como label | image element referencing the registered file, text element = `item.name`, centered exactly on viewport | `packages/editor-adapter/src/EditorSurface.spec.tsx:218-252` — `imageElement.fileId===file.id`, `textElement.text==='Server'`, `imageElement.x+width/2===400` / `y+height/2===300`. Insertion trigger: `LibraryPanel.spec.tsx:113-128` — `onInsert` called with full `LibraryItem` | ✅ PASS |
| CLIB-04 | Item `icon.kind==='external'` → fallback retângulo+label, nunca busca `sourceUrl` | rectangle+text fallback, zero `fetch` calls | `EditorSurface.spec.tsx:268-304` — `fetchSpy`/`addFilesSpy` not called, rectangle `backgroundColor==='#ED7100'`, text=`'Amazon EC2'` | ✅ PASS |
| CLIB-05 | `role` sem `diagram:write` → painel somente-leitura, sem botão inserir | zero "Inserir" buttons, items still listed | `LibraryPanel.spec.tsx:130-139` — `canWrite={false}`, `queryByRole('button',{name:'Inserir'})` is null | ✅ PASS |
| CLIB-06 | `GET /libraries` carregando → estado de loading, nunca lista vazia | loading text shown, no empty-search text | `LibraryPanel.spec.tsx:141-148` — pending promise, `getByText('Carregando biblioteca…')`, empty-search text absent | ✅ PASS |
| CLIB-07 | `GET /libraries` falha → erro com retry, sem quebrar o resto | error text + retry button; retry re-issues the GET | `LibraryPanel.spec.tsx:150-168` — 500 then retry succeeds, `callCount===2` | ✅ PASS |
| CLIB-08 | Elemento selecionado → busca via `GET .../metadata`, exibe no painel | form populated with server values | `apps/web/src/library/MetadataPanel.spec.tsx:29-49` — `fetchImpl` called with exact URL, semantic-type field = `'service'`, JSON field parses to `{owner:'team-a'}` | ✅ PASS |
| CLIB-09 | `404` → formulário vazio, nunca erro | blank form, no error text | `MetadataPanel.spec.tsx:51-70` — field value `''`, error text absent, Salvar button present | ✅ PASS |
| CLIB-10 | Salvar → `PATCH`, reflete só o valor devolvido (nunca otimista) | displayed value = server response, not the locally-typed draft | `MetadataPanel.spec.tsx:72-105` — types `'draft-type'`, server returns `'database'`, field ends at `'database'` | ✅ PASS |
| CLIB-11 | `PATCH` 403 (role menor) → sem formulário de edição, só leitura | no Salvar button, no editable inputs | `MetadataPanel.spec.tsx:107-124` — `canWrite={false}`, `queryByRole('button',{name:'Salvar'})`/`queryByLabelText('Tipo semântico')` both null | ✅ PASS (see design.md note below) |
| CLIB-12 | Nenhum elemento selecionado → estado vazio, painel montado | empty-state text, panel stays mounted (rerender, not unmount) | `MetadataPanel.spec.tsx:126-149` — `selection=[]` and `selection=['el-1','el-2']` both show the empty text, `fetchImpl` never called | ✅ PASS |
| CLIB-13 | Troca de seleção com edição não salva → descarta sem confirmação | new element's server value shown, unsaved text gone, no dialog | `MetadataPanel.spec.tsx:151-193` — unsaved `'unsaved-edit'` replaced by `'database'` on rerender, `queryByText('unsaved-edit')` null | ✅ PASS |
| CLIB-14 | Abrir inventário → lista via `GET .../inventory` com `elementType`/`semanticType`/`revision` | row contains all three fields | `apps/web/src/library/InventoryView.spec.tsx:33-46` — row text contains `'rectangle'`, `'service'`, `'1'` | ✅ PASS |
| CLIB-15 | Elemento com `elementType:null` → marcado "removido do canvas", não escondido | row still rendered, marked removed | `InventoryView.spec.tsx:48-60` — row2 text contains `'Removido do canvas'`, row still present | ✅ PASS |
| CLIB-16 | "Exportar CSV" → `GET .../inventory?format=csv`, dispara download | exact URL requested, Blob content = server CSV text, click fired, URL revoked | `InventoryView.spec.tsx:62-96` — `fetchImpl` called with `format=csv` URL, `blobArg.text()` resolves to the exact `csvText`, `clickSpy` called once, `revokeObjectURL` called with the mock URL | ✅ PASS |
| CLIB-17 | Lista vazia → estado vazio, não erro | empty text, no table, no error text | `InventoryView.spec.tsx:98-110` — empty text shown, `queryByRole('table')` null, error text absent | ✅ PASS |
| CLIB-18 | Toda ação alcançável só por teclado | every action operable via Tab/Enter | `apps/web/src/App.spec.tsx:590-604` — search input and inventory link proven focusable via `document.activeElement`. **All other actions (insert, save, retry, export-CSV) use native `<button>`/`<a>`/`<input>`/`<textarea>` elements** (inherently keyboard-operable), confirmed by source read, but not driven through an explicit Tab-sequence test | ⚠️ Spec-precision gap (narrow) — see Gaps |
| CLIB-19 | Inserção/salvamento completa (sucesso **ou falha**) → anuncia em `aria-live="polite"` | success AND failure both announced | Success: `LibraryPanel.spec.tsx:113-128` (`'Server inserido no canvas'`) and `MetadataPanel.spec.tsx:72-105` (`'Metadados salvos'`). **Failure path**: `MetadataPanel.tsx:104-106`'s `setAnnouncement(t('metadata.error'))` on a failed `PATCH` has **zero test coverage** — confirmed by both the coverage report (`MetadataPanel.tsx` lines 105-106 uncovered) and the discrimination sensor (mutation 5 below survived) | ❌ GAP (see Gaps + Sensor) |
| CLIB-20 | Todo texto visível vem de i18n, ambos locales (`en`/`pt-BR`) | identical key sets, no literal in component | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` — `library`/`metadata`/`inventory` keys identical across both files; manual read of `LibraryPanel.tsx`/`MetadataPanel.tsx`/`InventoryView.tsx`/`DiagramEditorPage.tsx`/`InventoryPage.tsx` found every visible string routed through `t(...)`. Locale switch proven at runtime: `App.spec.tsx:575-588` | ✅ PASS |

**Status**: ⚠️ 18/20 clean PASS, 1 spec-precision gap (CLIB-18, narrow), 1 real gap (CLIB-19, failure-path announcement untested).

---

## Discrimination Sensor

Isolated scratch: temporary `git worktree add --detach <scratch> HEAD` (never `git stash`). `node_modules`/`dist` cloned via `cp -Rc` (APFS clonefile) from the real tree into the scratch tree so the workspace resolves without a fresh `pnpm install`. Baseline `git status --porcelain` of the real tree was empty before the sensor ran and confirmed unchanged (`git worktree remove --force`, then a second `git status --porcelain` — empty, matches).

| # | File:line | Description | Killed? |
| - | --------- | ------------ | ------- |
| 1 | `packages/editor-adapter/src/EditorSurface.tsx:134` | Flipped `item.icon.kind === 'inline'` → `!== 'inline'` | ✅ Killed — 3 tests failed in `EditorSurface.spec.tsx` (`insertLibraryItem` inline/external/positioning cases) |
| 2 | `apps/web/src/library/metadataClient.ts:63-65` | Removed the explicit `404 → null` branch (`get` falls through to parsing the body instead) | ✅ Killed — `metadataClient.spec.ts`'s `get() resolves null on 404` failed (`expected undefined to be null`) |
| 3 | `apps/web/src/library/LibraryPanel.tsx:150` | Swapped `canWrite &&` → `!canWrite &&` on the insert-button guard | ✅ Killed — 2 tests failed in `LibraryPanel.spec.tsx` (CLIB-01's "Inserir" lookup found 2 matches instead of 0; CLIB-05's `queryByRole` found a button that should be absent) |
| 4 | `apps/web/src/library/InventoryView.tsx:46` | Changed CSV export's `client.inventory(diagramId, 'csv')` → `'json'` | ✅ Killed — `InventoryView.spec.tsx`'s CLIB-16 test failed (`fetchImpl` never called with the `format=csv` URL) |
| 5 | `apps/web/src/library/MetadataPanel.tsx:104-106` | Removed `setAnnouncement(t('metadata.error'))` from the failed-`PATCH` branch | ❌ **Survived** — `MetadataPanel.spec.tsx`, `MetadataPanel.a11y.spec.tsx`, `DiagramEditorPage.spec.tsx` all still pass (22/22) with the failure announcement silently dropped |

**Sensor depth**: lightweight (default tier), 5 mutations run (5 rather than the minimum 3, to specifically probe the coverage-report gap on `MetadataPanel.tsx:105-106`).
**Result**: 4/5 killed — ⚠️ **1 survivor** (mutation 5, same root cause as the CLIB-19 gap above).

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — no scope beyond spec.md's goals |
| Surgical changes | ✅ — touches only `packages/editor-adapter`, `apps/web/src/library/**`, `apps/web/src/diagram/**`, `apps/web/src/App.tsx`, i18n JSON |
| No scope creep | ✅ — Out of Scope table respected (no library-creation UI, no batch reclassification, no real-time metadata sync, no inventory pagination, no external-icon embedding) |
| Matches patterns | ✅ — clients mirror `aiDockClient.ts`/`resourceClient.ts`; panels mirror `WorkspaceListPage`'s loading/error/empty convention; `<details>` toggle mirrors `AiDock` |
| Spec-anchored outcome check (asserted values match spec) | ⚠️ — 18/20 clean, CLIB-19 asserted value for the failure path does not exist in any test |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ⚠️ — `MetadataPanel`'s error branch (write failure) is the one exception; every other route/branch has happy+edge+error coverage |
| Every test maps to a spec requirement — no unclaimed tests | ✅ |
| Documented guidelines followed | `.specs/features/component-library/tasks.md`'s own Test Coverage Matrix (this feature's guideline artifact) — followed for every layer except the one gap above |

---

## Edge Cases

- [x] Busca sem match → estado vazio de busca, distinto de biblioteca vazia — `LibraryPanel.spec.tsx:170-183`
- [x] Mesmo `stableKey` em duas bibliotecas visíveis → listado duas vezes, não deduplicado — `LibraryPanel.spec.tsx:185-195`
- [x] `metadataJson` inválido (sintaxe) → validação client-side, PATCH nunca chamado — `MetadataPanel.spec.tsx:195-217`
- [~] Elemento selecionado apagado do canvas → volta a "selecione um elemento" — não testado como cenário dedicado (seleção mudando para `[]`), mas coberto por composição via CLIB-12's test (`selection=[]` já força o estado vazio) — behavior is correct by construction (the panel only reacts to the `selection` prop), just not exercised as an explicit "element deleted" scenario
- [~] `metadataJson` sintaticamente válido mas não-objeto (array/primitivo) → mesma validação client-side — implemented (`MetadataPanel.tsx:84-86`) but **uncovered** per the coverage report (0% branch on that line); the only tested invalid-JSON case is a syntax error, not a valid-but-wrong-shape value

---

## Gate Check

- **Gate command**: `pnpm --filter @arch-canvas/editor-adapter run test:unit` + `pnpm --filter @arch-canvas/web run test:unit` + `pnpm -w typecheck` + `npx biome check apps/web packages/editor-adapter packages/library-content`
- **editor-adapter test:unit**: 64/64 passed (6 files)
- **web test:unit**: 273/273 passed (33 files)
- **typecheck**: 25/25 workspace tasks passed (full turbo, cache hits)
- **lint (scoped: `apps/web packages/editor-adapter packages/library-content`)**: 103 files checked, 0 errors, 0 warnings
- **lint (full repo, `npx biome check .`)**: 2 errors / 6 warnings, confirmed confined to `docs/openapi.json`, `apps/mcp/src/client.spec.ts`, `apps/server/src/modules/auth/users.int.spec.ts`, `tools/repo-tools/src/webConsumers.spec.ts` — none of these appear in this feature's `git diff --stat c78864d..ebef339`, so their lint status is independent of this feature's changes; treated as pre-existing per the task brief's own claim, confirmed here by direct `biome check` output rather than assumed
- **Skipped**: none

---

## Fix Plans

### Fix 1: CLIB-19 — metadata-save failure never verified to announce

- **Root cause**: `MetadataPanel.tsx`'s `handleSave` correctly calls `setAnnouncement(t('metadata.error'))` in the `result.status !== 'ok'` branch (line 104-106), but no test in `MetadataPanel.spec.tsx` drives `client.patch` to resolve `{status:'error'}` (e.g. a `403` or network failure) and then asserts on `metadata-announcement`'s text. Confirmed by both the vitest coverage report (0% branch coverage on those lines) and the discrimination sensor (mutation 5 survived).
- **Fix task**: Add a test to `MetadataPanel.spec.tsx` — mock `fetchImpl` so the `PATCH` call returns a `403`, click Salvar, assert `screen.getByTestId('metadata-announcement').textContent` equals the pt-BR `metadata.error` string (`'Não foi possível carregar ou salvar os metadados. Tente novamente.'`).
- **Priority**: Minor (the behavior IS implemented correctly; only the regression-catching test is missing — a future refactor could silently break the failure announcement with nothing to catch it).

### Fix 2: CLIB-18 — keyboard reachability evidence is narrow

- **Root cause**: Only 2 of the ~7 keyboard-reachable actions listed in spec.md (search field, inventory link) have an explicit focus-assertion test. The rest (insert button, save button, retry button, export-CSV button, canvas element selection) rely on being native `<button>`/`<input>`/`<textarea>` elements, which are keyboard-operable by construction, but this isn't asserted by a test.
- **Fix task**: optional — extend `App.spec.tsx`'s CLIB-18 test (or a new one) to `.focus()` the insert/save/retry/export buttons and assert `document.activeElement`, matching the existing pattern.
- **Priority**: Cosmetic/Minor — native semantic HTML elements are keyboard-operable by default; this is a coverage-precision gap, not a behavior gap.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ----------- |
| CLIB-01..17, CLIB-20 | Implementing | ✅ Verified |
| CLIB-18 | Implementing | ⚠️ Verified with spec-precision gap |
| CLIB-19 | Implementing | ❌ Needs Fix (test gap; behavior itself is correct) |

---

## Summary

**Overall**: ⚠️ Issues (non-blocking — behavior is correct; the gaps are missing regression tests, not incorrect product behavior)

**Spec-anchored check**: 18/20 ACs matched spec outcome cleanly, 1 spec-precision gap (CLIB-18), 1 real coverage gap (CLIB-19)
**Sensor**: 4/5 mutations killed, 1 survived (same root cause as CLIB-19's gap)
**Gate**: 337 tests passed (64 editor-adapter + 273 web), 0 failed; typecheck clean; lint clean on every file this feature touches

**What works**: Every P1 story (browse/search/insert with real SVG icons, external-icon fallback with zero network egress, semantic classification with 404→blank-form and non-optimistic save) and every P2 story (inventory listing with removed-element marking, CSV export, i18n parity) is implemented correctly and has solid, spec-anchored test evidence. `EditorSurfaceHandle.insertLibraryItem` correctly never touches `icon.sourceUrl` for external items — verified by a dedicated `fetch`-spy test, satisfying spec.md's Success Criteria network-egress claim.

**Issues found**:
1. `MetadataPanel`'s failure-path aria-live announcement (`metadata.error` on a failed `PATCH`) has zero test coverage — add the test in Fix 1 above.
2. Keyboard-reachability test coverage for CLIB-18 is narrower than the spec's "toda ação" wording — extend per Fix 2 above (lower priority, since the underlying elements are already keyboard-operable).

**Next steps**: Route Fix 1 (and optionally Fix 2) back to an implementer as a small follow-up task; re-run `MetadataPanel.spec.tsx` to confirm the new test both passes against real code and would fail against mutation 5. Neither gap blocks shipping this slice — both are test-coverage gaps on already-correct behavior, not product defects.
