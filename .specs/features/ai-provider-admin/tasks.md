# Administração do provider de IA — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Spec**: `.specs/features/ai-provider-admin/spec.md`
**Design**: `.specs/features/ai-provider-admin/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling (`apps/server/src/modules/ai-provider/ai-provider.int.spec.ts`, `apps/web/src/nav/memberClient.spec.ts`, `apps/web/src/nav/WorkspaceMembersPage.spec.tsx`, `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx`, `apps/web/src/ai-dock/AiDock.spec.tsx`) and this repo's coverage-floor convention (never lowered). Guidelines found: `CLAUDE.md` ("Comandos", gate substituto), `.claude/commands/gate.md`, `apps/server/vitest.config.ts` (pisos de cobertura travados) — strong defaults applied on top.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Server repository de escrita (`providerConfigs.ts`) | integration | PROV-23/24/25 mais o caso de borda de duas linhas já habilitadas: `POST` e `PATCH` cada um provado lendo a tabela direto (não só a resposta), e uma configuração de outro escopo provada intocada | `apps/server/src/modules/ai-provider/ai-provider.int.spec.ts` | `pnpm --filter @arch-canvas/server run test:integration` |
| Client HTTP (`aiProviderClient`) | unit | Todo ramo de status documentado em design.md: `list` 200/erro, `create` 201/400/erro, `update` 200/erro (com e sem `token` no corpo), `testConnection` 200-success/200-failure/429/erro de rede | `apps/web/src/nav/aiProviderClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`AiProviderAdminPage`) | unit (RTL) | 1:1 às ACs PROV-01..04, PROV-08..26 e a todos os casos de borda listados na spec que se aplicam à tela | `apps/web/src/nav/AiProviderAdminPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Accessibility (`AiProviderAdminPage`) | unit (axe) | Zero violações serious/critical nos estados populado e de formulário aberto; PROV-27/28/29 (foco por controle, `aria-live="polite"`, render em `en`) | `apps/web/src/nav/AiProviderAdminPage.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Roteamento e pontos de entrada | unit (RTL) | As duas rotas montam a página (PROV-01/02); link global presente/ausente conforme `role` (PROV-05/06); link de workspace sob `workspace:manage_members` (PROV-07) | `apps/web/src/App.spec.tsx`, `apps/web/src/nav/WorkspaceListPage.spec.tsx`, `apps/web/src/nav/ProjectListPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Mensagem do dock (`AiDock`) | unit (RTL) | PROV-30 nos dois locales | `apps/web/src/ai-dock/AiDock.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only — as chaves são exercitadas pelos testes de componente acima | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |

## Gate Check Commands

> Generated from codebase (`Makefile`, `package.json`, `.claude/commands/gate.md`) - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de uma task com testes unitários só, escopada a um package | `pnpm --filter @arch-canvas/web run test:unit` |
| Full | Depois de uma task com testes de integração, ou ao fechar a feature | `make lint && make typecheck && make test-unit` |
| Build | Task só de config/i18n, ou fechamento da onda | `make lint && make typecheck && make test-unit && pnpm --filter @arch-canvas/server run test:integration` |

**Armadilha de ambiente (versionada em `CLAUDE.md`):** todo comando precisa de Node 22.x —
`eval "$(fnm env)" && fnm use 22 && <comando>`. `make ci` não passa nesta máquina (falta
`pg_lsclusters`/`redis-server`); o gate substituto é `make lint && make typecheck && make test-unit`,
com `pnpm --filter @arch-canvas/server run test:integration` rodado à parte (PGlite, sem Docker,
AD-007).

---

## Execution Plan

13 tasks, 5 fases. Executadas por um único worker, em sequência — sem split em batches de
sub-agente (o worker desta onda é o único, por instrução da sessão).

### Phase 1: Corretude do servidor

A garantia de estado que o resto da onda assume.

```
T1
```

### Phase 2: Fundação do cliente

Cliente HTTP e chaves de texto — nenhum dos dois depende do outro.

```
T2
T3
```

### Phase 3: A tela

Uma cadeia sobre o mesmo arquivo: cada task acrescenta um bloco de comportamento à página.

```
T4 -> T5 -> T6 -> T7 -> T8
```

### Phase 4: Roteamento e pontos de entrada

```
T9 -> T10
T9 -> T11
```

### Phase 5: Acessibilidade e amarração com o dock

```
T12
T13
```

---

## Task Breakdown

### T1: Garantir no máximo uma configuração habilitada por escopo

**What**: `createProviderConfig` e `updateProviderConfig` passam a rodar dentro de `withTx`; quando a linha escrita fica `enabled = true`, toda outra linha do mesmo `scope` recebe `enabled = false` na mesma transação.
**Where**: `apps/server/src/modules/ai-provider/providerConfigs.ts`
**Depends on**: None
**Reuses**: `withTx` (`packages/database/src/tx.ts`, mesmo helper de `diagram-sync/operations.ts`), `PUBLIC_COLUMNS` já definido neste arquivo, `ne`/`and`/`eq` do `drizzle-orm`
**Requirement**: PROV-23, PROV-24, PROV-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `createProviderConfig` insere e rebaixa as irmãs do mesmo `scope` numa única transação quando a linha nova fica habilitada
- [x] `updateProviderConfig` atualiza e rebaixa as irmãs do mesmo `scope` numa única transação quando a linha resultante fica habilitada (gatilho é o estado da linha, não a presença de `enabled` no corpo — design.md)
- [x] Nenhuma linha de outro `scope` é tocada (cláusula `WHERE scope = <scope da linha>`)
- [x] Assinaturas públicas das duas funções inalteradas; nenhum contrato de rota muda
- [x] Testes de integração novos em `apps/server/src/modules/ai-provider/ai-provider.int.spec.ts`: (a) duas configs habilitadas no mesmo escopo, `PATCH {enabled:true}` na segunda deixa a primeira `false` — lido direto da tabela; (b) `POST` de uma terceira config deixa as anteriores `false`; (c) uma config de outro escopo continua `enabled = true` nos dois casos
- [x] Gate check passes: `make lint && make typecheck && make test-unit` e `pnpm --filter @arch-canvas/server run test:integration`
- [x] Test count: os 7 testes de integração existentes deste arquivo continuam passando, mais os 3 novos — 10/10 verdes (nenhuma exclusão silenciosa)

**Tests**: integration
**Gate**: full

**Commit**: `fix(ai-provider): enforce a single enabled config per scope`

---

### T2: Criar `aiProviderClient`

**What**: Cliente HTTP dedicado das 4 rotas de `/admin/ai-providers` — `list`, `create`, `update`, `testConnection` — com uma união de status por rota.
**Where**: `apps/web/src/nav/aiProviderClient.ts`
**Depends on**: None
**Reuses**: forma de `apps/web/src/nav/memberClient.ts` (fábrica com `fetchImpl` injetável, `fetchImpl(...)` literal em toda chamada para o extrator do `repo-tools audit`); tipos espelhando `ProviderConfigPublic`/`TestConnectionResult` do servidor
**Requirement**: PROV-01, PROV-02, PROV-09, PROV-13, PROV-14, PROV-17, PROV-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `list(scope)` emite `GET /admin/ai-providers?scope=<scope>` e devolve `ProviderConfig[]`; lança em resposta não-2xx
- [x] `create(input)` emite `POST /admin/ai-providers` e devolve `{status:'created', config} | {status:'rejected'} (400) | {status:'error'}`
- [x] `update(id, patch)` emite `PATCH /admin/ai-providers/:id` e devolve `{status:'ok', config} | {status:'error'}`; `patch.token` ausente não aparece no corpo serializado
- [x] `testConnection(id)` emite `POST /admin/ai-providers/:id:test` e devolve `{status:'done', result} | {status:'rate_limited'} (429) | {status:'error'}` — um `200` com `result.success === false` continua sendo `'done'`
- [x] `ProviderConfig` não declara nenhum campo de token
- [x] Testes unitários em `apps/web/src/nav/aiProviderClient.spec.ts` cobrem todo ramo acima, incluindo erro de rede (rejeição do `fetch`)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [x] Test count: 17 testes novos, 0 removidos

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add dedicated aiProviderClient`

---

### T3: Adicionar as chaves de i18n `adminProviders`

**What**: Namespace novo de primeiro nível `adminProviders` nos dois locales — título, rótulos de formulário (endpoint, modelo, chave), nota de "chave em branco mantém a atual", ações (cadastrar, salvar, cancelar, testar, ativar, desativar), estados de resultado (sucesso/falha do teste, limite de taxa, URL rejeitada), estado vazio, e os rótulos dos dois links de entrada.
**Where**: `apps/web/src/i18n/locales/pt-BR/translation.json` e o arquivo irmão `en/translation.json`
**Depends on**: None
**Reuses**: convenção de aninhamento já usada por `nav.*`/`aiDock.*`; os dois arquivos ficam com exatamente o mesmo conjunto de chaves
**Requirement**: PROV-29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Bloco `adminProviders` presente nos dois locales, com o mesmo conjunto de chaves em ambos
- [ ] Nenhuma chave existente removida ou renomeada
- [ ] Gate check passes: `make lint && make typecheck && make test-unit && pnpm --filter @arch-canvas/server run test:integration`

**Tests**: none
**Gate**: build

**Commit**: `feat(web): add adminProviders i18n keys`

---

### T4: Criar `AiProviderAdminPage` com listagem, estado vazio e `notFound`

**What**: A página nova — deriva o escopo da rota (`workspaceId ?? 'global'`), carrega a lista, renderiza cada configuração com endpoint, modelo e estado ativo/inativo, e trata `403`/`404` como "não existe ou sem acesso".
**Where**: `apps/web/src/nav/AiProviderAdminPage.tsx`
**Depends on**: T2, T3
**Reuses**: estrutura de `apps/web/src/nav/WorkspaceMembersPage.tsx` (região `aria-live="polite"`, estado `notFound`, link de voltar), `resourceListStore` (as configs já têm `id: string`, sem shim)
**Requirement**: PROV-01, PROV-02, PROV-03, PROV-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Montada em `/admin/ai-providers` a página emite `GET /admin/ai-providers?scope=global`; montada em `/w/:workspaceId/admin/ai-providers` emite `?scope=<workspaceId>`
- [ ] Cada configuração aparece com `baseUrl`, `model` e um indicador explícito de ativa/inativa
- [ ] Nenhum campo de token é exibido, em nenhuma forma (asserção sobre o texto renderizado, não só sobre o tipo)
- [ ] `403` e `404` levam ao estado "não existe ou sem acesso", sem lista e sem formulário
- [ ] Escopo sem nenhuma configuração renderiza estado vazio explícito (caso de borda da spec)
- [ ] Testes em `apps/web/src/nav/AiProviderAdminPage.spec.tsx` cobrem PROV-01..04 e o estado vazio
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add AiProviderAdminPage listing`

---

### T5: Cadastro de provider na página

**What**: Formulário de cadastro — endpoint, modelo e chave (campo de senha), submit único, tratamento de `201` e de `400` (URL rejeitada).
**Where**: `apps/web/src/nav/AiProviderAdminPage.tsx`
**Depends on**: T4
**Reuses**: forma do campo de senha de `apps/web/src/auth/LoginPage.tsx` (`type="password"` + `<label htmlFor>`), com `autoComplete="off"`; padrão de formulário de convite de `WorkspaceMembersPage`
**Requirement**: PROV-08, PROV-09, PROV-10, PROV-11, PROV-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O envio fica bloqueado enquanto endpoint, modelo ou chave estiverem vazios
- [ ] O corpo do `POST` emitido é `{scope, baseUrl, model, token}` com `scope` vindo da rota
- [ ] `201` adiciona a configuração à lista sem recarregar e limpa o campo de chave
- [ ] O campo de chave é `type="password"` com `autoComplete="off"` (asserção sobre os atributos)
- [ ] `400` mostra a mensagem de URL rejeitada e mantém os valores digitados
- [ ] Testes cobrem PROV-08..12
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add provider config creation form`

---

### T6: Edição sem redigitar a chave

**What**: Edição por linha — endpoint, modelo e chave opcional; chave em branco = `PATCH` sem a propriedade `token`.
**Where**: `apps/web/src/nav/AiProviderAdminPage.tsx`
**Depends on**: T5
**Reuses**: padrão de edição inline (`renamingId`) de `apps/web/src/nav/WorkspaceListPage.tsx`
**Requirement**: PROV-13, PROV-14, PROV-15, PROV-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Salvar com o campo de chave vazio emite um `PATCH` cujo corpo serializado não tem a propriedade `token` (asserção sobre o corpo, não sobre a chamada)
- [ ] Salvar com o campo de chave preenchido emite um `PATCH` com `token` igual ao valor digitado
- [ ] A nota "deixar em branco mantém a chave atual" aparece no formulário de edição
- [ ] Status diferente de `200` informa a falha e mantém os valores anteriores na lista
- [ ] Testes cobrem PROV-13..16
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): edit provider config without resending the key`

---

### T7: Alternar qual configuração está ativa

**What**: Ações de ativar e desativar por linha, com a lista refletindo a exclusividade por escopo depois de um `200`.
**Where**: `apps/web/src/nav/AiProviderAdminPage.tsx`
**Depends on**: T6
**Reuses**: `client.update(id, {enabled})` de T2; `replaceItem`/`setItems` do `resourceListStore`
**Requirement**: PROV-21, PROV-22, PROV-26

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Ativar emite `PATCH` com `{enabled: true}`
- [ ] Depois de um `200`, a configuração ativada aparece ativa e **toda outra do mesmo escopo** aparece inativa, sem recarregar (asserção sobre o estado renderizado das duas linhas, não só da ativada)
- [ ] Desativar a ativa emite `PATCH` com `{enabled: false}` e deixa o escopo sem nenhuma ativa
- [ ] Falha do `PATCH` mantém o estado anterior e anuncia a falha
- [ ] Testes cobrem PROV-21, PROV-22, PROV-26
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): switch which provider config is active`

---

### T8: Testar a conexão na página

**What**: Botão "Testar conexão" por linha, com os quatro desfechos: sucesso, falha com HTTP `200`, `429` e erro de rede.
**Where**: `apps/web/src/nav/AiProviderAdminPage.tsx`
**Depends on**: T7
**Reuses**: `client.testConnection(id)` de T2; região `aria-live` já criada em T4
**Requirement**: PROV-17, PROV-18, PROV-19, PROV-20

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O clique emite `POST /admin/ai-providers/:id:test`
- [ ] `200` com `success: true` exibe sucesso citando `modelAvailable` e `toolCallingSupported`
- [ ] `200` com `success: false` exibe falha com o texto de `error` — nunca sucesso
- [ ] `429` exibe a mensagem de limite de testes atingido
- [ ] Erro de rede exibe falha genérica e o botão volta a ficar disponível (não fica preso em carregamento)
- [ ] Um segundo clique com um teste em voo não emite segunda requisição (caso de borda da spec)
- [ ] A página nunca dispara um teste sozinha no carregamento (a cota é 10/60s por usuário)
- [ ] Testes cobrem PROV-17..20 e os dois casos de borda acima
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): test provider connection from the admin page`

---

### T9: Registrar as duas rotas da tela

**What**: `admin/ai-providers` e `w/:workspaceId/admin/ai-providers` como filhas do `<Route path="/">` que renderiza `AppShell`.
**Where**: `apps/web/src/App.tsx`
**Depends on**: T8
**Reuses**: padrão das rotas aninhadas já existentes (`w/:workspaceId/members` é a irmã mais próxima)
**Requirement**: PROV-01, PROV-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] As duas rotas montam `AiProviderAdminPage` dentro do `AppShell`, sob `ProtectedRoute`
- [ ] Testes em `apps/web/src/App.spec.tsx` provam que cada rota renderiza a página (a rota global é a primeira rota autenticada do app sem workspace na URL)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): route the AI provider admin page`

---

### T10: Link global em `WorkspaceListPage`

**What**: Link para `/admin/ai-providers`, visível só quando algum workspace da lista tem `role === 'org_admin'`.
**Where**: `apps/web/src/nav/WorkspaceListPage.tsx`
**Depends on**: T9
**Reuses**: `WorkspaceItem.role`, já carregado por esta página; chave de i18n de T3
**Requirement**: PROV-05, PROV-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Com pelo menos um item `role === 'org_admin'`, o link aparece
- [ ] Sem nenhum item `role === 'org_admin'`, o link não existe no DOM (asserção de ausência, não de invisibilidade)
- [ ] Testes em `apps/web/src/nav/WorkspaceListPage.spec.tsx` cobrem PROV-05 e PROV-06
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): link to the global AI provider admin`

---

### T11: Link de workspace em `ProjectListPage`

**What**: Link para `/w/:workspaceId/admin/ai-providers`, sob o mesmo gate `workspace:manage_members` do link "Membros" já existente.
**Where**: `apps/web/src/nav/ProjectListPage.tsx`
**Depends on**: T9
**Reuses**: `can()` de `@arch-canvas/auth`, já importado nesta página; posição ao lado do link de membros
**Requirement**: PROV-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Com papel que concede `workspace:manage_members`, o link aparece
- [ ] Com papel que não concede, o link não existe no DOM
- [ ] Testes em `apps/web/src/nav/ProjectListPage.spec.tsx` cobrem PROV-07 nas duas direções
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): link to the workspace AI provider admin`

---

### T12: Teste de acessibilidade da página

**What**: Suite dedicada de a11y — axe sem violações serious/critical, ordem de foco explícita por controle, `aria-live="polite"` provado como atributo, e um render no locale `en`.
**Where**: `apps/web/src/nav/AiProviderAdminPage.a11y.spec.tsx`
**Depends on**: T8
**Reuses**: molde exato de `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx` (`jest-axe`, helper `seriousOrCriticalViolations`, troca de locale com restauração no `afterEach`)
**Requirement**: PROV-27, PROV-28, PROV-29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Estado com lista populada e estado com formulário de edição aberto: zero violações serious/critical
- [ ] Todo controle interativo (voltar, campos de cadastro, salvar, testar, ativar/desativar, editar) recebe foco por teclado, com asserção de `document.activeElement`
- [ ] A região de resultado tem `aria-live="polite"` (asserção sobre o atributo) e anuncia o desfecho de uma ação completada
- [ ] Um teste renderiza a página no locale `en` e afirma os rótulos traduzidos
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add a11y coverage for the AI provider admin page`

---

### T13: Atualizar a mensagem `no_provider_configured` do dock

**What**: Reescrever a string do dock nos dois locales para nomear a tela de administração de provider de IA em vez de afirmar que a configuração acontece fora do produto.
**Where**: `apps/web/src/i18n/locales/pt-BR/translation.json` e o arquivo irmão `en/translation.json`
**Depends on**: T3
**Reuses**: chave existente `aiDock.error.no_provider_configured`; teste existente de erro do dock em `apps/web/src/ai-dock/AiDock.spec.tsx`
**Requirement**: PROV-30

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Nenhuma das duas mensagens afirma que a configuração é feita fora do produto
- [ ] As duas nomeiam a tela de administração de provider de IA
- [ ] Teste em `apps/web/src/ai-dock/AiDock.spec.tsx` afirma a mensagem nova nos dois locales (asserção sobre o texto renderizado)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): point the AI dock error at the provider admin screen`

---

## Phase Execution Map

Fases em sequência; tasks dentro de uma fase em ordem.

O mapa abaixo é a visão completa: inclui também as arestas que cruzam fases (as fatias por fase
acima mostram só o encadeamento interno de cada uma).

```
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5

Phase 1:  T1
Phase 2:  T2
          T3
Phase 3:  T2 -> T4
          T3 -> T4
          T4 -> T5 -> T6 -> T7 -> T8
Phase 4:  T8 -> T9 -> T10
          T9 -> T11
Phase 5:  T8 -> T12
          T3 -> T13
```

Execução estritamente sequencial, um worker, uma task por vez. As 13 tasks passam do orçamento de
~7 por batch, mas a sessão designou um único worker para esta worktree — nenhum split de
sub-agente é feito.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: exclusividade por escopo | 2 funções do mesmo arquivo, um invariante | ✅ Granular |
| T2: `aiProviderClient` | 1 módulo cliente | ✅ Granular |
| T3: chaves de i18n | 1 bloco de chaves, espelhado em 2 arquivos de locale | ✅ Granular (a duplicação é de locale, não de conceito) |
| T4: página com listagem | 1 componente | ✅ Granular |
| T5: cadastro | 1 bloco de comportamento no componente | ✅ Granular |
| T6: edição | 1 bloco de comportamento no componente | ✅ Granular |
| T7: alternar ativo | 1 bloco de comportamento no componente | ✅ Granular |
| T8: testar conexão | 1 bloco de comportamento no componente | ✅ Granular |
| T9: rotas | 1 arquivo, 2 entradas de rota | ✅ Granular |
| T10: link global | 1 componente | ✅ Granular |
| T11: link de workspace | 1 componente | ✅ Granular |
| T12: a11y | 1 arquivo de teste | ✅ Granular |
| T13: mensagem do dock | 1 chave, espelhada em 2 arquivos de locale | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | (sem seta) | ✅ Match |
| T2 | None | (sem seta) | ✅ Match |
| T3 | None | (sem seta) | ✅ Match |
| T4 | T2, T3 | T2 -> T4, T3 -> T4 | ✅ Match |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T5 | T5 -> T6 | ✅ Match |
| T7 | T6 | T6 -> T7 | ✅ Match |
| T8 | T7 | T7 -> T8 | ✅ Match |
| T9 | T8 | T8 -> T9 | ✅ Match |
| T10 | T9 | T9 -> T10 | ✅ Match |
| T11 | T9 | T9 -> T11 | ✅ Match |
| T12 | T8 | T8 -> T12 | ✅ Match |
| T13 | T3 | T3 -> T13 | ✅ Match |

Nenhuma dependência aponta para uma fase posterior.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Server repository de escrita | integration | integration | ✅ OK |
| T2 | Client HTTP | unit | unit | ✅ OK |
| T3 | i18n JSON | none | none | ✅ OK |
| T4 | Component | unit | unit | ✅ OK |
| T5 | Component | unit | unit | ✅ OK |
| T6 | Component | unit | unit | ✅ OK |
| T7 | Component | unit | unit | ✅ OK |
| T8 | Component | unit | unit | ✅ OK |
| T9 | Roteamento | unit | unit | ✅ OK |
| T10 | Ponto de entrada | unit | unit | ✅ OK |
| T11 | Ponto de entrada | unit | unit | ✅ OK |
| T12 | Accessibility | unit (axe) | unit | ✅ OK |
| T13 | i18n JSON + mensagem do dock | unit (a camada mais alta das duas) | unit | ✅ OK |

`Tests: none` aparece só em T3, e a matriz diz `none` exatamente para a camada que ele toca
(JSON de i18n, exercitado pelos testes de componente das tasks seguintes).
