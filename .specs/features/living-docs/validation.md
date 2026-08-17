# Documentação viva Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/living-docs/spec.md`
**Diff range**: `41cc792..bb19273` (base merge commit `41cc792` → `feature/living-docs` HEAD `bb19273`)
**Verifier**: this session, run as a distinct, adversarial re-derivation pass over `spec.md` — see
**Verifier independence caveat** below for why it is not a separate agent/container.

**Verdict**: **PASS** ✅ — 30/30 acceptance criteria covered with `file:line` evidence, gate green,
3/3 discrimination-sensor mutations killed, real worktree confirmed unmutated after the sensor run.

---

## Verifier independence caveat

The skill's protocol calls for a genuinely fresh sub-agent (author ≠ verifier, no shared context).
This session has no local subagent-spawn tool (`ToolSearch` for `Task`/`Agent`/`SpawnAgent` returns
nothing), and the only cross-session mechanism available
(`mcp__Claude_Code_Remote__create_session`) provisions a **separate container** that would need
this branch's commits reachable via a `source_url` — i.e. pushed to GitHub, which this task's hard
constraints explicitly forbid ("Never git push"). Spawning a container-isolated Verifier was
therefore not achievable without violating a harder constraint than the Verifier's own isolation
preference.

**What was done instead, to preserve as much of the intent as the tooling allows:** this pass is
mechanically independent even though it runs in the same session — every acceptance criterion below
was re-derived by reading `spec.md`'s literal text fresh (not from memory of the implementation),
matched against `grep`-located test assertions, cited with `file:line` evidence (evidence-or-zero:
no citation ⇒ not covered), and the discrimination sensor ran for-real against isolated file copies,
never against the author's own belief that the tests are adequate. This is disclosed here rather
than silently presented as full author/verifier separation — flagged prominently in the final report
to the parent orchestrator as something a human or a genuinely separate session should redo if
strict process conformance matters more than the evidence already gathered.

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | `apps/server/src/modules/docgen/routes.ts` — `markdownUrl` on all 3 responses |
| T2   | ✅ Done | `apps/web/src/docs/docgenClient.ts` |
| T3   | ✅ Done | `apps/web/src/docs/parseSpecMarkdown.ts` |
| T4   | ✅ Done | `apps/web/src/docs/SpecViewer.tsx` |
| T5   | ✅ Done | `apps/web/src/docs/DocsPanel.tsx` |
| T6   | ✅ Done | `DiagramEditorPage.tsx` wiring + `docs/route-inventory.md` regenerated |
| T7   | ✅ Done | `apps/web/src/docs/DocsPanel.a11y.spec.tsx` |

---

## Spec-Anchored Acceptance Criteria

### P1: Ver as versões geradas e gerar uma nova (LDC-01..11)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LDC-01 mount emits `GET .../specs` once, lists versions | Exactly 1 call to that URL; items rendered | `apps/web/src/docs/DocsPanel.spec.tsx:76-78` — `expect(items).toHaveLength(1)`; `expect(calls.filter(...)).toHaveLength(1)` | ✅ PASS |
| LDC-02 loading message while `GET` pending | Loading text visible pre-resolution | `apps/web/src/docs/DocsPanel.spec.tsx:93` — `expect(screen.getByText('Carregando documentação…')).toBeTruthy()` (assertion runs synchronously, before the mocked promise ever resolves) | ✅ PASS |
| LDC-03 non-200 → generic error, list stays empty | Error text shown; 0 version items | `apps/web/src/docs/DocsPanel.spec.tsx:111,113` — error text + `toHaveLength(0)` | ✅ PASS |
| LDC-04 empty list → empty state, distinct from loading/error | Empty-state text | `apps/web/src/docs/DocsPanel.spec.tsx:130` | ✅ PASS |
| LDC-05 `nextCursor` → "Carregar mais" fetches next page, appends | 2nd `GET` with `?cursor=`; list grows to 2 | `apps/web/src/docs/DocsPanel.spec.tsx:141-144` (mock branches on exact cursor URL) + `:160` `toHaveLength(2)` | ✅ PASS |
| LDC-06 "Gerar documento" only under `canMutate` | Absent when false, present when true | `apps/web/src/docs/DocsPanel.spec.tsx:177,187` | ✅ PASS |
| LDC-07 click → `POST :generate`, no body | `fetchImpl` called with `{method:'POST'}`, no `body` key | `apps/web/src/docs/DocsPanel.spec.tsx:198` — `expect(init).toEqual({ method: 'POST' })` | ✅ PASS |
| LDC-08 `201` → prepend+select, no extra `GET` | `listCalls === 1` after generate; new content shown | `apps/web/src/docs/DocsPanel.spec.tsx:220-221` | ✅ PASS |
| LDC-09 `403` → permission-denied message | Exact pt-BR string `'Você não tem permissão para gerar um documento.'` | `apps/web/src/docs/DocsPanel.spec.tsx:248` | ✅ PASS |
| LDC-10 other failure → generic error | Exact string `'Algo deu errado. Tente de novo.'` | `apps/web/src/docs/DocsPanel.spec.tsx:278` | ✅ PASS |
| LDC-11 in-flight generate → 2nd click no 2nd `POST` | `generateCalls === 1` after 2 clicks | `apps/web/src/docs/DocsPanel.spec.tsx:317` | ✅ PASS |

### P1: Ler o conteúdo de uma versão, seção a seção (LDC-12..19)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LDC-12 select → `fetch(markdownUrl)` direct | Content from that URL rendered | `apps/web/src/docs/DocsPanel.spec.tsx:350` — `overview body` text from `DOCUMENT_MARKDOWN` fetched via `spec.markdownUrl` | ✅ PASS |
| LDC-13 loading message while content fetch pending | Loading text visible synchronously right after selection, before the fetch resolves | `apps/web/src/docs/DocsPanel.spec.tsx:348` — `expect(screen.getByText('Carregando conteúdo…')).toBeTruthy()` (gap found during this pass — see "Fix Applied During Verification" below; assertion now in place) | ✅ PASS |
| LDC-14/15 split into 4 fixed sections, each under its title | `SECTION_NAMES` order, exact pt-BR titles | `apps/web/src/docs/SpecViewer.spec.tsx:43` — `toEqual(['Visão Geral','Componentes','Fluxos','Decisões'])` | ✅ PASS |
| LDC-16 (spec numbering: referenced-element list, dedup, ordered) | Exact ordered, deduped list | `apps/web/src/docs/SpecViewer.spec.tsx:60-71` + `apps/web/src/docs/parseSpecMarkdown.spec.ts:94` — `toEqual(['api','db','ui'])` | ✅ PASS |
| LDC-06 (2nd story numbering — orphan id shown, not hidden) | Marked "removido", never absent | `apps/web/src/docs/SpecViewer.spec.tsx:86-87` — `'Elemento: api'` present, `'Elemento removido (db)'` present | ✅ PASS |
| LDC-07 (2nd story) Visão Geral never lists references | No `docs-section-overview-references` node | `apps/web/src/docs/SpecViewer.spec.tsx:101` + `apps/web/src/docs/parseSpecMarkdown.spec.ts:111` (`extractReferencedElementIds` on an overview body → `[]`) | ✅ PASS |
| LDC-18 selecting a version fetches via plain `fetch` | Same as LDC-12 | `apps/web/src/docs/DocsPanel.spec.tsx:350` | ✅ PASS |
| LDC-19 later selection wins over earlier pending fetch | Only the 2nd selection's text visible; 1st's text never appears | `apps/web/src/docs/DocsPanel.spec.tsx:399,402-403` — `'overview body'` shown, `'FIRST CONTENT'` `toBeNull()` after the stale fetch resolves late | ✅ PASS |

### P1: Regenerar uma única seção (LDC-20..27)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LDC-20 control shows only `current && canMutate` | 4 buttons when true | `apps/web/src/docs/SpecViewer.spec.tsx:115` — `toHaveLength(4)` | ✅ PASS |
| LDC-21 (superseded/draft never shows it) | 0 buttons | `apps/web/src/docs/SpecViewer.spec.tsx:129` | ✅ PASS |
| LDC-21 (without `canMutate`, none shows) | 0 buttons | `apps/web/src/docs/SpecViewer.spec.tsx:143` | ✅ PASS |
| LDC-21 click → `onRegenerateSection(name)` | Called once, with `'components'` | `apps/web/src/docs/SpecViewer.spec.tsx:164-165` | ✅ PASS |
| LDC-22 click → `POST :regenerate-section` `{section}` against `current` version | Exact body/headers | `apps/web/src/docs/DocsPanel.spec.tsx:422-426` — `expect(init).toEqual({method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({section:'components'})})` | ✅ PASS |
| LDC-23/24 `201` → prepend+select, mark prior `current` as `superseded` in list | New item `'Atual'`, old item `'Substituída'`, announced | `apps/web/src/docs/DocsPanel.spec.tsx:455-457` | ✅ PASS |
| LDC-25 `403` → permission message, version unchanged | Exact string; list length unchanged, same content shown | `apps/web/src/docs/DocsPanel.spec.tsx:493,497-498` | ✅ PASS |
| LDC-26 `404` → "version no longer exists" | Exact string `'Essa versão não existe mais.'` | `apps/web/src/docs/DocsPanel.spec.tsx:534` | ✅ PASS |
| LDC-27 in-flight regenerate → 2nd click no 2nd `POST` | `regenerateCalls === 1` | `apps/web/src/docs/DocsPanel.spec.tsx:581` | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas (LDC-28..30)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LDC-28 every action keyboard-reachable | `.focus()` reaches version-select, "Carregar mais", "Gerar documento", regenerate button | `apps/web/src/docs/DocsPanel.a11y.spec.tsx:131,135,139,148` — `expect(document.activeElement).toBe(...)` per control | ✅ PASS |
| LDC-29 outcomes announced `aria-live=polite` | Region has that attribute, text updates to the exact forbidden-message string | `apps/web/src/docs/DocsPanel.a11y.spec.tsx:173,178` | ✅ PASS |
| LDC-30 all chrome text from i18n, both locales | en strings render after `changeLanguage('en')` mid-session | `apps/web/src/docs/DocsPanel.a11y.spec.tsx:203-213` — heading/button/status/reference labels all asserted in en | ✅ PASS |

**Status**: ✅ All 30 ACs covered with direct PASS. LDC-13 started this pass as a gap (the outcome
the AC describes genuinely happened — `DocsPanel.tsx:202` renders `docs.contentLoading` while
`contentStatus === 'loading'` — but no test asserted it explicitly, only exercised the code path
implicitly on the way to `overview body`) and was fixed inline during this pass, not deferred — see
"Fix Applied During Verification" below. The table above reflects the post-fix state.

---

## Fix Applied During Verification

**Issue**: LDC-13 (content-loading state) had implicit but not explicit coverage.

**Fix**: added one assertion to `DocsPanel.spec.tsx`'s existing LDC-12/18 test (same test, +1
assertion — test count unchanged at 76 files/743, assertion count +1), asserting the loading text
is visible synchronously right after the version-select click, before `findByText` resolves it
away — the same "assert before await" pattern LDC-02 already uses for the list's own loading state.

```ts
fireEvent.click(within(item).getByRole('button', { name: 'Versão 1' }));
expect(screen.getByText('Carregando conteúdo…')).toBeTruthy(); // LDC-13
await waitFor(() => expect(screen.getByText('overview body')).toBeTruthy());
```

Applied to `apps/web/src/docs/DocsPanel.spec.tsx` (LDC-12/18 test), verified green (76 files / 743
tests, unchanged count — this strengthens an existing test rather than adding a new one), re-ran
`make lint && make typecheck`. Committed as `test(living-docs): assert LDC-13's content-loading
state explicitly` (Verifier fix commit, see below) — a genuine gap this pass found, not a
hypothetical.

---

## Discrimination Sensor

Method: fallback (file-copy backup → in-place mutate → run → restore from backup → verify
`git status --porcelain` matches the pre-sensor baseline), per `validate.md`'s explicitly sanctioned
fallback. A `git worktree add` scratch was attempted first but abandoned: this monorepo resolves
internal `@arch-canvas/*` packages via their built `dist/` output (not raw TS source), and a fresh
worktree checkout has no `dist/` (gitignored) — running would have required a full `pnpm -w build`
in the scratch first, adding several minutes for no isolation benefit the copy-and-restore method
doesn't already provide. Baseline `git status --porcelain` was empty before the sensor ran, and
empty again after — confirmed after each individual mutation, not just once at the end.

| # | File:line | Description | Killed? |
| - | --------- | ------------ | ------- |
| 1 | `apps/server/src/modules/docgen/routes.ts:152` | List route: `const specs = await Promise.all(result.specs.map((spec) => withMarkdownUrl(storage, spec)));` → `const specs = result.specs;` (drops `markdownUrl` from every list row) | ✅ Killed — `docgen.int.spec.ts` fails: `expected undefined to be 'https://fake-storage.test/...'` |
| 2 | `apps/web/src/docs/parseSpecMarkdown.ts:71` | `if (token === undefined \|\| seen.has(token)) continue;` → `if (token === undefined) continue;` (drops dedup) | ✅ Killed — `parseSpecMarkdown.spec.ts` fails: `['api','db','ui','api','api','db']` ≠ `['api','db','ui']` |
| 3 | `apps/web/src/docs/DocsPanel.tsx:128` | `if (regeneratingSection) return;` → `if (false) return;` (drops the LDC-27 double-submit guard) | ✅ Killed — `DocsPanel.spec.tsx`'s LDC-27 test fails: `expected 2 to be 1` |

**Sensor depth**: lightweight (3 targeted mutations, one per layer touched by this feature: server
route, pure frontend logic, React container state guard) — proportional per `validate.md`'s tiering
table for a non-P0 feature.
**Result**: 3/3 killed — ✅ PASS

---

## Code Quality

| Principle | Status |
| --- | --- |
| No features beyond what was asked | ✅ — scope matches spec.md's Goals/Out of Scope exactly |
| No abstractions for single-use code | ✅ |
| No unnecessary "flexibility" added | ✅ |
| Only touched files required for each task | ✅ — verified via `git diff --stat 41cc792..HEAD`: 19 files, all in `apps/server/src/modules/docgen`, `apps/web/src/docs`, `apps/web/src/diagram`, `apps/web/src/i18n`, `docs/route-inventory.md`, `.specs/features/living-docs` |
| Didn't "improve" unrelated code | ✅ — the one pre-existing-bug discovery (`snapshotClient.ts`'s identical `doFetch` naming gap) was documented, not silently fixed |
| Matches existing patterns/style | ✅ — `docgenClient.ts` mirrors `snapshotClient.ts`/`memberClient.ts`; `DocsPanel.tsx` mirrors `HistoryPanel.tsx`; `SpecViewer.tsx`/`DocsPanel.tsx` split mirrors `HistoryPanel`/`DiffView` |
| Would senior engineer approve? | ✅ |
| Tests map to acceptance criteria and are non-shallow (spot-check LDC-19) | ✅ — LDC-19's race-guard test asserts the actual DOM content shown, not a call count, and would fail under a plausible wrong implementation (no request-id guard) |
| Spec-anchored outcome check | ✅ — see AC table; every PASS row targets spec's exact literal outcome (status text, HTTP method/body, list length) |
| Per-layer Coverage Expectation met | ✅ — server route: happy + int-test-level edge paths already existing plus the new field; web client: one branch per documented status; web components: 1:1 to spec ACs |
| Every test maps to a spec AC / Done-when / edge case (no unclaimed tests) | ✅ — spot-checked `DocsPanel.spec.tsx`'s 16 (now 17) tests and `SpecViewer.spec.tsx`'s 8: every `it()` title cites an `LDC-NN` or names a Done-when behavior traceable to spec.md |
| Documented guidelines followed | `CLAUDE.md` (gate commands), `apps/web`/`apps/server` `vitest.config.ts` coverage floors — both respected (per-package suites green; global coverage floors are workspace-level and untouched by this diff's file selection) |

---

## Edge Cases

- [x] Malformed Markdown (missing heading) → empty section, no throw — `parseSpecMarkdown.spec.ts:52-75`
- [x] Same `elementId` referenced by two sections → listed independently per section, not deduped across sections — by construction (`extractReferencedElementIds` runs per-section-body, no cross-section state); not independently tested but structurally guaranteed by the pure-function signature (`SectionName → string[]`, no shared state)
- [x] No versions generated → no regenerate controls anywhere — `DocsPanel.spec.tsx:130` (empty state renders no `SpecViewer` at all, so no regenerate button can exist)
- [x] Placeholder body (`pergunta aberta`/`não especificado`) → shown as normal text, no special handling — `parseSpecMarkdown.spec.ts:97-99`
- [x] Panel closed/reopened (`<details>`) keeps prior selection/content — structural: `DocsPanel` state lives in the mounted React component; `<details>` toggling is pure CSS visibility (`DiagramEditorPage.tsx`'s `<details>` block, same as Library/Metadata), never unmounts — not independently tested (would require a `DiagramEditorPage`-level test with `<details>` toggle simulation), flagged as a minor gap, not blocking (the mechanism is the same one already proven for Library/Metadata's own persistence-across-toggle, which those features didn't test explicitly either)

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit && make test-integration` (full — this feature touches a server route + its integration tests)
- **Result**:
  - `make lint`: 0 errors, 6 warnings (pre-existing, unrelated to this diff — confirmed via `git stash` in the T1 commit)
  - `make typecheck`: 25/25 packages green
  - Server unit: 39 files / 400 tests passed
  - Server integration (full suite, not just docgen): 52 files / 369 tests passed
  - Web unit (full suite): 76 files / 743 tests passed (assertion added to an existing test during
    this pass; test count unchanged)
- **Test count before feature**: server unit ~388 (400 − ~12 new server-side markdown-url assertions,
  which are additions to existing files, not new files) / server integration baseline unchanged file
  count / web unit 71 files, 695 tests (measured directly, T4 commit message)
- **Test count after feature**: web unit 76 files, 743 tests (+5 files, +48 tests)
- **Delta**: +48 web tests, +2 server integration assertions, +1 web assertion added to an existing
  test during this Verifier pass (additive to existing files)
- **Skipped tests**: none
- **Failures**: none (workspace-root `make test-unit` has 2 known pre-existing failures unrelated to
  this feature — `tools/repo-tools`'s stale `webConsumers.spec.ts` literal-count assertion, and an
  environment-only Turborepo-parallel-runner `EPIPE` flake in `apps/web`'s suite that does not
  reproduce running `apps/web` directly — both confirmed via `git stash` before any of this feature's
  changes existed, documented in the T1 commit message)

---

## Fix Plans

None outstanding — the one gap found (LDC-13 explicit assertion) was fixed inline during this pass,
not deferred (see "Fix Applied During Verification" above).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| LDC-01 .. LDC-30 (all 30) | Implementing | ✅ Verified |

(`spec.md` updated in the same commit as this report.)

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 30/30 ACs covered with `file:line` evidence (1 — LDC-13 — found uncovered
during this pass and fixed inline before this report was finalized; all 30 now direct PASS)
**Sensor**: 3/3 mutations killed
**Gate**: server unit 400 passed, server integration 369 passed, web unit 743 passed, 0 failed
(feature scope); lint 0 errors, typecheck 0 errors

**What works**: List/generate/paginate versions; read any version's content split into 4 sections
with per-section referenced-element lists (orphans shown, not hidden); regenerate a single section
of the current version with correct list reconciliation; full keyboard reachability and bilingual
chrome; the 3 docgen routes now show `consumed` in `docs/route-inventory.md`.

**Issues found**: 1 — LDC-13's loading-state assertion was implicit rather than explicit; fixed
inline (see above), not left as a gap.

**Next steps**: None required for this feature. Two items are worth a human's attention, both
already flagged in-repo rather than silently left implicit:
1. `snapshotClient.ts` (from `history-snapshots`, R6) has the same `doFetch`-naming gap this pass
   fixed in `docgenClient.ts` — its 2 routes still show `pending-product` in the route inventory
   despite being genuinely consumed. Not this feature's scope to fix.
2. **True author≠verifier session isolation was not achievable** with this session's available
   tools (see "Verifier independence caveat" above) — if strict process conformance is required, a
   human or a separate agent session with access to this branch (e.g. after it is pushed/merged)
   should re-run the spec-anchored check independently. The evidence gathered here (file:line
   citations, gate results, and the 3 killed mutations) is real and reproducible regardless of who
   re-runs it.
