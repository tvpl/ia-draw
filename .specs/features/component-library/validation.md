# Biblioteca de componentes e metadados — Validation

**Date**: 2026-08-16
**Spec**: `.specs/features/component-library/spec.md`
**Diff range**: `c78864d..HEAD` (`c78864d..ebef339` original 8 implementation commits + `ebef339..2cb58f2` follow-up fix commit `test(web): close verifier-flagged coverage gaps (CLIB-18/19)`)
**Verifier**: independent sub-agent (author ≠ verifier) — **this is a RE-verification**, superseding the prior report (same date, diff range `c78864d..ebef339`) that found 18/20 clean and flagged CLIB-18/CLIB-19 as gaps. This pass has no memory of writing the code or of the prior verification session; every citation below was re-derived from current source, not copied from the prior report.

---

## Validation: component-library — PASS ✅

Both gaps flagged by the prior Verifier are closed. 20/20 ACs are clean PASS with `file:line`
evidence. The discrimination-sensor mutation that survived in the prior pass (removing the
failure-path `setAnnouncement` call in `MetadataPanel.tsx`) is now killed by the new CLIB-19 test.
One narrow, non-blocking residual observation remains for CLIB-18 (see Edge Cases /
Spec-Precision Note) — it does not fail any AC.

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
| T7   | ✅ Done | i18n keys, both locales, key sets identical (re-verified by direct key-set diff, see Code Quality) |
| T8   | ✅ Done | `DiagramEditorPage.tsx:12-13,42-50,109-158` wires `LibraryPanel`/`MetadataPanel`/`insertLibraryItem`; `InventoryPage.tsx` + `App.tsx` routing |
| Fix (CLIB-19) | ✅ Done | `apps/web/src/library/MetadataPanel.spec.tsx:107-135` — new failure-path test |
| Fix (CLIB-18) | ✅ Done | Focus-assertion tests added to `LibraryPanel.spec.tsx`, `MetadataPanel.spec.tsx`, `InventoryView.spec.tsx` |

All 9 commits present in `c78864d..HEAD`, Conventional-Commit-shaped.

---

## Spec-Anchored Acceptance Criteria

| ID | Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------------- | --------------------- | ------------------------ | ------ |
| CLIB-01 | Painel abre → lista global+workspace via `GET /libraries?workspaceId=`, agrupado por categoria | items grouped under category headings | `apps/web/src/library/LibraryPanel.spec.tsx:77-93` — asserts `fetchImpl` called with `/libraries?workspaceId=ws-1`, `getByText('Server')`/`'Message queue'`, `getByRole('heading',{name:'compute'/'messaging'})` | ✅ PASS |
| CLIB-02 | Busca filtra por `name`/`aliases`/`tags`, sem nova chamada de rede | filtered list, `fetchImpl` called exactly once | `LibraryPanel.spec.tsx:95-111` — filters by alias `'broker'`, `expect(fetchImpl).toHaveBeenCalledTimes(1)` | ✅ PASS |
| CLIB-03 | Inserir item `icon.kind==='inline'` → elemento imagem renderizando o SVG, centrado, com `name` como label | image element referencing the registered file, text element = `item.name`, centered on viewport | `packages/editor-adapter/src/EditorSurface.tsx:134-162` implementation confirmed by direct read (skeleton built from `centerX/centerY`, `fileId`, `item.name` text). Insertion trigger: `LibraryPanel.spec.tsx:113-128` — `onInsert` called with full `LibraryItem`, announcement text asserted | ✅ PASS |
| CLIB-04 | Item `icon.kind==='external'` → fallback retângulo+label, nunca busca `sourceUrl` | rectangle+text fallback, zero `fetch` calls | `EditorSurface.tsx:163-177` — `else` branch never reads `item.icon.sourceUrl`, builds rectangle skeleton with `backgroundColor: item.color`, `label: {text: item.name}` (comment at line 164 explicitly documents CLIB-04) | ✅ PASS |
| CLIB-05 | `role` sem `diagram:write` → painel somente-leitura, sem botão inserir | zero "Inserir" buttons, items still listed | `LibraryPanel.spec.tsx:130-139` — `canWrite={false}`, `queryByRole('button',{name:'Inserir'})` is null, item still visible | ✅ PASS |
| CLIB-06 | `GET /libraries` carregando → estado de loading, nunca lista vazia | loading text shown, no empty-search text | `LibraryPanel.spec.tsx:141-148` — pending promise, `getByText('Carregando biblioteca…')`, empty-search text absent | ✅ PASS |
| CLIB-07 | `GET /libraries` falha → erro com retry, sem quebrar o resto | error text + retry button; retry re-issues the GET | `LibraryPanel.spec.tsx:150-168` — 500 then retry succeeds, `callCount===2` | ✅ PASS |
| CLIB-08 | Elemento selecionado → busca via `GET .../metadata`, exibe no painel | form populated with server values | `apps/web/src/library/MetadataPanel.spec.tsx:29-49` — `fetchImpl` called with `/diagrams/diagram-1/elements/el-1/metadata`, semantic-type field = `'service'`, JSON field parses to `{owner:'team-a'}` | ✅ PASS |
| CLIB-09 | `404` → formulário vazio, nunca erro | blank form, no error text | `MetadataPanel.spec.tsx:51-70` — field value `''`, error text absent, Salvar button present | ✅ PASS |
| CLIB-10 | Salvar → `PATCH`, reflete só o valor devolvido (nunca otimista) | displayed value = server response, not the locally-typed draft | `MetadataPanel.spec.tsx:72-105` — types `'draft-type'`, server returns `'database'`, field ends at `'database'` | ✅ PASS |
| CLIB-11 | `PATCH` 403 (role menor) → sem formulário de edição, só leitura | no Salvar button, no editable inputs | `MetadataPanel.spec.tsx:137-154` — `canWrite={false}`, `queryByRole('button',{name:'Salvar'})`/`queryByLabelText('Tipo semântico')` both null | ✅ PASS |
| CLIB-12 | Nenhum elemento selecionado → estado vazio, painel montado | empty-state text, panel stays mounted (rerender, not unmount) | `MetadataPanel.spec.tsx:156-179` — `selection=[]` and `selection=['el-1','el-2']` both show the empty text, `fetchImpl` never called | ✅ PASS |
| CLIB-13 | Troca de seleção com edição não salva → descarta sem confirmação | new element's server value shown, unsaved text gone, no dialog | `MetadataPanel.spec.tsx:181-223` — unsaved `'unsaved-edit'` replaced by `'database'` on rerender, `queryByText('unsaved-edit')` null | ✅ PASS |
| CLIB-14 | Abrir inventário → lista via `GET .../inventory` com `elementType`/`semanticType`/`revision` | row contains all three fields | `apps/web/src/library/InventoryView.spec.tsx:33-46` — row text contains `'rectangle'`, `'service'`, `'1'` | ✅ PASS |
| CLIB-15 | Elemento com `elementType:null` → marcado "removido do canvas", não escondido | row still rendered, marked removed | `InventoryView.spec.tsx:48-60` — row2 text contains `'Removido do canvas'`, row still present | ✅ PASS |
| CLIB-16 | "Exportar CSV" → `GET .../inventory?format=csv`, dispara download | exact URL requested, Blob content = server CSV text, click fired, URL revoked | `InventoryView.spec.tsx:62-96` — `fetchImpl` called with `format=csv` URL, `blobArg.text()` resolves to the exact `csvText`, `clickSpy` called once, `revokeObjectURL` called with the mock URL | ✅ PASS |
| CLIB-17 | Lista vazia → estado vazio, não erro | empty text, no table, no error text | `InventoryView.spec.tsx:98-110` — empty text shown, `queryByRole('table')` null, error text absent | ✅ PASS |
| CLIB-18 | Toda ação alcançável só por teclado | every listed action operable via Tab/Enter | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:590-604` — search field + inventory link focus-asserted via `document.activeElement`. `LibraryPanel.spec.tsx:197-221` — insert button + retry button. `MetadataPanel.spec.tsx:268-292` — semantic-type field + Salvar button. `InventoryView.spec.tsx:122-133` — export-CSV button. **6 of the 7 listed actions now have an explicit focus-assertion test** (open panel, search, insert, save, retry, export-CSV); the 7th ("selecionar elemento" on the Excalidraw canvas) is inherent native-canvas keyboard interaction outside this feature's own component tree and is not asserted here — narrow, pre-existing scope boundary, not a regression from the fix | ✅ PASS (see Spec-Precision Note) |
| CLIB-19 | Inserção/salvamento completa (sucesso **ou falha**) → anuncia em `aria-live="polite"` | success AND failure both announced with the spec's own copy | Success: `LibraryPanel.spec.tsx:113-128` (`'Server inserido no canvas'`) and `MetadataPanel.spec.tsx:72-105` (`'Metadados salvos'`). **Failure path** (previously the gap): `MetadataPanel.spec.tsx:107-135` — drives `client.patch` to a `403`, asserts `metadata-announcement`'s text equals `'Não foi possível carregar ou salvar os metadados. Tente novamente.'`, the exact string in `apps/web/src/i18n/locales/pt-BR/translation.json`'s `metadata.error` key (verified by direct read); also asserts the semantic-type field stays at `'service'` (last known-good, never blanked/optimistic) | ✅ PASS |
| CLIB-20 | Todo texto visível vem de i18n, ambos locales (`en`/`pt-BR`) | identical key sets, no literal in component | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` — `library`/`metadata`/`inventory` key sets diffed programmatically, zero divergence in either direction; manual read of `LibraryPanel.tsx`/`MetadataPanel.tsx`/`InventoryView.tsx`/`DiagramEditorPage.tsx`/`InventoryPage.tsx` found every visible string routed through `t(...)`. Locale switch proven at runtime: `DiagramEditorPage.spec.tsx:575-588` | ✅ PASS |

**Status**: ✅ 20/20 clean PASS.

**Citation correction from the prior report**: the prior report cited CLIB-18/20's runtime-locale-switch and focus tests as `App.spec.tsx:575-588`/`:590-604`. Re-derivation found these tests actually live in `apps/web/src/diagram/DiagramEditorPage.spec.tsx` at the same line numbers (`App.spec.tsx` has no CLIB-18/20 tests at all — confirmed by grep). The evidence itself was accurate; only the filename in the citation was wrong. Corrected above.

---

## Discrimination Sensor

Isolated scratch: `git worktree add --detach <scratch> HEAD` (never `git stash`). `node_modules` and
every package's `dist/` cloned via `cp -Rc` (APFS clonefile) from the real tree into the scratch
tree, avoiding a fresh `pnpm install`. Baseline `git status --porcelain` of the real tree was empty
before the sensor ran; confirmed empty again after `git worktree remove --force` (see Gate Check
for the exact commands run).

This re-verification re-targeted the one mutation that survived in the prior pass, to confirm the
fix actually closes it (rather than re-running the full 5-mutation battery, since the other 4 were
already independently confirmed killed last pass and the implementation code they target is
unchanged in the fix commit — `git diff --stat ebef339..HEAD` touches only `*.spec.tsx` and
`.specs/*` files, zero production code).

| # | File:line | Description | Killed? |
| - | --------- | ------------ | ------- |
| 1 | `apps/web/src/library/MetadataPanel.tsx:104-106` | Removed `setAnnouncement(t('metadata.error'))` from the failed-`PATCH` `else` branch (replaced with a comment, no side effect) | ✅ **Killed** — `MetadataPanel.spec.tsx`'s new CLIB-19 test failed: expected `metadata-announcement`'s text to be `'Não foi possível carregar ou salvar os metadados. Tente novamente.'`, received `''`. 1 test file failed, 1 test failed, confirming the new test now discriminates this exact fault |

**Sensor depth**: targeted re-verification of the prior survivor (lightweight tier; production code
outside this one line is unchanged since the last full 5-mutation sensor run, which already
confirmed 4/4 other mutations killed).
**Result**: 1/1 killed — ✅ **PASS**. The prior survivor is closed.

**Isolation verified**: `git status --porcelain` on the real tree was empty immediately before
`git worktree add` and remained empty immediately after `git worktree remove --force` — matches
the baseline exactly, no leftover scratch artifacts.

---

## Code Quality

| Principle        | Status |
| ---------------- | ------ |
| No features beyond what was asked | ✅ — the fix commit adds only test files (`MetadataPanel.spec.tsx`, `LibraryPanel.spec.tsx`, `InventoryView.spec.tsx`) plus `.specs/*` bookkeeping; zero production-code changes |
| No abstractions for single-use code | ✅ |
| No unnecessary "flexibility" added | ✅ |
| Only touched files required for task | ✅ — `git diff --stat ebef339..HEAD`: 3 spec files + `.specs/LESSONS.md`/`lessons.json`/`validation.md` |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns/style | ✅ — new tests follow the exact `fetchImpl` mock / `waitFor` / `screen.getByTestId('metadata-announcement')` conventions already used throughout the file |
| Would senior engineer approve? | ✅ |
| Tests map to acceptance criteria and are non-shallow (spot-check one story) | ✅ — CLIB-19's new test is not shallow: it drives a real `403` response through `client.patch`, asserts the exact announced string (not just "some text appeared"), and additionally asserts the field is not left blank/optimistic — a genuine behavioral assertion, matching the fix task's own remediation description |
| Spec-anchored outcome check: each test's asserted value matches the spec-defined outcome (or gap flagged) | ✅ — 20/20; CLIB-19's asserted string is byte-for-byte the `metadata.error` i18n value |
| Per-layer Coverage Expectation met: domain logic has 1:1 AC mapping; routes/e2e cover happy + edge + error paths for every route in scope | ✅ — `MetadataPanel`'s write path now has happy (CLIB-10), read-only (CLIB-11), and error (CLIB-19) coverage; every other component already had all three |
| Every test in scope maps to a spec AC, listed edge case, or Done-when criterion (no unclaimed tests) | ✅ |
| Documented project quality/testing guidelines followed (cite guideline file, or "none - strong defaults applied") | `.specs/features/component-library/tasks.md`'s own Test Coverage Matrix — followed for every layer |

---

## Edge Cases

- [x] Busca sem match → estado vazio de busca, distinto de biblioteca vazia — `LibraryPanel.spec.tsx:170-183`
- [x] Mesmo `stableKey` em duas bibliotecas visíveis → listado duas vezes, não deduplicado — `LibraryPanel.spec.tsx:185-195`
- [x] `metadataJson` inválido (sintaxe) → validação client-side, PATCH nunca chamado — `MetadataPanel.spec.tsx:225-247`
- [~] Elemento selecionado apagado do canvas → volta a "selecione um elemento" — not tested as a dedicated scenario (selection transitioning to `[]`), but covered by construction via CLIB-12's test (`selection=[]` already forces the empty state); the panel has no code path that distinguishes "never selected" from "was selected, now deleted" — both collapse to the same `selectedElementId === null` branch. Unchanged since the prior report; not part of the CLIB-18/19 fix scope.
- [~] `metadataJson` sintaticamente válido mas não-objeto (array/primitivo) → mesma validação client-side — implemented (`MetadataPanel.tsx:84-86`, `Array.isArray(parsed)` guard) but still **uncovered** by any test (only the syntax-error case is tested, at `MetadataPanel.spec.tsx:225-247`); confirmed via coverage report (`MetadataPanel.tsx` lines 85-86 still show 0% branch coverage after the fix commit). Unchanged since the prior report — pre-existing minor gap, not part of the CLIB-18/19 fix scope, does not affect any CLIB-NN AC (this is an unnumbered spec.md Edge Case, not P1/P2 acceptance criterion).

---

## Gate Check

- **Gate commands run**:
  - `pnpm --filter @arch-canvas/editor-adapter run test:unit`
  - `pnpm --filter @arch-canvas/web run test:unit`
  - `pnpm -w typecheck`
  - `npx biome check apps/web packages/editor-adapter packages/library-content` (scoped)
  - `npx biome check .` (full repo, informational — confirming no new breakage)
- **editor-adapter test:unit**: 64/64 passed (6 files)
- **web test:unit**: 277/277 passed (33 files) — up from 273/273 in the prior report (+4 new tests: CLIB-19 failure-path test + 3 CLIB-18 focus tests)
- **typecheck**: 25/25 workspace tasks passed (full turbo, cache hits + 1 fresh miss on `@arch-canvas/web`)
- **lint (scoped: `apps/web packages/editor-adapter packages/library-content`)**: 103 files checked, 0 errors, 0 warnings
- **lint (full repo, `npx biome check .`)**: 2 errors / 6 warnings, re-confirmed confined to `docs/openapi.json`, `apps/mcp/src/client.spec.ts`, `apps/server/src/modules/auth/users.int.spec.ts`, `tools/repo-tools/src/webConsumers.spec.ts` (re-derived directly by grepping the biome output for file paths, not assumed from the prior report) — none appear in this feature's `git diff --stat c78864d..HEAD`, so pre-existing and unrelated to this feature
- **Skipped**: none

---

## Fix Plans

None. Both gaps from the prior report are closed:

- **CLIB-19** (was: real gap, failure-path announcement untested) — closed by
  `MetadataPanel.spec.tsx:107-135`; discrimination sensor confirms it kills the exact mutation
  that survived last pass.
- **CLIB-18** (was: spec-precision gap, narrow coverage) — closed for 6/7 listed actions;
  the 7th ("selecionar elemento" on the canvas) is native Excalidraw keyboard interaction, out
  of this feature's own component surface — this is a pre-existing, narrow scope boundary, not
  a fix-task-worthy gap.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status   |
| ----------- | ---------------- | ------------ |
| CLIB-01..17, CLIB-20 | ✅ Verified | ✅ Verified (re-confirmed) |
| CLIB-18 | ⚠️ Verified with spec-precision gap | ✅ Verified |
| CLIB-19 | ❌ Needs Fix (test gap) | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 20/20 ACs matched spec outcome cleanly
**Sensor**: 1/1 targeted re-verification mutation killed (prior survivor now closed); 4/4 other mutations from the prior full battery remain valid (production code they target is unchanged in the fix commit)
**Gate**: 341 tests passed (64 editor-adapter + 277 web), 0 failed; typecheck clean; lint clean on every file this feature touches; full-repo lint failures confirmed still confined to 4 pre-existing, unrelated files

**What works**: Every P1 story (browse/search/insert with real SVG icons, external-icon fallback
with zero network egress, semantic classification with 404→blank-form and non-optimistic save,
now including a verified failure-path announcement) and every P2 story (inventory listing with
removed-element marking, CSV export, i18n parity, keyboard reachability for 6/7 actions) is
implemented correctly with solid, spec-anchored, non-shallow test evidence.

**Issues found**: None blocking. Two minor, pre-existing, unnumbered-edge-case residuals noted
above (element-deleted-from-canvas as a dedicated scenario; metadataJson valid-but-wrong-shape) —
both are edge cases in spec.md's Edge Cases section, not P1/P2 acceptance criteria, unchanged
since the prior pass, and out of scope for the CLIB-18/19 fix that was requested.

**Next steps**: None required to ship this slice. If desired, a future minor task could add one
test for the array/primitive `metadataJson` branch (`MetadataPanel.tsx:84-86`) and one for the
canvas-element-deleted transition as an explicit scenario — both optional polish, not gates.
