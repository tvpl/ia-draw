# Compartilhamento externo por link — Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/share-links/spec.md`
**Diff range**: `f3ed671..8cb8c29` (branch `feature/r11-share-links`, 15 commits, sem interleaving de outras ondas)
**Verifier**: independent sub-agent (author ≠ verifier), read-only sobre a árvore real

---

## Validation: share-links - FAIL ❌

Um mutante sobreviveu ao sensor de discriminação (M7, SHR-04). O código está correto; o
teste que cobre SHR-04 não discrimina o papel escolhido pelo usuário de um papel constante.
Por `validate.md` §5.7, mutante sobrevivente vira fix task e a feature não fecha como done.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 — redigir token/ticket na URL logada | ✅ Done | `apps/server/src/core/logging.ts:58-73`, 5 testes novos |
| T2 — `viewModeEnabled` em `EditorSurface` | ✅ Done | 3 testes novos, nenhum existente tocado |
| T3 — `shareLinkClient` | ✅ Done | 11 testes novos, todos os ramos de status |
| T4 — chaves de i18n (pt-BR, en) | ✅ Done | 26 chaves `share.*` em cada locale, conjuntos idênticos (verificado por diff de chaves achatadas) |
| T5 — `PublicShell` | ✅ Done | 3 testes novos |
| T6 — `SharedResourcePage` | ✅ Done | 9 testes novos |
| T7 — a11y da visão pública | ✅ Done | 5 testes novos, todos sem `AuthProvider` |
| T8 — `ShareLinkPanel` | ✅ Done | 11 testes novos |
| T9 — a11y do painel | ✅ Done | 5 testes novos |
| T10 — `/share/:token` fora de `AuthProvider` | ✅ Done | `apps/web/src/App.tsx:62-63`, 2 testes novos |
| T11 — `viewModeEnabled={!canMutate}` no editor | ✅ Done | 2 testes novos |
| T12 — montar `ShareLinkPanel` no editor | ✅ Done | 2 testes novos |
| T13 — changeset | ✅ Done | `.changeset/share-links-view-mode.md`, patch em `@arch-canvas/editor-adapter` |
| T14 — inventário de rotas + escopo R11 | ✅ Done | 3 rotas saíram de `pending-product`; nota de escopo no roadmap |

Todos os 14 blocos de task têm 100% dos `Done when` marcados `[x]`; nenhum parcial, nenhum bloqueado.

---

## Spec-Anchored Acceptance Criteria

### P1: Criar um link de compartilhamento (SHR-01..07)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-01 — ação de criar link só com `mutatePermissions.allowed` verdadeiro | painel presente com `true`, ausente com `false` | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:924` - `expect(await screen.findByText('Link de compartilhamento')).toBeTruthy()`; `:934` - `expect(screen.queryByText('Link de compartilhamento')).toBeNull()` | ✅ PASS |
| SHR-02 — papel ou expiração vazios bloqueiam o envio, sem requisição | zero requisições | `apps/web/src/share/ShareLinkPanel.spec.tsx:62` e `:74` - `expect(fetchImpl).not.toHaveBeenCalled()` | ✅ PASS |
| SHR-03 — expiração no passado bloqueia com mensagem própria, sem requisição | mensagem específica + zero requisições | `apps/web/src/share/ShareLinkPanel.spec.tsx:85` - `expect(...textContent).toBe('Escolha uma data de expiração no futuro.')`; `:89` - `expect(fetchImpl).not.toHaveBeenCalled()` | ✅ PASS |
| SHR-04 — emitir `POST /diagrams/:id/share-links` com `{role, expiresAt}` | corpo com **o papel escolhido** e a expiração escolhida | `apps/web/src/share/ShareLinkPanel.spec.tsx:106-111` - `expect(url).toBe('/diagrams/d-1/share-links')`, `expect(JSON.parse(init.body)).toEqual({role:'viewer', expiresAt: new Date(FUTURE_LOCAL).toISOString()})` | ❌ GAP — asserção não discrimina o papel (ver Sensor M7) |
| SHR-05 — no `201`, exibir `${origin}/share/${token}` + aviso de exibição única | URL completa + aviso | `apps/web/src/share/ShareLinkPanel.spec.tsx:124` - `findByDisplayValue` da URL montada com `window.location.origin` + `/share/plain-token-abc`; `:127` - texto do aviso de uma única exibição | ✅ PASS |
| SHR-06 — `403` informa teto de papel e não adiciona link | mensagem de teto + lista vazia | `apps/web/src/share/ShareLinkPanel.spec.tsx:141` - `toBe('Você não pode conceder um papel acima do seu.')`; `:145` - `expect(screen.queryAllByRole('listitem')).toEqual([])` | ✅ PASS |
| SHR-07 — outro status informa falha genérica e não adiciona link | mensagem genérica + lista vazia | `apps/web/src/share/ShareLinkPanel.spec.tsx:156` - `toBe('Algo deu errado. Tente de novo.')`; `:160` - lista vazia | ✅ PASS |

### P1: Revogar um link criado (SHR-08..11)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-08 — lista só com links desta montagem, declarado visivelmente | aviso visível na tela | `apps/web/src/share/ShareLinkPanel.spec.tsx:188-192` - `getByText('Só aparecem aqui os links que você criou nesta tela...')` | ✅ PASS |
| SHR-09 — revogar emite `POST /share-links/:id:revoke` | URL + método exatos | `apps/web/src/share/ShareLinkPanel.spec.tsx:219` - `expect(fetchImpl).toHaveBeenCalledWith('/share-links/sl-1:revoke', {method:'POST'})` | ✅ PASS |
| SHR-10 — `200` marca revogado e some com a URL | badge "Revogado" + URL ausente do DOM | `apps/web/src/share/ShareLinkPanel.spec.tsx:215` - `queryByLabelText('URL de compartilhamento')).toBeNull()`; `:216` - `expect(urlField.isConnected).toBe(false)`; `:218` - `getByText('Revogado')` | ✅ PASS |
| SHR-11 — `403`/`404` informa falha e mantém o link ativo | falha anunciada + URL ainda presente + sem badge | `apps/web/src/share/ShareLinkPanel.spec.tsx:235` - anúncio genérico; `:239` - `getByLabelText('URL de compartilhamento')`; `:240` - `queryByText('Revogado')).toBeNull()` | ✅ PASS (`403`; o `404` é coberto no cliente, `shareLinkClient.spec.ts:95`) |

### P1: Abrir a visão pública sem sessão (SHR-12..17)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-12 — visitante sem sessão vê a visão pública, nunca redirect para `/login` | rota permanece `/share/<token>` | `apps/web/src/App.spec.tsx:405-406` - `findByTestId('share-read-only-notice')` + `expect(screen.getByTestId('location').textContent).toBe('/share/tok-1')` | ✅ PASS |
| SHR-13 — nenhum `GET /me` nem `POST /auth/refresh` enquanto montada | contadores em zero | `apps/web/src/App.spec.tsx:440-441` - `expect(meCalls).toBe(0)` e `expect(refreshCalls).toBe(0)` (contadores reais, não ausência de asserção) | ✅ PASS |
| SHR-14 — `GET /share/:token` exatamente uma vez | array de chamadas com um único elemento | `apps/web/src/share/SharedResourcePage.spec.tsx:71` - `expect(calls).toEqual(['/share/tok-1'])` | ✅ PASS |
| SHR-15 — `200` com `resourceType:'diagram'` renderiza `scene` no canvas | elementos chegam ao `<Excalidraw/>` | `apps/web/src/share/SharedResourcePage.spec.tsx:81` - `expect(capturedInitialElements).toEqual(SCENE)` | ✅ PASS |
| SHR-16 — `404` mostra mensagem única, sem distinguir causa e sem canvas | texto único + zero renders de canvas | `apps/web/src/share/SharedResourcePage.spec.tsx:128` - `findByText('Este link é inválido, expirou ou foi revogado.')`; `:129` - `expect(excalidrawRenders).toBe(0)` | ✅ PASS |
| SHR-17 — chrome público sem logout, navegação de workspace ou link autenticado | zero botão "Sair", zero links | `apps/web/src/share/PublicShell.spec.tsx:30` - `queryByRole('button', {name:'Sair'})).toBeNull()`; `:31` - `expect(screen.queryAllByRole('link')).toEqual([])`; `:38` - monta sem `AuthProvider` sem lançar | ✅ PASS |

### P1: A visão pública é somente leitura de verdade (SHR-18..21)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-18 — prop opcional repassada, comportamento preservado quando ausente | `true`/`false`/`undefined` chegam ao `<Excalidraw/>` | `packages/editor-adapter/src/EditorSurface.spec.tsx:340` - `toBe(true)`; `:346` - `toBe(false)`; `:352` - `toBeUndefined()` | ✅ PASS |
| SHR-19 — visão pública renderiza com `viewModeEnabled === true` | prop capturada no `<Excalidraw/>` real, via `EditorSurface` real | `apps/web/src/share/SharedResourcePage.spec.tsx:91` - `expect(capturedViewModeEnabled).toBe(true)` | ✅ PASS |
| SHR-20 — papel `editor` no link continua em `viewModeEnabled === true` | `true` mesmo com `role:'editor'` | `apps/web/src/share/SharedResourcePage.spec.tsx:101` - `expect(capturedViewModeEnabled).toBe(true)` | ✅ PASS |
| SHR-21 — sem `DiagramSyncClient`/fila de mutação, sem requisição de mutação | única chamada emitida é o resolve | `apps/web/src/share/SharedResourcePage.spec.tsx:120` - `expect(calls).toEqual(['/share/tok-1'])` (após flush de microtasks, com `role:'editor'`) | ✅ PASS |

### P1: O editor autenticado respeita papel de leitura (SHR-22)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-22 — `viewModeEnabled === true` quando `canMutate` falso, `false` quando verdadeiro | os dois valores, do bootstrap real | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:908` - `toBe(true)` com `mutatePermissions.allowed:false`; `:916` - `toBe(false)` com `true` | ✅ PASS |

### P1: O token nunca aparece em texto claro no log (SHR-23..26)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-23 — campo `url` da linha de log vira `/share/[REDACTED]` | valor literal | `apps/server/src/core/logging.spec.ts:120` - `expect(redactSensitiveUrl('/share/abc123')).toBe('/share/[REDACTED]')`; ponta a ponta em `:146` - `expect(output).toContain('"url":"/share/[REDACTED]"')` | ✅ PASS |
| SHR-24 — nenhum campo da linha contém o token em claro | stream real do Pino, `NODE_ENV=development` | `apps/server/src/core/logging.spec.ts:145` - `expect(output).not.toContain('real-share-token-abc123')` (saída capturada do `buildServer` real, não serializer mockado) | ✅ PASS |
| SHR-25 — valor de `ticket=` na URL logada vira `[REDACTED]` | valor literal | `apps/server/src/core/logging.spec.ts:124-126` - `expect(redactSensitiveUrl('/ws/diagrams/d-1?ticket=abc123')).toBe('/ws/diagrams/d-1?ticket=[REDACTED]')` | ✅ PASS |
| SHR-26 — redação só no valor logado; roteamento/resposta recebem a URL original | handler vê a URL com token | `apps/server/src/core/logging.spec.ts:158` - `expect(response.json()).toEqual({seenByHandler:'/share/real-share-token-abc123'})` | ✅ PASS |

### P2: Link de apresentação (SHR-27..28)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-27 — nome da apresentação + estado "ainda não disponível", sem canvas | heading com nome + placeholder + zero canvas | `apps/web/src/share/SharedResourcePage.spec.tsx:172` - `findByRole('heading',{name:'Apresentação: Roadmap'})`; `:173-177` - texto do placeholder com contagem de frames; `:179` - `expect(excalidrawRenders).toBe(0)` | ✅ PASS |
| SHR-28 — nunca renderizar conteúdo de frame (`notes`, `navLinksJson`) | `notes` ausente da tela | `apps/web/src/share/SharedResourcePage.spec.tsx:178` - `expect(container.textContent).not.toContain('private speaker note')`; no limite do cliente, `shareLinkClient.spec.ts:143` - `expect(JSON.stringify(result)).not.toContain('private speaker note')` | ✅ PASS |

### P2: Teclado e idioma (SHR-29..31)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-29 — criar, ler a URL e revogar alcançáveis só por teclado | cada controle recebe foco | `apps/web/src/share/ShareLinkPanel.a11y.spec.tsx:84,88,92,98` - `expect(document.activeElement).toBe(...)` para select, data, enviar e revogar; visão pública em `SharedResourcePage.a11y.spec.tsx:111` | ✅ PASS |
| SHR-30 — resultado anunciado em região `aria-live="polite"` | atributo + texto do resultado | `apps/web/src/share/ShareLinkPanel.spec.tsx:259` - `expect(liveRegion.getAttribute('aria-live')).toBe('polite')`; `:260` e `:264` - anúncios de criado e revogado | ✅ PASS |
| SHR-31 — todo texto visível vem de chaves de i18n nos dois locales | render em `en` além de `pt-BR` | `apps/web/src/share/ShareLinkPanel.a11y.spec.tsx:116-119` - `'Create link'`, `'Role granted by the link'`, `'Expires on'`, `'Links created in this session'`; `SharedResourcePage.a11y.spec.tsx:119` - `'This link is invalid, expired or revoked.'` | ✅ PASS |

**Status**: ⚠️ 30/31 ACs com asserção que casa o outcome da spec; **SHR-04 tem asserção presente mas não discriminante** (ver Sensor M7). Nenhum ⚠️ spec-precision gap: toda AC define outcome preciso e o teste mira nele.

---

## Decisões de design verificadas contra a implementação

| Decisão do design.md | Implementado como projetado? | Evidência |
| --- | --- | --- |
| `/share/:token` fora de `AuthProvider`, via rota de layout sem path (`AuthLayout`) | ✅ Sim — irmã real, não apenas visualmente separada | `apps/web/src/App.tsx:62` (rota pública) precede `:63` (`<Route element={<AuthLayout/>}>`), que abre o subtree autenticado fechado em `:94`. Nenhum ancestral da rota pública monta `AuthProvider`; prova comportamental (contadores `/me`/`/auth/refresh` em zero) em `App.spec.tsx:440-441` e mutante M3 morto |
| `AD-012` registrado em `.specs/STATE.md` e coerente com o design | ✅ Sim | `.specs/STATE.md` seção Decisions, `AD-012` (Decision/Reason/Trade-off/Scope/Date/Status), texto casando com `design.md:319-324`, incluindo a relação com AD-011 |
| Criação de link de apresentação adiada para R12, com justificativa explícita | ✅ Sim, em três lugares | `spec.md:51` (Out of Scope, com o motivo: não há superfície de apresentação de onde tirar um `presentationId`, e um método de cliente sem chamador é código morto); `spec.md:299-302` (tabela "Rotas consumidas" declarando 3 de 4 e a quarta adiada); `.specs/features/platform-maturity/ui-roadmap.md` (bloco "Escopo real entregue" na entrada R11). Não é omissão silenciosa |
| Visão pública de apresentação mostra placeholder honesto, nunca tenta renderizar frames | ✅ Sim | `apps/web/src/share/SharedResourcePage.tsx:67-74` renderiza nome + placeholder e retorna antes do canvas; `frames` sequer atravessa o cliente (`shareLinkClient.ts:155-164` projeta só `{id,name}` + `frameCount`) |
| Redação de log é serializer próprio, nunca reatribui `request.url` | ✅ Sim | `apps/server/src/core/logging.ts:113` (`url: redactSensitiveUrl(request.url)`) é a única chamada; nenhuma atribuição a `request.url` no diff. Segundo caminho com credencial (`?ticket=`) coberto pelo mesmo serializer (`logging.ts:59,72`) — real, não apenas alegado |
| `viewModeEnabled` repassada literalmente ao Excalidraw | ✅ Sim | `packages/editor-adapter/src/EditorSurface.tsx:200` (`viewModeEnabled={viewModeEnabled}`); nenhuma lógica condicional adicional, nenhum efeito colateral quando ligada |
| Retrofit no editor autenticado existente | ✅ Sim | `apps/web/src/diagram/DiagramEditorPage.tsx:165` (`viewModeEnabled={!canMutate}`), com teste nos dois valores; diff deste arquivo é autocontido (17 linhas, só a prop e o `<details>` do painel) |
| Formulário sem opção "nunca expira" | ✅ Sim | `apps/web/src/share/ShareLinkPanel.tsx:152-159` — único controle é `<input type="datetime-local">`; nenhuma opção de nulo, casando o contrato `z.coerce.date()` sem `.nullable()` do servidor |

---

## Discrimination Sensor

Tier: **P0-full** (rota pública sem sessão + redação de credencial em log). Scratch isolado via
`git worktree add` em `/private/tmp/.../scratchpad/sensor` (fora da árvore do worktree real),
removido ao fim; nunca `git stash`.

| # | File:line | Description | Killed? |
| --- | --- | --- | --- |
| M1 | `apps/server/src/core/logging.ts:69-73` | `redactSensitiveUrl` vira no-op (`return url`) | ✅ Killed (3 falhas) |
| M2 | `apps/server/src/core/logging.ts:72` | Só a redação de `ticket=` removida (a de `/share/` mantida) | ✅ Killed (1 falha) |
| M3 | `apps/web/src/App.tsx:62` | `/share/:token` movida para DENTRO de `<Route element={<AuthLayout/>}>` | ✅ Killed (1 falha: contador de `/me`) |
| M4 | `packages/editor-adapter/src/EditorSurface.tsx:200` | `EditorSurface` deixa de repassar `viewModeEnabled` ao `<Excalidraw/>` | ✅ Killed (2 falhas) |
| M5 | `apps/web/src/share/SharedResourcePage.tsx:82` | Visão pública passa `viewModeEnabled={false}` | ✅ Killed (3 falhas) |
| M6 | `apps/web/src/diagram/DiagramEditorPage.tsx:165` | Editor autenticado inverte para `viewModeEnabled={canMutate}` | ✅ Killed (3 falhas) |
| M7 | `apps/web/src/share/ShareLinkPanel.tsx:89` | Formulário ignora o papel escolhido e envia `'viewer'` fixo | ❌ **Survived** — 462/462 testes de `@arch-canvas/web` continuam passando |
| M8 | `apps/web/src/share/ShareLinkPanel.tsx:80` | Guarda de expiração no passado removida (requisição emitida mesmo assim) | ✅ Killed (1 falha) |

**Sensor depth**: P0-full (8 mutações)
**Result**: 7/8 killed — FAIL ❌

**Isolamento verificado**: `git status --porcelain` do worktree real vazio antes e depois do sensor
(baseline idêntico); scratch worktree removido e `git worktree prune` executado.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ — 4 arquivos de produção novos em `apps/web/src/share/`, 1 prop no pacote compartilhado, 1 função pura no servidor |
| Surgical changes | ✅ — `DiagramEditorPage.tsx` +15 linhas, `App.tsx` +32/-15 (apenas a indireção `AuthLayout`), `EditorSurface.tsx` +14 |
| No scope creep | ✅ — nada de listagem de links, renovação, analytics ou edição por link; as duas ampliações (redação de log, `viewModeEnabled`) estão declaradas na spec como decididas com o usuário antes do Specify |
| No abstractions for single-use code | ✅ — `shareLinkClient` dedicado justificado no design (forma de resposta e verbo `:revoke` incompatíveis com `resourceClient`), mesmo precedente de `memberClient.ts` |
| Only touched files required for task | ✅ — 27 arquivos, todos rastreáveis a uma task; nenhuma alteração em módulo não relacionado |
| Didn't "improve" unrelated code | ✅ — nenhum teste existente removido ou enfraquecido (ver "Integridade de testes") |
| Matches existing patterns/style | ✅ — `aria-live` + `data-testid` como `WorkspaceMembersPage`; `<details>` colapsado como `LibraryPanel`/`MetadataPanel`; `fetchImpl(...)` literal para o extrator de `repo-tools audit` |
| Would senior engineer approve? | ✅ com a ressalva de M7 (teste a fortalecer, não código a corrigir) |
| Tests map to acceptance criteria and are non-shallow | ⚠️ — 1:1 com as ACs, mas SHR-04 é raso quanto ao papel (M7) |
| Spec-anchored outcome check | ⚠️ — 30/31; SHR-04 assertado com o valor default, não com um papel distinto do default |
| Per-layer Coverage Expectation met | ✅ — cliente cobre todos os ramos de status documentados; telas cobrem cada AC e cada Edge Case aplicável; a11y cobre os estados renderizáveis nos dois locales |
| Every test maps to a spec AC / edge case / Done-when | ✅ — nenhum teste sem reivindicação; todos citam SHR-NN ou o Edge Case correspondente |
| Documented guidelines followed | ✅ — `CLAUDE.md` (Node 22, gate substituto) e `.claude/commands/gate.md` |

---

## Edge Cases

- [x] `GET /share/:token` falha de rede → mesma mensagem genérica, sem retry — `SharedResourcePage.spec.tsx:141,143` (`expect(attempts).toBe(1)`)
- [x] Segundo envio com criação em voo não emite segunda requisição — `ShareLinkPanel.spec.tsx:175,178` (`toHaveBeenCalledTimes(1)`)
- [x] Revogar duas vezes tratado como sucesso (rota idempotente, `200`) — coberto pelo caminho `200` (`ShareLinkPanel.spec.tsx:219`, `shareLinkClient.spec.ts:77`): a segunda revogação recebe o mesmo `200` e segue o mesmo ramo `{status:'revoked'}`, sem duplicar item (a lista é mapeada por `id`, `ShareLinkPanel.tsx:125-127`). Sem teste dedicado de duplo clique — coberto por construção, não por asserção própria
- [x] Cena vazia (`scene: []`) renderiza canvas vazio, nunca "link inválido" — `SharedResourcePage.spec.tsx:153,154`
- [x] `201` sem `token` tratado como falha genérica, sem URL incompleta — `shareLinkClient.spec.ts:57-66`

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (gate Build de `tasks.md`, sob Node 22.23.2 via `fnm`)
- **Result**: 1279 passed, 0 failed, 0 skipped (exit 0)
- **Por pacote**: web 462, server 400, diagram-ir 68, editor-adapter 67, ai-tools 70, auth 63, repo-tools 49, diagram-domain 29, shared-contracts 27, mcp 20, library-content 12, test-fixtures 8, backup 4
- **Test count antes da onda**: 1220 (derivado do diff: 59 blocos `it()` adicionados, 0 removidos)
- **Test count depois**: 1279
- **Delta**: +59 testes; nenhum teste deletado, nenhuma asserção enfraquecida
- **Integração** (`pnpm --filter @arch-canvas/server run test:integration`, não exigido por nenhuma task desta onda): 350 passed, 13 skipped, 3 arquivos falhando — `backup/restoreTest.int.spec.ts`, `ws-gateway/crossInstancePresence.int.spec.ts`, `ws-gateway/presenceBroadcaster.int.spec.ts`, todos por falta de `redis-server`/segunda instância Postgres neste host (lacuna de sandbox documentada em `CLAUDE.md`), nenhum tocado por esta onda. `share/share.int.spec.ts` passa limpo (10 testes)
- **Integridade de testes**: a única alteração em teste pré-existente é `DiagramEditorPage.spec.tsx:149` (`<details>` da coluna lateral, `3 → 4`). É **fortalecimento legítimo**: T12 monta de fato um quarto `<details>` (`DiagramEditorPage.tsx:196-201`), a asserção continua sendo de contagem exata, e a ausência do painel no caso `canMutate === false` tem asserção própria (`:934-935`). Nenhuma asserção trocada por uma mais frouxa

---

## Fix Plans

### Fix 1: SHR-04 — a asserção de criação não prova que o papel escolhido é o enviado

- **Root cause**: `ShareLinkPanel.spec.tsx:92-112` e `shareLinkClient.spec.ts:23-37` exercitam
  apenas `role: 'viewer'`. O único teste que escolhe outro papel (`org_admin`,
  `ShareLinkPanel.spec.tsx:137`) responde `403` e assere só a mensagem, nunca o corpo enviado.
  Consequência: uma implementação que ignore o `<select>` e envie um papel constante passa em
  462/462 testes de `@arch-canvas/web` (comprovado por M7). O código atual está correto
  (`ShareLinkPanel.tsx:74,89` usa `chosenRole`) — a lacuna é de discriminação de teste, num
  ponto com consequência de segurança: um papel enviado errado concede mais (ou menos) acesso
  do que o usuário escolheu.
- **Fix task**: em `ShareLinkPanel.spec.tsx`, trocar o papel do teste de SHR-04 para um valor
  diferente do primeiro/último do `<select>` (ex.: `reviewer`) e manter a asserção de corpo
  exato; adicionalmente, no teste de `403` (SHR-06), assertar que o corpo enviado carrega
  `role: 'org_admin'`. Done when: aplicar M7 (papel fixo em `'viewer'` na chamada de
  `createForDiagram`) faz o gate de `@arch-canvas/web` falhar.
- **Priority**: Major

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| SHR-01 | Implementing | ✅ Verified |
| SHR-02 | Implementing | ✅ Verified |
| SHR-03 | Implementing | ✅ Verified |
| SHR-04 | Implementing | ❌ Needs Fix |
| SHR-05..SHR-31 | Implementing | ✅ Verified |

(Detalhe linha a linha aplicado na tabela de `spec.md`.)

---

## Summary

**Overall**: ⚠️ Issues — uma fix task de fortalecimento de teste antes de fechar

**Spec-anchored check**: 30/31 ACs com asserção casando o outcome da spec; 1 gap (SHR-04); 0 spec-precision gaps
**Sensor**: 7/8 mutações mortas (P0-full)
**Gate**: 1279 passed, 0 failed

**What works**:
- `/share/:token` é estruturalmente pública: irmã da rota de layout `AuthLayout`, com prova
  comportamental de zero chamadas a `/me` e `/auth/refresh`, e o mutante que a move para dentro
  do provider morre.
- A redação de token no log é provada contra o stream real do Pino de um `buildServer` real, e o
  teste-par prova que `request.url` chega intacto ao handler — redação só no valor logado. O
  segundo caminho com credencial (`?ticket=`) é real, implementado no mesmo serializer e testado.
- `viewModeEnabled` chega ao `<Excalidraw/>` de verdade nas duas superfícies (pública e editor
  autenticado), com os três valores cobertos no pacote compartilhado e mutantes mortos em cada
  ponto da cadeia.
- O retrofit de `!canMutate` no `DiagramEditorPage` existente é real e testado nos dois valores,
  fechando a lacuna pré-existente de `reviewer`/`viewer`.
- O adiamento da criação de link de apresentação (3 de 4 rotas) é declarado com justificativa em
  spec, roadmap e tabela de rotas consumidas — decisão registrada, não omissão.
- A mudança de `3 → 4` `<details>` é fortalecimento legítimo, com painel real e asserção de
  ausência no caso negativo.

**Issues found**: Fix 1 (SHR-04): fortalecer a asserção de corpo do `POST` para discriminar o
papel escolhido pelo usuário — usar um papel diferente do default e assertar o corpo também no
caminho `403`.

**Next steps**: rotear Fix 1 como fix task para um implementer; re-verificar (rodada 2) rodando o
gate e reaplicando M7 para confirmar que passa a morrer.
