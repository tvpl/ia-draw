# Comentários e revisão no diagrama — Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/diagram-comments/spec.md`
**Diff range**: `f51e163..HEAD` (branch `feature/r9-diagram-comments`, 9 commits: `f50b525..5ced875`)
**Verifier**: independent sub-agent (author ≠ verifier)

Diff surface confirmed clean of unrelated history: `git log --oneline` shows only this wave's 9
commits on top of `f51e163`, and `git diff f51e163 HEAD -- apps/mcp tools/repo-tools` is empty.
16 files changed, +2491/-16. This is a frontend-only wave; the backend
(`apps/server/src/modules/comment/`) was verified in F3 and is untouched here.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1: `commentClient` | ✅ Done | `apps/web/src/comments/commentClient.ts`, 16 unit tests |
| T2: chaves de i18n `comments` | ✅ Done | 27 keys, byte-identical key set in `en` and `pt-BR` (verified programmatically) |
| T3: `commentThreads` | ✅ Done | `apps/web/src/comments/commentThreads.ts`, 10 unit tests |
| T4: `CommentsSidebar` (lista + composer) | ✅ Done | 27 RTL tests in `CommentsSidebar.spec.tsx` (T4+T5 combined) |
| T5: resolver/reabrir/responder/filtrar/atualizar | ✅ Done | no T4 test removed — all 27 present and passing |
| T6: cobertura de a11y | ✅ Done | `CommentsSidebar.a11y.spec.tsx`, 5 tests, 2 axe states |
| T7: `EditorSidePanel` | ✅ Done | `apps/web/src/diagram/EditorSidePanel.tsx`, 7 RTL tests |
| T8: fiação no `DiagramEditorPage` | ✅ Done | layout test updated (strengthened, see below); `docs/route-inventory.md` regenerated |

All 8 tasks are `[x]` in `tasks.md`. No blocked or partial task.

---

## Spec-Anchored Acceptance Criteria

### P1: Ler os comentários do diagrama (CMT2-01..10)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| CMT2-01 — coluna lateral exibe exatamente um painel por vez, via `role="tablist"` com abas "IA"/"Comentários" | um `tablist`, duas abas, um único painel visível | `apps/web/src/diagram/EditorSidePanel.spec.tsx:26` - `expect(screen.getByRole('tablist')).toBeTruthy()`; `:44` - `expect(container.querySelector('#side-panel-ai')?.hasAttribute('hidden')).toBe(false)`; `:45` - `expect(container.querySelector('#side-panel-comments')?.hasAttribute('hidden')).toBe(true)` | ✅ PASS |
| CMT2-02 — `mutatePermissions.allowed: false` omite a aba "IA" | a aba "IA" **não existe** no DOM | `apps/web/src/diagram/EditorSidePanel.spec.tsx:69` - `expect(screen.queryByRole('tab', { name: 'IA' })).toBeNull()`; `:70` - `expect(screen.getAllByRole('tab')).toHaveLength(1)`; `:71` - `expect(container.querySelector('#side-panel-ai')).toBeNull()`; end-to-end em `apps/web/src/diagram/DiagramEditorPage.spec.tsx:464` - `expect(screen.queryByRole('tab', { name: 'IA' })).toBeNull()` | ✅ PASS |
| CMT2-03 — `allowed: false` ⇒ comentários é o painel ativo inicial | aba "Comentários" com `aria-selected="true"` | `apps/web/src/diagram/EditorSidePanel.spec.tsx:77` - `expect(...getAttribute('aria-selected')).toBe('true')`; `:80` - `#side-panel-comments` sem `hidden`; `apps/web/src/diagram/DiagramEditorPage.spec.tsx:465` - mesma asserção no editor real | ✅ PASS |
| CMT2-04 — `allowed: true` ⇒ aba "IA" é a ativa inicial | aba "IA" com `aria-selected="true"`, "Comentários" com `false` | `apps/web/src/diagram/EditorSidePanel.spec.tsx:34` - `expect(screen.getByRole('tab', { name: 'IA' }).getAttribute('aria-selected')).toBe('true')`; `:35` - Comentários `.toBe('false')`; `:89` - default derivado após bootstrap resolver (rerender `null`→`aiSlot`) | ✅ PASS |
| CMT2-05 — `GET /diagrams/:id/comments` uma única vez ao montar | exatamente 1 `GET`, threads renderizadas | `apps/web/src/comments/CommentsSidebar.spec.tsx:78` - `expect(callsTo(fetchImpl)).toHaveLength(1)`; `:79` - `expect(callsTo(fetchImpl)[0]?.[0]).toBe('/diagrams/d-1/comments')` | ✅ PASS |
| CMT2-06 — agrupar em threads por cadeia de `parentId`, na ordem do `GET` | 1 thread por raiz, cadeia profunda achatada na mesma raiz, ordem de entrada preservada | `apps/web/src/comments/commentThreads.spec.ts:35` - `expect(threads.map((t) => t.root.id)).toEqual(['c-1','c-3'])`; `:45` - `expect(threads[0]?.replies.map((r) => r.id)).toEqual(['c-2','c-3'])`; `:56` - reply-to-a-reply na mesma raiz; render em `CommentsSidebar.spec.tsx:81` - `expect(screen.getAllByTestId('comment-thread')).toHaveLength(1)` | ✅ PASS |
| CMT2-07 — mensagem de carregando durante o `GET` inicial | string `comments.loading` visível | `apps/web/src/comments/CommentsSidebar.spec.tsx:95` - `expect(screen.getByText('Carregando comentários…')).toBeTruthy()`, com `fetch` represado e liberado em `:97` | ✅ PASS |
| CMT2-08 — `GET` ≠ 200 ⇒ erro genérico + lista vazia | `comments.error` visível E zero threads | `apps/web/src/comments/CommentsSidebar.spec.tsx:112` - `expect(await screen.findByText('Algo deu errado. Tente de novo.')).toBeTruthy()`; `:113` - `expect(screen.queryAllByTestId('comment-thread')).toHaveLength(0)` | ✅ PASS |
| CMT2-09 — `elementId` presente na cena ⇒ exibir como âncora | rótulo com o `elementId` | `apps/web/src/comments/CommentsSidebar.spec.tsx:122` - `expect(await screen.findByText('Ancorado em el-1')).toBeTruthy()`; classificação em `commentThreads.spec.ts:94` - `expect(threads[0]?.anchor).toEqual({ kind: 'element', elementId: 'el-1' })` | ✅ PASS |
| CMT2-10 — `elementId` ausente da cena ⇒ exibir marcado como removido, **nunca ocultar** | rótulo "âncora removida" E o comentário continua na lista | `apps/web/src/comments/CommentsSidebar.spec.tsx:129` - `expect(await screen.findByText('Âncora removida (el-gone)')).toBeTruthy()`; `:130` - `expect(screen.getByText('body of c-1')).toBeTruthy()`; `:131` - `expect(screen.getAllByTestId('comment-thread')).toHaveLength(1)`; `commentThreads.spec.ts:102` - `expect(threads[0]?.anchor).toEqual({ kind: 'missing', elementId: 'el-gone' })` | ✅ PASS |

### P1: Comentar ancorando na seleção (CMT2-11..19)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| CMT2-11 — composer disponível a qualquer papel, inclusive `allowed: false` | campo + botão presentes sem nenhuma entrada de permissão | `apps/web/src/comments/CommentsSidebar.spec.tsx:148` - `expect(await screen.findByLabelText('Novo comentário')).toBeTruthy()`; `:149` - botão "Comentar"; prova de produto no editor real com `mutatePermissions.allowed: false` em `DiagramEditorPage.spec.tsx:468` - `expect(screen.getByRole('button', { name: 'Comentar' })).toBeTruthy()` | ✅ PASS |
| CMT2-12 — corpo vazio ou só espaços ⇒ enviar desabilitado | `submit.disabled === true` | `apps/web/src/comments/CommentsSidebar.spec.tsx:159` - `expect(submit.disabled).toBe(true)`; `:162` - idem após `'   '`; `:165` - `.toBe(false)` com texto real | ✅ PASS |
| CMT2-13 — exatamente 1 selecionado ⇒ `POST` com `elementId` igual ao id | corpo do `POST` = `{body, elementId}` | `apps/web/src/comments/CommentsSidebar.spec.tsx:180` - `expect(postBody(fetchImpl)).toEqual({ body: 'olha aqui', elementId: 'el-7' })` (asserção sobre o corpo real enviado ao `fetch` mockado, não sobre a tela) | ✅ PASS |
| CMT2-14 — 0 selecionados ⇒ `POST` **sem** o campo `elementId` | chave ausente do corpo (não `''`, não `null`) | `apps/web/src/comments/CommentsSidebar.spec.tsx:195` - `expect(Object.hasOwn(postBody(fetchImpl), 'elementId')).toBe(false)`; nível de cliente em `commentClient.spec.ts:111` - mesma asserção | ✅ PASS |
| CMT2-15 — 2+ selecionados ⇒ `POST` sem `elementId` **e** aviso de não-ancorado | chave ausente E texto `composer.anchor.multiple` na tela | `apps/web/src/comments/CommentsSidebar.spec.tsx:206` - `expect(await screen.findByText('Vários elementos selecionados — o comentário não será ancorado')).toBeTruthy()`; `:212` - `expect(Object.hasOwn(postBody(fetchImpl), 'elementId')).toBe(false)` — as duas metades asseridas, e nenhum "primeiro da multi-seleção" vaza | ✅ PASS |
| CMT2-16 — `201` ⇒ acrescenta o comentário devolvido, limpa o campo, nenhum `GET` extra | comentário na lista, campo `''`, `GET` count = 1 | `apps/web/src/comments/CommentsSidebar.spec.tsx:230` - `expect(await screen.findByText('comentário novo')).toBeTruthy()`; `:231` - `expect(field.value).toBe('')`; `:232` - `expect(callsTo(fetchImpl)).toHaveLength(1)`; `:233` - anúncio `'Comentário publicado.'` | ✅ PASS |
| CMT2-17 — `404` ⇒ mensagem "não existe ou sem acesso", nada na lista | string `comments.notFound` E zero threads | `apps/web/src/comments/CommentsSidebar.spec.tsx:248` - `expect(...textContent).toBe('Este diagrama não existe ou você não tem acesso a ele.')`; `:252` - `expect(screen.queryAllByTestId('comment-thread')).toHaveLength(0)` | ✅ PASS |
| CMT2-18 — outro status de falha ⇒ erro genérico, nada na lista | string `comments.error` E zero threads | `apps/web/src/comments/CommentsSidebar.spec.tsx:267` - `.toBe('Algo deu errado. Tente de novo.')`; `:271` - zero threads; ramo de rede em `commentClient.spec.ts:147` | ✅ PASS |
| CMT2-19 — segundo envio durante envio em voo não emite segunda requisição | `POST` count permanece 1 | `apps/web/src/comments/CommentsSidebar.spec.tsx:292` - `expect(callsTo(fetchImpl, 'POST')).toHaveLength(1)` após dois `fireEvent.submit`; `:294` - ainda 1 após liberar a promise | ✅ PASS |

### P1: Resolver e reabrir uma thread (CMT2-20..23)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| CMT2-20 — resolver aparece em toda thread aberta, qualquer papel | um botão "Resolver" por thread aberta | `apps/web/src/comments/CommentsSidebar.spec.tsx:333` - `expect(screen.getAllByRole('button', { name: 'Resolver' })).toHaveLength(2)` | ✅ PASS |
| CMT2-21 — `PATCH` na **raiz** com `{status:'resolved'}`, refletido só após `200` | URL da raiz, corpo exato, tela inalterada antes da resposta | `apps/web/src/comments/CommentsSidebar.spec.tsx:357` - `expect(callsTo(fetchImpl,'PATCH')[0]?.[0]).toBe('/diagrams/d-1/comments/c-1')` (raiz, não a resposta `c-2`); `:358` - `expect(JSON.parse(...)).toEqual({ status: 'resolved' })`; `:362` - `expect(screen.queryByText('Resolvido')).toBeNull()` **antes** de liberar; `:365` - `Resolvido` só depois | ✅ PASS |
| CMT2-22 — thread resolvida oferece reabrir com `{status:'open'}` | corpo `{status:'open'}` e botão volta a "Resolver" | `apps/web/src/comments/CommentsSidebar.spec.tsx:383` - `expect(JSON.parse(...)).toEqual({ status: 'open' })`; `:386` - `expect(await screen.findByRole('button', { name: 'Resolver' })).toBeTruthy()` | ✅ PASS |
| CMT2-23 — `PATCH` ≠ 200 ⇒ informa a falha e mantém o status anterior | anúncio de falha E thread continua aberta | `apps/web/src/comments/CommentsSidebar.spec.tsx:402` - `.toBe('A ação falhou. Tente de novo.')`; `:406` - `expect(screen.getByRole('button', { name: 'Resolver' })).toBeTruthy()`; `:407` - `expect(screen.queryByText('Resolvido')).toBeNull()` | ✅ PASS |

### P2: Responder dentro da thread (CMT2-24..26)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| CMT2-24 — responder aparece em toda thread exibida | um botão "Responder" por thread | `apps/web/src/comments/CommentsSidebar.spec.tsx:417` - `expect(screen.getAllByRole('button', { name: 'Responder' })).toHaveLength(2)` | ✅ PASS |
| CMT2-25 — `POST` com `parentId` = id da **raiz**, nunca de uma resposta | corpo `{body, parentId: 'c-1'}` numa thread que já tem `c-2` | `apps/web/src/comments/CommentsSidebar.spec.tsx:442` - `expect(postBody(fetchImpl)).toEqual({ body: 'minha resposta', parentId: 'c-1' })` (thread montada com `c-2` já como resposta) | ✅ PASS |
| CMT2-26 — `201` ⇒ resposta dentro da própria thread, após as já exibidas | ordem `['body of c-2','minha resposta']` dentro de 1 thread | `apps/web/src/comments/CommentsSidebar.spec.tsx:471` - `expect(replies).toEqual(['body of c-2','minha resposta'])`; `:472` - `expect(screen.getAllByTestId('comment-thread')).toHaveLength(1)` | ✅ PASS |

### P2: Filtrar resolvidas e atualizar (CMT2-27..29)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| CMT2-27 — ocultar por padrão as threads cuja **raiz** está `resolved` | thread resolvida ausente, 1 thread visível | `apps/web/src/comments/CommentsSidebar.spec.tsx:482` - `expect(screen.queryByText('body of c-2')).toBeNull()`; `:483` - `expect(screen.getAllByTestId('comment-thread')).toHaveLength(1)` | ✅ PASS |
| CMT2-28 — "mostrar resolvidas" exibe todas | 2 threads visíveis | `apps/web/src/comments/CommentsSidebar.spec.tsx:493` - `expect(screen.getByText('body of c-2')).toBeTruthy()`; `:494` - `toHaveLength(2)` | ✅ PASS |
| CMT2-29 — "atualizar" reemite o `GET` e **substitui** a lista | conteúdo novo presente, antigo ausente, 2 `GET`s | `apps/web/src/comments/CommentsSidebar.spec.tsx:513` - `expect(await screen.findByText('body of c-9')).toBeTruthy()`; `:514` - `expect(screen.queryByText('body of c-1')).toBeNull()` (substitui, não concatena); `:515` - `expect(callsTo(fetchImpl)).toHaveLength(2)` | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas (CMT2-30..32)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| CMT2-30 — toda ação alcançável só por teclado | cada controle recebe foco | `apps/web/src/comments/CommentsSidebar.a11y.spec.tsx:106,110,115,119,123,128,133,138` - oito asserções `expect(document.activeElement).toBe(<control>)` cobrindo mostrar-resolvidas, atualizar, resolver, responder, campo, enviar, campo de resposta, enviar resposta. Trocar de aba: as abas são `<button type="button" role="tab">` nativos (`apps/web/src/diagram/EditorSidePanel.tsx:34,46`), ativados em `EditorSidePanel.spec.tsx:54` — foco não asserido explicitamente (ver Observações) | ✅ PASS |
| CMT2-31 — anunciar o resultado em região `aria-live="polite"` | atributo `polite` E texto do resultado | `apps/web/src/comments/CommentsSidebar.a11y.spec.tsx:146` - `expect(liveRegion.getAttribute('aria-live')).toBe('polite')`; `:151` - `expect(liveRegion.textContent).toBe('Comentário resolvido.')` após resolver | ✅ PASS |
| CMT2-32 — todo texto visível vindo de i18n, presente em `pt-BR` e `en` | mesmas chaves nos dois locales, render em `en` | `apps/web/src/comments/CommentsSidebar.a11y.spec.tsx:158-165` - 8 asserções por rótulo em inglês (`'Comments'`, `'Show resolved'`, `'Refresh'`, `'New comment'`, `'Comment'`, `'Resolve'`, `'Reply'`, `'Anchored to el-1'`), com `pt-BR` restaurado no `afterEach:27`; paridade de chaves verificada programaticamente: 27 chaves sob `comments`, conjunto idêntico nos dois arquivos | ✅ PASS |

**Status**: ✅ All 32 ACs covered — 32/32 asserted values match the spec-defined outcome. Zero
spec-precision gaps: every AC that names a precise value (`elementId` presence/absence, `{status}`
body, HTTP codes, request counts, `aria-selected`, `aria-live="polite"`) has a test asserting that
exact value, not merely that an assertion exists.

---

## Discrimination Sensor

Scratch: `git worktree add /tmp/r9-sensor HEAD` (outside this worktree's tree). `node_modules`
linked in, mutated, tests run, symlinks removed, `git worktree remove --force`. No `git stash` at
any point. Pre-sensor baseline `git status --porcelain` was empty; post-cleanup it is empty again,
and the real `node_modules` is intact.

Scratch baseline before any mutation: 72 passed (6 files: the 5 new specs + `DiagramEditorPage.spec.tsx`).

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| 1 | `apps/web/src/diagram/EditorSidePanel.tsx:33` | `{aiPanel !== null && (` → `{true && (` — the "IA" tab renders even for a role denied canvas mutation | ✅ Killed — 2 tests: `EditorSidePanel.spec.tsx:66` ("omits the AI tab entirely") **and** `DiagramEditorPage.spec.tsx:422` (the reviewer end-to-end test) |
| 2 | `apps/web/src/comments/CommentsSidebar.tsx:91` | `selection.length === 1` → `selection.length >= 1` — a multi-selection silently anchors to the first element | ✅ Killed — `CommentsSidebar.spec.tsx:198` (CMT2-15), via the `POST`-body assertion |
| 3 | `apps/web/src/comments/commentThreads.ts:33` | `if (!parent) return current.id;` → `return current.parentId;` — an orphaned `parentId` resolves to a non-existent root and the comment is silently dropped | ✅ Killed — 2 tests: `commentThreads.spec.ts:65` and `:73` |
| 4 | `apps/web/src/comments/commentThreads.ts:40` | `return { kind: 'missing', elementId }` → `return { kind: 'none' }` — a removed anchor is silently downgraded to "unanchored" | ✅ Killed — at BOTH levels: `commentThreads.spec.ts:97` (classification) **and** `CommentsSidebar.spec.tsx:125` (rendered list) |
| 5 | `apps/web/src/comments/CommentsSidebar.tsx:214` | `thread.root.status === 'open' ? 'resolved' : 'open'` → `'resolved'` — reopen sends the wrong status | ✅ Killed — `CommentsSidebar.spec.tsx:369` (CMT2-22) |
| 6 | `apps/web/src/diagram/EditorSidePanel.tsx:67` | `hidden={active !== 'comments'}` → conditional render — the inactive panel is UNMOUNTED instead of merely hidden | ✅ Killed — 2 tests: `EditorSidePanel.spec.tsx:41` and the updated layout test `DiagramEditorPage.spec.tsx:77` |

**Sensor depth**: lightweight+ (6 mutations, above the 1-3 default, covering all five highest-risk
behaviors named in the review scope plus the resolve/reopen toggle).
**Result**: 6/6 killed — PASS ✅

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ `commentClient` 131 lines, `commentThreads` 78, `CommentsSidebar` 275, `EditorSidePanel` 77 — no dead branch, no unused export |
| Surgical changes | ✅ 16 files: 8 new under `apps/web/src/comments/` + `apps/web/src/diagram/`, 2 i18n JSONs, `DiagramEditorPage.tsx`+spec, 2 spec docs, `docs/route-inventory.md` (regenerated artifact, required by T8) |
| No scope creep | ✅ every Out of Scope row honored: no edit, no delete, no `frameId` (never sent), no WS, no mention chip (the `mentions` array is deliberately absent from `Comment`, documented at `commentClient.ts:61`), no canvas pin, no click-to-select |
| No abstractions for single-use code | ✅ `EditorSidePanel` is slot-based with two literal slots — not a generic tab framework; `commentThreads` is one pure function |
| Only touched files required | ✅ `git diff f51e163 HEAD -- apps/mcp tools/repo-tools apps/server packages` is empty — no server or package touched |
| Didn't "improve" unrelated code | ✅ `handleApproved`, `mutationQueue`, `AiDock` props all unchanged; the canvas column's `flex:1`/`minHeight:0` still asserted at `DiagramEditorPage.spec.tsx:108-109` |
| Matches existing patterns/style | ✅ `commentClient` mirrors `nav/memberClient.ts` (injected `fetchImpl`, one status union per method, literal `fetchImpl(` at every call site); a11y suite mirrors `WorkspaceMembersPage.a11y.spec.tsx` incl. the local `seriousOrCriticalViolations` helper |
| Would a senior engineer approve? | ✅ yes — each non-obvious decision carries an inline rationale pointing back to the spec's Assumptions table |
| Tests map to ACs and are non-shallow | ✅ spot-checked P1 "Comentar": 9 ACs → 9+ tests, all asserting the request body or the exact rendered string, none asserting "something rendered" |
| Spec-anchored outcome check | ✅ 32/32 — see the AC tables above |
| Per-layer Coverage Expectation met | ✅ every row of `tasks.md`'s Test Coverage Matrix satisfied at the stated location, with the stated branch coverage (client: all 9 status branches + 3 network-failure branches) |
| Every test maps to a spec requirement | ✅ no unclaimed test — each `describe`/`it` names its CMT2 id or the spec edge case it covers |
| Documented guidelines followed | ✅ `CLAUDE.md` (Node 22 pin, gate commands), `.claude/commands/gate.md`; no numeric coverage guideline exists — strong defaults applied |

---

## Edge Cases

- [x] **`parentId` órfão vira raiz de thread própria, nunca descartado** — `commentThreads.spec.ts:65` (`expect(threads[0]?.root.id).toBe('c-9')`) and `:73` (a reply to an orphan groups under the orphan, not a discarded ancestor). Mutation 3 confirmed both assertions are load-bearing.
- [x] **Texto preservado quando a seleção muda** — `CommentsSidebar.spec.tsx:320` - `expect((...).value).toBe('rascunho')` after a `rerender` with a new `selection`; `:323` confirms only the pending anchor changed.
- [x] **Menção `@` não resolvida exibida verbatim, sem erro** — covered by construction: the panel renders `{thread.root.body}` (`CommentsSidebar.tsx:200`) with no mention processing anywhere, and `Comment` deliberately omits the `mentions` field (`commentClient.ts:61`) so a stray token cannot signal an error. `commentClient.spec.ts:55` asserts the raw row passes through untouched.
- [x] **Estado vazio quando não há comentário** — `CommentsSidebar.spec.tsx:105` - `expect(await screen.findByText('Nenhum comentário neste diagrama ainda.')).toBeTruthy()`.
- [x] **Painel inativo permanece montado e fora da árvore de acessibilidade** — `EditorSidePanel.spec.tsx:47` - `expect(container.querySelector('[data-testid="comments-slot"]')).not.toBeNull()` (still in the DOM) with `:48` - `expect(screen.queryByRole('button', { name: 'ação de comentário' })).toBeNull()` (out of the a11y tree); `:61` proves the same for the AI slot after switching away. Mutation 6 confirmed unmounting is caught.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (the Full/Build gate from `tasks.md`), Node 22.20.0 via `fnm`
- **Result**: exit 0 on all three. `make test-unit`: 24/24 turbo tasks successful, 0 failed, 0 skipped
- **`apps/web` test count before this feature** (`f51e163`): 265 tests / 28 files
- **`apps/web` test count after**: 331 tests / 33 files
- **Delta**: +66 tests, +5 files (`commentClient.spec.ts` 16, `commentThreads.spec.ts` 10, `CommentsSidebar.spec.tsx` 27, `CommentsSidebar.a11y.spec.tsx` 5, `EditorSidePanel.spec.tsx` 7, plus 1 new test in `DiagramEditorPage.spec.tsx`) — count only grew, satisfying T8's Done-when
- **Skipped tests**: none
- **Failures**: none
- **Lint**: 6 warnings, all `lint/suspicious/noTemplateCurlyInString` in `tools/repo-tools/src/webConsumers.spec.ts` — pre-existing and outside this feature's diff (`git diff f51e163 HEAD -- apps/mcp tools/repo-tools` is empty). Zero new findings attributable to this wave; `biome check` still exits 0.

**Test Integrity Check**: no test deleted, no assertion weakened. The one pre-existing test modified
is `DiagramEditorPage.spec.tsx:77` (the layout test). Its old assertion was
`expect((row.children[1] as HTMLElement).tagName).toBe('DETAILS')`; the new one asserts the row's
second child contains a `[role="tablist"]`, an `#side-panel-ai details` (the AiDock, still a
`<details>`, now nested one level deeper), and an `#side-panel-comments`. This is a **strengthening**:
it still proves the AiDock is inside the row's second child, and adds two structural claims the old
assertion could not make. Empirically load-bearing — mutation 6 (unmounting the inactive panel) was
killed by this very test. The canvas column's `flex:1`/`minHeight:0` assertions (`:108-109`) are
untouched.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| CMT2-01 .. CMT2-32 (all 32) | Implementing | ✅ Verified |

---

## Observations (non-blocking — no fix task created)

Three places where the evidence is sound but a future wave could make it more direct. None is an
uncovered AC, and each behavior was empirically discriminated by the sensor:

1. **Orphaned `parentId` has no panel-level render assertion.** The edge case is proven at the pure
   layer (`commentThreads.spec.ts:65,73`) but no `CommentsSidebar` test feeds a `GET` containing an
   orphaned `parentId` and asserts the comment appears in the rendered list. The sibling case
   (orphaned `elementId`) *does* have that render assertion (`CommentsSidebar.spec.tsx:125`), and the
   panel renders `threads` unconditionally, so the render path is proven — just via the other orphan.
2. **The "in-flight AI run survives a tab switch" rationale is proven structurally, not behaviorally.**
   `EditorSidePanel.spec.tsx:47,61` assert the inactive slot's DOM node persists, which in React
   means the subtree was never unmounted (mutation 6 confirms the assertion catches unmounting). No
   test drives an actual `awaiting_approval` run, switches to Comments and back, and asserts the run
   state survived — the claim rests on React semantics rather than a round-trip test.
3. **Keyboard reachability of the tabs themselves is not focus-asserted.** CMT2-30 lists "trocar de
   aba" among the actions; the tabs are native `<button type="button" role="tab">`
   (`EditorSidePanel.tsx:34,46`), so they are focusable by construction, but there is no
   `expect(document.activeElement).toBe(tab)` assertion, and no `EditorSidePanel.a11y.spec.tsx`
   (the Test Coverage Matrix does not require one).

---

## REST-only scoping disclosure

Confirmed honestly disclosed, not silently missing. `spec.md` documents it twice with a stated
reason: the Out of Scope table (`spec.md:39`) — "Atualização em tempo real de comentários
(WebSocket) | Esta fatia é REST puro. Transporte WebSocket é R10 (`realtime-presence`), onda própria
e paralela" — and the Assumptions table (`spec.md:61`) — "Limitação aceita, não lacuna a corrigir em
silêncio... O botão de atualizar é o que torna a limitação vivível". The mitigation is a real,
tested capability (CMT2-29, `CommentsSidebar.spec.tsx:497`), and the code repeats the disclosure at
`CommentsSidebar.tsx:32-33`.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 32/32 ACs matched the spec-defined outcome, 0 spec-precision gaps
**Sensor**: 6/6 mutations killed
**Gate**: `make lint && make typecheck && make test-unit` — all exit 0; 331 web tests passed, 0 failed, 0 skipped

**What works**:

- A role denied canvas mutation gets a side column with **no** "IA" tab at all (DOM-absence asserted, not just "Comments works"), Comments pre-selected, and a fully functional composer — asserted end-to-end in the real editor at `DiagramEditorPage.spec.tsx:422`.
- Selection→anchor is exact: 1 selected sends `elementId`; 0 and 2+ omit the key entirely (`Object.hasOwn(...)` is `false`, so no empty string and no first-of-multi-select leak), and the multi-select case shows the explicit "won't be anchored" notice.
- Orphaned anchors are never dropped: an `elementId` absent from the loaded scene renders marked-as-removed with the comment still in the list; an orphaned `parentId` becomes its own thread root.
- Both panels stay mounted with only `hidden` toggling, so no tab switch can unmount an in-flight AI run.
- The pre-existing layout test was strengthened, not weakened — and it is the test that catches unmounting.
- Resolve/reopen only reflects after a `200`; any other status keeps the previous state and announces the failure.
- `docs/route-inventory.md` now lists all three comment routes as consumed by `apps/web/src/comments/commentClient.ts`, closing the `pending-product` gap the Problem Statement opened with.

**Issues found**: none blocking. Three non-blocking observations recorded above.

**Next steps**: flip CMT2-01..32 to ✅ Verified in `spec.md` (done); close the R9 wave. The three
observations are candidates for opportunistic strengthening, not fix tasks.
