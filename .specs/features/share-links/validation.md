# Compartilhamento externo por link — Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/share-links/spec.md`
**Diff range**: `f3ed671..9552f78` (branch `feature/r11-share-links`, 17 commits, sem interleaving de outras ondas)
**Verifier**: independent sub-agent (author ≠ verifier), read-only sobre a árvore real
**Rodada**: 2 — **supersede integralmente o relatório da rodada 1** (FAIL, um mutante sobrevivente em SHR-04). Todas as 31 ACs foram re-derivadas do zero nesta rodada, não copiadas.

---

## Validation: share-links - PASS ✅

O único gap da rodada 1 (SHR-04 — a asserção do formulário de criação não discriminava o papel
escolhido pelo usuário de um papel constante) está fechado no commit `9552f78`. A correção foi
re-derivada de forma independente: o mutante exato que sobreviveu na rodada 1 foi reinjetado num
scratch isolado e **morre** agora, com duas falhas (SHR-04 e SHR-06). Nenhum gap remanescente.

---

## Task Completion

| Task | Status | Notes |
| --- | --- | --- |
| T1 — redigir token/ticket na URL logada | ✅ Done | `apps/server/src/core/logging.ts:58-73`, 5 testes |
| T2 — `viewModeEnabled` em `EditorSurface` | ✅ Done | 3 testes, nenhum existente tocado |
| T3 — `shareLinkClient` | ✅ Done | 11 testes, todos os ramos de status |
| T4 — chaves de i18n (pt-BR, en) | ✅ Done | 26 chaves `share.*` por locale, conjuntos idênticos (re-verificado nesta rodada por diff de chaves achatadas) |
| T5 — `PublicShell` | ✅ Done | 3 testes |
| T6 — `SharedResourcePage` | ✅ Done | 9 testes |
| T7 — a11y da visão pública | ✅ Done | 5 testes, todos sem `AuthProvider` |
| T8 — `ShareLinkPanel` | ✅ Done | 12 testes (11 da onda + o reforço de SHR-06 dentro do teste existente) |
| T9 — a11y do painel | ✅ Done | 5 testes |
| T10 — `/share/:token` fora de `AuthProvider` | ✅ Done | `apps/web/src/App.tsx:62-63`, 2 testes |
| T11 — `viewModeEnabled={!canMutate}` no editor | ✅ Done | `apps/web/src/diagram/DiagramEditorPage.tsx:169`, 2 testes |
| T12 — montar `ShareLinkPanel` no editor | ✅ Done | `apps/web/src/diagram/DiagramEditorPage.tsx:201`, 2 testes |
| T13 — changeset | ✅ Done | `.changeset/share-links-view-mode.md`, patch em `@arch-canvas/editor-adapter` |
| T14 — inventário de rotas + escopo R11 | ✅ Done | 3 rotas saíram de `pending-product`; nota de escopo no roadmap |

Todos os 14 blocos de task mantêm 100% dos `Done when` marcados `[x]`; nenhum parcial, nenhum
bloqueado, nenhum revertido pela correção da rodada 1 (que é test-only).

---

## Spec-Anchored Acceptance Criteria

### P1: Criar um link de compartilhamento (SHR-01..07)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-01 — ação de criar link só com `mutatePermissions.allowed` verdadeiro | painel presente com `true`, ausente com `false` | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:923` - `expect(await screen.findByText('Link de compartilhamento')).toBeTruthy()`; `:932` - `expect(screen.queryByText('Link de compartilhamento')).toBeNull()` | ✅ PASS |
| SHR-02 — papel ou expiração vazios bloqueiam o envio, sem requisição | zero requisições | `apps/web/src/share/ShareLinkPanel.spec.tsx:62` e `:74` - `expect(fetchImpl).not.toHaveBeenCalled()` | ✅ PASS |
| SHR-03 — expiração no passado bloqueia com mensagem própria, sem requisição | mensagem específica + zero requisições | `apps/web/src/share/ShareLinkPanel.spec.tsx:85-87` - `expect(...textContent).toBe('Escolha uma data de expiração no futuro.')`; `:89` - `expect(fetchImpl).not.toHaveBeenCalled()` | ✅ PASS |
| SHR-04 — emitir `POST /diagrams/:id/share-links` com `{role, expiresAt}` | corpo com **o papel escolhido** e a expiração escolhida | `apps/web/src/share/ShareLinkPanel.spec.tsx:112-117` - `expect(url).toBe('/diagrams/d-1/share-links')`, `expect(init.method).toBe('POST')`, `expect(JSON.parse(init.body as string)).toEqual({role:'editor', expiresAt: new Date(FUTURE_LOCAL).toISOString()})`, com o papel escolhido em `:104` (`fillForm('editor')`); reforço no caminho `403` em `:158` - `expect(JSON.parse(init.body as string).role).toBe('org_admin')` | ✅ PASS |
| SHR-05 — no `201`, exibir `${origin}/share/${token}` + aviso de exibição única | URL completa + aviso | `apps/web/src/share/ShareLinkPanel.spec.tsx:130` - `findByDisplayValue(\`${window.location.origin}/share/plain-token-abc\`)`; `:133-135` - texto do aviso de exibição única | ✅ PASS |
| SHR-06 — `403` informa teto de papel e não adiciona link | mensagem de teto + lista vazia | `apps/web/src/share/ShareLinkPanel.spec.tsx:147-149` - `toBe('Você não pode conceder um papel acima do seu.')`; `:151` - `expect(screen.queryAllByRole('listitem')).toEqual([])`; `:158` - corpo enviado carrega `role: 'org_admin'` | ✅ PASS |
| SHR-07 — outro status informa falha genérica e não adiciona link | mensagem genérica + lista vazia | `apps/web/src/share/ShareLinkPanel.spec.tsx:169-171` - `toBe('Algo deu errado. Tente de novo.')`; `:173` - lista vazia | ✅ PASS |

**Nota de discriminação em SHR-04 (o gap da rodada 1), re-derivada nesta rodada:**
o papel afirmado é `'editor'`, que **não é** nenhum dos valores para os quais a implementação
poderia cair por default ou por hardcode plausível: não é o estado inicial do `<select>`
(`''`, `ShareLinkPanel.tsx:61`), não é a primeira opção da lista (`'org_admin'`,
`ShareLinkPanel.tsx:8`), e não é o default do helper `fillForm()` do próprio arquivo de teste
(`'viewer'`, `:35`). A asserção mira o **corpo serializado real** da requisição
(`JSON.parse(init.body as string)` sobre `mock.calls[0]`), não o argumento do cliente nem um
estado interno do componente, e usa `toEqual` sobre o objeto inteiro — um campo extra também
reprovaria. O teste de SHR-06 fixa um segundo papel distinto (`'org_admin'`) no mesmo ponto de
observação, de modo que nenhum valor constante único satisfaz os dois testes ao mesmo tempo.
Confirmado empiricamente pelo mutante M1 do sensor abaixo.

### P1: Revogar um link criado (SHR-08..11)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-08 — lista só com links desta montagem, declarado visivelmente | aviso visível na tela | `apps/web/src/share/ShareLinkPanel.spec.tsx:201-205` - `getByText('Só aparecem aqui os links que você criou nesta tela...')` | ✅ PASS |
| SHR-09 — revogar emite `POST /share-links/:id:revoke` | URL + método exatos | `apps/web/src/share/ShareLinkPanel.spec.tsx:232` - `expect(fetchImpl).toHaveBeenCalledWith('/share-links/sl-1:revoke', {method:'POST'})` | ✅ PASS |
| SHR-10 — `200` marca revogado e some com a URL | badge "Revogado" + URL ausente do DOM | `apps/web/src/share/ShareLinkPanel.spec.tsx:228` - `expect(screen.queryByLabelText('URL de compartilhamento')).toBeNull()`; `:229` - `expect(urlField.isConnected).toBe(false)`; `:231` - `within(item).getByText('Revogado')` | ✅ PASS |
| SHR-11 — `403`/`404` informa falha e mantém o link ativo | falha anunciada + URL ainda presente + sem badge | `apps/web/src/share/ShareLinkPanel.spec.tsx:248-250` - anúncio genérico; `:252` - `getByLabelText('URL de compartilhamento')`; `:253` - `queryByText('Revogado')).toBeNull()` | ✅ PASS (`403` na tela; o ramo `404` é coberto no cliente, `shareLinkClient.spec.ts:95`) |

### P1: Abrir a visão pública sem sessão (SHR-12..17)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-12 — visitante sem sessão vê a visão pública, nunca redirect para `/login` | rota permanece `/share/<token>` | `apps/web/src/App.spec.tsx:405-406` - `findByTestId('share-read-only-notice')` + `expect(screen.getByTestId('location').textContent).toBe('/share/tok-1')` | ✅ PASS |
| SHR-13 — nenhum `GET /me` nem `POST /auth/refresh` enquanto montada | contadores em zero | `apps/web/src/App.spec.tsx:440-441` - `expect(meCalls).toBe(0)` e `expect(refreshCalls).toBe(0)` (contadores reais, após flush de microtasks) | ✅ PASS |
| SHR-14 — `GET /share/:token` exatamente uma vez | array de chamadas com um único elemento | `apps/web/src/share/SharedResourcePage.spec.tsx:71` - `expect(calls).toEqual(['/share/tok-1'])` | ✅ PASS |
| SHR-15 — `200` com `resourceType:'diagram'` renderiza `scene` no canvas | elementos chegam ao `<Excalidraw/>` | `apps/web/src/share/SharedResourcePage.spec.tsx:81` - `expect(capturedInitialElements).toEqual(SCENE)` | ✅ PASS |
| SHR-16 — `404` mostra mensagem única, sem distinguir causa e sem canvas | texto único + zero renders de canvas | `apps/web/src/share/SharedResourcePage.spec.tsx:128` - `findByText('Este link é inválido, expirou ou foi revogado.')`; `:129` - `expect(excalidrawRenders).toBe(0)` | ✅ PASS |
| SHR-17 — chrome público sem logout, navegação de workspace ou link autenticado | zero botão "Sair", zero links | `apps/web/src/share/PublicShell.spec.tsx:30` - `queryByRole('button', {name:'Sair'})).toBeNull()`; `:31` - `expect(screen.queryAllByRole('link')).toEqual([])`; `:38-44` - monta sem `AuthProvider` sem lançar | ✅ PASS |

### P1: A visão pública é somente leitura de verdade (SHR-18..21)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-18 — prop opcional repassada, comportamento preservado quando ausente | `true`/`false`/`undefined` chegam ao `<Excalidraw/>` | `packages/editor-adapter/src/EditorSurface.spec.tsx:340` - `expect(capturedViewModeEnabled).toBe(true)`; `:346` - `toBe(false)`; `:352` - `toBeUndefined()` | ✅ PASS |
| SHR-19 — visão pública renderiza com `viewModeEnabled === true` | prop capturada no `<Excalidraw/>` real, via `EditorSurface` real | `apps/web/src/share/SharedResourcePage.spec.tsx:91` - `expect(capturedViewModeEnabled).toBe(true)` | ✅ PASS |
| SHR-20 — papel `editor` no link continua em `viewModeEnabled === true` | `true` mesmo com `role:'editor'` na resposta | `apps/web/src/share/SharedResourcePage.spec.tsx:101` - `expect(capturedViewModeEnabled).toBe(true)` com `role: 'editor'` em `:96` | ✅ PASS |
| SHR-21 — sem `DiagramSyncClient`/fila de mutação, sem requisição de mutação | única chamada emitida é o resolve | `apps/web/src/share/SharedResourcePage.spec.tsx:120` - `expect(calls).toEqual(['/share/tok-1'])` (após flush de microtasks, com `role:'editor'`) | ✅ PASS |

### P1: O editor autenticado respeita papel de leitura (SHR-22)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-22 — `viewModeEnabled === true` quando `canMutate` falso, `false` quando verdadeiro | os dois valores, derivados do bootstrap real | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:907` - `expect(capturedViewModeEnabled).toBe(true)` com `mutatePermissions.allowed:false`; `:915` - `toBe(false)` com `true` | ✅ PASS |

### P1: O token nunca aparece em texto claro no log (SHR-23..26)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-23 — campo `url` da linha de log vira `/share/[REDACTED]` | valor literal | `apps/server/src/core/logging.spec.ts:120` - `expect(redactSensitiveUrl('/share/abc123')).toBe('/share/[REDACTED]')`; ponta a ponta em `:146` - `expect(output).toContain('"url":"/share/[REDACTED]"')` | ✅ PASS |
| SHR-24 — nenhum campo da linha contém o token em claro | stream real do Pino, `NODE_ENV=development` | `apps/server/src/core/logging.spec.ts:145` - `expect(output).not.toContain('real-share-token-abc123')` (saída capturada de um `buildServer` real, não serializer mockado) | ✅ PASS |
| SHR-25 — valor de `ticket=` na URL logada vira `[REDACTED]` | valor literal | `apps/server/src/core/logging.spec.ts:124-126` - `expect(redactSensitiveUrl('/ws/diagrams/d-1?ticket=abc123')).toBe('/ws/diagrams/d-1?ticket=[REDACTED]')` | ✅ PASS |
| SHR-26 — redação só no valor logado; roteamento/resposta recebem a URL original | handler vê a URL com token | `apps/server/src/core/logging.spec.ts:158` - `expect(response.json()).toEqual({seenByHandler:'/share/real-share-token-abc123'})` | ✅ PASS |

### P2: Link de apresentação (SHR-27..28)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-27 — nome da apresentação + estado "ainda não disponível", sem canvas | heading com nome + placeholder + zero canvas | `apps/web/src/share/SharedResourcePage.spec.tsx:172` - `findByRole('heading',{name:'Apresentação: Roadmap'})`; `:174-177` - texto do placeholder com contagem de frames; `:179` - `expect(excalidrawRenders).toBe(0)` | ✅ PASS |
| SHR-28 — nunca renderizar conteúdo de frame (`notes`, `navLinksJson`) | `notes` ausente da tela | `apps/web/src/share/SharedResourcePage.spec.tsx:178` - `expect(container.textContent).not.toContain('private speaker note')`; no limite do cliente, `apps/web/src/share/shareLinkClient.spec.ts:143` - `expect(JSON.stringify(result)).not.toContain('private speaker note')` | ✅ PASS |

### P2: Teclado e idioma (SHR-29..31)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SHR-29 — criar, ler a URL e revogar alcançáveis só por teclado | cada controle recebe foco | `apps/web/src/share/ShareLinkPanel.a11y.spec.tsx:84,88,92,98` - `expect(document.activeElement).toBe(...)` para select de papel, data, enviar e revogar; visão pública em `apps/web/src/share/SharedResourcePage.a11y.spec.tsx:111` | ✅ PASS |
| SHR-30 — resultado anunciado em região `aria-live="polite"` | atributo + texto do resultado | `apps/web/src/share/ShareLinkPanel.spec.tsx:272` - `expect(liveRegion.getAttribute('aria-live')).toBe('polite')`; `:273` (criado) e `:277` (revogado); falha em `:248-250` | ✅ PASS |
| SHR-31 — todo texto visível vem de chaves de i18n nos dois locales | render em `en` além de `pt-BR` | `apps/web/src/share/ShareLinkPanel.a11y.spec.tsx:116-119` - `'Create link'`, `'Role granted by the link'`, `'Expires on'`, `'Links created in this session'`; `apps/web/src/share/SharedResourcePage.a11y.spec.tsx:119` - `'This link is invalid, expired or revoked.'`. Paridade estrutural re-verificada nesta rodada: 26 chaves `share.*` em cada locale, conjuntos achatados idênticos | ✅ PASS |

**Status**: ✅ **31/31 ACs** com asserção que casa o outcome definido pela spec. Nenhum gap.
Nenhum ⚠️ spec-precision gap: toda AC define um outcome preciso e o teste mira exatamente nele.

---

## Decisões de design verificadas contra a implementação

| Decisão do design.md | Implementado como projetado? | Evidência |
| --- | --- | --- |
| `/share/:token` fora de `AuthProvider`, via rota de layout sem path (`AuthLayout`) | ✅ Sim — irmã real, não apenas visualmente separada | `apps/web/src/App.tsx:62` (rota pública) precede `:63` (`<Route element={<AuthLayout/>}>`), que abre o subtree autenticado fechado em `:94`. Prova comportamental (contadores `/me`/`/auth/refresh` em zero) em `App.spec.tsx:440-441`, e o mutante M4 desta rodada morre |
| `AD-012` registrado em `.specs/STATE.md` e coerente com o design | ✅ Sim | `.specs/STATE.md`, seção Decisions, `AD-012`, casando com `design.md` |
| Criação de link de apresentação adiada para R12, com justificativa explícita | ✅ Sim, em três lugares | `spec.md:51` (Out of Scope), `spec.md:299-302` (tabela "Rotas consumidas": 3 de 4), e o bloco de escopo na entrada R11 de `.specs/features/platform-maturity/ui-roadmap.md`. Decisão declarada, não omissão |
| Visão pública de apresentação mostra placeholder honesto, nunca tenta renderizar frames | ✅ Sim | `apps/web/src/share/SharedResourcePage.tsx:67-74` renderiza nome + placeholder e retorna antes do canvas; `frames` sequer atravessa o cliente (`shareLinkClient.ts:155-164` projeta só `{id,name}` + `frameCount`) |
| Redação de log é serializer próprio, nunca reatribui `request.url` | ✅ Sim | `apps/server/src/core/logging.ts:113` (`url: redactSensitiveUrl(request.url)`) é a única chamada; nenhuma atribuição a `request.url` no diff. Segundo caminho com credencial (`?ticket=`) coberto pelo mesmo serializer (`logging.ts:59,72`) |
| `viewModeEnabled` repassada literalmente ao Excalidraw | ✅ Sim | `packages/editor-adapter/src/EditorSurface.tsx:200` (`viewModeEnabled={viewModeEnabled}`); nenhuma lógica condicional adicional |
| Retrofit no editor autenticado existente | ✅ Sim | `apps/web/src/diagram/DiagramEditorPage.tsx:169` (`viewModeEnabled={!canMutate}`), testado nos dois valores |
| Formulário sem opção "nunca expira" | ✅ Sim | `apps/web/src/share/ShareLinkPanel.tsx:152-159` — único controle é `<input type="datetime-local">`, casando o contrato `z.coerce.date()` sem `.nullable()` do servidor |
| Papel enviado é o escolhido pelo usuário, nunca substituído no cliente | ✅ Sim | `apps/web/src/share/ShareLinkPanel.tsx:74` (`const chosenRole = role`) e `:89` (`client.createForDiagram(diagramId, chosenRole, when.toISOString())`); serializado como `{role, expiresAt}` em `shareLinkClient.ts:99`. Agora provado por teste (M1 morto) |

---

## Discrimination Sensor

Tier: **P0-full** (rota pública sem sessão + redação de credencial em log + teto de papel).
Scratch isolado via `git worktree add --detach` em `/private/tmp/r11-sensor-scratch` — fora da
árvore do worktree real —, com `node_modules` ligados por symlink ao worktree de origem; removido
com `git worktree remove --force` + `git worktree prune` ao fim. Nunca `git stash`.

Run de controle no scratch antes de qualquer mutação: **77/77 passando**
(`src/share/`, `src/App.spec.tsx`, `src/diagram/DiagramEditorPage.spec.tsx`).

| # | File:line | Description | Killed? |
| --- | --- | --- | --- |
| M1 | `apps/web/src/share/ShareLinkPanel.tsx:89` | **Reprodução exata do sobrevivente da rodada 1**: o formulário ignora o papel escolhido e envia `'viewer'` fixo (`createForDiagram(diagramId, 'viewer', ...)`) | ✅ **Killed** (2 falhas: SHR-04 `expected { role: 'viewer' } to deeply equal { role: 'editor' }`; SHR-06 `expected 'viewer' to be 'org_admin'`) |
| M2 | `apps/server/src/core/logging.ts:70-72` | Redação do segmento `/share/` removida (a de `ticket=` mantida) | ✅ Killed (2 falhas: SHR-23 e SHR-24, esta última contra o stream real do Pino) |
| M3 | `apps/web/src/share/SharedResourcePage.tsx:82` | `viewModeEnabled` deriva do papel do link (`result.role === 'viewer'`) em vez de ser sempre `true` | ✅ Killed (2 falhas: SHR-20 e SHR-21) |
| M4 | `apps/web/src/App.tsx:62` | `/share/:token` movida para DENTRO de `<Route element={<AuthLayout/>}>` | ✅ Killed (1 falha: contador de `/me` `expected 1 to be +0`) |
| M5 | `apps/web/src/share/shareLinkClient.ts:111-112` | Guarda de `201` sem `token` removida (devolve `created` com `token: ''`) | ✅ Killed (1 falha: Edge Case da URL meio-construída) |
| M6 | `apps/web/src/diagram/DiagramEditorPage.tsx:169` | Editor autenticado inverte para `viewModeEnabled={canMutate}` | ✅ Killed (3 falhas: SHR-22 nos dois valores + ausência do painel) |
| M7 | `apps/web/src/share/ShareLinkPanel.tsx:126` | Revogação com `200` deixa de marcar o item como revogado (a URL continua na tela) | ✅ Killed (1 falha: SHR-10) |

**Sensor depth**: P0-full (7 mutações)
**Result**: **7/7 killed** — PASS ✅

**Isolamento verificado**: `git status --porcelain` do worktree real **vazio** antes e depois do
sensor (baseline idêntico, capturado em arquivo e comparado); scratch worktree removido do disco e
de `git worktree list`, `git worktree prune` executado.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ — 4 arquivos de produção novos em `apps/web/src/share/`, 1 prop no pacote compartilhado, 1 função pura no servidor |
| Surgical changes | ✅ — a correção da rodada 1 é **test-only**: `+16/-3` num único arquivo (`ShareLinkPanel.spec.tsx`), nenhum arquivo de produção tocado |
| No scope creep | ✅ — nada de listagem de links, renovação, analytics ou edição por link; as duas ampliações (redação de log, `viewModeEnabled`) estão declaradas na spec como decididas com o usuário antes do Specify |
| No abstractions for single-use code | ✅ — `shareLinkClient` dedicado justificado no design (forma de resposta e verbo `:revoke` incompatíveis com `resourceClient`), mesmo precedente de `memberClient.ts` |
| Only touched files required for task | ✅ — 27 arquivos na onda, todos rastreáveis a uma task |
| Didn't "improve" unrelated code | ✅ — nenhum teste existente removido; nenhuma asserção enfraquecida (ver "Integridade de testes") |
| Matches existing patterns/style | ✅ — `aria-live` + `data-testid` como `WorkspaceMembersPage`; `<details>` colapsado como `LibraryPanel`/`MetadataPanel`; `fetchImpl(...)` literal para o extrator de `repo-tools audit` |
| Would senior engineer approve? | ✅ — sem ressalvas nesta rodada |
| Tests map to acceptance criteria and are non-shallow | ✅ — 1:1 com as ACs; SHR-04 agora discrimina o papel escolhido, comprovado por M1 |
| Spec-anchored outcome check | ✅ — 31/31 asserções miram o valor definido pela spec |
| Per-layer Coverage Expectation met | ✅ — cliente cobre todos os ramos de status documentados; telas cobrem cada AC e cada Edge Case aplicável; a11y cobre os estados renderizáveis nos dois locales |
| Every test maps to a spec AC / edge case / Done-when | ✅ — nenhum teste sem reivindicação; todos citam SHR-NN ou o Edge Case correspondente |
| Documented guidelines followed | ✅ — `CLAUDE.md` (Node 22, gate substituto) e `.claude/commands/gate.md` |

---

## Edge Cases

- [x] `GET /share/:token` falha de rede → mesma mensagem genérica, sem retry — `apps/web/src/share/SharedResourcePage.spec.tsx:141` (mensagem) e `:143` (`expect(attempts).toBe(1)`)
- [x] Segundo envio com criação em voo não emite segunda requisição — `apps/web/src/share/ShareLinkPanel.spec.tsx:188,191` (`toHaveBeenCalledTimes(1)` antes e depois do segundo submit)
- [x] Revogar duas vezes tratado como sucesso (rota idempotente, `200`) — coberto pelo caminho `200` (`ShareLinkPanel.spec.tsx:232`, `shareLinkClient.spec.ts:77`): a segunda revogação recebe o mesmo `200` e segue o mesmo ramo `{status:'revoked'}`, sem duplicar item (a lista é mapeada por `id`, `ShareLinkPanel.tsx:125-127`). Sem teste dedicado de duplo clique — coberto por construção, não por asserção própria
- [x] Cena vazia (`scene: []`) renderiza canvas vazio, nunca "link inválido" — `apps/web/src/share/SharedResourcePage.spec.tsx:153-154`
- [x] `201` sem `token` tratado como falha genérica, sem URL incompleta — `apps/web/src/share/shareLinkClient.spec.ts:57-66`; mutante M5 confirma a discriminação

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (gate Build de `tasks.md`, sob Node 22.23.2 via `fnm`)
- **Result**: **1279 passed, 0 failed, 0 skipped** (exit 0; `make lint` e `make typecheck` limpos, 25/25 e 24/24 tasks de Turbo bem-sucedidas)
- **Por pacote**: web 462, server 400, diagram-ir 68, editor-adapter 67, ai-tools 70, auth 63, repo-tools 49, diagram-domain 29, shared-contracts 27, mcp 20, library-content 12, test-fixtures 8, backup 4
- **Test count antes da onda**: 1220
- **Test count depois**: 1279
- **Delta**: +59 testes; nenhum teste deletado
- **Delta da rodada 1 → rodada 2**: **0 testes novos, 0 removidos** — a correção `9552f78` altera asserções dentro de dois testes existentes (`ShareLinkPanel.spec.tsx`, 12 blocos `it()` antes e depois). As duas mudanças são **fortalecimento estrito**: o papel de SHR-04 passou de `'viewer'` (o default) para `'editor'` (não-default), e SHR-06 ganhou uma asserção nova sobre o corpo enviado. Nenhuma asserção foi trocada por uma mais frouxa
- **Integridade de testes**: a única alteração em teste pré-existente à onda é `DiagramEditorPage.spec.tsx:147` (`<details>` da coluna lateral, `3 → 4`). É fortalecimento legítimo: T12 monta de fato um quarto `<details>` (`DiagramEditorPage.tsx:201`), a asserção continua sendo de contagem exata, e a ausência do painel no caso `canMutate === false` tem asserção própria (`:932-933`)

---

## Fix Plans

Nenhum. O único gap da rodada 1 (SHR-04) está fechado e verificado de forma independente nesta
rodada, tanto por leitura do teste quanto pelo mutante M1.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| SHR-04 | ❌ Needs Fix (rodada 1) | ✅ Verified |
| SHR-06 | ✅ Verified | ✅ Verified (evidência reforçada: corpo enviado, não só mensagem) |
| SHR-01..03, SHR-05, SHR-07..31 | ✅ Verified | ✅ Verified (re-derivadas do zero nesta rodada) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 31/31 ACs com asserção casando o outcome da spec; 0 gaps; 0 spec-precision gaps
**Sensor**: 7/7 mutações mortas (P0-full)
**Gate**: 1279 passed, 0 failed

**What works**:
- O gap da rodada 1 está genuinamente fechado, não apenas declarado: o mutante que sobreviveu
  antes (papel fixo `'viewer'` no envio) foi reinjetado e morre com duas falhas. A discriminação
  vem de dois papéis distintos e não-default (`'editor'` em SHR-04, `'org_admin'` em SHR-06)
  afirmados sobre o corpo serializado real da requisição — nenhuma constante única satisfaz os dois.
- `/share/:token` é estruturalmente pública: irmã da rota de layout `AuthLayout`, com prova
  comportamental de zero chamadas a `/me` e `/auth/refresh`, e o mutante que a move para dentro do
  provider morre.
- A redação de token no log é provada contra o stream real do Pino de um `buildServer` real, e o
  teste-par prova que `request.url` chega intacto ao handler — redação só no valor logado. O
  segundo caminho com credencial (`?ticket=`) é real e testado no mesmo serializer.
- `viewModeEnabled` chega ao `<Excalidraw/>` de verdade nas duas superfícies (pública e editor
  autenticado), com os três valores cobertos no pacote compartilhado e mutantes mortos em cada
  ponto da cadeia — inclusive um que faz a visão pública derivar o modo do papel do link.
- O retrofit de `!canMutate` no `DiagramEditorPage` existente fecha a lacuna pré-existente de
  `reviewer`/`viewer`, testado nos dois valores.
- O adiamento da criação de link de apresentação (3 de 4 rotas) é declarado com justificativa em
  spec, roadmap e tabela de rotas consumidas.

**Issues found**: nenhum.

**Next steps**: fechar a onda R11. Sem lição nova a destilar: a rodada 1 já registrou `L-037`,
que cobre exatamente esta classe de gap ("escolha um valor que o código não poderia plausivelmente
hardcodar"), e esta rodada não produziu sinal novo (0 sobreviventes, 0 spec-precision gaps, 0 ACs
descobertas).
