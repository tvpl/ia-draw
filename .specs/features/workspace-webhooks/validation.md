# Webhooks do workspace — Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/workspace-webhooks/spec.md`
**Diff range**: `c63266e..5d22115` (this feature's own 7 commits inside `f51e163..HEAD`; the rest of
that range is the unrelated R5/R6/R7 upstream merge this branch was rebased onto)
**Verifier**: independent sub-agent (author ≠ verifier)
**Round**: 1 (first behavioural review; also a post-rebase integrity re-check)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 — `webhookClient` | ✅ Done | `apps/web/src/nav/webhookClient.ts`, 16 unit tests |
| T2 — `nav.webhooks` i18n keys | ✅ Done | 34 keys, `en` and `pt-BR` key sets verified identical |
| T3 — `WebhookSecretPanel` | ✅ Done | `apps/web/src/nav/WebhookSecretPanel.tsx`, 8 unit tests |
| T4 — `WorkspaceWebhooksPage` | ⚠️ Partial | 24 unit tests; the screen-level dismissal path (WHK-17) is unasserted — see Sensor M2 |
| T5 — a11y coverage | ✅ Done | 9 tests (4 axe states, keyboard focus, `aria-live`, `en` locale) |
| T6 — route + `ProjectListPage` link | ✅ Done | `App.tsx:60`, `ProjectListPage.tsx:146,260`; +3 tests |

All 6 tasks carry `[x]` on every Done-when bullet in `tasks.md`.

---

## Rebase-Integrity Spot Check

The branch was rebased onto `f3ed671`, with manual conflict resolution in two files. Both were
re-read in full:

| File | This feature's addition | Unrelated upstream addition | Verdict |
| ---- | ----------------------- | --------------------------- | ------- |
| `apps/web/src/App.tsx` | `w/:workspaceId/webhooks` nested route (line 60) + `WorkspaceWebhooksPage` import (line 13) | R5's `/w/:workspaceId/d/:diagramId/inventory` sibling route (lines 71–78) + `InventoryPage` import (line 8) | ✅ Both present; doc comment carries both the T8 (component-library) and T6 (workspace-webhooks) paragraphs, no duplication, no dangling reference |
| `apps/web/src/nav/ProjectListPage.tsx` | `canManageWebhooks` (line 146), consumed at line 260 | R7's `canImportDiagram` (line 140), consumed at line 317 (`ImportDialog canImport=`) | ✅ Both constants survive and both are actually consumed — neither is orphaned |

Gate re-run post-rebase and post-`pnpm install --force`: green (see Gate Check).

---

## Spec-Anchored Acceptance Criteria

### P1: Ver os webhooks do workspace

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-01 — a tela lista URL, eventos e estado | URL, event labels and Ativo/Inativo per row | `WorkspaceWebhooksPage.spec.tsx:109-117` — `expect(getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook')`, `…webhook-events-wh-2…toBe('Spec gerada, Mencionado em um comentário')`, `…webhook-enabled-wh-2…toBe('Inativo')` | ✅ PASS |
| WHK-02 — link só com `workspace:manage_members` | link present for `workspace_admin`, absent for `editor` | `ProjectListPage.spec.tsx:157-158` — `expect(webhooksLink).toHaveProperty('href', expect.stringContaining('/w/ws-1/webhooks'))`; `ProjectListPage.spec.tsx:175` — `expect(screen.queryByRole('link', {name:'Webhooks'})).toBeNull()` | ✅ PASS |
| WHK-03 — qualquer não-2xx → mesma mensagem, sem distinguir 403/404 | the shared `nav.notFound` string for both | `WorkspaceWebhooksPage.spec.tsx:124-126` (403) and `:133-135` (404) — both `expect(await findByText('Este item não existe ou você não tem acesso a ele.')).toBeTruthy()` | ✅ PASS |
| WHK-04 — lista vazia → estado vazio explícito | `nav.webhooks.empty` rendered | `WorkspaceWebhooksPage.spec.tsx:141` — `expect(await findByText('Este workspace ainda não tem webhooks.')).toBeTruthy()` | ✅ PASS |

### P1: Cadastrar um webhook

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-05 — exatamente os 5 tipos de evento | 5 checkboxes, one per `WEBHOOK_EVENT_TYPES` value | `WorkspaceWebhooksPage.spec.tsx:152-161` — `expect(checkboxes).toHaveLength(5)` + `getByLabelText` for each of the 5 labels; enum itself pinned at `webhookClient.spec.ts:24-30` — `expect(WEBHOOK_EVENT_TYPES).toEqual([...5 server values...])` | ✅ PASS |
| WHK-06 — URL vazia após `trim` bloqueia, sem `POST` | message shown, no POST emitted | `WorkspaceWebhooksPage.spec.tsx:174-176` — `expect(within(form).getByText('A URL do endpoint é obrigatória.')).toBeTruthy()` + `expect(fetchImpl).toHaveBeenCalledTimes(1)` (list only) | ✅ PASS |
| WHK-07 — zero eventos bloqueia, sem `POST` | message shown, no POST emitted | `WorkspaceWebhooksPage.spec.tsx:188-189` — `expect(within(form).getByText('Escolha ao menos um evento.')).toBeTruthy()` + `toHaveBeenCalledTimes(1)` | ✅ PASS |
| WHK-08 — emite `POST` com `{url, events}` | exact body `{url, events}` | `WorkspaceWebhooksPage.spec.tsx:211-215` — `expect(fetchImpl).toHaveBeenCalledWith('/workspaces/ws-1/webhooks', {method:'POST', headers:{…}, body: JSON.stringify({url:'https://c.example.com/hook', events:['diagram.updated']})})` | ✅ PASS |
| WHK-09 — `201` → adiciona à lista e limpa o formulário | row appended, URL input `''`, checkbox unchecked | `WorkspaceWebhooksPage.spec.tsx:210,218-221` — `expect(await findByTestId('webhook-url-wh-9')).toBeTruthy()`, `expect(urlInput.value).toBe('')`, `expect(checkbox.checked).toBe(false)` | ✅ PASS |
| WHK-10 — não-`201` → informa a falha, nada adicionado | `nav.error.generic` announced, zero rows | `WorkspaceWebhooksPage.spec.tsx:237-242` — `expect(getByTestId('webhooks-announcement').textContent).toBe('Algo deu errado. Tente novamente.')` + `expect(queryAllByTestId(/^webhook-url-/)).toHaveLength(0)` | ✅ PASS |

### P1: Receber o segredo numa revelação única

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-11 — painel com o segredo em texto selecionável | secret value present, read-only | `WebhookSecretPanel.spec.tsx:24-25` — `expect(field.value).toBe(SECRET)` + `expect(field.readOnly).toBe(true)`; wired at `WorkspaceWebhooksPage.spec.tsx:259-261` — `expect(getByTestId('webhook-secret-value').value).toBe('whsec_A')` | ✅ PASS |
| WHK-12 — aviso explícito de "única vez" | the one-time warning string | `WebhookSecretPanel.spec.tsx:32-34` — `getByText('Este é o único momento em que este segredo aparece. Copie agora — depois não dá para recuperá-lo.')` | ✅ PASS |
| WHK-13 — segredo nunca alcançável só pelo botão de copiar | value in the DOM with no copy interaction | `WebhookSecretPanel.spec.tsx:42` — `expect(getByTestId('webhook-secret-value').value).toBe(SECRET)` with no click in the test body | ✅ PASS |
| WHK-14 — copiar escreve no clipboard e confirma | `writeText(secret)` called, `secret.copied` shown | `WebhookSecretPanel.spec.tsx:53-57` — `expect(copyOutcome.textContent).toBe('Segredo copiado para a área de transferência.')` + `expect(writeText).toHaveBeenCalledWith(SECRET)` | ✅ PASS |
| WHK-15 — clipboard ausente ou rejeitado → cópia manual, segredo mantido | `secret.copyFailed` shown, secret still rendered | `WebhookSecretPanel.spec.tsx:67-71` (absent) and `:81-85` (rejected) — both assert the manual-copy string **and** `expect(secretField.value).toBe(SECRET)` | ✅ PASS |
| WHK-16 — painel só some por dispensa explícita, nunca por tempo/re-render | still mounted after re-renders and 60s of fake time | `WebhookSecretPanel.spec.tsx:88-101` — `vi.advanceTimersByTime(60_000)` between two `rerender`s, then `expect(getByTestId('webhook-secret-panel')).toBeTruthy()` | ✅ PASS |
| WHK-17 — ao dispensar, **a tela** remove o segredo do documento e nada o traz de volta | after dismissal the secret is gone from the document | `WebhookSecretPanel.spec.tsx:110` — `expect(onDismiss).toHaveBeenCalledTimes(1)` covers only the *component contract*. **No test anywhere clicks dismiss on the page and asserts the panel/secret left the document.** `WorkspaceWebhooksPage.tsx:246`'s `onDismiss={() => setRevealedSecret(null)}` is unasserted — confirmed by surviving mutant M2 | ❌ GAP |

### P1: Editar um webhook

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-18 — `PATCH` com `url`, `events`, `enabled` correntes | exact three-field body | `WorkspaceWebhooksPage.spec.tsx:343-351` — `toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {method:'PATCH', …, body: JSON.stringify({url:'https://renamed.example.com/hook', events:['diagram.created'], enabled:true})})` | ✅ PASS |
| WHK-19 — nada alterado → nenhuma requisição | only the list fetch was made | `WorkspaceWebhooksPage.spec.tsx:363` — `expect(fetchImpl).toHaveBeenCalledTimes(1)` | ✅ PASS |
| WHK-20 — `200` → reflete os novos valores, nunca antes | row shows the new URL only after the response resolves | `WorkspaceWebhooksPage.spec.tsx:338-342` — `waitFor(() => expect(getByTestId('webhook-url-wh-1').textContent).toBe('https://renamed.example.com/hook'))`; the "never before" half is discriminated by WHK-21's failure test | ✅ PASS |
| WHK-21 — não-`200` → informa falha, mantém valores anteriores | old URL still in the row | `WorkspaceWebhooksPage.spec.tsx:388` — `expect(getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook')` after a 403 | ✅ PASS |
| WHK-22 — alternar ativo/inativo emite `PATCH {enabled}`, reflete só após `200` | body exactly `{enabled:false}`, label flips to Inativo | `WorkspaceWebhooksPage.spec.tsx:417-424` — `expect(getByTestId('webhook-enabled-wh-1').textContent).toBe('Inativo')` + `toHaveBeenCalledWith(…, {method:'PATCH', …, body: JSON.stringify({enabled:false})})` | ✅ PASS |

### P1: Rotacionar o segredo

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-23 — confirmação explícita antes de qualquer requisição, avisando invalidação imediata | warning text present, zero requests emitted | `WorkspaceWebhooksPage.spec.tsx:436-441` — `getByText('O segredo atual para de valer imediatamente, sem período de carência.')` + `expect(fetchImpl).toHaveBeenCalledTimes(1)` (list only) | ✅ PASS |
| WHK-24 — confirmar emite `PATCH …:rotate-secret` | exact sub-resource URL, `PATCH`, no body | `WorkspaceWebhooksPage.spec.tsx:461-463` — `toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1:rotate-secret', {method:'PATCH'})`; client-level at `webhookClient.spec.ts:181-183` | ✅ PASS |
| WHK-25 — `200` → novo segredo no mesmo painel | panel shows the rotated secret | `WorkspaceWebhooksPage.spec.tsx:456-460` — `expect(getByTestId('webhook-secret-value').value).toBe('whsec_R')` | ✅ PASS |
| WHK-26 — não-`200` → informa falha, nenhum painel | error announced, no panel in the DOM | `WorkspaceWebhooksPage.spec.tsx:478-483` — announcement assertion + `expect(queryByTestId('webhook-secret-panel')).toBeNull()` | ✅ PASS |
| WHK-27 — cancelar → nenhuma requisição, linha volta ao normal | Rotacionar button back, warning gone, list fetch only | `WorkspaceWebhooksPage.spec.tsx:494-500` — `getByRole('button',{name:'Rotacionar segredo'})`, `queryByText(warning)` `.toBeNull()`, `toHaveBeenCalledTimes(1)` | ✅ PASS |

### P1: Remover um webhook

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-28 — confirmação via `ConfirmArchiveDialog` citando a URL | dialog `itemName` = the webhook URL | `WorkspaceWebhooksPage.spec.tsx:515-517` — `expect(getByTestId('confirm-archive-item-name').textContent).toBe('https://a.example.com/hook')` | ✅ PASS |
| WHK-29 — confirmar emite `DELETE`, `204` remove da lista | row gone, exact DELETE call | `WorkspaceWebhooksPage.spec.tsx:521-524` — `waitFor(() => expect(queryByTestId('webhook-url-wh-1')).toBeNull())` + `toHaveBeenCalledWith('/workspaces/ws-1/webhooks/wh-1', {method:'DELETE'})` | ✅ PASS |
| WHK-30 — não-`204` → informa falha, mantém o webhook | error announced, row still shows the URL | `WorkspaceWebhooksPage.spec.tsx:544` — `expect(getByTestId('webhook-url-wh-1').textContent).toBe('https://a.example.com/hook')` | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| WHK-31 — toda ação alcançável só por teclado | every interactive control focusable | `WorkspaceWebhooksPage.a11y.spec.tsx:151-174` (back link, row edit/toggle/rotate/remove, URL input, 5 checkboxes, submit) and `:185-207` (remove-dialog confirm, rotate confirm, secret-panel copy/dismiss, secret field) — each `expect(document.activeElement).toBe(control)`; 4 axe states at `:99-145` assert `seriousOrCriticalViolations(results)).toEqual([])` | ✅ PASS |
| WHK-32 — resultado anunciado em `aria-live="polite"` | region carries `aria-live="polite"` and receives real text | `WorkspaceWebhooksPage.a11y.spec.tsx:220,225` — `expect(liveRegion.getAttribute('aria-live')).toBe('polite')` + `waitFor(() => expect(liveRegion.textContent).toBe('Webhook removido.'))`; also `WorkspaceWebhooksPage.spec.tsx:559,564` | ✅ PASS |
| WHK-33 — texto visível vem de i18n em `pt-BR` e `en` | English strings render after `changeLanguage('en')` | `WorkspaceWebhooksPage.a11y.spec.tsx:232-241` — `findByRole('heading',{name:'Webhooks'})`, `getByRole('button',{name:'Add webhook'})`, `expect(getByTestId('webhook-enabled-wh-1').textContent).toBe('Enabled')`; secret-panel `en` strings at `:258-264`. Key-set parity verified independently: 34 keys under `nav.webhooks`, `en` and `pt-BR` identical | ✅ PASS |

**Status**: ❌ 32/33 ACs matched the spec-defined outcome; **WHK-17 has no evidence** for its
screen-level half. 0 spec-precision gaps.

---

## Discrimination Sensor

Isolated scratch: `git worktree add /tmp/whk-sensor-9f2a HEAD --detach` (outside the feature
worktree tree), removed with `git worktree remove --force` afterwards. Baseline
`git status --porcelain` on the real worktree was empty before and after — isolation verified.
Baseline scratch run before any mutation: 90/90 passing across the 6 in-scope spec files.

| # | File:line | Description | Killed? |
| - | --------- | ----------- | ------- |
| 1 | `apps/web/src/nav/ProjectListPage.tsx:146` | Admin gate bypassed: `canManageWebhooks = can(…,'workspace:manage_members',…).allowed` → `= true` (link shown to every role) | ✅ Killed (1 failed / 22) |
| 2 | `apps/web/src/nav/WorkspaceWebhooksPage.tsx:246` | One-time-secret invariant broken: `onDismiss={() => setRevealedSecret(null)}` → `onDismiss={() => {}}` (dismissing never removes the secret from the document) | ❌ **Survived** — 471/471 of the entire `@arch-canvas/web` suite still green |
| 3 | `apps/web/src/nav/webhookClient.ts:11` | Event-type enum drift: `'comment.mentioned'` → `'comment.created'` | ✅ Killed (2 failed / 40) |
| 4 | `apps/web/src/nav/WorkspaceWebhooksPage.tsx:328` | Rotation confirmation bypassed: the Rotacionar button calls `confirmRotate(item)` directly instead of `setRotatingId(item.id)` | ✅ Killed (9 failed / 33) |
| 5 | `apps/web/src/nav/WebhookSecretPanel.tsx:31` | Clipboard-absent degrade broken: reports `secret.copied` instead of `secret.copyFailed` | ✅ Killed (1 failed / 8) |

**Sensor depth**: P0-full (5 mutations — the feature is the product's only surface that renders a
credential in the clear, plus an admin-only authorization gate)
**Result**: 4/5 killed — ❌ FAIL

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — no server change, 5 existing routes consumed as-is |
| Surgical changes | ✅ — 4 new files, 2 wiring files touched by 7 lines each, 2 locale files |
| No scope creep | ✅ — no delivery-status UI, no `rotatedAt`, no test-send button (all correctly left in Out of Scope) |
| Matches patterns | ✅ — mirrors `memberClient.ts` / `WorkspaceMembersPage` / `*.a11y.spec.tsx` conventions; `fetchImpl(...)` written literally at all 5 call sites, as the route-inventory extractor requires |
| Spec-anchored outcome check (asserted values match spec) | ⚠️ — 32/33; WHK-17 unasserted at the screen level |
| Per-layer Coverage Expectation met | ⚠️ — client layer covers every documented status branch of all 5 routes plus a network rejection per mutating method; component layer is 1:1 to ACs **except** WHK-17 |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — every `it()` title carries its WHK id or edge-case number |
| Documented guidelines followed | ✅ — `CLAUDE.md` (Node 22, gate commands), `.claude/commands/gate.md`; no other project testing guideline exists |
| No abstractions for single-use code / no invented flexibility | ✅ — `WebhookEndpoint` mirrors `toPublicWebhookEndpoint` field for field with no `secret` field; `WEBHOOK_EVENT_TYPES` mirrors the server list in the same order |

---

## Edge Cases

- [x] **Envio duplo do cadastro → um só `POST`** — `WorkspaceWebhooksPage.spec.tsx:308-311`,
      `expect(postCalls).toHaveLength(1)` with the create promise deliberately held open.
- [x] **Segunda revelação enquanto um painel está aberto → só o segredo mais recente** —
      `WorkspaceWebhooksPage.spec.tsx:282-287`, secret value `'whsec_B'` **and**
      `expect(getAllByTestId('webhook-secret-panel')).toHaveLength(1)`.
- [x] **Papel revogado durante a sessão → `403` tratado como qualquer outra falha** — covered on
      all three mutating paths: `PATCH` 403 (`:366-389`), rotate 403 (`:466-484`), `DELETE` 403
      (`:527-545`); the screen stays usable in each.
- [x] **Desmarcar o último evento durante a edição → bloqueia o `PATCH`** —
      `WorkspaceWebhooksPage.spec.tsx:401-402`, message shown + `toHaveBeenCalledTimes(1)`.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (Node 22 via `fnm use 22`;
  `make test-integration` correctly skipped — no task touches server code)
- **Result**: exit 0. `@arch-canvas/web`: **471 passed, 0 failed, 0 skipped** (52 files);
  `make lint` and `make typecheck` clean across all 25 workspace tasks.
- **Test count before feature** (web): 411 in 48 files
- **Test count after feature** (web): 471 in 52 files
- **Delta**: +60 tests, +4 files (webhookClient 16, WebhookSecretPanel 8, WorkspaceWebhooksPage 24,
  a11y 9, `App.spec.tsx` +1, `ProjectListPage.spec.tsx` +2)
- **Skipped tests**: none
- **Failures**: none
- **Test integrity**: no test deleted, no assertion weakened; the rebase preserved every upstream
  R5/R6/R7 test alongside these.

---

## Fix Plans

### Fix 1: WHK-17 — the screen-level dismissal of the secret panel is untested

- **Root cause**: WHK-17 was implemented (`WorkspaceWebhooksPage.tsx:246`,
  `onDismiss={() => setRevealedSecret(null)}`) but tested only at the component boundary. T3's
  Done-when phrased WHK-17 as "dismiss invokes `onDismiss`; the parent controls unmounting", and
  T4's Done-when list omits WHK-17 entirely — so neither task's tests assert the outcome the AC
  actually states: that **the screen** removes the secret from the document. `WebhookSecretPanel`
  deliberately keeps itself rendered after dismissal (asserted at `WebhookSecretPanel.spec.tsx:113`),
  which makes the parent the only place the guarantee can be proven, and it is exactly the place
  nobody asserted. Sensor M2 confirms: replacing the handler with a no-op leaves all 471 web tests
  green.
- **Fix task**: In `apps/web/src/nav/WorkspaceWebhooksPage.spec.tsx`, add one test that creates (or
  rotates) a webhook, waits for `webhook-secret-panel`, clicks the dismiss button
  (`getByRole('button', { name: 'Já guardei' })`), and asserts both
  `expect(screen.queryByTestId('webhook-secret-panel')).toBeNull()` and
  `expect(screen.queryByDisplayValue('whsec_A')).toBeNull()` — i.e. the value is gone from the
  document, not merely the panel hidden. Assert as well that no control on the row brings it back
  (the row after dismissal offers only Editar / Desativar / Rotacionar segredo / Remover).
  The behaviour is already correct; only the assertion is missing, so no production code changes.
- **Verify**: re-run sensor mutation M2 (`onDismiss={() => {}}`) and confirm the new test fails.
- **Priority**: Major — the AC guards the product's only cleartext-credential surface, and the
  spec's own Independent Test for the story ("dispensar e confirmar que sumiu e que nada na tela o
  recupera") is precisely the assertion that is absent.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| WHK-01..16 | Implementing | ✅ Verified |
| WHK-17 | Implementing | ❌ Needs Fix |
| WHK-18..33 | Implementing | ✅ Verified |

---

## Summary

**Overall**: ⚠️ Issues — one Major coverage gap, no behavioural defect found

**Spec-anchored check**: 32/33 ACs matched the spec-defined outcome; 1 AC (WHK-17) with no
evidence; 0 spec-precision gaps
**Sensor**: 4/5 mutations killed (M2 survived)
**Gate**: 471 passed, 0 failed, 0 skipped; lint and typecheck clean

**What works**: The rebase is intact — `App.tsx` and `ProjectListPage.tsx` each carry both this
feature's additions and the unrelated R5/R7 ones, all consumed, none orphaned. The admin-only gate
is real and discriminating (M1 killed). The event-type enum is pinned to the server's exact 5
values in order (M3 killed). Rotation cannot fire without explicit in-row confirmation (M4 killed).
The clipboard degrade path is genuinely asserted in both its absent and rejected forms (M5 killed).
All four listed edge cases are covered with real assertions, including the double-submit guard
proved against a deliberately-held-open promise and the single-panel invariant on a second reveal.
i18n key sets are identical across `en` and `pt-BR` (34 keys), with an explicit English render.

**Issues found**: WHK-17 — dismissing the secret panel must remove the secret from the document,
and no test at the screen level asserts it. The implementation is correct; the assertion is
missing, so a future refactor of `WorkspaceWebhooksPage.tsx:246` would silently reintroduce a
persistent cleartext secret on screen. See Fix 1.

**Next steps**: Route Fix 1 to an implementer (test-only, no production change), then re-verify by
re-running sensor mutation M2. No other gaps block the feature.
