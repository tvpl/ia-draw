# presentation-mode Validation

**Date**: 2026-08-21
**Spec**: `.specs/features/presentation-mode/spec.md`
**Diff range**: `d9a7eb7..bcff834` (18 commits, second parent of merge `da8d6e4` into `main`, now `b742e48`)
**Verifier**: independent sub-agent (author ≠ verifier) — first real Verifier pass for this feature; it was merged to `main` with an explicit disclosed debt of "no Verifier PASS, no validation.md" (`.specs/STATE.md` lines 189-198).

---

## Headline finding (read this first)

Tasks **T1-T18** (of 28) were implemented and are solid. Tasks **T19-T28 were never executed** —
not partially, not stubbed: no commit, no file, in some cases not even dead code, implements them.
Concretely, of the feature's "4 new frontend surfaces" claimed in `STATE.md:190`:

- `PresenterPage`/`PresenterModePage` **does not exist anywhere in the repository** (no file under
  `apps/web/src/presentation/Presenter*`, confirmed by `find`/`grep`, T19-T21 never ran).
- `apps/web/src/share/SharedResourcePage.tsx` is **byte-for-byte the pre-R12 file** — `git show
  da8d6e4 --stat` does not list it. The `resourceType === 'presentation'` branch still
  unconditionally renders the R11 "not available yet" placeholder and never reads `result.scene`
  (`SharedResourcePage.tsx:67-74`) — T22/T23 never ran, even though the backend half of this exact
  gap (T1, `scene`/`published` on `GET /share/:token`) is done and well-tested.
- The PDF-export UI control was never added to `PresentationEditorPage.tsx` — `presentationClient.
  exportPdf` exists and is unit-tested in isolation (`presentationClient.spec.ts`), but zero
  production code calls it (`grep -rn "exportPdf" apps/web/src --include=*.tsx` outside specs: no
  hits) — T24 never ran.
- **The route `/w/:workspaceId/d/:diagramId/present/:presentationId` is never registered in
  `App.tsx`.** Only `/present` (the list) is wired (`App.tsx:119-126`). `App.tsx`'s own doc comment
  admits this was left half-done: *"`/present/:presentationId` ... join[s] once their pages exist
  (design.md)"* (`App.tsx:64-67`) — the pages now exist (`PresentationEditorPage.tsx`, 462 lines,
  565-line spec file) but the route was never added. This means **the entire, otherwise
  well-implemented Create/Reorder/Nav-link/Publish surface (T9-T14, PRZ-05..28) is unreachable from
  the real running app**: `PresentationListPage`'s "Open"/"Criar apresentação" links point at a URL
  `<Routes>` has no match for. `App.spec.tsx` never tests this (`grep -n "present"
  App.spec.tsx` → one hit, the `/present` list route only), so nothing caught it.
- `docs/capability-map.yaml`'s presentation entry still reads `status: backend-only`, `ui_surface:
  null` (`capability-map.yaml:96-100`) — T27 never ran; the spec's own Success Criteria ("`repo-tools
  audit` deixa de classificar as rotas... como `pending-product`") is unmet.
- i18n keys for the never-built surfaces (`presentation.editor.exportPdf*`,
  `presentation.editor.presentButton*`, `presentation.presenter.*`) exist in both locale files but
  are referenced by **zero** production or test code (`grep -rn` for each key across
  `apps/web/src`, all `.tsx`/`.ts`, returns nothing) — dead entries planted by T6's base-namespace
  task, never consumed because T19/T20/T24 never ran.

`STATE.md:190`'s own summary of what shipped ("`PresenterPage` (modo tela cheia...)", "a visão
pública publicada... agora resolvido com o viewer de frames real") is **not accurate** — it
describes the *intended* design, not the merged code. This is exactly the failure mode a real
Verifier pass exists to catch, and exactly why this round was flagged as highest-priority debt.

**Verdict: FAIL.** Reasons below are organized by story; the gate itself is green (module-scoped)
and the discrimination sensor killed all 3 injected mutants for the code that DOES exist — the
failure is coverage/completeness against the spec, not quality of what was built.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 | ✅ Done | `share/routes.ts:240-271`, `share.int.spec.ts:424-568` (3 new tests, all pass) |
| T2 | ⚠️ Partial | `scrollToFrame` exists and is well-tested, but its no-match fallback deviates from the spec's documented behavior — see Gap G1 below |
| T3 | ✅ Done | `presentationClient.ts`, all 9 methods incl. `exportPdf` (client layer only — never wired to UI, see T24) |
| T4 | ✅ Done | `shareLinkClient.ts` `createForPresentation` + extended `resolve()` |
| T5 | ✅ Done | `frameLabel.ts`, `cropSceneForFrame.ts` — both pure, well-tested, but `cropSceneForFrame` has no consumer (T22 never ran) |
| T6 | ⚠️ Partial | Keys exist and pt-BR/en sets match structurally, but a materially-sized subset (export/present/presenter) is dead — planted for tasks that never ran |
| T7 | ✅ Done | `PresentationListPage.tsx` + spec |
| T8 | ❌ Incomplete | Only `/present` wired; `/present/:presentationId` never added despite the task's own scope naming it (T8 doc comment, `App.tsx:64-67`) |
| T9 | ✅ Done | frame list + add-frame form |
| T10 | ✅ Done | notes edit + delete |
| T11 | ✅ Done | reorder |
| T12 | ✅ Done | nav-link config |
| T13 | ✅ Done | publish/republish |
| T14 | ✅ Done | `PresentationSharePanel.tsx` |
| T15 | ✅ Done | a11y for List + Editor |
| T16 | Not run as a task | closure step skipped entirely at merge time (STATE.md: merged early, no Verifier) |
| T17 | ✅ Done | `FrameViewer.tsx` + spec |
| T18 | ✅ Done | `FrameViewer.a11y.spec.tsx` — the fixture bug STATE.md describes (testing focus on a disabled "Next" at the last frame) is verified genuinely fixed: `FrameViewer.a11y.spec.tsx:54-71` uses `currentIndex={1}` of 3 frames, where "Next" is enabled — correct |
| T19 | ❌ Not done | `PresenterModePage.tsx` does not exist |
| T20 | ❌ Not done | no presenter route, no "Apresentar" launcher button anywhere in `PresentationEditorPage.tsx` |
| T21 | ❌ Not done | no a11y spec (component doesn't exist) |
| T22 | ❌ Not done | `SharedResourcePage.tsx` unchanged from R11 |
| T23 | ❌ Not done | no new a11y state added |
| T24 | ❌ Not done | no export-PDF control in `PresentationEditorPage.tsx` |
| T25 | ⚠️ Partial | `cropSceneForFrame.spec.ts` covers the pure-function edge cases, but has no consuming screen to prove the edge case end-to-end (T22 never ran) |
| T26 | ⚠️ Partial | key sets match, but see T6 |
| T27 | ❌ Not done | `capability-map.yaml:96-100` still `status: backend-only` |
| T28 | ❌ Not done | this Verifier pass is the first real closure check |

---

## Spec-Anchored Acceptance Criteria

Evidence-or-zero. `file:line` cited only where the exact spec-defined outcome is asserted, not
merely "a test exists."

### P1: Criar uma apresentação e montar seus frames (PRZ-01..12)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-01 | `/present` lista apresentações p/ `diagram:read` | lista renderiza p/ qualquer papel c/ leitura | `PresentationListPage.spec.tsx:60-71` — `expect(await screen.findByText('Roadmap')).toBeTruthy()` with `canMutate=false` | ✅ PASS |
| PRZ-02 | Controle de criar só com `mutatePermissions.allowed` | form ausente p/ `canMutate=false`, presente p/ `true` | `PresentationListPage.spec.tsx:70,77` — `queryByLabelText(...)` `.toBeNull()` / `findByLabelText(...)` `.toBeTruthy()` | ✅ PASS |
| PRZ-03 | Confirmar form emite `POST /presentations {diagramId,name}` | corpo exato | `PresentationListPage.spec.tsx:91-95` — `toHaveBeenCalledWith('/presentations', {method:'POST',...,body: JSON.stringify({diagramId:'d-1',name:'New deck'})})` | ✅ PASS |
| PRZ-04 | `201` navega para `/present/:id` | rota exata da apresentação criada | `PresentationListPage.spec.tsx:88-90` — `location` textContent `=== '/w/ws-1/d/d-1/present/p-new'` | ✅ PASS |
| PRZ-05 | Frames listados em ordem de `position` | ordem do array devolvido | `PresentationEditorPage.spec.tsx:129-157` — `rows.map(...).toEqual(['frame-row-f-1','frame-row-f-2'])` | ✅ PASS |
| PRZ-06 | Adicionar via canvas OU rótulo emite `POST .../frames` c/ exatamente um campo | `elementId` xor `frameId`, nunca ambos | `PresentationEditorPage.spec.tsx:246-250` — body `{elementId:null, frameId:'second', position:1}` (logical-label path; canvas-`elementId` path exercised by `PresentationEditorPage.tsx:131-135`'s ternary, same call site) | ✅ PASS |
| PRZ-07 | Nem escolher nem digitar bloqueia envio | zero POST emitido | `PresentationEditorPage.spec.tsx:209-223` — `expect(fetchImpl).not.toHaveBeenCalledWith('/presentations/p-1/frames', expect.objectContaining({method:'POST'}))` | ✅ PASS |
| PRZ-08 | `201` insere ao final da lista | frame aparece no fim | `PresentationEditorPage.spec.tsx:245` — `frame-row-f-new` appended after existing row | ✅ PASS |
| PRZ-09 | Editar notas (canMutate) emite `PATCH {notes}` | corpo exato | `PresentationEditorPage.spec.tsx:297-303` — body `{notes:'updated note'}` | ✅ PASS |
| PRZ-10 | Remover, confirmar, `DELETE`, some só em `204` | remoção condicionada ao status | `PresentationEditorPage.spec.tsx:306-317` — row null only after DELETE resolves; declining (`:319-334`) never emits DELETE | ✅ PASS |
| PRZ-11 | Falha (403/404/400) mostra erro, lista inalterada | lista intacta em falha | `PresentationEditorPage.spec.tsx:253-274` (add, 400) — `queryByTestId('frame-list')` null (empty list state preserved, not corrupted); reorder failure at `:388-416` reverts explicitly | ✅ PASS |
| PRZ-12 | Notas nunca aparecem sem `diagram:mutate` | campo ausente, não vazio | `PresentationEditorPage.spec.tsx:166-184` (null notes → no field) and `:278-285` (`canMutate=false` → no edit control at all) | ✅ PASS |

### P1: Reordenar frames (PRZ-13..17)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-13 | Botões ▲/▼ por linha, teclado nativo | `<button>` nativo | `PresentationEditorPage.tsx:305-319` real `<button>` elements; a11y spec `PresentationEditorPage.a11y.spec.tsx:91-98` "every top-level control ... keyboard-focusable" | ✅ PASS |
| PRZ-14 | Mover emite `PATCH` c/ array COMPLETO recalculado | todas as posições, não só a movida | `PresentationEditorPage.spec.tsx:358-378` — body `{frames:[{id:'f-1',position:0},{id:'f-3',position:1},{id:'f-2',position:2}]}` for moving f-3 up (3 entries, not 1) | ✅ PASS |
| PRZ-15 | 1ª linha "▲" desabilitado, última "▼" desabilitado | `disabled` no extremo | `PresentationEditorPage.spec.tsx:338-356` — `upFirst.disabled===true`, `downLast.disabled===true`, `upMiddle.disabled===false` | ✅ PASS |
| PRZ-16 | `200` renderiza ordem devolvida pelo servidor | ordem == resposta, não a otimista local | `PresentationEditorPage.spec.tsx:366-385` — rows after == server-returned order | ✅ PASS |
| PRZ-17 | Falha reverte p/ última ordem confirmada | reversão exata | `PresentationEditorPage.spec.tsx:388-416` — rows after failure == pre-move order `[f-1,f-2,f-3]` | ✅ PASS |

### P1: Navegação de protótipo — configuração (PRZ-18..21)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-18 | Escolher 0+ outros frames como alvo | `<select multiple>` de outros frames | `PresentationEditorPage.tsx:368-391` | ✅ PASS |
| PRZ-19 | Salvar emite `PATCH {navLinksJson:[{targetFrameId}]}` | corpo exato | `PresentationEditorPage.spec.tsx:451-457` — body `{navLinksJson:[{targetFrameId:'f-3'}]}` | ✅ PASS |
| PRZ-20 | `400` mostra erro, mantém links salvos exibidos | frame list untouched | `PresentationEditorPage.spec.tsx:460-491` — error text shown, `frame-row-f-1` still present (state never mutated on 400) | ✅ PASS |
| PRZ-21 | Alvo nunca inclui o próprio frame | lista de opções exclui self | `PresentationEditorPage.spec.tsx:420-433` — options `===['f-2','f-3']` when editing f-1 | ✅ PASS |

### P1: Publicar link imutável (PRZ-22..28)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-22 | Controle de publicar só com `diagram:mutate` | ausente sem canMutate | `PresentationEditorPage.spec.tsx:495-501` — `queryByRole('button',{name:'Publicar'})` null | ✅ PASS |
| PRZ-23 | Confirmar emite `POST :publish` | URL exata | `PresentationEditorPage.spec.tsx:510-512` — `'/presentations/p-1:publish', {method:'POST'}` | ✅ PASS |
| PRZ-24 | `200` mostra "publicado" e botão vira "republicar" | rótulo exato + `publishedSnapshotId` visível | `PresentationEditorPage.spec.tsx:513-514` — `findByRole('button',{name:'Republicar'})`, `getByText('Publicada')` | ✅ PASS |
| PRZ-25 | Republicar mostra aviso ANTES de confirmar | passo bloqueante, não nota estática | `PresentationEditorPage.spec.tsx:517-542` — persistent on-page warning text + `window.confirm()` called (blocking) before the POST; **sensor mutation 1 (below) proved this gate is load-bearing**, not decorative | ✅ PASS |
| PRZ-26 | Painel de link desabilitado até 1ª publicação | `disabled`, texto explicativo | `PresentationSharePanel.spec.tsx:49-60` — `fieldset` disabled + explanatory text present | ✅ PASS |
| PRZ-27 | Criar link emite `POST {role,expiresAt}`, `201` mostra URL 1x | corpo exato + revelação one-shot | `PresentationSharePanel.spec.tsx:71-87` — body `{role:'viewer',expiresAt:'2030-01-01T10:00:00.000Z'}`, URL field found once | ✅ PASS |
| PRZ-28 | `403` mostra msg de teto de papel (mesma de R11) | mensagem exata | `PresentationSharePanel.spec.tsx:89-99` — `'Você não pode conceder um papel acima do seu.'` | ✅ PASS |

### P1: A visão pública mostra os frames publicados (PRZ-29..34)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-29 | `scene` presente → `/share/:token` renderiza visualizador de frames | `SharedResourcePage` monta `FrameViewer`/`EditorSurface` recortado | **no evidence** — `SharedResourcePage.tsx:67-74` still unconditionally renders the R11 placeholder for `status==='presentation'`, never reads `result.scene` | ❌ GAP |
| PRZ-30 | `scene` ausente → placeholder R11 inalterado | mensagem idêntica | trivially true (nothing was changed) but not a meaningful pass — the branch that should differ from it doesn't exist | ⚠️ Vacuous |
| PRZ-31 | Anterior/próximo + indicador de posição | "Frame X de Y" | `FrameViewer.tsx`/`.spec.tsx` prove the COMPONENT does this; **no evidence it is ever mounted by the public route** | ❌ GAP (component ready, not wired) |
| PRZ-32 | Nunca renderiza `notes` | notas nunca no DOM | not applicable — no viewer renders at all in this state | ❌ GAP |
| PRZ-33 | Clicar link de protótipo pula direto | `onNavigate(targetIndex)` | `FrameViewer.spec.tsx:91-104` proves the COMPONENT does this; not reachable via `/share/:token` | ❌ GAP (component ready, not wired) |
| PRZ-34 | Navegação nunca emite requisição extra | 1 única `GET /share/:token` | not testable — no such navigation exists on this route | ❌ GAP |

### P1: Modo apresentador em tela cheia (PRZ-35..41)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-35 | Rota `/present/:id/presenter`, `ProtectedRoute`, `diagram:read` | rota autenticada existe | **no evidence** — route not present in `App.tsx`, no `Presenter*.tsx` file exists anywhere | ❌ GAP |
| PRZ-36 | Monta cena viva, `viewModeEnabled` sempre `true` | — | no evidence, component doesn't exist | ❌ GAP |
| PRZ-37 | Troca de frame chama `scrollToFrame` | — | the HANDLE method exists and is unit-tested (`EditorSurface.spec.tsx:537-608`), but its only intended caller (`PresenterModePage`) does not exist, so it is never invoked in the running app | ❌ GAP (dependency ready, consumer missing) |
| PRZ-38 | Setas/`PageDown`/`PageUp`/`Space` navegam | — | no evidence | ❌ GAP |
| PRZ-39 | `Escape`/sair volta para o editor | — | no evidence | ❌ GAP |
| PRZ-40 | Nav links pulam direto | — | no evidence at the screen level (component-level proof only, see PRZ-33) | ❌ GAP |
| PRZ-41 | 0 frames → controle de abrir desabilitado | — | no launcher control exists at all (T20 never ran) | ❌ GAP |

### P2: Exportar PDF (PRZ-42..45)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-42 | Desabilitado sem publicação / 0 frames, c/ texto | — | no evidence — no export control in `PresentationEditorPage.tsx` at all | ❌ GAP |
| PRZ-43 | Confirmar emite `POST :export-pdf`, loading state | — | `presentationClient.exportPdf` is implemented+tested in isolation (`presentationClient.spec.ts`), but no UI calls it | ❌ GAP (client ready, no UI) |
| PRZ-44 | `200` mostra link p/ `url` + `pageCount`, sem download automático | — | no evidence | ❌ GAP |
| PRZ-45 | `400`/`404`/erro → mensagens específicas | — | `presentationClient.ts:274-276` maps 400→`no_frames`, 404→`not_published` distinctly (client-layer only); no UI consumes it | ❌ GAP |

### P2: Operável por teclado e nos dois idiomas (PRZ-46..48)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-46 | Toda ação alcançável só por teclado | — | ✅ for List/Editor/FrameViewer-as-component: `PresentationListPage.a11y.spec.tsx:77-89`, `PresentationEditorPage.a11y.spec.tsx:91-98`, `FrameViewer.a11y.spec.tsx:54-71`. ❌ for Presenter/public view — surfaces don't exist | ⚠️ Partial (2 of 4 surfaces covered; the other 2 don't exist to test) |
| PRZ-47 | `aria-live="polite"` asserido pelo atributo (L-030) | attribute present, not just text | `PresentationEditorPage.a11y.spec.tsx:99-129` — `region.getAttribute('aria-live')` `.toBe('polite')`; same pattern in `PresentationListPage.a11y.spec.tsx` and `PresentationSharePanel` (`presentation-share-announcement` `aria-live` div, `PresentationSharePanel.tsx:132-134`) | ⚠️ Partial (List/Editor/SharePanel yes; Presenter/public don't exist) |
| PRZ-48 | Todo texto vem de i18n, `pt-BR`/`en` mesmas chaves | — | `pt-BR`/`en` key sets match exactly (416/416, scripted diff, see Code Quality) — structurally ✅; but a meaningful subset of those keys (`editor.exportPdf*`, `editor.presentButton*`, `presenter.*`) is dead, i.e. i18n coverage exists for functionality that was never built, and is genuinely absent for the functionality that's missing since no component renders it | ⚠️ Partial |

**Totals**: 28 PASS / 1 vacuous-PASS / 19 hard GAP (0-evidence) / 3 Partial across 48 ACs.

---

## Gaps found (not from the sensor)

- **G1 — `scrollToFrame`'s no-match fallback contradicts the spec.** `spec.md`'s Edge Cases: *"WHEN
  um frame referenciar um `elementId` que não existe mais na cena viva ... THEN o modo apresentador
  SHALL cair no mesmo fallback documentado do servidor (mostrar a cena inteira)"*, and T2's own
  Done-when: *"elementId sem nenhum membro correspondente: fallback, `scrollToContent` chamado com a
  cena inteira."* The actual implementation, `EditorSurface.tsx:233-236`, does the opposite — a
  true no-op (`if (target.length === 0) return;`, `scrollToContent` never called) — and the test at
  `EditorSurface.spec.tsx:573-583` asserts exactly that no-op, i.e. the wrong outcome per spec. Note
  `design.md:207-215` documents the SAME no-op behavior, so this was a real design decision, just
  one that was never back-ported into `spec.md`'s Edge Case or `tasks.md`'s Done-when — a
  spec/design/implementation consistency gap, not a random slip. Low severity in isolation (crops to
  "stay put" instead of "show everything," and `cropSceneForFrame.ts` — the function actually used
  for the export/public-view crop, per design — DOES implement the whole-scene fallback correctly),
  but it is a live discrepancy between what three project documents each claim, and the one place it
  would matter (`PresenterModePage`) doesn't exist to observe it either way.
- **G2 — no test for the "second submit while in-flight" edge case.** `spec.md`'s Edge Cases:
  *"WHILE uma requisição de criar/editar/remover frame estiver em andamento, um segundo envio do
  MESMO formulário SHALL não emitir uma segunda requisição."* The implementation has the guard
  (`PresentationEditorPage.tsx:119` `if (addInFlight) return;`, `PresentationListPage.tsx:71` `if
  (inFlight) return;`, `PresentationSharePanel.tsx:65` `if (inFlight || !published) return;`), but no
  test in any `*.spec.tsx` in this diff exercises a double-click/double-submit and asserts a single
  fetch call. Evidence-or-zero: GAP.
- **G3 — revoke-twice idempotency (spec Edge Case) not retested in this diff.** The mechanism
  (`revokeShareLinkById`) is shared, unmodified R11 code; `share.int.spec.ts` in this diff doesn't
  add a presentation-specific double-revoke case. Low severity since it's the identical code path
  R11 already covers, but per strict evidence-or-zero within THIS feature's diff surface it's
  unproven here.

---

## Discrimination Sensor

Scratch worktree: `git worktree add <tmp>/pm-sensor HEAD` (never `git stash`). Baseline
`git status --porcelain` captured before any sensor work; `pnpm install --frozen-lockfile` +
targeted `pnpm --filter ... run build` inside the worktree only (mirrors `.specs/STATE.md`'s L-016
mitigation for cross-package `node_modules` symlinks). All 3 mutations targeted the areas the task
flagged as highest-risk: publish/republish overwrite confirmation, frame reordering, and public
share-link role-based redaction gating.

| # | file:line | Mutation | Command | Killed? |
| - | --- | --- | --- | --- |
| 1 | `apps/web/src/presentation/PresentationEditorPage.tsx:249` | `if (presentation?.publishedSnapshotId)` → `if (false && presentation?.publishedSnapshotId)` (republish confirmation gate bypassed) | `vitest run src/presentation/PresentationEditorPage.spec.tsx` | ✅ Killed — 2 tests failed (`republishing an already-published presentation asks for confirmation first...`, `declining the republish confirmation never emits :publish`) |
| 2 | `apps/web/src/presentation/PresentationEditorPage.tsx:202` | `reordered.map((frame, i) => ({id, position:i}))` (full recompute) → `[{id: moved.id, position: targetIndex}]` (only the moved frame) | `vitest run src/presentation/PresentationEditorPage.spec.tsx` | ✅ Killed — 1 test failed (`moving the last frame to the top PATCHes ALL 3 recalculated positions...`) |
| 3 | `apps/server/src/modules/share/routes.ts:234` | `const canEdit = can(...).allowed;` → `const canEdit = !can(...).allowed;` (redaction gate inverted) | `vitest run -c vitest.integration.config.ts src/modules/share/share.int.spec.ts` | ✅ Killed — 1 test failed (`a share link for a presentation redacts frame notes unless the link role can edit`: `expected 'secret speaker notes' to be null`) |

**Sensor depth**: lightweight (3 targeted mutations, per the "largest unverified piece" guidance to
lean to the top of the standard tier).
**Result**: 3/3 killed — ✅ PASS. The tests that DO exist for T1-T18 are discriminating, not just
present. This does not offset the coverage GAPs above — a killed mutant proves an existing test is
real, it says nothing about the ~40% of ACs (PRZ-29..45) with no code and no test to mutate.

**Isolation check**: worktree removed (`git worktree remove --force`) before re-checking
`git status --porcelain` on the real tree. It matched the pre-sensor baseline exactly for every path
this Verifier could have touched. Three extra lines appeared (`.specs/features/architecture-lint/
tasks.md`, `apps/web/src/diagram/DiagramEditorPage.spec.tsx`, `apps/web/src/lint/
LintPanel.a11y.spec.tsx`, plus the pre-existing `.specs/LESSONS.md`/`lessons.json` diff and the
`architecture-lint/validation.md` untracked file) — these belong to the concurrent, unrelated
architecture-lint Verifier session running in the same real tree (as scoped in this task's
instructions) and were never touched by this session.

---

## Code Quality

| Principle | Status | Notes |
| --- | --- | --- |
| No features beyond what was asked | ✅ | Nothing extra added within what WAS built |
| No abstractions for single-use code | ✅ | `FrameViewer`'s generic `<TFrame extends ViewableFrame>` is justified by its two intended consumers (design.md) — though only one exists today |
| No unnecessary "flexibility" added | ✅ | — |
| Only touched files required for task | ✅ | `git show da8d6e4 --stat` — all 33 files are in-scope for presentation-mode |
| Didn't "improve" unrelated code | ✅ | — |
| Matches existing patterns/style | ✅ | `fetchImpl` injection, discriminated-union client results, `<details>` panel pattern, aria-live convention all consistent with R9-R11 precedent |
| Would senior engineer approve? | ❌ | Not as "done" — see headline finding. As partial work-in-progress for T1-T18, yes |
| Tests map to acceptance criteria and are non-shallow (spot-check: reorder story) | ✅ | `PresentationEditorPage.spec.tsx:358-378` asserts the FULL recalculated `frames` array in the PATCH body, not just presence of a call — non-shallow |
| Spec-anchored outcome check | ⚠️ | True where tested (see AC table); false where untested (19 ACs, 0 evidence) |
| Per-layer Coverage Expectation met | ❌ | Domain/pure-function layer (`frameLabel`, `cropSceneForFrame`, `scrollToFrame`) has good 1:1 coverage; the route/screen layer is missing entirely for 2 of 4 surfaces |
| Every test in scope maps to a spec AC/edge case/Done-when (no unclaimed tests) | ✅ | Sampled test names all cite PRZ IDs directly in `describe()` blocks |
| Documented project guidelines followed | `.claude/skills/tlc-spec-driven/references/validate.md`, `coding-principles.md` | Followed for the code that exists |

Extra finding, not blocking but worth recording: `pt-BR`/`en` key sets are identical (416 keys each,
scripted comparison), satisfying PRZ-48's structural half — but a non-trivial number of those keys
(`presentation.editor.exportPdf*`, `presentation.editor.presentButton*`,
`presentation.editor.presentDisabledNoFrames`, `presentation.editor.error.noFrames`,
`presentation.editor.error.notPublished`, `presentation.editor.announcement.exported`,
`presentation.presenter.*`) have zero references anywhere in `apps/web/src` outside the translation
files themselves — dead entries for surfaces that were never built.

---

## Edge Cases (spec.md)

- [x] `POST /presentations` falha → erro genérico, sem navegar — `PresentationListPage.spec.tsx:105-114`
- [ ] Segundo envio do mesmo formulário durante requisição em andamento → sem 2ª requisição — code has the guard, **no test** (Gap G2)
- [ ] Revogar o mesmo link de apresentação duas vezes → idempotente — shared R11 mechanism, **not retested in this diff** (Gap G3, low severity)
- [x] 1 frame → anterior/próximo desabilitados, nav links continuam — `FrameViewer.spec.tsx:134-156`
- [x] `GET /presentations/:id` falha por rede → mensagem genérica — `PresentationEditorPage.spec.tsx:159-164` (404 case) + `presentationClient.spec.ts:57-59` (thrown-fetch → `{status:'error'}`, same code path via `result.status !== 'ok'`)
- [ ] `GET /share/:token` falha por rede (visão pública) → mensagem genérica — **not applicable to verify meaningfully; the presentation branch of this page doesn't render a viewer at all**
- [x] `elementId` órfão → fallback cena inteira (função pura) — `cropSceneForFrame.spec.ts:26-33`, but **no consuming screen exists to prove this end-to-end** (T22 never ran); see also G1 for the DIFFERENT (no-op) behavior of the sibling `scrollToFrame` function that WOULD have backed the presenter mode
- [x] `scene: []` → canvas vazio, nunca mensagem de link inválido (função pura) — `cropSceneForFrame.ts` returns `scene` (i.e. `[]`) unconditionally when `elementId` is falsy or no members match; no consuming screen to prove the rendered result end-to-end

---

## Gate Check

- **Gate command** (tasks.md "Close"): `make lint && make typecheck && make test-unit`
- **`make lint`**: exit 0 (6 pre-existing warnings in `tools/repo-tools/src/webConsumers.spec.ts`, unrelated to this feature)
- **`make typecheck`**: exit 0 (25/25 package tasks, cache hits)
- **`make test-unit`** (full monorepo via turbo, no `--continue`): exit 2 — turbo fails fast on the first failing package and cancels in-flight tasks (`@arch-canvas/web`/`@arch-canvas/editor-adapter` were mid-run when cancelled). Re-ran the affected packages individually for real evidence:
  - `pnpm --filter @arch-canvas/repo-tools run test:unit`: 1 failed / 48 passed — `webConsumers.spec.ts` "finds exactly the 4 endpoints" golden-count test. **Confirmed pre-existing and unrelated**: this exact failure (stale golden count, unrelated to presentation-mode) is documented in `.specs/STATE.md:174/180` for R8/R13, well before R12 merged, and CLAUDE.md/the task brief both name it as a known sandbox gap.
  - `pnpm --filter @arch-canvas/web run test:unit`: **873/873 passed**, 89/89 files.
  - `pnpm --filter @arch-canvas/editor-adapter run test:unit`: 79/80 passed, 1 failed — `EditorSurface.spec.tsx` "icon.kind external ... inserts the rectangle+label fallback" (text-wrap measurement). **Confirmed pre-existing and unrelated**: this exact test/failure is named in the merge commit `da8d6e4`'s own message and in `.specs/STATE.md:188` (registered against R14/`architecture-lint`, a different feature, before R12's own merge). Not something this Verifier re-derived blindly from the commit message — the failure reproduces identically in the current tree with no presentation-mode-specific mutation applied.
  - `pnpm --filter @arch-canvas/server run test:unit`: **400/400 passed**, 39/39 files.
  - `pnpm --filter @arch-canvas/server run test:integration` (PGlite, AD-007, no Docker): **372/372 passed**, 52/52 files, including `share.int.spec.ts` 13/13 (3 new T1 tests + 10 pre-existing R11 tests, all green).
- **Test count before feature**: not independently measured (pre-`d9a7eb7` baseline not checked out) — `git show da8d6e4 --stat` shows 5095 insertions across 33 files, consistent with the ~3800 lines of new test code alone (spec files listed in the diff stat).
- **Test count after feature**: 873 (web) + 400 (server unit) + 372 (server integration) + 80 (editor-adapter) = 1725 across the diff-surface packages, all passing except the 2 confirmed-pre-existing, confirmed-unrelated failures above.
- **Skipped tests**: none found skipped in this diff surface.
- **Failures**: 2, both confirmed pre-existing/unrelated (see above). 0 failures attributable to presentation-mode code.

**Gate verdict**: ✅ PASS at the build/test level for the code that exists. This does NOT make the
feature verdict PASS — see the AC table: the gate can only run tests for code that was written, and
~40% of the spec's ACs have no code to gate.

---

## Fix Plans

### Fix 1: Wire the presentation-editor route (Blocker)

- **Root cause**: `App.tsx` never got the `/present/:presentationId` route added in T8, despite the
  page (`PresentationEditorPage.tsx`) being fully built in T9-T14. The doc comment at
  `App.tsx:64-67` even flags this as deferred, and it was never revisited.
- **Fix task**: Add `<Route path="/w/:workspaceId/d/:diagramId/present/:presentationId" element={<ProtectedRoute><PresentationEditorPage/></ProtectedRoute>} />` to `App.tsx`, sibling to the existing `/present` route. Add an `App.spec.tsx` case proving navigation from the list page's "Open" link actually renders `PresentationEditorPage` through the REAL route table (not a stub `<Route>` like `PresentationListPage.spec.tsx`'s own test harness uses).
- **Priority**: Blocker — without this, T9-T14's ~1500 lines of implemented, unit-tested functionality is unreachable in the deployed app.

### Fix 2: Implement T19-T21 (`PresenterModePage`)

- **Root cause**: never started.
- **Fix task**: build `PresenterModePage.tsx` per `design.md`'s Components section and `tasks.md` T19/T20/T21, wiring `scrollToFrame` (already built and tested) and `FrameViewer` (already built and tested) — most of the dependency graph is ready, only the composing page and its route/launcher are missing.
- **Priority**: Blocker — PRZ-35..41 (7 ACs) entirely unimplemented; also fix G1 (`scrollToFrame`'s fallback) while building this, since it's this page's only consumer.

### Fix 3: Implement T22-T23 (`SharedResourcePage` real viewer)

- **Root cause**: never started, despite its backend prerequisite (T1) being done and tested.
- **Fix task**: per `design.md`, branch on `result.scene` in `SharedResourcePage.tsx`, mount `FrameViewer` with `cropSceneForFrame`-cropped `EditorSurface` instances (both already built and tested), preserve the placeholder byte-for-byte when `scene` is `null` (SHR-27/28).
- **Priority**: Blocker — PRZ-29..34 (6 ACs), the entire "share a roadmap with someone outside the workspace" story, unimplemented.

### Fix 4: Implement T24 (PDF export control)

- **Root cause**: never started; client method ready and tested in isolation.
- **Fix task**: add the export control to `PresentationEditorPage.tsx` per T24's Done-when.
- **Priority**: Major (P2 in the spec, but currently zero coverage).

### Fix 5: T26/T27 — dead i18n keys + capability-map/audit

- **Root cause**: consequence of Fixes 2-4 not having happened; `capability-map.yaml` was never updated because there's no UI surface to point it at yet.
- **Fix task**: after Fixes 2-4, sweep i18n for any remaining gaps, flip `capability-map.yaml`'s presentation entry off `backend-only`, run `repo-tools audit`, regenerate `route-inventory.md`.
- **Priority**: Minor (mechanical, blocked on the above).

### Fix 6 (Minor): G1, G2, G3 from Gaps section

- **Fix task**: reconcile `scrollToFrame`'s fallback with spec/tasks.md (either fix the code to match, or fix the two docs to match the code — pick one, they currently disagree); add a double-submit-guard test to at least one of the 3 forms that has the guard; add (or explicitly waive with a comment) a presentation-scoped double-revoke test.
- **Priority**: Minor.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| PRZ-01..12 | Pending | ✅ Verified |
| PRZ-13..17 | Pending | ✅ Verified |
| PRZ-18..21 | Pending | ✅ Verified |
| PRZ-22..28 | Pending | ✅ Verified |
| PRZ-29..34 | Pending | ❌ Needs Fix (no UI implementation) |
| PRZ-35..41 | Pending | ❌ Needs Fix (no implementation at all) |
| PRZ-42..45 | Pending | ❌ Needs Fix (no UI implementation) |
| PRZ-46 | Pending | ⚠️ Needs Fix (partial — 2 of 4 surfaces) |
| PRZ-47 | Pending | ⚠️ Needs Fix (partial — 2 of 4 surfaces, 1 shared panel) |
| PRZ-48 | Pending | ⚠️ Needs Fix (structurally complete, materially dead for missing surfaces) |

---

## Summary

**Overall**: ❌ Not Ready

**Spec-anchored check**: 28/48 ACs matched spec outcome, 1 vacuous pass, 19 hard gaps (zero evidence), 3 partial
**Sensor**: 3/3 mutations killed (for the code that exists)
**Gate**: 1725 tests passed across the diff-surface packages; 2 failures, both confirmed pre-existing and unrelated to this feature

**What works**: Presentation CRUD, frame management, reorder, prototype-nav-link configuration,
publish/republish (with a genuinely-tested overwrite confirmation), and presentation-scoped
share-link creation (T1-T18, PRZ-01..28) are solidly implemented and well-tested — but **currently
unreachable from the real app** because the editor route was never wired (Fix 1).

**Issues found**: Half the feature (public frame viewer, presenter mode, PDF export UI, capability-
map/audit closure — PRZ-29..45, T19-T27) was never built despite being merged to `main` and
described in `STATE.md` as delivered. See Fix Plans 1-5.

**Next steps**: Route the 5 Fix Plans back to an implementer. Fix 1 (routing) is both the cheapest
and highest-leverage — it alone would make T9-T14's already-built, already-tested work reachable.
Fixes 2-4 are the real remaining implementation work (T19-T24, roughly the other half of the
original task breakdown). Given the size, treat this as a new implementation wave rather than a
single "fix task," re-running Design's existing plan for T19-T28 as-is (it was never invalidated,
just never executed) — then re-verify.
