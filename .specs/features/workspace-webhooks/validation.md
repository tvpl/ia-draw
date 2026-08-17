# Webhooks do workspace — Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/workspace-webhooks/spec.md`
**Diff range**: `c63266e..377c073` (this feature's own commits inside `f3ed671..HEAD`)
**Verifier**: independent sub-agent (author ≠ verifier)
**Round**: 2 — **supersedes the round 1 report**, which FAILED on a single gap (WHK-17, screen-level
dismissal unasserted; sensor mutant M2 survived). All requirements were re-derived fresh this
round, not carried over: every `file:line` citation below was re-read against the current tree
(round 1's citations past line 265 of `WorkspaceWebhooksPage.spec.tsx` are now stale by +17 lines
because of the new test).

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 — `webhookClient` | ✅ Done | `apps/web/src/nav/webhookClient.ts`, 16 unit tests |
| T2 — `nav.webhooks` i18n keys | ✅ Done | 34 keys; `en` and `pt-BR` key sets re-verified identical this round |
| T3 — `WebhookSecretPanel` | ✅ Done | `apps/web/src/nav/WebhookSecretPanel.tsx`, 8 unit tests |
| T4 — `WorkspaceWebhooksPage` | ✅ Done | 25 unit tests (24 → 25; the WHK-17 screen-level gap is closed) |
| T5 — a11y coverage | ✅ Done | 9 tests (4 axe states, keyboard focus, `aria-live`, `en` locale) |
| T6 — route + `ProjectListPage` link | ✅ Done | `App.tsx:60`, `ProjectListPage.tsx:146,260`; +3 tests |

All 6 tasks carry `[x]` on every Done-when bullet in `tasks.md` — re-checked line by line.

---

## Round 1 Gap — Independent Re-derivation

The round 1 FAIL had exactly one cause: WHK-17's spec-defined outcome is that **the screen**
removes the secret from the document on dismissal, and the only evidence was
`WebhookSecretPanel.spec.tsx:110` — `expect(onDismiss).toHaveBeenCalledTimes(1)` — a component
*contract*, not the outcome. Mutant M2 (`onDismiss={() => {}}` on the page) survived the entire
471-test web suite.

Commit `377c073` adds one test. It was re-derived from scratch this round rather than accepted on
the commit message:

1. **It drives the real dismiss control, not a mock.** `WorkspaceWebhooksPage.spec.tsx:277` —
   `fireEvent.click(screen.getByRole('button', { name: 'Já guardei' }))`. `'Já guardei'` is the
   literal `pt-BR` value of `nav.webhooks.secret.dismiss` (verified directly in
   `apps/web/src/i18n/locales/pt-BR/translation.json`), which
   `WebhookSecretPanel.tsx:55-57` renders on the button whose `onClick` is the real `onDismiss`
   prop. Nothing in the test stubs the panel: the page is rendered whole, the panel is reached
   through a real `201` create response, and the click travels the production handler chain.
2. **Removal is a genuine unmount, not a CSS hide.** `WorkspaceWebhooksPage.tsx:245-247` renders
   the panel behind `{revealedSecret !== null && (<WebhookSecretPanel … />)}` — a conditional
   render, so `setRevealedSecret(null)` detaches the subtree. The assertion at
   `WorkspaceWebhooksPage.spec.tsx:279` is `expect(screen.queryByTestId('webhook-secret-panel'))
   .toBeNull()`, and `queryByTestId` resolves against the document tree regardless of styling — a
   panel merely hidden with CSS would still be found and the assertion would fail. Because
   `webhook-secret-value` lives **inside** the `webhook-secret-panel` section
   (`WebhookSecretPanel.tsx:43-51`), the panel's absence entails the secret's absence; the page
   renders the secret nowhere else (`grep` over `WorkspaceWebhooksPage.tsx`: `revealedSecret` is
   read at exactly one site, line 245-246).
3. **It fails if the handler breaks.** Proven empirically, not argued — sensor mutation M1 below
   reproduces round 1's exact survivor and the new test is the only thing that fails.
4. **"…and nothing brings it back"** — after `setRevealedSecret(null)` no variable in the component
   retains the value; the only two setters (`handleCreate:133`, `confirmRotate:202`) write a *new*
   secret straight from a fresh server response, and no route re-exposes an existing one by
   backend design. This half of the AC holds by construction, and no control could reintroduce
   `whsec_A` without a new HTTP round trip.

Residual note (not a gap): the assertion is on the panel's `data-testid` rather than additionally
on `queryByDisplayValue('whsec_A')`. Given the containment relationship above the two are
equivalent, and the mutation evidence is decisive.

---

## Spec-Anchored Acceptance Criteria

### P1: Ver os webhooks do workspace

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-01 — a tela lista URL, eventos e estado | URL, event labels and Ativo/Inativo per row | `WorkspaceWebhooksPage.spec.tsx:109-117` — `expect(getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook')`, `…webhook-events-wh-2….toBe('Spec gerada, Mencionado em um comentário')`, `…webhook-enabled-wh-2….toBe('Inativo')` | ✅ PASS |
| WHK-02 — link só com `workspace:manage_members` | link present for `workspace_admin`, absent for `editor` | `ProjectListPage.spec.tsx:159` — `expect(webhooksLink).toHaveProperty('href', expect.stringContaining('/w/ws-1/webhooks'))`; `ProjectListPage.spec.tsx:174` — `expect(screen.queryByRole('link', {name:'Webhooks'})).toBeNull()` | ✅ PASS |
| WHK-03 — qualquer não-2xx → mesma mensagem, sem distinguir 403/404 | the shared `nav.notFound` string for both | `WorkspaceWebhooksPage.spec.tsx:124-126` (403) and `:133-135` (404) — both `expect(await findByText('Este item não existe ou você não tem acesso a ele.')).toBeTruthy()` | ✅ PASS |
| WHK-04 — lista vazia → estado vazio explícito | `nav.webhooks.empty` rendered | `WorkspaceWebhooksPage.spec.tsx:141` — `expect(await findByText('Este workspace ainda não tem webhooks.')).toBeTruthy()` | ✅ PASS |

### P1: Cadastrar um webhook

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-05 — exatamente os 5 tipos de evento | 5 checkboxes, one per `WEBHOOK_EVENT_TYPES` value | `WorkspaceWebhooksPage.spec.tsx:152` — `expect(checkboxes).toHaveLength(5)` + `:160` `getByLabelText` per label; enum pinned at `webhookClient.spec.ts:23-32` — `expect(WEBHOOK_EVENT_TYPES).toEqual([…5 server values…])` | ✅ PASS |
| WHK-06 — URL vazia após `trim` bloqueia, sem `POST` | message shown, no POST emitted | `WorkspaceWebhooksPage.spec.tsx:174` — `expect(within(form).getByText('A URL do endpoint é obrigatória.')).toBeTruthy()` + `:176` `expect(fetchImpl).toHaveBeenCalledTimes(1)` (list only) | ✅ PASS |
| WHK-07 — zero eventos bloqueia, sem `POST` | message shown, no POST emitted | `WorkspaceWebhooksPage.spec.tsx:188-189` — `expect(within(form).getByText('Escolha ao menos um evento.')).toBeTruthy()` + `toHaveBeenCalledTimes(1)` | ✅ PASS |
| WHK-08 — emite `POST` com `{url, events}` | exact body `{url, events}` | `WorkspaceWebhooksPage.spec.tsx:211-216` — `toHaveBeenCalledWith('/workspaces/ws-1/webhooks', {method:'POST', …, body: JSON.stringify({url:'https://c.example.com/hook', events:['diagram.updated']})})` | ✅ PASS |
| WHK-09 — `201` → adiciona à lista e limpa o formulário | row appended, URL input `''`, checkbox unchecked | `WorkspaceWebhooksPage.spec.tsx:210,218-221` — `expect(await findByTestId('webhook-url-wh-9')).toBeTruthy()`, `expect(urlInput.value).toBe('')`, checkbox `.checked` `false` | ✅ PASS |
| WHK-10 — não-`201` → informa a falha, nada adicionado | `nav.error.generic` announced, zero rows | `WorkspaceWebhooksPage.spec.tsx:237-241` — `expect(getByTestId('webhooks-announcement').textContent).toBe('Algo deu errado. Tente novamente.')` + `expect(queryAllByTestId(/^webhook-url-/)).toHaveLength(0)` | ✅ PASS |

### P1: Receber o segredo numa revelação única

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-11 — painel com o segredo em texto selecionável | secret value present, read-only | `WebhookSecretPanel.spec.tsx:24-25` — `expect(field.value).toBe(SECRET)` + `expect(field.readOnly).toBe(true)`; page wiring at `WorkspaceWebhooksPage.spec.tsx:259-261` — `expect(getByTestId('webhook-secret-value').value).toBe('whsec_A')` | ✅ PASS |
| WHK-12 — aviso explícito de "única vez" | the one-time warning string | `WebhookSecretPanel.spec.tsx:31-34` — `getByText('Este é o único momento em que este segredo aparece. Copie agora — depois não dá para recuperá-lo.')` | ✅ PASS |
| WHK-13 — segredo nunca alcançável só pelo botão de copiar | value in the DOM with no copy interaction | `WebhookSecretPanel.spec.tsx:42` — `expect(getByTestId('webhook-secret-value').value).toBe(SECRET)` with no click anywhere in the test body | ✅ PASS |
| WHK-14 — copiar escreve no clipboard e confirma | `writeText(secret)` called, `secret.copied` shown | `WebhookSecretPanel.spec.tsx:53-57` — `expect(copyOutcome.textContent).toBe('Segredo copiado para a área de transferência.')` + `expect(writeText).toHaveBeenCalledWith(SECRET)` | ✅ PASS |
| WHK-15 — clipboard ausente ou rejeitado → cópia manual, segredo mantido | `secret.copyFailed` shown, secret still rendered | `WebhookSecretPanel.spec.tsx:67-71` (absent) and `:81-85` (rejected) — both assert the manual-copy string **and** `expect(secretField.value).toBe(SECRET)` | ✅ PASS |
| WHK-16 — painel só some por dispensa explícita, nunca por tempo/re-render | still mounted after re-renders and 60s of fake time | `WebhookSecretPanel.spec.tsx:97-98` — `vi.advanceTimersByTime(60_000)` between two `rerender`s, then `expect(getByTestId('webhook-secret-panel')).toBeTruthy()` + the value intact | ✅ PASS |
| WHK-17 — ao dispensar, **a tela** remove o segredo do documento e nada o traz de volta | after dismissal the panel (and with it the secret) is gone from the document | `WorkspaceWebhooksPage.spec.tsx:265-280` — real `201` create, `findByTestId('webhook-secret-panel')`, then `fireEvent.click(getByRole('button', {name:'Já guardei'}))` and `:279` `expect(queryByTestId('webhook-secret-panel')).toBeNull()`. True unmount, not a CSS hide: `WorkspaceWebhooksPage.tsx:245` renders behind `revealedSecret !== null &&`. Discrimination proven by mutant M1 below. Component contract still additionally covered at `WebhookSecretPanel.spec.tsx:110` | ✅ PASS |

### P1: Editar um webhook

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-18 — `PATCH` com `url`, `events`, `enabled` correntes | exact three-field body | `WorkspaceWebhooksPage.spec.tsx:360-368` — `toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {method:'PATCH', …, body: JSON.stringify({url:'https://renamed.example.com/hook', events:['diagram.created'], enabled:true})})` | ✅ PASS |
| WHK-19 — nada alterado → nenhuma requisição | only the list fetch was made | `WorkspaceWebhooksPage.spec.tsx:380` — `expect(fetchImpl).toHaveBeenCalledTimes(1)` | ✅ PASS |
| WHK-20 — `200` → reflete os novos valores, nunca antes | row shows the new URL only after the response resolves | `WorkspaceWebhooksPage.spec.tsx:355-358` — `waitFor(() => expect(getByTestId('webhook-url-wh-1').textContent).toBe('https://renamed.example.com/hook'))`; the "never before" half discriminated by WHK-21's failure test | ✅ PASS |
| WHK-21 — não-`200` → informa falha, mantém valores anteriores | old URL still in the row | `WorkspaceWebhooksPage.spec.tsx:400-405` — announcement assertion + `expect(getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook')` after a 403 | ✅ PASS |
| WHK-22 — alternar ativo/inativo emite `PATCH {enabled}`, reflete só após `200` | body exactly `{enabled:false}`, label flips to Inativo | `WorkspaceWebhooksPage.spec.tsx:430,435,437-441` — pre-toggle `'Ativo'`, then `waitFor(… .toBe('Inativo'))` + `toHaveBeenCalledWith(…, body: JSON.stringify({enabled:false}))` | ✅ PASS |

### P1: Rotacionar o segredo

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-23 — confirmação explícita antes de qualquer requisição, avisando invalidação imediata | warning text present, zero requests emitted | `WorkspaceWebhooksPage.spec.tsx:453-458` — `getByText('O segredo atual para de valer imediatamente, sem período de carência.')` + `expect(fetchImpl).toHaveBeenCalledTimes(1)` (list only) | ✅ PASS |
| WHK-24 — confirmar emite `PATCH …:rotate-secret` | exact sub-resource URL, `PATCH` | `WorkspaceWebhooksPage.spec.tsx:478-480` — `toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1:rotate-secret', {method:'PATCH'})`; client-level at `webhookClient.spec.ts:168-185` | ✅ PASS |
| WHK-25 — `200` → novo segredo no mesmo painel | panel shows the rotated secret | `WorkspaceWebhooksPage.spec.tsx:474-477` — `expect(getByTestId('webhook-secret-value').value).toBe('whsec_R')` | ✅ PASS |
| WHK-26 — não-`200` → informa falha, nenhum painel | error announced, no panel in the DOM | `WorkspaceWebhooksPage.spec.tsx:496-500` — announcement assertion + `expect(queryByTestId('webhook-secret-panel')).toBeNull()` | ✅ PASS |
| WHK-27 — cancelar → nenhuma requisição, linha volta ao normal | Rotacionar button back, warning gone, list fetch only | `WorkspaceWebhooksPage.spec.tsx:511-517` — `getByRole('button',{name:'Rotacionar segredo'})`, warning `queryByText` `.toBeNull()`, `toHaveBeenCalledTimes(1)` | ✅ PASS |

### P1: Remover um webhook

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-28 — confirmação via `ConfirmArchiveDialog` citando a URL | dialog `itemName` = the webhook URL | `WorkspaceWebhooksPage.spec.tsx:532-534` — `expect(getByTestId('confirm-archive-item-name').textContent).toBe('https://a.example.com/hook')` | ✅ PASS |
| WHK-29 — confirmar emite `DELETE`, `204` remove da lista | row gone, exact DELETE call | `WorkspaceWebhooksPage.spec.tsx:538-542` — `waitFor(() => expect(queryByTestId('webhook-url-wh-1')).toBeNull())` + `toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {method:'DELETE'})` | ✅ PASS |
| WHK-30 — não-`204` → informa falha, mantém o webhook | error announced, row still shows the URL | `WorkspaceWebhooksPage.spec.tsx:557-561` — announcement + `expect(getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook')` | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-31 — toda ação alcançável só por teclado | every interactive control focusable | `WorkspaceWebhooksPage.a11y.spec.tsx:153-173` (back link, row edit/toggle/rotate/remove, URL input, 5 checkboxes, submit) and `:188-207` (remove-dialog confirm, rotate confirm, secret-panel copy/dismiss, secret field) — each `expect(document.activeElement).toBe(control)`; 4 axe states at `:104,121,132,144` assert `seriousOrCriticalViolations(results)).toEqual([])` | ✅ PASS |
| WHK-32 — resultado anunciado em `aria-live="polite"` | region carries `aria-live="polite"` and receives real text | `WorkspaceWebhooksPage.a11y.spec.tsx:220,225` — `expect(liveRegion.getAttribute('aria-live')).toBe('polite')` + `waitFor(() => expect(liveRegion.textContent).toBe('Webhook removido.'))`; also `WorkspaceWebhooksPage.spec.tsx:576,581` | ✅ PASS |
| WHK-33 — texto visível vem de i18n em `pt-BR` e `en` | English strings render after `changeLanguage('en')` | `WorkspaceWebhooksPage.a11y.spec.tsx:232-241` — `findByRole('heading',{name:'Webhooks'})`, `getByRole('button',{name:'Add webhook'})`, `expect(getByTestId('webhook-enabled-wh-1').textContent).toBe('Enabled')`; secret-panel `en` strings at `:258-264`. Key-set parity re-verified this round: 34 keys under `nav.webhooks`, `en` and `pt-BR` identical | ✅ PASS |

**Status**: ✅ **33/33 ACs matched the spec-defined outcome. 0 gaps, 0 spec-precision gaps.**

---

## Discrimination Sensor

Isolated scratch: `git worktree add /tmp/whk-sensor-r2 HEAD --detach` (outside this worktree's
directory tree), `node_modules` symlinked in, removed afterwards with
`git worktree remove --force` + `git worktree prune`. Baseline `git status --porcelain` on the real
worktree was **empty before and after** — isolation verified, no `git stash` used at any point.
Baseline scratch run before any mutation: **91/91 passing** across the 6 in-scope spec files
(90/90 in round 1; +1 is the new WHK-17 test).

| # | File:line | Description | Killed? |
| - | --------- | ----------- | ------- |
| 1 | `apps/web/src/nav/WorkspaceWebhooksPage.tsx:246` | **Round 1's exact survivor, reproduced**: `onDismiss={() => setRevealedSecret(null)}` → `onDismiss={() => {}}` (dismissing never removes the secret from the document) | ✅ **Killed** (1 failed / 91) — the failure is precisely `WorkspaceWebhooksPage.spec.tsx:279`, and nothing else |
| 2 | `apps/web/src/nav/ProjectListPage.tsx:146` | Admin gate bypassed: `canManageWebhooks = can(…,'workspace:manage_members',…).allowed` → `= true` (link shown to every role) | ✅ Killed (1 failed / 22) |
| 3 | `apps/web/src/nav/WorkspaceWebhooksPage.tsx:328` | Rotation confirmation bypassed: the Rotacionar button calls `void confirmRotate(item)` directly instead of `setRotatingId(item.id)` | ✅ Killed (9 failed / 34) |
| 4 | `apps/web/src/nav/WorkspaceWebhooksPage.tsx:119-123` | Event-type validation removed: the `createEvents.length === 0` client-side block deleted, so a create with zero events reaches the network | ✅ Killed (1 failed / 25) |
| 5 | `apps/web/src/nav/WorkspaceWebhooksPage.tsx:21` | Unchanged-save guard defeated: `sameEvents()` → `return false`, so an edit that changed nothing still emits a `PATCH` the server would 400 | ✅ Killed (1 failed / 34) |

**Sensor depth**: P0-full (5 mutations — the feature is the product's only surface rendering a
credential in the clear, plus an admin-only authorization gate)
**Result**: **5/5 killed — PASS ✅**

M1 is the decisive result of this round: the mutation that survived all 471 tests in round 1 now
fails exactly one test, the one added by `377c073`, confirming the new assertion is both
discriminating and correctly targeted (it does not fire on unrelated behaviour).

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — no server change; 5 existing routes consumed as-is. The round 1 fix is test-only: `377c073` is `+17 / -0` in a single spec file, zero production lines touched |
| Surgical changes | ✅ — 4 new files, 2 wiring files touched by ~7 lines each, 2 locale files |
| No scope creep | ✅ — no delivery-status UI, no `rotatedAt`, no test-send button (all correctly left in Out of Scope) |
| Matches patterns | ✅ — mirrors `memberClient.ts` / `WorkspaceMembersPage` / `*.a11y.spec.tsx`; `fetchImpl(...)` written literally at all 5 call sites, as the route-inventory extractor requires |
| Spec-anchored outcome check (asserted values match spec) | ✅ — 33/33 |
| Per-layer Coverage Expectation met | ✅ — client covers every documented status branch of all 5 routes plus a network rejection per mutating method; component layer is now 1:1 to ACs with no exception |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — every `it()` title carries its WHK id or edge-case number, the new one included (`… (WHK-17)`) |
| Documented guidelines followed | ✅ — `CLAUDE.md` (Node 22, gate commands), `.claude/commands/gate.md`; no other project testing guideline exists |
| No abstractions for single-use code / no invented flexibility | ✅ — `WebhookEndpoint` mirrors `toPublicWebhookEndpoint` field for field with no `secret` field; `WEBHOOK_EVENT_TYPES` mirrors the server list in the same order |

---

## Edge Cases

- [x] **Envio duplo do cadastro → um só `POST`** — `WorkspaceWebhooksPage.spec.tsx:328`,
      `expect(postCalls).toHaveLength(1)` with the create promise deliberately held open.
- [x] **Segunda revelação enquanto um painel está aberto → só o segredo mais recente** —
      `WorkspaceWebhooksPage.spec.tsx:300-304`, value `'whsec_B'` **and**
      `expect(getAllByTestId('webhook-secret-panel')).toHaveLength(1)`.
- [x] **Papel revogado durante a sessão → `403` tratado como qualquer outra falha** — covered on
      all three mutating paths: `PATCH` 403 (`:383-405`), rotate 403 (`:483-500`), `DELETE` 403
      (`:544-561`); the screen stays usable in each.
- [x] **Desmarcar o último evento durante a edição → bloqueia o `PATCH`** —
      `WorkspaceWebhooksPage.spec.tsx:418-419`, message shown + `toHaveBeenCalledTimes(1)`; its
      discrimination independently re-confirmed by sensor mutation 4 on the sibling create path.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (Node 22 via `fnm use 22`;
  `make test-integration` correctly skipped — no task touches server code)
- **Result**: **exit 0**. `@arch-canvas/web`: **472 passed, 0 failed, 0 skipped** (52 files);
  `make lint` and `make typecheck` clean across all 24 workspace tasks; every other package green
  (server 395, auth 63, ai-tools 70, diagram-ir 68, editor-adapter 64, repo-tools 49, …)
- **Test count before feature** (web): 411 in 48 files
- **Test count after round 1** (web): 471 in 52 files
- **Test count after round 2** (web): **472 in 52 files**
- **Delta**: +61 tests, +4 files vs. pre-feature; **+1 test vs. round 1**, no file added
- **Skipped tests**: none
- **Failures**: none
- **Test integrity**: `git show --stat 377c073` is `1 file changed, 17 insertions(+)` — no test
  deleted, no assertion weakened, no production code touched. Coverage of
  `WorkspaceWebhooksPage.tsx` reported at 98.63% stmts / 94.62% branch; `WebhookSecretPanel.tsx`
  and `webhookClient.ts` at 100% / 100%.

---

## Fix Plans

None. Round 1's Fix 1 (WHK-17) is closed and independently re-verified above; no new issue found.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| WHK-17 | ❌ Needs Fix (round 1) | ✅ Verified |
| WHK-01..16, WHK-18..33 | ✅ Verified (round 1, re-derived fresh this round) | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 33/33 ACs matched the spec-defined outcome; 0 gaps; 0 spec-precision gaps
**Sensor**: 5/5 mutations killed, including a faithful reproduction of round 1's survivor
**Gate**: 472 passed, 0 failed, 0 skipped; lint and typecheck clean

**What works**: The one-time secret reveal is now guarded end to end — the panel holds through
re-renders and elapsed time (WHK-16), degrades correctly when the clipboard is absent or refuses
(WHK-15), never stacks two panels on a second reveal (edge case 2), and — the round 1 gap, now
closed — genuinely leaves the document when the user clicks the real "Já guardei" button, with the
value retained nowhere that could bring it back. The admin-only entry gate is real and
discriminating (M2), rotation cannot fire without explicit in-row confirmation (M3), the
zero-event and no-change client-side guards both prevent avoidable 400s and are discriminating
(M4, M5). All four listed edge cases carry real assertions. i18n key sets are identical across
`en` and `pt-BR` (34 keys) with an explicit English render, including the secret panel's strings.

**Issues found**: none.

**Next steps**: Feature is done. Ready to close the wave.
