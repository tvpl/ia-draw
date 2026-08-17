# ai-provider-admin Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/ai-provider-admin/spec.md`
**Diff range**: `f3ed671..9e7c873` (branch `feature/r15-ai-provider-admin`)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1: exclusividade de `enabled` por escopo | ✅ Done | `providerConfigs.ts` — ambas as escritas dentro de `withTx`, gatilho pelo estado da linha |
| T2: `aiProviderClient` | ✅ Done | 17 testes unitários, todo ramo de status |
| T3: chaves i18n `adminProviders` | ✅ Done | 29 chaves, conjunto idêntico nos dois locales (verificado programaticamente) |
| T4: `AiProviderAdminPage` (lista/vazio/notFound) | ✅ Done | - |
| T5: cadastro | ✅ Done | - |
| T6: edição sem redigitar a chave | ✅ Done | - |
| T7: alternar ativo | ✅ Done | - |
| T8: testar conexão | ✅ Done | - |
| T9: duas rotas | ✅ Done | `App.tsx:62-63`, ambas provadas em `App.spec.tsx` |
| T10: link global | ✅ Done | - |
| T11: link de workspace | ✅ Done | - |
| T12: a11y | ✅ Done | 5 testes, axe + foco + `aria-live` + locale `en` |
| T13: mensagem do dock | ✅ Done | - |

Todas as 13 tasks marcadas `[x]` em `tasks.md`. Nenhuma parcial ou bloqueada.
Histórico do branch limpo: 15 commits, todos desta onda, sem interleaving de outras waves.

---

## Spec-Anchored Acceptance Criteria

Caminhos relativos à raiz do repo. Todos os `file:line` conferidos individualmente.

### P1: Ver as configurações de um escopo

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| PROV-01 `/admin/ai-providers` → `GET ?scope=global`, lista com `baseUrl`/`model`/estado | query `scope=global`; estado ativo/inativo visível | `apps/web/src/nav/AiProviderAdminPage.spec.tsx:71` — `expect(fetchImpl).toHaveBeenCalledWith('/admin/ai-providers?scope=global')`; `:70` — `expect(...getByTestId('ai-provider-state-cfg-1').textContent).toBe('Ativo')`; `:81` — `'Inativo'` | ✅ PASS |
| PROV-02 rota de workspace → `GET ?scope=<workspaceId>` | query `scope=ws-1` | `apps/web/src/nav/AiProviderAdminPage.spec.tsx:95` — `toHaveBeenCalledWith('/admin/ai-providers?scope=ws-1')` | ✅ PASS |
| PROV-03 nunca exibir a chave, em nenhuma forma | nenhum token renderizado, nem mascarado nem derivado | `apps/web/src/nav/AiProviderAdminPage.spec.tsx:108-109` — `expect(container.textContent).not.toContain('ciphertext-leak')` / `not.toContain('sk-plaintext-leak')` (resposta injetada COM campos de token) | ✅ PASS |
| PROV-04 `403`/`404` → "não existe ou sem acesso", sem lista | estado notFound, nenhuma config listada | `:117-120` (403) e `:128-131` (404) — `findByText('Este item não existe ou você não tem acesso a ele.')` + `expect(screen.queryByRole('list')).toBeNull()` | ✅ PASS |

### P1: Alcançar a tela a partir da navegação

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| PROV-05 algum `role === 'org_admin'` → link global | link para `/admin/ai-providers` presente | `apps/web/src/nav/WorkspaceListPage.spec.tsx:504-507` — `getByRole('link', {name:'Providers de IA (global)'})` com `href` contendo `/admin/ai-providers` | ✅ PASS |
| PROV-06 nenhum `org_admin` → link omitido | ausência no DOM | `apps/web/src/nav/WorkspaceListPage.spec.tsx:523` — `expect(screen.queryByRole('link', {name:'Providers de IA (global)'})).toBeNull()` (fixture com `workspace_admin` + `viewer`) | ✅ PASS |
| PROV-07 link de workspace só sob `workspace:manage_members` | presente para `workspace_admin`, ausente para `editor` | `apps/web/src/nav/ProjectListPage.spec.tsx:504-507` (presente) e `:514` — `queryByRole(...)).toBeNull()` (ausente) | ✅ PASS |

### P1: Cadastrar um provider

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| PROV-08 exigir `baseUrl`, `model` e chave não vazios | submit desabilitado até os três preenchidos | `AiProviderAdminPage.spec.tsx:169` `expect(submit.disabled).toBe(true)`; `:175` ainda `true` com 2 campos; `:178` `toBe(false)` com os 3 | ✅ PASS |
| PROV-09 `POST` com `{scope,baseUrl,model,token}`, `scope` da rota | corpo exato, `scope: 'ws-1'` vindo da URL | `:195-200` — `expect(bodyOfCall(fetchImpl,1)).toEqual({scope:'ws-1', baseUrl:..., model:'gpt-4o', token:'sk-new'})` | ✅ PASS |
| PROV-10 `201` → adiciona à lista sem recarregar e limpa a chave | nova linha visível; campo de chave `''` | `:218` `findByText('https://new.example/v1')`; `:219` — `expect((getByLabelText('Chave da API')).value).toBe('')` | ✅ PASS |
| PROV-11 chave é `type="password"` + `autoComplete="off"` | ambos os atributos | `:232-233` — `expect(keyInput.type).toBe('password')` / `getAttribute('autocomplete')).toBe('off')` | ✅ PASS |
| PROV-12 `400` → informa URL rejeitada e mantém valores | mensagem específica + 3 campos preservados | `:249-257` — announcement `'O endpoint informado foi rejeitado pelo servidor.'` + os 3 valores (incl. `http://169.254.169.254/v1`) intactos | ✅ PASS |

### P1: Editar sem redigitar a chave

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| PROV-13 chave vazia → `PATCH` **sem** a propriedade `token` | `token` ausente do corpo serializado | `AiProviderAdminPage.spec.tsx:288-289` — `expect('token' in body).toBe(false)` + `expect(body).toEqual({baseUrl:..., model:'gpt-4.1'})`; camada de cliente: `aiProviderClient.spec.ts:120` | ✅ PASS |
| PROV-14 chave preenchida → `PATCH` com `token` digitado | `token === 'sk-rotated'` | `:302` — `expect(bodyOfCall(fetchImpl,1).token).toBe('sk-rotated')`; cliente: `aiProviderClient.spec.ts:133` | ✅ PASS |
| PROV-15 texto "em branco mantém a chave atual" | hint presente no form de edição | `:309` — `getByText('Deixe em branco para manter a chave atual.')`; `:311` — campo de chave começa `''` (nunca pré-preenchido) | ✅ PASS |
| PROV-16 status ≠ `200` → informa falha, mantém valores anteriores | announcement genérico + lista inalterada | `:322-327` — announcement `'Algo deu errado. Tente novamente.'`, `getByText('gpt-4o-mini')` presente, `queryByText('gpt-4.1')` null | ✅ PASS |

### P1: Testar a conexão

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| PROV-17 clique → `POST /admin/ai-providers/:id:test` | URL e método exatos | `:462-464` — `expect(calls[1][0]).toBe('/admin/ai-providers/cfg-1:test')` + `testInit.method === 'POST'` | ✅ PASS |
| PROV-18 `200` + `success:true` → sucesso citando `modelAvailable`/`toolCallingSupported` | texto com ambos os campos | `:476-478` — `toBe('Conexão OK. Modelo disponível: sim. Tool calling: não.')` | ✅ PASS |
| PROV-19 `200` + `success:false` → falha com texto de `error`, nunca sucesso | falha exibindo o erro do provider | `:496-499` — `toBe('Falha na conexão: provider responded with status 401')`; `:500` — `.not.toContain('Conexão OK')` | ✅ PASS |
| PROV-20 `429` → informa limite (10/60s) | mensagem citando o limite | `:510-513` — `toBe('Limite de 10 testes de conexão por 60 segundos atingido. Tente de novo em instantes.')` | ✅ PASS |

### P1: Alternar qual configuração está ativa

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| PROV-21 ativar → `PATCH` com `{enabled:true}` | corpo exato no id certo | `:378-379` — `expect(calls[1][0]).toBe('/admin/ai-providers/cfg-2')` + `toEqual({enabled:true})` | ✅ PASS |
| PROV-22 `200` → ativada ativa e **toda outra** inativa, sem recarregar | ambas as linhas verificadas | `:391` `state-cfg-2` `'Ativo'`; `:394` `state-cfg-1` `'Inativo'` (irmã rebaixada) | ✅ PASS |
| PROV-23 `PATCH` que deixa a linha `enabled` → servidor rebaixa irmãs do mesmo `scope` na mesma transação | leitura direta da tabela: irmã `false` | `apps/server/src/modules/ai-provider/ai-provider.int.spec.ts:366-368` — `expect(await readEnabled(first.id)).toBe(false)`, `readEnabled(second.id)).toBe(true)`, `countEnabledInScope(workspaceId)).toBe(1)` | ✅ PASS |
| PROV-24 `POST` que cria linha `enabled` → mesma garantia | leitura direta: pré-existente `false` | `ai-provider.int.spec.ts:387-389` — `readEnabled(existing.id)).toBe(false)` + `countEnabledInScope).toBe(1)` | ✅ PASS |
| PROV-25 nunca alterar `enabled` de linha de outro `scope` | config `global` intocada nos dois caminhos | `ai-provider.int.spec.ts:370` (PATCH) e `:390` (POST) — `expect(await readEnabled(otherScope.id)).toBe(true)` | ✅ PASS |
| PROV-26 desativar a ativa → `{enabled:false}` e escopo sem nenhuma ativa | corpo + ambas as linhas inativas | `AiProviderAdminPage.spec.tsx:409` `state-cfg-1` `'Inativo'`; `:411` `toEqual({enabled:false})`; `:412` `state-cfg-2` `'Inativo'` | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| PROV-27 toda ação alcançável só por teclado | foco por controle | `AiProviderAdminPage.a11y.spec.tsx:95-131` — `expect(document.activeElement).toBe(control)` para voltar, Editar, Desativar, Testar conexão, os 3 campos, Cadastrar, Salvar, Cancelar | ✅ PASS |
| PROV-28 resultado anunciado em `aria-live="polite"` | atributo + conteúdo anunciado | `a11y.spec.tsx:138` — `expect(liveRegion.getAttribute('aria-live')).toBe('polite')`; `:144` — `toBe('Provider ativado.')` | ✅ PASS |
| PROV-29 todo texto de i18n, `pt-BR` e `en` | rótulos traduzidos, sem literal | `a11y.spec.tsx:147-158` — render em `en`, `'AI providers'`, `'Back'`, `'Provider endpoint'`, `'API key'`, `'Register provider'`, `'Test connection'`, `'Edit'`. Paridade de chaves verificada: 29 chaves idênticas nos dois locales | ✅ PASS |

### P2: O dock de IA aponta para a tela

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| PROV-30 mensagem nomeia a tela em vez de "fora do produto" | nos dois locales | `apps/web/src/ai-dock/AiDock.spec.tsx:548-551` (en, + `queryByText(/outside the product/i)).toBeNull()`) e `:559-562` (pt-BR, + `queryByText(/fora do produto/i)).toBeNull()`) | ✅ PASS |

**Status**: ✅ Todas as 30 ACs cobertas com evidência `file:line`; 0 gaps; 0 spec-precision gaps.

---

## Focused Verification (áreas de risco desta onda)

| # | Foco | Achado |
| - | ---- | ------ |
| 1 | Exclusividade transacional (núcleo da feature) | Real. `providerConfigs.ts:104-145` — ambas as escritas dentro de `withTx`; `disableSiblingConfigs` (`:87-98`) recebe o handle `tx`, então demote e escrita commitam/revertem juntos. Gatilho é `if (row.enabled)` sobre a linha **resultante** (`:117`, `:142`), não a presença de `enabled` no corpo — provado pelo teste de borda `ai-provider.int.spec.ts:393-410`, onde um `PATCH {model}` sem `enabled` converge um escopo que já tinha duas ativas. O teste exigido existe literalmente: duas configs no mesmo escopo, `PATCH {enabled:true}` na segunda, leitura da **primeira direto da tabela** → `false` (`:352-371`). `resolveProviderConfig` não foi editado (diff vazio); o fallback workspace→global segue intacto em `resolveProvider.ts:29-40` |
| 2 | Isolamento entre escopos | Provado nos dois caminhos de escrita: `ai-provider.int.spec.ts:370` e `:390` — uma config `scope='global'` habilitada permanece `enabled = true` depois de um enable em escopo de workspace. Predicado `eq(aiProviderConfigs.scope, scope)` em `providerConfigs.ts:93` |
| 3 | Duas rotas, um componente | Confirmado. `App.tsx:62-63` registra ambas com o mesmo `element={<AiProviderAdminPage />}`; o escopo vem de `useParams()` (`AiProviderAdminPage.tsx:26-27`, `workspaceId ?? 'global'`), não hardcoded. Ambas provadas montando de verdade dentro do `AppShell`: `App.spec.tsx:288-319` (global → `?scope=global`) e `:321-337` (workspace → `?scope=ws-1`). Derivação "é `org_admin` em algum lugar" é client-side puro sobre o `role` já devolvido por `GET /workspaces` (`WorkspaceListPage.tsx:207`) — **nenhuma rota nova de backend**, confirmado pelo audit (90 rotas, mesmo total de antes) |
| 4 | Bug do extrator de rotas do audit | Corrigido de verdade, e no lugar certo: em vez de mexer no extrator, o cliente escreve o prefixo literal em cada call site (`aiProviderClient.ts:85,94,115,134`), com a razão documentada em `:71-79`. Rodei `pnpm --filter @arch-canvas/repo-tools run audit` — regenera `docs/route-inventory.md` **byte a byte idêntico** ao commitado (nenhum drift). As 4 rotas `/admin/ai-providers*` aparecem como `consumed`; `aiProviderClient.ts` é creditado por exatamente essas 4 e nenhuma outra. Spot-check: `/health/live` continua em `pending-product`; `/projects/:id` (GET/PATCH/DELETE) continua creditada a `DiagramListPage.tsx`. Contagem: 23 consumed / 67 pending (era 19/71) — delta exato de 4, sem colateral |
| 5 | Segredo na UI | O campo de chave de edição nunca recebe a chave: `startEdit` faz `setEditToken('')` (`AiProviderAdminPage.tsx:123`), e não há de onde preencher (o GET não devolve token). Provado em `AiProviderAdminPage.spec.tsx:311` (campo `''` ao abrir) e `:288-289` (omissão do `token` no corpo). `PROV-03` reforça no render inteiro (`:108-109`) com uma resposta deliberadamente contaminada com `encryptedToken`/`token` |
| 6 | Botão `:test` lê o corpo, não o status | Confirmado nas duas camadas. Cliente: `200` com `success:false` continua `{status:'done'}` (`aiProviderClient.ts:144-145`, teste `aiProviderClient.spec.ts:190`). Tela: caminho de falha específico em `AiProviderAdminPage.spec.tsx:482-501`, que afirma o texto de falha **e** `not.toContain('Conexão OK')` |
| 7 | Decisão de não linkar o dock | Documentada na tabela de Assumptions da spec, `spec.md:64` — com o raciocínio completo (o `bootstrap` devolve permissões de diagrama, não papel de workspace; um link que leva a maioria a um 403 é pior que uma frase). Também em `design.md:290`. Não é só alegação do relatório |

---

## Discrimination Sensor

Scratch isolado via `git worktree add /tmp/r15-sensor HEAD` (fora da árvore desta worktree), com
`node_modules`/`dist` linkados read-only da worktree real. Baseline do scratch confirmado verde
antes de qualquer mutação (server 10/10, web 45/45). Nunca foi usado `git stash`.

| # | File:line | Description | Killed? |
| - | --------- | ----------- | ------- |
| 1 | `apps/server/src/modules/ai-provider/providerConfigs.ts:142` | Removido o demote das irmãs em `updateProviderConfig` (quebra a transação de exclusividade) | ✅ Killed (2 testes) |
| 2 | `providerConfigs.ts:93` | Removido o predicado `eq(scope)` — vazamento entre escopos, rebaixa linhas de todo escopo | ✅ Killed (2 testes) |
| 3 | `providerConfigs.ts:117` | Removido o demote em `createProviderConfig` | ✅ Killed (PROV-24/25) |
| 4 | `apps/web/src/nav/AiProviderAdminPage.tsx:27` | Escopo hardcoded para `'global'`, ignorando `useParams()` | ✅ Killed (3 testes, incl. a rota real em `App.spec.tsx`) |
| 5 | `AiProviderAdminPage.tsx:137` | Form de edição envia `token: editToken` (string vazia) em vez de omitir | ✅ Killed (PROV-13) |
| 6 | `AiProviderAdminPage.tsx:188` | `:test` exibe sucesso independentemente de `result.success` | ✅ Killed (PROV-19) |
| 7 | `AiProviderAdminPage.tsx:163` | Ativar não rebaixa as irmãs na lista renderizada | ✅ Killed (PROV-22) |
| 8 | `apps/web/src/nav/WorkspaceListPage.tsx:207` | Gate `org_admin` sempre verdadeiro | ✅ Killed (PROV-06) |

**Sensor depth**: P0-full (autorização + integridade de dados) — 8 mutações, acima do piso de 5.
**Result**: 8/8 killed — PASS ✅

**Isolamento verificado**: `git status --porcelain` antes e depois idêntico
(`?? .specs/features/ai-provider-admin/validation.md`, o próprio relatório). Scratch removido;
nenhuma worktree irmã tocada.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ Nenhuma rota nova de backend, nenhuma migração, nenhum schema alterado — só duas funções de escrita passam a rodar em `withTx` |
| Surgical changes | ✅ 20 arquivos, todos previstos em design.md; `resolveProvider.ts` deliberadamente intocado |
| No scope creep | ✅ `DELETE`, índice único parcial, seletor de escopo, editor de `capabilitiesJson` e link no dock estão todos em Out of Scope/Assumptions e nenhum foi implementado às escondidas |
| Matches patterns | ✅ `aiProviderClient` segue `memberClient`; a página segue `WorkspaceMembersPage`; a11y segue `WorkspaceMembersPage.a11y.spec.tsx` |
| Spec-anchored outcome check | ✅ 30/30 asserções batem com o valor definido na spec |
| Per-layer Coverage Expectation met | ✅ Repositório: PROV-23/24/25 + borda, cada um lido direto da tabela. Cliente: todo ramo de status. Componente: 1:1 às ACs + 5 casos de borda. Rotas: ambas montadas de verdade |
| Every test maps to a spec requirement | ✅ Nenhum teste órfão; cada `it` novo cita PROV-NN ou um caso de borda da spec |
| Documented guidelines followed | ✅ `CLAUDE.md` (Node 22, gate substituto), `.claude/commands/gate.md`, `.claude/commands/audit.md` |

Nota positiva: os comentários de código explicam **por que**, não o que — em particular
`providerConfigs.ts:72-86` (por que o gatilho é o estado da linha) e `aiProviderClient.ts:71-79`
(por que o prefixo é literal em cada call site). Isso é a lição do extrator de rotas registrada em
`.specs/STATE.md` aplicada em vez de redescoberta.

---

## Edge Cases

- [x] Escopo sem nenhuma configuração → estado vazio explícito — `AiProviderAdminPage.spec.tsx:141` (`'Nenhum provider cadastrado neste escopo.'` + `queryByRole('list')` null)
- [x] Escopo com duas ou mais `enabled = true` de antes desta onda → ativar qualquer uma deixa exatamente uma — `ai-provider.int.spec.ts:393-410` (`countEnabledInScope` → `1`), inclusive num `PATCH` que nem menciona `enabled`
- [x] Segundo clique em "Testar conexão" com teste em voo → nenhuma segunda requisição — `AiProviderAdminPage.spec.tsx:533-555` (`calls.length` fica em 2 antes e depois de liberar o deferred); guarda dupla no código: `disabled` + early-return `testingId !== null` (`AiProviderAdminPage.tsx:180`)
- [x] `:test` falha por rede (sem resposta HTTP) → falha genérica, botão não trava — `:516-531` (`expect(button.disabled).toBe(false)`); `finally` em `AiProviderAdminPage.tsx:208-211`
- [x] Perder o papel administrativo com a tela aberta → `403` tratado como qualquer falha — `:314-328` (edição) e `:416-431` (alternância): announcement genérico, lista preservada, tela intacta

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` + `pnpm -w build && pnpm --filter @arch-canvas/server run test:integration`
- **Lint/typecheck/unit**: exit 0 — 25 tasks turbo OK (lint+typecheck), 24 tasks OK (test-unit)
- **Integração**: 353 passed | 13 skipped (366); 3 test **files** falharam, todos por lacuna de
  ambiente pré-existente e alheia a este diff:
  - `src/modules/backup/restoreTest.int.spec.ts` — exige duas instâncias Postgres reais (`pg_lsclusters` ausente no host)
  - `src/modules/ws-gateway/presenceBroadcaster.int.spec.ts` — `spawn redis-server ENOENT`
  - `src/modules/ws-gateway/crossInstancePresence.int.spec.ts` — `spawn redis-server ENOENT`

  Exatamente as 3 lacunas documentadas em `CLAUDE.md`. **Nenhuma falha de asserção em teste algum.**
- **`ai-provider.int.spec.ts` isolado**: **10 passed (10)** — os 7 pré-existentes + os 3 novos de exclusividade
- **Audit**: `repo-tools audit` → 90 rotas, 23 consumed, 67 pending-product; `docs/route-inventory.md` regenerado idêntico ao commitado
- **Test count**: +~60 testes novos (17 cliente, 28 página, 5 a11y, 3 integração, 2 rotas, 2+2 links, 1 dock); **0 removidos, 0 enfraquecidos**
- **Skipped**: 13 skips, todos pré-existentes e fora do diff desta onda

---

## Fix Plans

Nenhum. Nenhuma gap encontrada.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| PROV-01..PROV-30 (todos os 30) | Implementing | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 30/30 ACs bateram com o outcome definido na spec; 0 spec-precision gaps
**Sensor**: 8/8 mutações mortas (P0-full)
**Gate**: lint + typecheck + unit exit 0; integração 353 passed, 0 falhas de asserção;
`ai-provider.int.spec.ts` 10/10

**What works**:

- A exclusividade de "ativo" por escopo é uma garantia transacional real, no repositório, disparada
  pelo estado resultante da linha — e por isso vale para qualquer chamador e converge sozinha um
  escopo herdado com duas ativas, sem migração. É a parte mais bem testada da onda (leitura direta
  da tabela, não da resposta) e as 3 mutações contra ela morreram todas.
- Isolamento entre escopos provado nos dois caminhos de escrita.
- Duas rotas, um componente, escopo derivado da URL — ambas montadas de verdade dentro do `AppShell`
  nos testes, não só o componente isolado.
- O segredo nunca volta para a tela e editar não obriga a redigitá-lo, com asserção sobre o corpo
  serializado do `PATCH` (não sobre a chamada).
- Falha de conexão com HTTP `200` aparece como falha, com asserção negativa explícita contra o texto
  de sucesso.
- O audit voltou a classificar corretamente: as 4 rotas viraram `consumed` sem arrastar nenhuma
  rota alheia junto — verificado regenerando o arquivo do zero.

**Issues found**: nenhum.

**Residual conhecido (aceito e documentado, não é gap)**: sem índice único parcial, uma escrita SQL
direta fora de `providerConfigs.ts` ainda pode criar duas linhas ativas no mesmo escopo. Está em
`design.md` (Approach exploration 2 e Risks & Concerns) e em `spec.md` Out of Scope, com a razão —
um índice transformaria "alternar" em erro de constraint e exigiria migração escolhendo
arbitrariamente qual linha sobrevive. Decisão consciente, não omissão.

**Next steps**: onda pronta para merge. Nenhuma fix task.
