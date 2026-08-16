# Platform Maturity — Tasks (Onda F6: Verdade e portões)

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Spec**: `.specs/features/platform-maturity/spec.md`
**Design**: não produzido — F6 não introduz decisão arquitetural nova (ferramenta de auditoria isolada, configuração de CI e reescrita de documentação). O Design entra na onda F9 (MCP), que cria uma aplicação nova.
**Escopo desta rodada**: apenas F6 (TRU-01..04, CIQ-01..07, UIX-01..04). F7 a F10 são ondas seguintes.
**Status**: Draft

---

## Test Coverage Matrix

> Gerada a partir do codebase, das diretrizes do projeto e da spec — confirmar antes do Execute. Diretrizes encontradas: **nenhuma** (não existe `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, nem limiar de cobertura em nenhum dos 14 `vitest.config.ts`) → aplicados os defaults fortes da skill. Padrões de teste inferidos por amostragem de `packages/diagram-domain/src/*.spec.ts`, `apps/server/src/modules/**/*.int.spec.ts` e `apps/web/e2e/crash-recovery.spec.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Lógica de ferramenta de repositório (`tools/repo-tools/src/*.ts`) | unit | Todos os ramos; 1:1 com as ACs da spec; todo edge case listado tem teste | `tools/repo-tools/src/*.spec.ts` | `make test-unit` |
| Fluxo de usuário fim-a-fim (`apps/web/e2e/*.spec.ts`) | e2e | Caminho feliz + cada edge case listado + caminhos de erro | `apps/web/e2e/*.spec.ts` | `make test-e2e` |
| Configuração de workflow de CI (`.github/workflows/*.yaml`) | none | Não é testável por suíte — a verificação é a própria execução do workflow no pull request, mais uma reprodução local declarada no `Done when` da task | — | build gate + reprodução local |
| Configuração de runner e de dependências (`**/vitest.config.ts`, `.github/renovate.json`) | none | build gate apenas | — | `make ci` |
| Artefato de dados (`docs/capability-map.yaml`, inventário gerado) | none | Validado pelos testes unitários do checker que o consome (T6), nunca por teste próprio | — | build gate |
| Documentação e specs (`README.md`, `docs/*.html`, `.specs/**`) | none | build gate apenas | — | `make ci` |

## Gate Check Commands

> Gerados a partir do codebase (root `package.json` + `Makefile`) — confirmar antes do Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com testes unitários | `make test-unit` |
| Full | Depois de tasks com e2e ou integração | `make test && make test-e2e` |
| Build | Depois de tasks de configuração, dados ou documentação, e ao fechar uma fase | `make ci` |

---

## Execution Plan

As fases rodam em sequência; dentro de cada fase as tasks rodam na ordem numérica. As setas expressam dependência real, não paralelismo — a execução é sempre uma task por vez.

### Phase 1: Ferramental de auditoria

Cria o package de ferramentas e as duas extrações que alimentam todo o resto da onda.

```
T1 → T2 → T4
T1 → T3 → T4
```

### Phase 2: Mapa de capacidades

Transforma o inventário em um contrato verificável entre o que a documentação afirma e o que existe.

```
T5 → T6 → T7
```

### Phase 3: Portões de CI

Seis mudanças de configuração independentes entre si; nenhuma depende de outra dentro da fase.

```
T8   (piso de cobertura — independente)
T9   (commit lint — independente)
T10  (smoke do compose — independente)
T11  (e2e no CI — independente; o Playwright sobe seu próprio webServer)
T12  (job de auditoria — depende de T7, fase anterior)
T13  (automação de dependências — independente)
```

### Phase 4: Verdade na documentação e roadmap de produto

Só acontece depois que o mapa e o inventário existem — senão a reescrita seria mais uma afirmação sem lastro.

```
T16 → T17
```

---

## Task Breakdown

### Phase 1 — Ferramental de auditoria

#### T1: Criar o package de ferramentas de repositório

**What**: Scaffold do workspace package `@arch-canvas/repo-tools`, sem lógica de negócio ainda.
**Where**: `tools/repo-tools/`
**Depends on**: None
**Reuses**: `packages/diagram-domain/` (package.json, tsconfig.json, tsconfig.build.json e vitest.config.ts como molde exato)
**Requirement**: UIX-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `tools/repo-tools/package.json` declara `name`, `private: true`, `type: module` e os scripts `build`, `typecheck` e `test:unit`, no mesmo formato dos packages existentes
- [x] `tools/*` registrado em `pnpm-workspace.yaml`
- [x] `pnpm install` resolve o workspace sem erro e `turbo run typecheck` inclui o package novo na lista de escopo
- [x] Gate check passa: `make ci` — ver nota de ambiente abaixo

> **Nota de ambiente (vale para todo gate `build` desta rodada).** `make ci` roda `lint typecheck test-unit test-integration`. Nesta máquina o alvo `test-integration` já falhava antes desta onda por falta de binários externos: `infra/backup/src/incremental.int.spec.ts` precisa de `pg_lsclusters` e três specs de `apps/server/src/modules/ws-gateway` precisam de `redis-server`. Nenhuma asserção falha (318 testes passam em `apps/server`); as falhas são `ENOENT` de spawn. O gate aplicado foi `make lint && make typecheck && make test-unit` mais a confirmação de que `test-integration` falha exatamente nos mesmos arquivos de antes.

**Status**: ✅ Complete

**Tests**: none
**Gate**: build

**Commit**: `chore(repo-tools): scaffold repository audit tooling package`

---

#### T2: Extrair as rotas REST registradas no servidor

**What**: Função `extractServerRoutes(sourceRoot)` que varre `apps/server/src/modules` e devolve toda rota registrada com método, path e arquivo de origem.
**Where**: `tools/repo-tools/src/serverRoutes.ts`
**Depends on**: T1
**Reuses**: convenção de registro `app.<método>('<path>'` já usada por todos os 21 módulos
**Requirement**: UIX-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Retorna método, path e arquivo de origem para cada rota registrada
- [x] Arquivos `*.spec.ts` e `*.int.spec.ts` são ignorados, para que rotas de fixture de teste nunca entrem no inventário
- [x] Edge case coberto: arquivo sem nenhuma rota registrada devolve lista vazia em vez de lançar
- [x] Edge case coberto: mesmo path registrado com métodos diferentes conta como entradas distintas
- [x] Executado contra o repositório real, encontra pelo menos as 48 rotas hoje registradas
- [x] Gate check passa: `make test-unit`
- [x] Test count: 6 testes passam (sem deleção silenciosa)

> **Achado — a contagem de 48 rotas estava subestimada.** O extrator encontra **79** rotas registradas, não 48. O número 48 vinha de um `grep` de uma linha só (`app.<método>('<path>'`), que não enxerga os registros quebrados em várias linhas (`app.post(\n  '/path',`). Contagem independente: existem 79 chamadas `app.<método>(` em `apps/server/src/modules` fora de arquivos `*.spec.ts`, e as 79 têm path literal — nenhum falso positivo e nenhum registro perdido. O critério pedia "pelo menos 48", então o teste passa como escrito; a spec e a documentação de produto devem usar 79.

**Status**: ✅ Complete

**Tests**: unit
**Gate**: quick

**Commit**: `feat(repo-tools): extract registered server routes`

---

#### T3: Extrair os endpoints consumidos pela UI

**What**: Função `extractWebConsumers(sourceRoot)` que varre `apps/web/src` e devolve todo endpoint efetivamente requisitado pelo frontend, com o arquivo que o chama.
**Where**: `tools/repo-tools/src/webConsumers.ts`
**Depends on**: T1
**Reuses**: chamadas reais em `apps/web/src/sync/syncClient.ts` e `apps/web/src/diagram/DiagramEditorPage.tsx` como casos de referência
**Requirement**: UIX-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Reconhece tanto `fetch('/literal')` quanto template literal com interpolação, normalizando `${...}` para o segmento de parâmetro correspondente
- [x] Edge case coberto: chamada montada por concatenação de variável é reportada como não resolvível, nunca descartada em silêncio
- [x] Edge case coberto: arquivo de teste do frontend não conta como consumidor de produção
- [x] Executado contra o repositório real, encontra exatamente os 4 endpoints hoje consumidos (`/me`, bootstrap, `operations:batch`, catch-up de operações)
- [x] Gate check passa: `make test-unit`
- [x] Test count: 6 testes passam (sem deleção silenciosa)

> **Nota.** Os consumidores reais passam por `this.fetchImpl(...)`, não por `fetch(` direto, e a chamada de catch-up quebra em várias linhas. O extrator cobre as duas formas e apaga comentários antes de varrer — sem isso, a menção em prosa a `this.fetchImpl(...)` no JSDoc de `syncClient.ts` virava um quinto endpoint fantasma. `${...}` é normalizado para `:param` e a query string sai do `path` (fica no `expression`), que é o que faz o catch-up casar com `/diagrams/:id/operations` em T4.

**Status**: ✅ Complete

**Tests**: unit
**Gate**: quick

**Commit**: `feat(repo-tools): extract endpoints consumed by the web app`

---

#### T4: Reconciliar rotas e consumidores em um inventário classificado

**What**: Função `buildRouteInventory(routes, consumers)` que cruza as duas extrações e classifica cada rota como `consumed` ou `pending-product`.
**Where**: `tools/repo-tools/src/routeInventory.ts`
**Depends on**: T2, T3
**Reuses**: as saídas de `extractServerRoutes` (T2) e `extractWebConsumers` (T3)
**Requirement**: UIX-01, UIX-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Toda rota recebe exatamente uma classificação, sem categoria de escape
- [x] A soma de `consumed` e `pending-product` iguala o total de rotas de entrada — invariante asseverada em teste
- [x] Edge case coberto: consumidor apontando para rota inexistente no servidor é reportado como `orphan-consumer` em vez de ignorado
- [x] Edge case coberto: rota parametrizada casa com o consumidor que a chama com interpolação
- [x] Gate check passa: `make test-unit`
- [x] Test count: 7 testes passam (sem deleção silenciosa)

> **Resultado no repositório real:** 79 rotas, 4 `consumed`, 75 `pending-product`, 0 `orphan-consumer`. 4 + 75 = 79, que é o invariante de Success Criteria da spec. O casamento é por path: uma chamada `fetch` não carrega método legível estaticamente, então um path registrado com vários métodos contaria como consumido em todos eles. Não acontece hoje — as 4 rotas consumidas têm path distinto.

**Status**: ✅ Complete

**Tests**: unit
**Gate**: quick

**Commit**: `feat(repo-tools): reconcile routes against UI consumers into a classified inventory`

---

### Phase 2 — Mapa de capacidades

#### T5: Declarar o mapa de capacidades

**What**: Arquivo de dados que registra, para cada capacidade anunciada na documentação, a evidência de backend e o caminho da superfície de UI que a expõe — ou a marca explicitamente como `backend-only`.
**Where**: `docs/capability-map.yaml`
**Depends on**: T4
**Reuses**: a tabela de rastreabilidade de `.specs/features/architecture-canvas/spec.md` como fonte das capacidades anunciadas
**Requirement**: TRU-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Cada entrada tem `capability`, `requirements`, `backend_evidence` e `ui_surface` (caminho de arquivo ou `null` com `status: backend-only`)
- [x] Toda capacidade hoje afirmada como entregue no README e na landing tem entrada correspondente
- [x] As capacidades sem componente em `apps/web/src` — dock de IA, apresentação, comentários, biblioteca, histórico, docgen, lint, navegação de workspace — estão marcadas `backend-only`
- [x] O arquivo é consistente com a saída do inventário de T4 (nenhuma capacidade marcada com superfície que o inventário classifica como `pending-product`)
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1

> **Estado do mapa:** 26 entradas cobrindo os 92 requisitos de `architecture-canvas` exatamente uma vez cada. 22 são `backend-only`; 4 têm superfície de UI (`DiagramEditorPage.tsx` para sessão e edição, `syncClient.ts` para recuperação após crash, `AppShell.tsx` para acessibilidade). Além das capacidades nomeadas no critério, export/import, backup, colaboração em tempo real, compartilhamento, webhooks, OIDC, hardening, observabilidade e desempenho também não têm componente e entraram como `backend-only`.

**Status**: ✅ Complete

**Tests**: none
**Gate**: build

**Commit**: `docs(capability-map): declare backend evidence and UI surface per capability`

---

#### T6: Checar o mapa de capacidades contra o código

**What**: Função `checkCapabilityMap(map, sourceRoot)` que valida o schema do mapa e falha quando uma entrada declara superfície de UI inexistente.
**Where**: `tools/repo-tools/src/capabilityMap.ts`
**Depends on**: T5
**Reuses**: `docs/capability-map.yaml` (T5) como fixture real dos testes
**Requirement**: TRU-02, TRU-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Falha nomeando a entrada quando `ui_surface` aponta para caminho inexistente em `apps/web/src`
- [x] Falha quando uma entrada tem `ui_surface` nula sem `status: backend-only`, impedindo capacidade sem classificação
- [x] Edge case coberto: mapa vazio falha em vez de passar por vacuidade
- [x] Edge case coberto: entrada sem campo obrigatório falha nomeando o campo
- [x] Executado contra `docs/capability-map.yaml` real, passa
- [x] Gate check passa: `make test-unit`
- [x] Test count: 7 testes passam (sem deleção silenciosa)

> **Nota.** `checkCapabilityMap` devolve uma lista de violações (`{ entry, problem }`) em vez de lançar, para que a CLI de T7 imprima todas as entradas ofensoras de uma vez. `ui_surface` precisa estar sob `apps/web/src` **e** existir em disco — apontar para um arquivo de servidor é afirmação falsa, não superfície. O package ganhou a dependência `yaml@^2.9.0` (já presente no lockfile do workspace) para ler o mapa.

**Status**: ✅ Complete

**Tests**: unit
**Gate**: quick

**Commit**: `feat(repo-tools): fail when a declared UI surface does not exist`

---

#### T7: Expor a auditoria como comando único

**What**: CLI `repo-tools audit` que roda o inventário e a checagem do mapa, escreve o artefato de inventário e sai diferente de zero em qualquer divergência.
**Where**: `tools/repo-tools/src/cli.ts`
**Depends on**: T4, T6
**Reuses**: `buildRouteInventory` (T4) e `checkCapabilityMap` (T6)
**Requirement**: TRU-03, UIX-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Sai com código diferente de zero quando o mapa de capacidades tem qualquer divergência, imprimindo cada entrada ofensora
- [x] Escreve o inventário em `docs/route-inventory.md` com as rotas agrupadas por classificação
- [x] Edge case coberto: sem divergência nenhuma, sai zero e ainda assim escreve o artefato
- [x] Edge case coberto: caminho de repositório inválido falha com mensagem explícita, nunca com stack trace cru
- [x] `pnpm --filter @arch-canvas/repo-tools exec repo-tools audit` roda de verdade no repositório e produz o artefato
- [x] Gate check passa: `make test-unit`
- [x] Test count: 5 testes passam (sem deleção silenciosa)

> **Como invocar (importa para T12).** O `bin` só é linkado por `pnpm install` **depois** que `dist/cli.js` existe: num checkout limpo o primeiro `pnpm install` avisa `Failed to create bin` e a forma `exec repo-tools audit` não resolve. Duas saídas, ambas verificadas: rodar `install → build → install` e então `pnpm --filter @arch-canvas/repo-tools exec repo-tools audit`, ou usar direto `pnpm --filter @arch-canvas/repo-tools run audit`, que chama `node dist/cli.js audit` e só depende do build. O CI deve preferir a segunda.
>
> Duas mudanças de wiring fora do `Where` da task foram necessárias: `bin` e o script `audit` em `tools/repo-tools/package.json`, e `@arch-canvas/repo-tools` como devDependency da raiz (é isso que coloca o bin no `node_modules/.bin` do workspace). Auto-referência dentro do próprio package foi testada e **não** funciona: o turbo rejeita com `@arch-canvas/repo-tools#build depends on itself`.
>
> **Teste independente da spec (TRU-01 AC3) reproduzido:** apontar a entrada `Acessibilidade do shell da aplicação` para um `GhostShell.tsx` inexistente faz a auditoria sair 1 nomeando a entrada. O mapa foi restaurado.

**Status**: ✅ Complete

**Tests**: unit
**Gate**: quick

**Commit**: `feat(repo-tools): add audit CLI writing the route inventory`

---

### Phase 3 — Portões de CI

#### T8: Declarar piso de cobertura por package

**What**: Provider de cobertura instalado e limiar declarado em cada package, iniciado no valor medido hoje e travado como piso.
**Where**: `**/vitest.config.ts`
**Depends on**: None
**Reuses**: os 14 `vitest.config.ts` existentes, alterados no mesmo formato
**Requirement**: CIQ-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `@vitest/coverage-v8` adicionado como devDependency na raiz (hoje não existe provider de cobertura em lugar nenhum)
- [x] Cada package com `test:unit` declara `coverage.thresholds` com o valor medido na primeira execução, nunca um número aspiracional
- [x] Baixar qualquer limiar exige alteração explícita do arquivo — nenhum limiar é herdado implicitamente
- [x] Reprodução local: reduzir a cobertura de um package removendo um teste faz `make test-unit` falhar nomeando o package; o teste é restaurado em seguida
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1

> **Pisos medidos (não aspiracionais).** Os 12 packages com `test:unit` receberam o valor medido na primeira execução com `@vitest/coverage-v8@3.2.7`: server 25.48/39.73/80.27, web 56.54/72.5/85.52, backup 6.01/46.15/66.66, ai-tools 91.13/90.24/77.43, auth 97.61/50/75, diagram-domain 98.02/93.33/93.82, diagram-ir 89.88/92.85/77.7, editor-adapter 80.34/77.77/92.59, library-content 99.51/75/75, shared-contracts 97.34/87.5/78.26, test-fixtures 67.53/88.88/93.33, repo-tools 92.2/100/83.33 (lines/functions/branches; `statements` igual a `lines` no provider v8). `coverage.enabled: true` é o que faz o piso valer no `test:unit` normal — sem isso o limiar só existiria com `--coverage` explícito e o portão seria decorativo. `packages/database` não tem `test:unit` e ficou de fora.
>
> **Sensor de discriminação executado.** Removido `packages/diagram-domain/src/envelope.spec.ts` e rodado `make test-unit`: falha com `@arch-canvas/diagram-domain:test:unit: ERROR: Coverage for lines (71.92%) does not meet global threshold (98.02%)` — nomeia package, piso e valor medido, que é exatamente o que a CIQ-04 exige. Arquivo restaurado; `git status --porcelain` sem resíduo.
>
> **Risco declarado:** o piso é o valor medido em macOS/Node 22.23.2. Se o runner Linux do CI executar um ramo diferente em algum arquivo, o piso pode ficar 0,01 ponto acima do medido lá. Só o primeiro pull request confirma.

**Status**: ✅ Complete

**Tests**: none
**Gate**: build

**Commit**: `chore(test): declare per-package coverage floors`

---

#### T9: Validar mensagens de commit no CI

**What**: Job de CI que valida cada mensagem de commit do pull request contra Conventional Commits.
**Where**: `.github/workflows/ci.yaml`
**Depends on**: None
**Reuses**: `.claude/skills/tlc-spec-driven/scripts/check_commit.py`, que já implementa exatamente essa checagem
**Requirement**: CIQ-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O job percorre todos os commits do pull request, não apenas o head
- [ ] Falha nomeando a primeira mensagem não conforme
- [ ] Reprodução local: `check_commit.py --message "mensagem invalida"` sai diferente de zero e `--message "feat(x): y"` sai zero
- [ ] Gate check passa: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `ci: enforce conventional commits on pull requests`

---

#### T10: Subir o stack real no CI e provar a saúde

**What**: Job de CI que sobe o compose completo, espera todos os serviços ficarem saudáveis e valida `/health/ready` pela porta pública.
**Where**: `.github/workflows/ci.yaml`
**Depends on**: None
**Reuses**: `infra/compose/compose.yaml` e os alvos `up`, `ps` e `down` do `Makefile`
**Requirement**: CIQ-01, CIQ-02, CIQ-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O job sobe o stack via `docker compose up --build` e falha se qualquer serviço não atingir `healthy` em 5 minutos
- [ ] Requisita `GET /health/ready` pela porta pública e falha se a resposta não for 200 com `status` igual a `ok` e `postgres` em `up`
- [ ] Ausência de daemon Docker falha o job explicitamente em vez de ser reportada como sucesso
- [ ] Os logs dos containers são publicados como artefato quando o job falha, para diagnóstico sem reproduzir
- [ ] Sensor de discriminação: reverter localmente o `apk add` de dependências nativas do `canvas` em `infra/compose/server.Dockerfile` faz o job falhar; reverter o `127.0.0.1` do healthcheck em `web.Dockerfile` faz o job falhar; ambas as reversões são desfeitas ao final
- [ ] Gate check passa: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `ci: boot the full compose stack and assert public health`

---

#### T11: Rodar a suíte end-to-end no CI

**What**: Job de CI que executa a suíte Playwright de `apps/web`.
**Where**: `.github/workflows/ci.yaml`
**Depends on**: None
**Reuses**: `apps/web/playwright.config.ts`, que já sobe seus próprios `webServer` — a suíte é autossuficiente e não depende do stack do compose
**Requirement**: CIQ-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Os binários de browser são instalados e cacheados entre execuções
- [ ] `crash-recovery.spec.ts` roda no CI e passa
- [ ] Falha de teste publica o relatório do Playwright como artefato
- [ ] Reprodução local: `make test-e2e-browsers && make test-e2e` passa antes de o job ser escrito
- [ ] Gate check passa: `make test && make test-e2e`
- [ ] Test count: 1 teste e2e passa (sem deleção silenciosa)

**Tests**: e2e
**Gate**: full

**Commit**: `ci: run the playwright end-to-end suite`

---

#### T12: Rodar a auditoria de capacidades no CI

**What**: Job de CI que executa `repo-tools audit` e falha o build quando a documentação afirma capacidade sem superfície existente.
**Where**: `.github/workflows/ci.yaml`
**Depends on**: T7
**Reuses**: a CLI entregue em T7
**Requirement**: TRU-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O job falha quando o mapa de capacidades diverge do código
- [ ] O inventário gerado é publicado como artefato do build
- [ ] Sensor de discriminação: apontar uma entrada do mapa para um componente inexistente faz o job falhar nomeando a entrada; a alteração é desfeita ao final
- [ ] Gate check passa: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `ci: fail when documented capabilities lack a real UI surface`

---

#### T13: Automatizar atualização de dependências

**What**: Configuração de atualização automatizada com pull requests agrupados por ecossistema.
**Where**: `.github/renovate.json`
**Depends on**: None
**Reuses**: os grupos naturais já presentes no monorepo (react, vitest, fastify, aws-sdk, opentelemetry)
**Requirement**: CIQ-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Atualizações agrupadas por ecossistema, não uma por dependência
- [ ] Atualizações de major ficam isoladas em pull request próprio
- [ ] Node fica travado na faixa 22.x, respeitando `.nvmrc` e o campo `engines`
- [ ] A suíte completa roda em cada pull request gerado
- [ ] Gate check passa: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `ci: automate grouped dependency updates`

---

### Phase 4 — Verdade na documentação e roadmap

#### T14: Corrigir as afirmações do README

**What**: Reescrita das afirmações de capacidade do README para refletirem contrato de backend verificado e superfície de produto pendente.
**Where**: `README.md`
**Depends on**: T5
**Reuses**: `docs/capability-map.yaml` (T5) como única fonte das afirmações
**Requirement**: TRU-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A contagem de requisitos aparece qualificada como contrato de backend verificado por Verifier independente
- [ ] A contagem de capacidades sem superfície de produto aparece explicitamente, com link para o mapa
- [ ] Nenhuma capacidade marcada `backend-only` no mapa é descrita como disponível ao usuário
- [ ] `repo-tools audit` passa contra o README reescrito
- [ ] Gate check passa: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(readme): qualify delivered capabilities against the capability map`

---

#### T15: Corrigir as afirmações da landing

**What**: Mesma correção aplicada à página de visão geral da arquitetura.
**Where**: `docs/architecture-overview.html`
**Depends on**: T5
**Reuses**: `docs/capability-map.yaml` (T5) como única fonte das afirmações
**Requirement**: TRU-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] As seções que descrevem capacidades sem superfície deixam claro que são contrato de backend
- [ ] O rodapé com a contagem de requisitos recebe a mesma qualificação do README
- [ ] O mockup do editor continua rotulado como ilustrativo, sem sugerir tela existente
- [ ] `repo-tools audit` passa contra a landing reescrita
- [ ] Gate check passa: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(overview): qualify capability claims on the architecture landing page`

---

#### T16: Publicar o roadmap de produto decomposto

**What**: Índice de roadmap que converte cada capacidade sem superfície em uma entrada dimensionada para um squad, com escopo, dependências e spec prevista.
**Where**: `.specs/features/platform-maturity/ui-roadmap.md`
**Depends on**: T4
**Reuses**: o inventário classificado gerado em T4 e T7
**Requirement**: UIX-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Toda capacidade `backend-only` do mapa tem entrada correspondente no roadmap
- [ ] Cada entrada declara escopo, rotas de backend que consome, dependências entre entradas e tamanho estimado em ondas
- [ ] Nenhuma entrada depende de outra que esteja depois dela na ordem proposta
- [ ] O índice declara explicitamente que cada entrada vira uma spec própria em sua própria rodada de Specify, e não nesta onda
- [ ] Gate check passa: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(roadmap): decompose the product gap into squad-sized entries`

---

#### T17: Especificar o dock de IA como primeira fatia vertical

**What**: Spec completa da primeira entrada do roadmap de produto, servindo de exemplar para as demais.
**Where**: `.specs/features/ai-dock/spec.md`
**Depends on**: T16
**Reuses**: as rotas de `apps/server/src/modules/ai-engine` já existentes e o formato de `.specs/features/platform-maturity/spec.md`
**Requirement**: UIX-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven` (fase Specify)

**Done when**:

- [ ] A spec cobre o fluxo declarado do produto: pedido em linguagem natural, prévia, aprovação explícita e undo
- [ ] Toda AC está em notação EARS, com valores concretos em vez de qualificadores vagos
- [ ] Os IDs de requisito não colidem com nenhum prefixo já usado no repositório
- [ ] `python3 .claude/skills/tlc-spec-driven/scripts/validate_spec.py .specs/features/ai-dock/spec.md` sai zero
- [ ] Gate check passa: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(ai-dock): specify the AI dock as the first product vertical slice`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 → T2 → T4
          T1 → T3 → T4
Phase 2:  T5 → T6 → T7
Phase 3:  T8, T9, T10, T11, T12, T13 (sem dependência entre si)
Phase 4:  T14, T15 (independentes)
          T16 → T17
```

A execução é estritamente sequencial — não há paralelismo dentro de uma fase.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Scaffold do package | 1 package novo | ✅ Granular |
| T2: Extrator de rotas | 1 função | ✅ Granular |
| T3: Extrator de consumidores | 1 função | ✅ Granular |
| T4: Reconciliador de inventário | 1 função | ✅ Granular |
| T5: Mapa de capacidades | 1 artefato de dados | ✅ Granular |
| T6: Checker do mapa | 1 função | ✅ Granular |
| T7: CLI de auditoria | 1 entrypoint | ✅ Granular |
| T8: Piso de cobertura | 1 conceito uniforme aplicado aos configs de teste | ⚠️ Coeso — mudança única replicada, não deliverables distintos |
| T9: Commit lint no CI | 1 job | ✅ Granular |
| T10: Smoke do compose no CI | 1 job | ✅ Granular |
| T11: E2E no CI | 1 job | ✅ Granular |
| T12: Auditoria no CI | 1 job | ✅ Granular |
| T13: Automação de dependências | 1 arquivo de config | ✅ Granular |
| T14: README | 1 documento | ✅ Granular |
| T15: Landing | 1 documento | ✅ Granular |
| T16: Índice de roadmap | 1 documento | ✅ Granular |
| T17: Spec do dock de IA | 1 spec | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (corpo) | Diagrama mostra | Status |
| ---- | ------------------ | --------------- | ------ |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 | ✅ Match |
| T4 | T2, T3 | T2 → T4, T3 → T4 | ✅ Match |
| T5 | T4 | fase anterior (parity não se aplica entre fases) | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T4, T6 | T6 → T7 intra-fase; T4 é fase anterior | ✅ Match |
| T8 | None | — | ✅ Match |
| T9 | None | — | ✅ Match |
| T10 | None | — | ✅ Match |
| T11 | None | — | ✅ Match |
| T12 | T7 | fase anterior | ✅ Match |
| T13 | None | — | ✅ Match |
| T14 | T5 | fase anterior | ✅ Match |
| T15 | T5 | fase anterior | ✅ Match |
| T16 | T4 | fase anterior | ✅ Match |
| T17 | T16 | T16 → T17 | ✅ Match |

Nenhuma dependência aponta para fase posterior.

---

## Test Co-location Validation

| Task | Camada criada/alterada | Matriz exige | Task declara | Status |
| ---- | ---------------------- | ------------ | ------------ | ------ |
| T1 | Configuração de package | none | none | ✅ OK |
| T2 | Lógica de ferramenta | unit | unit | ✅ OK |
| T3 | Lógica de ferramenta | unit | unit | ✅ OK |
| T4 | Lógica de ferramenta | unit | unit | ✅ OK |
| T5 | Artefato de dados | none | none | ✅ OK |
| T6 | Lógica de ferramenta | unit | unit | ✅ OK |
| T7 | Lógica de ferramenta | unit | unit | ✅ OK |
| T8 | Configuração de runner | none | none | ✅ OK |
| T9 | Workflow de CI | none | none | ✅ OK |
| T10 | Workflow de CI | none | none | ✅ OK |
| T11 | Workflow de CI + fluxo e2e | e2e | e2e | ✅ OK |
| T12 | Workflow de CI | none | none | ✅ OK |
| T13 | Configuração de dependências | none | none | ✅ OK |
| T14 | Documentação | none | none | ✅ OK |
| T15 | Documentação | none | none | ✅ OK |
| T16 | Documentação | none | none | ✅ OK |
| T17 | Spec | none | none | ✅ OK |

Todo `Tests: none` corresponde a uma linha da matriz que exige `none` — nenhum é adiamento de teste. As tasks de workflow, que não têm suíte possível, compensam com reprodução local declarada no `Done when`; T8, T10 e T12 vão além e exigem sensor de discriminação (quebrar de propósito e confirmar que o portão pega).
