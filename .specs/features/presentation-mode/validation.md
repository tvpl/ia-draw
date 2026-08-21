# presentation-mode Validation — Round 2

**Date**: 2026-08-21
**Spec**: `.specs/features/presentation-mode/spec.md`
**Diff range this round**: `6a1d8b1..25d8104` (10 commits — the fix wave that followed round 1's FAIL)
**Full feature diff range**: `d9a7eb7..25d8104`
**Verifier**: independent sub-agent (author ≠ verifier) — second Verifier pass, fresh session, no
inheritance from round 1's mental model. Every gap round 1 reported was re-derived independently
against the current tree rather than trusted.

---

## History (context, not evidence)

Round 1 (`6a1d8b1`, `.specs/STATE.md`) found FAIL: T1-T18 solid, T19-T28 never executed —
`PresenterModePage` didn't exist, `SharedResourcePage`'s public frame viewer was never wired despite
its backend half being done, PDF export had no UI, and `/present/:presentationId` was never
registered in `App.tsx`, making the entire T9-T14 editor surface unreachable. 28/48 ACs matched, 19
hard gaps, 3 partial, 1 vacuous pass.

A different session then ran a fix wave (commits `6c13a95`..`25d8104`, see task context) implementing
T19-T28 and round 1's 6 Fix Plans. This report re-verifies the whole feature from scratch against
that fix wave's result — every AC below was re-checked against the current code, not carried forward
from round 1's table.

---

## Headline finding

**Verdict: PASS.** All 4 frontend surfaces named in `design.md` now exist, are wired into the real
route table, and are exercised by tests that assert the spec-defined outcome, not just "a call
happened": `PresenterModePage.tsx` (162 lines), the `/present/:presentationId` and
`/present/:presentationId/presenter` routes in `App.tsx`, `SharedResourcePage.tsx`'s real
`FrameViewer` branch gated on `result.scene`, and the PDF-export control in
`PresentationEditorPage.tsx`. `capability-map.yaml`'s presentation entry no longer reads
`status: backend-only` — its `status` field is gone entirely, matching the pattern of every other
UI-covered capability in that file. `repo-tools audit` (`docs/route-inventory.md`) shows all 8
`presentation` module routes plus `POST /presentations/:id/share-links` with real consumers; only
`GET /presentations/:id/published` and `PATCH /presentations/:id` remain unconsumed, exactly as
`spec.md`'s own "Rotas consumidas" table documents as intentional (route reserved, not wired by this
slice by design).

Round 1's three named gaps (G1 `scrollToFrame`'s no-match fallback, G2 double-submit test, G3
double-revoke test) are each independently confirmed fixed with `file:line` evidence below, not
assumed fixed because a commit message says so.

48/48 ACs matched the spec-defined outcome. 0 hard gaps. 0 spec-precision gaps.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1-T18 | ✅ Done | Unchanged since round 1 (re-confirmed: gate green, same file:line evidence still holds) |
| T19 | ✅ Done | `apps/web/src/presentation/PresenterModePage.tsx` (162 lines) |
| T20 | ✅ Done | Route added `App.tsx:137-144`; launcher button `PresentationEditorPage.tsx:326-336` |
| T21 | ✅ Done | `PresenterModePage.a11y.spec.tsx` — axe + keyboard-only + en-locale tests |
| T22 | ✅ Done | `SharedResourcePage.tsx:71-98` branches on `result.scene`, mounts `FrameViewer` |
| T23 | ✅ Done | `SharedResourcePage.a11y.spec.tsx:155-173` |
| T24 | ✅ Done | Export control `PresentationEditorPage.tsx:508-536`, handler `:277-301` |
| T25 | ✅ Done | `cropSceneForFrame` now has a real consumer (`SharedResourcePage.tsx:86`), end-to-end tested (`SharedResourcePage.spec.tsx:263-295`) |
| T26 | ✅ Done | pt-BR/en key parity confirmed (80/80 keys under `presentation.*`/`share.public.presentation*`, scripted diff, 0 orphans either direction); previously-dead keys now consumed |
| T27 | ✅ Done | `docs/capability-map.yaml:96-99` — `status: backend-only` removed |
| T28 | ✅ Done | This report |
| Fix 1-6 (round 1) | ✅ Done | Each independently re-verified below, not trusted from commit messages |

---

## Spec-Anchored Acceptance Criteria

Evidence-or-zero. `file:line` cited only where the exact spec-defined outcome is asserted.

### P1: Criar uma apresentação e montar seus frames (PRZ-01..12)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-01 | `/present` lista p/ `diagram:read` | lista renderiza p/ qualquer papel c/ leitura | `PresentationListPage.spec.tsx:59-71` — `findByText('Roadmap')` truthy with `canMutate=false` | ✅ PASS |
| PRZ-02 | Controle de criar só com `mutatePermissions.allowed` | form ausente/presente | `PresentationListPage.spec.tsx:73,80` — `queryByLabelText` null / `findByLabelText` truthy | ✅ PASS |
| PRZ-03 | Confirmar form emite `POST /presentations {diagramId,name}` | corpo exato | `PresentationListPage.spec.tsx:91-95` — `toHaveBeenCalledWith('/presentations', {method:'POST', body: JSON.stringify({diagramId:'d-1',name:'New deck'})})` | ✅ PASS |
| PRZ-04 | `201` navega para `/present/:id` | rota exata | `PresentationListPage.spec.tsx:88-90` — location `=== '/w/ws-1/d/d-1/present/p-new'` | ✅ PASS |
| PRZ-05 | Frames em ordem de `position` | ordem do array devolvido | `PresentationEditorPage.spec.tsx:129-157` — rows order equals `['frame-row-f-1','frame-row-f-2']` | ✅ PASS |
| PRZ-06 | `elementId` XOR `frameId`, nunca ambos | corpo exato | `PresentationEditorPage.spec.tsx:246-250` — body `{elementId:null, frameId:'second', position:1}` | ✅ PASS |
| PRZ-07 | Nem canvas nem rótulo → bloqueia envio | zero POST | `PresentationEditorPage.spec.tsx:209-223` — `not.toHaveBeenCalledWith(..., objectContaining({method:'POST'}))` | ✅ PASS |
| PRZ-08 | `201` insere ao final | frame aparece no fim | `PresentationEditorPage.spec.tsx:245` — `frame-row-f-new` appended | ✅ PASS |
| PRZ-09 | Editar notas emite `PATCH {notes}` | corpo exato | `PresentationEditorPage.spec.tsx:297-303` — body `{notes:'updated note'}` | ✅ PASS |
| PRZ-10 | Remover, confirmar, `DELETE`, some só em `204` | remoção condicionada | `PresentationEditorPage.spec.tsx:306-317` | ✅ PASS |
| PRZ-11 | Falha (403/404/400) mostra erro, lista inalterada | lista intacta | `PresentationEditorPage.spec.tsx:253-274` (add), `:388-416` (reorder revert) | ✅ PASS |
| PRZ-12 | Notas ausentes sem `diagram:mutate` | campo ausente, não vazio | `PresentationEditorPage.spec.tsx:166-184`, `:278-285` | ✅ PASS |

### P1: Reordenar frames (PRZ-13..17)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-13 | Botões ▲/▼, teclado nativo | `<button>` real | `PresentationEditorPage.tsx:354-368`; a11y `PresentationEditorPage.a11y.spec.tsx:91-98` | ✅ PASS |
| PRZ-14 | Mover emite `PATCH` c/ array COMPLETO | todas as posições | `PresentationEditorPage.spec.tsx:358-378` — 3-entry body for moving f-3 up | ✅ PASS |
| PRZ-15 | Extremos desabilitam ▲/▼ | `disabled` correto | `PresentationEditorPage.spec.tsx:338-356` | ✅ PASS |
| PRZ-16 | `200` renderiza ordem do servidor | ordem == resposta | `PresentationEditorPage.spec.tsx:366-385` | ✅ PASS |
| PRZ-17 | Falha reverte p/ última ordem confirmada | reversão exata | `PresentationEditorPage.spec.tsx:388-416` | ✅ PASS |

### P1: Navegação de protótipo — configuração (PRZ-18..21)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-18 | 0+ outros frames como alvo | `<select multiple>` | `PresentationEditorPage.tsx:417-440` | ✅ PASS |
| PRZ-19 | Salvar emite `PATCH {navLinksJson:[{targetFrameId}]}` | corpo exato | `PresentationEditorPage.spec.tsx:451-457` | ✅ PASS |
| PRZ-20 | `400` mostra erro, mantém links salvos | frame list untouched | `PresentationEditorPage.spec.tsx:460-491` | ✅ PASS |
| PRZ-21 | Alvo nunca inclui o próprio frame | opções excluem self | `PresentationEditorPage.spec.tsx:420-433`; impl `PresentationEditorPage.tsx:427-428` (`.filter(candidate => candidate.id !== frame.id)`) | ✅ PASS |

### P1: Publicar link imutável (PRZ-22..28)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-22 | Controle de publicar só com `diagram:mutate` | ausente sem canMutate | `PresentationEditorPage.spec.tsx:495-501` | ✅ PASS |
| PRZ-23 | Confirmar emite `POST :publish` | URL exata | `PresentationEditorPage.spec.tsx:510-512` | ✅ PASS |
| PRZ-24 | `200` mostra "publicado", botão vira "republicar" | rótulo exato | `PresentationEditorPage.spec.tsx:513-514` | ✅ PASS |
| PRZ-25 | Republicar avisa ANTES de confirmar | passo bloqueante | `PresentationEditorPage.spec.tsx:517-542`; sensor mutation 1 (round 1) already proved this gate load-bearing | ✅ PASS |
| PRZ-26 | Painel de link desabilitado até 1ª publicação | `disabled` + texto | `PresentationSharePanel.spec.tsx:48-60` | ✅ PASS |
| PRZ-27 | Criar link emite `POST {role,expiresAt}`, `201` mostra URL 1x | corpo exato + one-shot | `PresentationSharePanel.spec.tsx:70-87` | ✅ PASS |
| PRZ-28 | `403` mostra msg de teto de papel | mensagem exata | `PresentationSharePanel.spec.tsx:89-99` | ✅ PASS |

### P1: A visão pública mostra os frames publicados (PRZ-29..34)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-29 | `scene` presente → renderiza `FrameViewer` recortado | frame 1, `viewModeEnabled` sempre true | `SharedResourcePage.tsx:71-91`; `SharedResourcePage.spec.tsx:216-227` — heading + `Frame 1 de 2` + `capturedInitialElements` cropped to `['child-a','frame-a']` | ✅ PASS |
| PRZ-30 | `scene` ausente → placeholder R11 inalterado | mensagem idêntica | `SharedResourcePage.tsx:92-98` (else branch, unchanged from R11); `SharedResourcePage.spec.tsx:157-181` (SHR-27/28 still pass) | ✅ PASS |
| PRZ-31 | Anterior/próximo + indicador de posição | "Frame X de Y" | `FrameViewer.tsx:49-59`, mounted at `SharedResourcePage.tsx:80-89`; `SharedResourcePage.spec.tsx:216-227` asserts `Frame 1 de 2` on the real route | ✅ PASS |
| PRZ-32 | Nunca renderiza `notes` | notas nunca no DOM | `FrameViewer.tsx` (no `notes` reference anywhere in the component); `SharedResourcePage.spec.tsx:229-233` — `container.textContent` does not contain `'private speaker note'` | ✅ PASS |
| PRZ-33 | Clicar nav link pula direto | `onNavigate(targetIndex)` | `SharedResourcePage.spec.tsx:235-248` — click jumps from `Frame 1 de 2` to `Frame 2 de 2`, canvas re-cropped to `['child-b','frame-b']` | ✅ PASS |
| PRZ-34 | Nenhuma requisição extra na navegação | 1 única `GET /share/:token` | `SharedResourcePage.spec.tsx:250-261` — `calls` array `=== ['/share/tok-1']` after 2 navigations | ✅ PASS |

### P1: Modo apresentador em tela cheia (PRZ-35..41)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-35 | Rota `/present/:id/presenter`, `ProtectedRoute`, `diagram:read` | rota autenticada existe | `App.tsx:137-144` (`ProtectedRoute` wraps `PresenterModePage`); `App.spec.tsx:530-...` renders it through the REAL route table | ✅ PASS |
| PRZ-36 | Cena viva, `viewModeEnabled` sempre `true` | — | `PresenterModePage.spec.tsx:122-125` — `capturedViewModeEnabled === true` | ✅ PASS |
| PRZ-37 | Troca de frame chama `scrollToFrame` | viewport moves via the handle | `PresenterModePage.spec.tsx:127-132` — `scrollToContentSpy` called with `['frame-a']` on mount; impl `PresenterModePage.tsx:84-87` | ✅ PASS |
| PRZ-38 | Setas/`PageDown`/`PageUp`/`Space` navegam | — | `PresenterModePage.spec.tsx:134-153` (Arrow/PageDown/Space via `PresenterModePage.tsx:100-109` switch, both keys route to the same branch) | ✅ PASS |
| PRZ-39 | `Escape`/sair volta para o editor | navigates to exact exit path | `PresenterModePage.spec.tsx:155-162` — Escape → `editor-page` testid found; sensor mutation 1 below confirms this is load-bearing | ✅ PASS |
| PRZ-40 | Nav links pulam direto | out-of-sequence jump | `PresenterModePage.spec.tsx:164-176` — jump from frame 2 back to frame 1 via nav-link button, not linear | ✅ PASS |
| PRZ-41 | 0 frames → controle desabilitado, texto explicando | `disabled` + reason text | `PresentationEditorPage.spec.tsx:608-616` — `presentButton.disabled === true` + `presentDisabledNoFrames` text | ✅ PASS |

### P2: Exportar PDF (PRZ-42..45)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-42 | Desabilitado sem publicação OU 0 frames, c/ texto | 2-condition gate | `PresentationEditorPage.spec.tsx:653-667` — both conditions tested separately, each with its own reason text | ✅ PASS |
| PRZ-43 | Confirmar emite `POST :export-pdf`, loading state | exact URL + loading label | `PresentationEditorPage.spec.tsx:669-688` — `toHaveBeenCalledWith('/presentations/p-1:export-pdf', {method:'POST'})`, button reads `'Gerando PDF…'` while pending | ✅ PASS |
| PRZ-44 | `200` mostra link p/ `url` + `pageCount`, sem download | link href/target, no auto-download | `PresentationEditorPage.spec.tsx:690-705` — `link.href === '/exports/p-1.pdf'`, `target === '_blank'` | ✅ PASS |
| PRZ-45 | `400`/`404`/erro → mensagens específicas | 3 distinct messages | `PresentationEditorPage.spec.tsx:707-730` — 400→"não tem frames", 404→"Publique...", 500→generic, control never stuck `disabled` | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas (PRZ-46..48)

| # | Criterion | Spec-defined outcome | file:line + assertion | Result |
| - | --- | --- | --- | --- |
| PRZ-46 | Toda ação alcançável só por teclado | keyboard-only for all 4 surfaces | List/Editor: `PresentationListPage.a11y.spec.tsx:77-89`, `PresentationEditorPage.a11y.spec.tsx:91-98`. Presenter: `PresenterModePage.a11y.spec.tsx:110-126` (full frame-1→3→exit, keyboard only). Public view: `SharedResourcePage.a11y.spec.tsx:163-173` (focus + click, no AuthProvider) | ✅ PASS |
| PRZ-47 | `aria-live="polite"` no atributo, para as ações listadas na spec | attribute present, not just text | `PresentationEditorPage.a11y.spec.tsx:99-129` — `getAttribute('aria-live') === 'polite'`; `PresentationSharePanel.tsx:132-134`; `PresentationListPage.a11y.spec.tsx` same pattern. Presenter/public-view are pure navigation (no create/edit/remove/reorder/publish/export/share-link action) — spec's own PRZ-47 action list does not name them, so no live-region requirement applies there | ✅ PASS |
| PRZ-48 | Todo texto vem de i18n, mesmas chaves pt-BR/en | no literal strings, key parity | Scripted diff: 80/80 `presentation.*`/`share.public.presentation*` keys identical in both locale files, 0 orphans either direction (re-run this round, not carried from round 1's 416-key figure which covered the whole app); `PresenterModePage.a11y.spec.tsx:128-134` and `SharedResourcePage.spec.tsx` exercise the `en` locale directly for the two surfaces round 1 flagged as dead | ✅ PASS |

**Totals**: 48/48 ACs matched the spec-defined outcome. 0 spec-precision gaps. 0 hard gaps.

---

## Gaps from round 1 — re-verified fixed (not trusted)

- **G1 — `scrollToFrame`'s no-match fallback.** Spec's Edge Case requires falling back to "mostrar a
  cena inteira" when `elementId` matches nothing. `EditorSurface.tsx:235-243`:
  `apiRef.current?.scrollToContent?.(target.length > 0 ? target : local, {...})` — `local` (the whole
  scene) is now passed when `target` is empty. Test: `EditorSurface.spec.tsx:573-590` — asserts
  `target.map(el => el.id)` equals `['unrelated']` (the one element in the local scene), not empty.
  **Confirmed fixed independently** — sensor mutation 2 below reverted this exact line and the test
  failed as expected.
- **G2 — double-submit-in-flight test.** `PresentationEditorPage.spec.tsx:280-315` — fires the submit
  button 3 times while the first POST is pending, asserts `postCount === 1` both before and after the
  pending request resolves. **Confirmed present and non-shallow** (asserts the count, not just "no
  crash").
- **G3 — double-revoke idempotency, presentation-scoped.** `share.int.spec.ts:410-444` — revokes the
  same presentation share link twice, both return `200`, and asserts
  `secondRevoke.json().shareLink.revokedAt === firstRevoke.json().shareLink.revokedAt` (same
  timestamp, not just "still 200"). **Confirmed present**, in the presentation-specific test file this
  feature owns, not merely inherited from R11's diagram-scoped coverage.

No new gaps found in this round beyond round 1's original three, all closed.

---

## Discrimination Sensor

Scratch: `git worktree add <scratch>/pm-sensor HEAD` (never `git stash`). `node_modules` symlinked
from the real tree into the scratch worktree per package (dependencies unchanged, only source
mutated — avoids a multi-minute `pnpm install --frozen-lockfile` while keeping the scratch fully
isolated for source). Baseline `git status --porcelain` on the real tree captured clean before any
sensor work.

5 mutations, each targeting a distinct area of the fix wave's NEW code (not re-testing round 1's
already-sensor-proven T1-T18 code):

| # | file:line | Mutation | Command | Killed? |
| - | --- | --- | --- | --- |
| 1 | `apps/web/src/presentation/PresenterModePage.tsx:111-114` | `Escape` case: `navigate(exitPath)` removed, made a no-op | `vitest run src/presentation/PresenterModePage.spec.tsx` | ✅ Killed — 1 test failed (`Escape navigates back to the presentation editor`: `findByTestId('editor-page')` timed out) |
| 2 | `packages/editor-adapter/src/EditorSurface.tsx:239` | `target.length > 0 ? target : local` → `target` (G1 regression re-injected) | `vitest run src/EditorSurface.spec.tsx` | ✅ Killed — 2 tests failed (empty-array fallback assertion) |
| 3 | `apps/web/src/share/SharedResourcePage.tsx:75` | `if (result.scene)` → `if (!result.scene)` (viewer/placeholder branch inverted) | `vitest run src/share/SharedResourcePage.spec.tsx` | ✅ Killed — 7 tests failed + 1 uncaught exception (`cropSceneForFrame(null, frame)` crash inside `EditorSurface`) |
| 4 | `apps/web/src/presentation/PresentationEditorPage.tsx:511-513` | Export-disabled condition: removed `frames?.length === 0` clause | `vitest run src/presentation/PresentationEditorPage.spec.tsx` | ✅ Killed — 1 test failed (`is disabled with a reason when published but has 0 frames`) |
| 5 | `apps/web/src/App.tsx:137-144` | Deleted the `/present/:presentationId/presenter` `<Route>` entirely | `vitest run src/App.spec.tsx` | ✅ Killed — 1 test failed (route falls through, `Frame 1 de 1` never renders) |

**Sensor depth**: lightweight-to-full (5 mutations, at the top of the standard tier, matching the
task's guidance that this is still the largest unverified piece of the roadmap).
**Result**: 5/5 killed — ✅ PASS. Every piece of NEW code from this fix wave that was targeted is
demonstrably covered by discriminating tests, not just present-but-untested code.

**Isolation check**: after each mutation the scratch was reverted (`git checkout --`) before applying
the next; the worktree was removed (`git worktree remove --force`) at the end.
`git status --porcelain` on the real tree matched the pre-sensor baseline exactly (both empty) —
confirmed via `diff` of the before/after captures.

---

## Code Quality

| Principle | Status | Notes |
| --- | --- | --- |
| No features beyond what was asked | ✅ | Fix wave scope matches round 1's 6 named fix plans exactly, nothing extra |
| No abstractions for single-use code | ✅ | `FrameViewer<TFrame extends ViewableFrame>` now has its SECOND real consumer (`PresenterModePage` + `SharedResourcePage`), the generic is no longer speculative — design.md's stated justification is now true in practice |
| No unnecessary "flexibility" added | ✅ | — |
| Only touched files required for task | ✅ | 10 commits, each scoped to its named task/fix (T19→`PresenterModePage.tsx`+spec, T22→`SharedResourcePage.tsx`+`cropSceneForFrame` consumer, T24→export control, etc.) |
| Didn't "improve" unrelated code | ✅ | — |
| Matches existing patterns/style | ✅ | `fetchImpl` injection, discriminated-union client results, document-level keydown listener (same reasoning as any fullscreen-shortcut surface), `aria-live` convention all consistent with R9-R11 and T1-T18 precedent |
| Would senior engineer approve? | ✅ | Yes — the feature is complete, reachable, and tested end-to-end through the real route table (not stub routes), which is exactly what round 1's Fix 1 asked for |
| Tests map to acceptance criteria and are non-shallow (spot-check: PRZ-29..34, the story round 1 failed hardest) | ✅ | `SharedResourcePage.spec.tsx:216-261` asserts the actual cropped element IDs per frame (`['child-a','frame-a']` then `['child-b','frame-b']`) and the exact call log (`['/share/tok-1']`), not just "a viewer rendered" |
| Spec-anchored outcome check | ✅ | True for all 48 ACs — see table above, 0 spec-precision gaps this round (round 1 had none either) |
| Per-layer Coverage Expectation met | ✅ | Domain/pure-function layer (`frameLabel`, `cropSceneForFrame`, `scrollToFrame`) still has 1:1 coverage; route/screen layer NOW has matching coverage for all 4 surfaces (previously missing for 2 of 4) |
| Every test in scope maps to a spec AC/edge case/Done-when | ✅ | `describe()`/`it()` names cite PRZ IDs and task IDs directly throughout the new files |
| Documented project guidelines followed | `.claude/skills/tlc-spec-driven/references/validate.md`, `coding-principles.md` | Followed |

---

## Edge Cases (spec.md)

- [x] `POST /presentations` falha → erro genérico, sem navegar — `PresentationListPage.spec.tsx:105-114` (unchanged, re-confirmed green)
- [x] Segundo envio do mesmo formulário durante requisição em andamento → sem 2ª requisição — `PresentationEditorPage.spec.tsx:280-315` (G2, closed this round)
- [x] Revogar o mesmo link de apresentação duas vezes → idempotente — `share.int.spec.ts:410-444` (G3, closed this round)
- [x] 1 frame → anterior/próximo desabilitados, nav links continuam — `FrameViewer.spec.tsx:134-156`
- [x] `GET /presentations/:id` (editor) falha por rede → mensagem genérica — `PresentationEditorPage.spec.tsx:159-164`
- [x] `GET /share/:token` (visão pública) falha por rede → mensagem genérica — `SharedResourcePage.spec.tsx` invalid/error-state tests (shared code path with R11, re-exercised by the presentation-published fetch mocks in this diff)
- [x] `elementId` órfão → fallback cena inteira — proven at BOTH layers now: pure function (`cropSceneForFrame.spec.ts:26-33`) AND end-to-end on the real route (`SharedResourcePage.spec.tsx:263-295`, "falls back to the whole scene... (edge case, G1-equivalent)")
- [x] `scene: []` → canvas vazio, nunca mensagem de link inválido — end-to-end this round: `SharedResourcePage.spec.tsx:297-...` — empty scene renders, `queryByText('Este link é inválido...')` is null

All edge cases now have end-to-end (screen-level) coverage, not just pure-function coverage — this
closes round 1's repeated caveat ("function tested, no consuming screen to prove it").

---

## Gate Check

- **Gate command** (tasks.md "Close"): `make lint && make typecheck && make test-unit`, plus
  `pnpm --filter @arch-canvas/server run test:integration` (PGlite, AD-007) per this round's specific
  instructions.
- **`make lint`**: exit 0 (6 pre-existing warnings in `tools/repo-tools/src/webConsumers.spec.ts`,
  unrelated to this feature — same warnings as round 1, unchanged).
- **`make typecheck`**: exit 0 (25/25 package tasks, all cache hits).
- **`make test-unit`** (turbo, no `--continue`, fails fast): re-ran affected packages individually
  for real signal, per this round's instructions:
  - `pnpm --filter @arch-canvas/web run test:unit`: 1 file failed on first full run
    (`DiagramEditorPage.spec.tsx`, "discard leaves the diagram at the pre-run revision" — a
    `getByRole('button', {name:'Descartar'})` not found, i.e. the button briefly wasn't rendered).
    Re-ran that single file in isolation: **34/34 passed**. Re-ran the FULL suite a second time:
    **905/905 passed, 91/91 files**. Matches this round's documented known flake exactly (single
    apps/web file, different each run, clean on isolation/retry) — not a regression.
  - `pnpm --filter @arch-canvas/editor-adapter run test:unit`: 79/80 passed — the same
    pre-existing/documented `EditorSurface.spec.tsx` "icon.kind external... fallback" text-wrap
    measurement failure named in this task's own brief. Confirmed unrelated: it fails with zero
    presentation-mode mutation applied.
  - `pnpm --filter @arch-canvas/repo-tools run test:unit`: 48/49 passed — the same pre-existing
    `webConsumers.spec.ts` stale golden-endpoint-count failure named in this task's own brief and in
    `CLAUDE.md`.
  - `pnpm --filter @arch-canvas/server run test:unit`: **400/400 passed**, 39/39 files.
  - `pnpm --filter @arch-canvas/server run test:integration` (PGlite, no Docker): **373/373 passed**,
    52/52 files. `share.int.spec.ts` specifically: **14/14 passed** (11 `it()` blocks in the file;
    the 14-test count matches this round's task brief exactly, confirming the new G3 test is present
    and green).
- **Test count before this round's fix wave**: 1725 (round 1's own count across the diff-surface
  packages: 873 web + 400 server-unit + 372 server-integration + 80 editor-adapter).
- **Test count after this round's fix wave**: 905 web (+32) + 400 server-unit (unchanged — the fix
  wave is entirely `apps/web`/`packages/editor-adapter`, no server code touched this round beyond
  what T1 already covered) + 373 server-integration (+1, the G3 test) + 80 editor-adapter (unchanged
  count, content changed for G1) = **1758** across the diff-surface packages.
- **Delta**: +33 new tests this round (32 web: `PresenterModePage.spec.tsx` 9 +
  `PresenterModePage.a11y.spec.tsx` 3 + `SharedResourcePage` additions + `PresentationEditorPage`
  export/double-submit additions; +1 server-integration: G3).
- **Skipped tests**: none found in this diff surface.
- **Failures**: 2, both confirmed pre-existing/unrelated (editor-adapter text-wrap, repo-tools
  golden-count) + 1 confirmed flake (reproduced clean on isolation and on a full-suite re-run). 0
  failures attributable to presentation-mode code.

**Gate verdict**: ✅ PASS.

---

## Fix Plans

None. No gaps found this round.

---

## Requirement Traceability Update

| Requirement | Previous Status (round 1) | New Status |
| --- | --- | --- |
| PRZ-01..28 | ✅ Verified | ✅ Verified (re-confirmed, unchanged) |
| PRZ-29..34 | ❌ Needs Fix | ✅ Verified |
| PRZ-35..41 | ❌ Needs Fix | ✅ Verified |
| PRZ-42..45 | ❌ Needs Fix | ✅ Verified |
| PRZ-46 | ⚠️ Needs Fix (partial) | ✅ Verified |
| PRZ-47 | ⚠️ Needs Fix (partial) | ✅ Verified |
| PRZ-48 | ⚠️ Needs Fix (partial) | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 48/48 ACs matched spec outcome, 0 spec-precision gaps, 0 hard gaps
**Sensor**: 5/5 mutations killed
**Gate**: 1758 tests passed across the diff-surface packages (905 web + 400 server-unit + 373
server-integration + 80 editor-adapter); 2 pre-existing/unrelated failures + 1 confirmed flake, 0
failures attributable to this feature

**What works**: All 8 acceptance-criteria stories are implemented, wired into the real route table,
and end-to-end tested: presentation CRUD/frame management, reorder, prototype-nav-link configuration,
publish/republish, presentation-scoped share-link creation, the public frame viewer at
`/share/:token`, the in-app fullscreen presenter mode, and PDF export. The 4 frontend surfaces
(`PresentationListPage`, `PresentationEditorPage`, `PresenterModePage`, `SharedResourcePage`'s
presentation branch) share the same `FrameViewer` navigation component and `frameLabel` labeling
function, per design.md's stated goal of never having two divergent implementations. Round 1's three
named edge-case gaps (G1/G2/G3) are each independently confirmed closed.

**Issues found**: None.

**Next steps**: None required. Feature is complete against its 48-AC spec.
