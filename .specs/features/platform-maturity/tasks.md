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

### Phase 5: Correções da rodada 1 de verificação

Fecha as lacunas apontadas por `validation.md` (rodada 1). As correções de ferramenta vêm antes das de documentação, porque a contagem publicada depende delas.

```
T18 → T21
T19  (independente)
T20  (independente)
T22  (independente)
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

- [x] O job percorre todos os commits do pull request, não apenas o head
- [x] Falha nomeando a primeira mensagem não conforme
- [x] Reprodução local: `check_commit.py --message "mensagem invalida"` sai diferente de zero e `--message "feat(x): y"` sai zero
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1

> **Reprodução local do job inteiro, não só do script.** O bloco `run` do job foi extraído do YAML e executado como shell:
> - Faixa real deste branch (`a09b6ef..HEAD`, 13 commits): sai 0, `13 commit messages conform to Conventional Commits`.
> - Repositório descartável com um commit ruim no meio (`feat(a): ...` → `mensagem invalida` → `fix(b): ...`): sai 1 em `mensagem invalida` e **não** chega ao commit seguinte, que é o que prova "primeira mensagem não conforme" e não "alguma mensagem".
>
> `--reverse` existe por isso: sem ele o `rev-list` sai do mais novo para o mais antigo e "primeira" seria a última em ordem cronológica. Commits de merge ficam fora (`--no-merges`) porque a mensagem é gerada pelo GitHub — o próprio repositório já tem uma (`fc143f8`). `fetch-depth: 0` é obrigatório: o clone raso padrão não tem `base.sha`.
>
> **Achado (não corrigido):** dois commits de T4 e T5 têm header acima de 72 caracteres. O `check_commit.py` trata isso como WARN, não ERROR, então o job passa.
>
> **Não verificável localmente:** que `github.event.pull_request.base.sha` e `head.sha` cheguem preenchidos e que o `if: github.event_name == 'pull_request'` selecione o job. Só o primeiro pull request confirma.

**Status**: ✅ Complete

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

- [x] O job sobe o stack via `docker compose up --build` e falha se qualquer serviço não atingir `healthy` em 5 minutos
- [x] Requisita `GET /health/ready` pela porta pública e falha se a resposta não for 200 com `status` igual a `ok` e `postgres` em `up`
- [x] Ausência de daemon Docker falha o job explicitamente em vez de ser reportada como sucesso
- [x] Os logs dos containers são publicados como artefato quando o job falha, para diagnóstico sem reproduzir
- [x] Sensor de discriminação: reverter localmente o `apk add` de dependências nativas do `canvas` em `infra/compose/server.Dockerfile` faz o job falhar; reverter o `127.0.0.1` do healthcheck em `web.Dockerfile` faz o job falhar; ambas as reversões são desfeitas ao final
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1

> **O stack subiu de verdade nesta máquina.** Os blocos `run` do job foram extraídos do YAML e executados como shell contra o daemon Docker real (Compose v5.1.0). Resultado do caminho feliz: os 8 serviços sobem, `migrate` e `minio-init` saem 0, e `GET http://localhost:8080/health/ready` responde `HTTP 200` com `{"status":"ok","dependencies":[{"name":"postgres","status":"up"}]}` — as três asserções da CIQ-02 batem com o corpo real, não com um corpo suposto.
>
> **Armadilha encontrada e corrigida: `--wait` não convive com job one-shot.** A primeira versão usava `docker compose up --build -d --wait --wait-timeout 300` e falhou com `container arch-canvas-minio-init-1 exited (0)` mesmo com o stack inteiro saudável — `--wait` trata container que terminou como falha. A forma final separa as três responsabilidades: `docker compose build` (fora do orçamento de saúde), `timeout 300 docker compose up -d` (é o `timeout` que transforma serviço que nunca fica saudável em job vermelho em vez de job pendurado, porque o `up` espera `depends_on` indefinidamente) e um `--wait` final restrito aos serviços de longa duração, que é o único jeito de provar `redis` — o `server` o declara como `service_started`, não `service_healthy`.
>
> **Sensor de discriminação — duas quebras, as duas pegas:**
> 1. Removido o `RUN apk add --no-cache python3 make g++ ... cairo-dev ...` do estágio installer de `server.Dockerfile`: o job sai 1 no build, com `gyp ERR! Could not find any Python installation to use` no `canvas@3.2.3` e `failed to solve: process "/bin/sh -c pnpm install --frozen-lockfile" did not complete successfully`.
> 2. Trocado `http://127.0.0.1/` por `http://localhost/` no HEALTHCHECK de `web.Dockerfile`: o job sai 1 em 55 segundos com `dependency failed to start: container arch-canvas-web-1 is unhealthy`; `proxy` fica em `Created` e o passo de asserção de saúde nem chega a rodar. O próprio compose desiste quando o healthcheck esgota as tentativas, antes do `timeout 300`.
>
> As duas reversões foram desfeitas com `git checkout HEAD --` apontando só para o arquivo quebrado, e `git status --porcelain` voltou a mostrar apenas `.github/workflows/ci.yaml`.
>
> **Não verificável localmente:** `actions/upload-artifact@v4` publicando `compose-diagnostics.txt`, o comportamento de `if: failure()`, e o fato de o runner Linux ter `timeout` (coreutils) — nesta máquina macOS não existe `timeout`, e a reprodução usou um substituto com o mesmo contrato (mata o filho, sai 124). O passo "Require a Docker daemon" também só é exercitado de verdade num runner sem Docker; aqui ele passa porque o daemon existe.

**Status**: ✅ Complete

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

- [x] Os binários de browser são instalados e cacheados entre execuções
- [x] `crash-recovery.spec.ts` roda no CI e passa
- [x] Falha de teste publica o relatório do Playwright como artefato
- [x] Reprodução local: `make test-e2e-browsers && make test-e2e` passa antes de o job ser escrito
- [x] Gate check passa: `make test && make test-e2e` — `test-integration` substituído, ver nota de ambiente em T1
- [x] Test count: 1 teste e2e passa (sem deleção silenciosa)

> **Reprodução local antes de escrever o job.** `make test-e2e-browsers` baixou o Chromium Headless Shell 141.0.7390.37 e `CI=true NODE_ENV=test make test-e2e` passou: `1 passed (30.8s)`, `crash-recovery.spec.ts:38`. `CI=true` importa — é o que desliga o `reuseExistingServer` do `playwright.config.ts` e faz os dois `webServer` subirem do zero, como no runner. `NODE_ENV=test` reproduz o `env` global do workflow, que de outro modo só apareceria no CI.
>
> **O job não passa por `turbo run test:e2e`.** Chama `playwright test --reporter=list,html` direto, porque o repórter padrão do `playwright.config.ts` é só `list` e não produz artefato nenhum. Adicionar `html` pelo config sairia do `Where` desta task; pela linha de comando o config fica intacto e o artefato existe. Os blocos `run` extraídos do YAML foram executados nesta máquina na ordem do job (`pnpm install --frozen-lockfile` → `pnpm -w build` → `playwright test --reporter=list,html`): saem 0 e escrevem `apps/web/playwright-report/index.html`. O `install --frozen-lockfile` também confirma que o lockfile que T8 alterou está consistente.
>
> **Não verificável localmente:** o `actions/cache@v4` de `~/.cache/ms-playwright` (não dá para provar cache hit entre execuções fora do runner), o `--with-deps` instalando bibliotecas de sistema do Ubuntu, e o `if: failure()` publicando o relatório. Só o primeiro pull request confirma.

**Status**: ✅ Complete

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

- [x] O job falha quando o mapa de capacidades diverge do código
- [x] O inventário gerado é publicado como artefato do build
- [x] Sensor de discriminação: apontar uma entrada do mapa para um componente inexistente faz o job falhar nomeando a entrada; a alteração é desfeita ao final
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1

> **Job reproduzido inteiro nesta máquina.** Os passos extraídos do YAML (`pnpm install --frozen-lockfile` → `pnpm --filter @arch-canvas/repo-tools build` → `pnpm --filter @arch-canvas/repo-tools run audit`) saem 0 e imprimem `repo-tools audit: wrote docs/route-inventory.md — 79 routes, 4 consumed, 75 pending-product`, que é a linha de base de T4/T7.
>
> A forma `run audit` foi escolhida por causa do achado de T7: num checkout limpo o `bin` não está linkado porque `dist/cli.js` ainda não existe na hora do install, então `exec repo-tools audit` só funcionaria com install → build → install. O script depende apenas do passo de build, que o job já tem.
>
> **Sensor de discriminação executado.** A entrada `Recuperação após crash do navegador` foi apontada para `apps/web/src/sync/GhostSyncClient.ts`, que não existe. O job sai 1 com `repo-tools audit: Recuperação após crash do navegador — ui_surface 'apps/web/src/sync/GhostSyncClient.ts' does not exist` — nomeia a capacidade e o caminho, que é o Independent Test da TRU-01 no nível do job e não mais no nível da função. Restaurado com `git checkout HEAD -- docs/capability-map.yaml`; `git status --porcelain` voltou a mostrar só `.github/workflows/ci.yaml`.
>
> **Não verificável localmente:** `actions/upload-artifact@v4` publicando `docs/route-inventory.md`. O `if: always()` é deliberado — o inventário é escrito mesmo quando a auditoria falha, e é justamente no build vermelho que ele serve para diagnóstico.

**Status**: ✅ Complete

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

- [x] Atualizações agrupadas por ecossistema, não uma por dependência — 8 grupos (`react`, `vitest and vite`, `fastify`, `aws-sdk`, `opentelemetry`, `postgres`, `canvas rendering`, `toolchain`)
- [x] Atualizações de major ficam isoladas em pull request próprio — regra final com `groupName: null`, prefixo de branch `major-` e `dependencyDashboardApproval`
- [x] Node fica travado na faixa 22.x, respeitando `.nvmrc` e o campo `engines` — `constraints.node: ">=22 <23"` mais `allowedVersions: "<23"` na regra do próprio `node`
- [x] A suíte completa roda em cada pull request gerado — pull request do Renovate é pull request comum, então `ci.yaml` dispara nele os 9 jobs (incluindo `compose-smoke`, `e2e` e `capability-audit`)
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1; aplicado `make lint && make typecheck && make test-unit`

> **Correção aplicada na revisão.** O comentário da regra do `node` atribuía a quebra do Node 24 a `apps/web`; o teste afetado é `apps/server/src/modules/ai-engine/callProvider.spec.ts`. Corrigido antes do commit.

**Status**: ✅ Complete

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

- [x] A contagem de requisitos aparece qualificada como contrato de backend verificado por Verifier independente
- [x] A contagem de capacidades sem superfície de produto aparece explicitamente, com link para o mapa
- [x] Nenhuma capacidade marcada `backend-only` no mapa é descrita como disponível ao usuário
- [x] `repo-tools audit` passa contra o README reescrito
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1; aplicado `make lint && make typecheck && make test-unit`

> **A correção é de precisão, não de mérito.** O bloco de status passou a separar duas afirmações que antes vinham coladas: os 92 requisitos continuam verificados por Verifier independente, com evidência em `file:line`, e essa é uma afirmação forte que ficou intacta; o que mudou é que ela agora se declara como contrato de backend, com a superfície de produto medida ao lado (26 capacidades, 4 com tela, 22 `backend-only`; 79 rotas, 4 consumidas, 75 sem consumidor). Todos os números saíram de `docs/capability-map.yaml` e `docs/route-inventory.md`, nunca de estimativa.
>
> A seção `O que é` foi partida em duas listas. As 22 capacidades `backend-only` — IA geradora e editora, colaboração em tempo real, docgen, lint, interop, apresentações, comentários, biblioteca, histórico, export, share, webhooks, OIDC, backup, observabilidade — estavam na mesma lista das entregues e agora estão sob "ainda sem tela". A lista "com tela hoje" tem exatamente as 4 entradas com `ui_surface` no mapa.
>
> `repo-tools audit` sai 0 depois da reescrita (`79 routes, 4 consumed, 75 pending-product`). A auditoria não lê o README — ela protege o mapa, que é a fonte do texto; a checagem do texto contra o mapa foi feita entrada a entrada.
>
> **Achado não corrigido (fora do `Where` desta task):** a árvore do monorepo no README não lista `tools/repo-tools`, criado em T1.

**Status**: ✅ Complete

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

- [x] As seções que descrevem capacidades sem superfície deixam claro que são contrato de backend
- [x] O rodapé com a contagem de requisitos recebe a mesma qualificação do README
- [x] O mockup do editor continua rotulado como ilustrativo, sem sugerir tela existente
- [x] `repo-tools audit` passa contra a landing reescrita
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1; aplicado `make lint && make typecheck && make test-unit`

> **Marcação por seção, não aviso genérico no topo.** Um bloco `.status-panel` no herói dá os números (26 capacidades, 4 com tela, 22 `backend-only`; 79 rotas, 4 consumidas) com link para o mapa e para o inventário. Cada seção que descreve capacidade sem superfície ganhou um selo `contrato de backend · sem tela` ao lado do título e um `.surface-note` dizendo o que existe e o que falta: 02 (IA), 04 (colaboração), 05 (formatos, docgen, lint) e 06 (produção). As seções 01 e 03, que têm superfície parcial, receberam só o `.surface-note` separando o que abre do que é `backend-only` — biblioteca e presets na 01; snapshots, conflito e export na 03. São 5 selos (4 seções + 1 na legenda do painel) e 6 notas.
>
> **Três afirmações de UI foram corrigidas no texto, não só anotadas:** `Um botão "Gerar documentação"` virou `A geração de documentação`, `O editor avisa quando algo parece errado` virou `O lint avisa...` com `roda no servidor` no lugar de `roda em segundo plano`, e o eyebrow `IA geradora · tempo real` virou `IA e tempo real como API`. Frase de mockup reescrita: era `o desenho real usa os componentes da biblioteca`, que sugere tela existente; agora é `Mockup ilustrativo, não uma captura de tela` mais a afirmação explícita de que nenhum componente equivalente existe em `apps/web`.
>
> **Verificação de render.** Página aberta no navegador: HTML fecha todas as tags (checagem por parser), os 5 selos medem 221×24, as 6 notas de 117 a 163 px de altura, o painel de status 622×325, e `scrollWidth == clientWidth` — nenhum overflow horizontal. Os estilos novos usam só tokens já definidos (`--amber`, `--amber-soft`, `--paper-deep`), então o tema escuro segue pelo mesmo caminho dos demais.

**Status**: ✅ Complete

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

- [x] Toda capacidade `backend-only` do mapa tem entrada correspondente no roadmap
- [x] Cada entrada declara escopo, rotas de backend que consome, dependências entre entradas e tamanho estimado em ondas
- [x] Nenhuma entrada depende de outra que esteja depois dela na ordem proposta
- [x] O índice declara explicitamente que cada entrada vira uma spec própria em sua própria rodada de Specify, e não nesta onda
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1; aplicado `make lint && make typecheck && make test-unit`

> **Cobertura fechada por contagem, não por impressão.** O mapa tem 22 entradas com `status: backend-only` (conferido: `grep -c '^    status: backend-only'` devolve 22, e `ui_surface: null` também 22). Delas, 16 viraram entradas de produto R1–R16 e 6 ficaram registradas como superfície operacional — instalação, backup, DR, hardening, observabilidade e desempenho, cujo lugar certo é compose, job ou painel Grafana, não tela. 16 + 6 = 22.
>
> Dois casos não são um-para-um, e estão declarados no documento: R1 cobre duas capacidades (geração e edição por IA) porque vivem no mesmo dock, e a capacidade de workspace foi partida em R3 (navegação, 15 rotas) e R4 (membros e papéis, 4 rotas) para caber no orçamento de uma onda.
>
> **Dimensionamento é fórmula, não palpite.** Base de 1 onda, mais 0,5 para cada um de: mais de 10 rotas pendentes, transporte novo no frontend ou rota pública sem sessão, mais de 3 superfícies novas. Total 18,5 ondas em 16 entradas, nenhuma acima de 2. As rotas de cada entrada saíram linha a linha do `pending-product` de `docs/route-inventory.md`: 73 das 75 atribuídas. As 2 restantes são as de `asset`, que pertencem a `Edição server-first do canvas` — capacidade que **tem** superfície e por isso não é `backend-only` e não gera entrada; ficam declaradas como escopo de R5.
>
> **Ordem verificada por tabela própria** no fim do documento: as 16 entradas têm dependência apontando só para posição anterior. R1 e R2 são raízes independentes.

**Status**: ✅ Complete

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

- [x] A spec cobre o fluxo declarado do produto: pedido em linguagem natural, prévia, aprovação explícita e undo
- [x] Toda AC está em notação EARS, com valores concretos em vez de qualificadores vagos
- [x] Os IDs de requisito não colidem com nenhum prefixo já usado no repositório
- [x] `python3 .claude/skills/tlc-spec-driven/scripts/validate_spec.py .specs/features/ai-dock/spec.md` sai zero
- [x] Gate check passa: `make ci` — ver nota de ambiente em T1; aplicado `make lint && make typecheck && make test-unit`

> **Prefixo `DOCK`,** conferido contra os 30 já usados (A11Y, AAC, AIC, AIE, AIG, API, AUTH, CIQ, CLB, CMT, DOC, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, OBS, OIDC, OPS, PERF, PRS, REC, SEC, TRU, UIX, VER). 23 requisitos, um por AC, em cinco histórias: pedido (5), prévia (5), aprovação (6), undo (4), teclado e idioma (3). `validate_spec.py` sai **0, com 0 erros e 0 avisos**.
>
> **Os valores concretos saíram do código, não de suposição.** O limite de 20 pedidos por minuto é o `DEFAULT_AI_RUN_RATE_LIMIT` de `routes.ts`; as quatro listas do diff (`added`, `removed`, `moved`, `modified`) mais `metadataChanged` são o `PreviewSummary` real; o 409 é o `StaleRevisionError` de `applyPatch.ts`; os motivos do limiar (`removal`, `element_count`, `outside_selection`) e a fronteira estrita de 50 elementos são o `computeApprovalThreshold` de `preview.ts`; o `snapshot.id` do undo é o `pre_ai` que `approveAiRun` devolve.
>
> **Duas decisões de produto registradas como assumption, não escondidas na prosa:** (1) o dock exige clique de aprovação em **todo** run, inclusive quando `requiresExplicitApproval` vem `false` — o limiar do servidor e o consentimento do usuário passam a ser duas travas independentes; (2) o run não sobrevive a recarregar a página, porque o patch pendente vive no `RunStore` em memória e só a linha do run está em Postgres. A segunda virou edge case explícito: run em `awaiting_approval` sem patch no servidor é tratado como expirado, nunca como aprovável.
>
> **Achado — inconsistência de atribuição com o roadmap de T16.** O undo precisa de `POST /diagrams/{id}/snapshots/{snapshotId}:restore`, que `ui-roadmap.md` atribui a R6, enquanto a entrada R1 lá declara 2 rotas. A spec do dock resolve declarando a atribuição do roadmap como **dono primário e não exclusividade**, e lista as 4 rotas que consome de fato. Não foi corrigido em `ui-roadmap.md` porque isso está fora do `Where` desta task.
>
> **Achado — `reasons` não trafega.** `computeApprovalThreshold` calcula os três motivos e `attachPreview` os devolve, mas o handler de `POST /diagrams/{id}/ai/runs` só coloca `requiresExplicitApproval` no corpo. O dock exibe o aviso sem detalhar o motivo, e expor `reasons` ficou declarado como escopo de R15 em vez de virar mudança de servidor nesta fatia.

**Status**: ✅ Complete

**Tests**: none
**Gate**: build

**Commit**: `docs(ai-dock): specify the AI dock as the first product vertical slice`

---

### Phase 5 — Correções da rodada 1 de verificação

> Origem: `.specs/features/platform-maturity/validation.md` (Verifier independente, veredito FAIL). A lacuna 3 do relatório (job `e2e` contra o stack do compose, CIQ-03) está **fora desta rodada** por decisão do usuário e não tem task aqui.

#### T18: Varrer todas as rotas registradas, não só as dos módulos

**What**: Ampliar a raiz de varredura do extrator de rotas para todo `apps/server/src`, de modo que as rotas registradas fora de `modules/` entrem no inventário.
**Where**: `tools/repo-tools/src/serverRoutes.ts`, `tools/repo-tools/src/serverRoutes.spec.ts`
**Depends on**: None
**Reuses**: `extractServerRoutes` (T2) e sua exclusão de `*.spec.ts`
**Requirement**: UIX-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A varredura cobre todo `apps/server/src`, e não apenas `apps/server/src/modules`
- [x] `*.spec.ts` e `*.int.spec.ts` continuam excluídos, para que rotas de fixture nunca entrem no inventário
- [x] Teste de regressão assevera que `GET /health/live`, `GET /health/ready` e `GET /metrics` — registradas em `apps/server/src/core/server.ts` — aparecem no resultado contra o repositório real, nomeadamente e não só por contagem
- [x] Contra o repositório real o extrator encontra pelo menos as 82 rotas hoje registradas, e pelo menos uma delas vem de fora de `apps/server/src/modules` — a contagem exata (82) é conferida de forma independente
- [x] Gate check passa: `make test-unit`
- [x] Test count: 9 testes passam em `serverRoutes.spec.ts`, 34 no package (era 6 e 31) — sem deleção silenciosa

> **A raiz de varredura era uma suposição, não um fato.** `MODULES_DIR = 'apps/server/src/modules'` virou `SERVER_SOURCE_DIR = 'apps/server/src'`. Contagem independente por `grep -rE "\bapp\.(get|post|put|patch|delete|head|options)\(" apps/server/src --include='*.ts' | grep -v '.spec.ts'`: **82** linhas, e o extrator devolve exatamente 82. As 3 rotas que faltavam são `GET /health/live`, `GET /health/ready` e `GET /metrics`, todas em `apps/server/src/core/server.ts` — nenhuma outra rota vive fora de `modules/`.
>
> **O teste de regressão nomeia as três rotas, não conta.** Uma asserção de contagem sozinha (`>= 48`) ficou verde durante toda a onda F6 com a raiz errada; é exatamente o que `validation.md` aponta. O piso de contagem subiu de 48 para 82 e ganhou um teste que assevera as três rotas por método, path e arquivo.
>
> **Cobertura.** Ampliar a raiz apagou um ramo antes coberto em `listSourceFiles` (144→143 ramos no package) e derrubou o piso de 83,33% por 0,12 ponto. Coberto com teste, não baixando o limiar: raiz de varredura ausente devolve lista vazia em vez de lançar. Package fecha em 92,75/84,13/100/92,75 contra o piso 92,2/83,33/100/92,2.

**Status**: ✅ Complete

**Tests**: unit
**Gate**: quick

**Commit**: `fix(repo-tools): scan the whole server source tree for registered routes`

---

#### T19: Exigir que a superfície declarada seja um módulo de UI de verdade

**What**: Endurecer `checkCapabilityMap` para que `ui_surface` só seja aceita quando aponta para um módulo `.tsx`/`.ts` de componente sob `apps/web/src` — não um arquivo de tradução, JSON ou outro ativo que não é superfície.
**Where**: `tools/repo-tools/src/capabilityMap.ts`, `tools/repo-tools/src/capabilityMap.spec.ts`
**Depends on**: None
**Reuses**: `checkCapabilityMap` (T6) e o formato de violação `{ entry, problem }`
**Requirement**: TRU-02, TRU-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Uma entrada cuja `ui_surface` existe em disco sob `apps/web/src` mas não é módulo de componente (por exemplo `apps/web/src/i18n/locales/en/translation.json`) é reportada como violação nomeando a entrada e o caminho
- [ ] Arquivos de locale continuam rejeitados mesmo com extensão de módulo
- [ ] Arquivos de teste (`*.spec.ts`, `*.spec.tsx`) e declarações (`*.d.ts`) não contam como superfície
- [ ] As superfícies reais hoje declaradas em `docs/capability-map.yaml` continuam aceitas — a checagem contra o mapa real segue sem violação
- [ ] Mutante M6 do `validation.md` morre: repontar `Recuperação após crash do navegador` para `apps/web/src/i18n/locales/en/translation.json` faz a suíte falhar
- [ ] Gate check passa: `make test-unit`

**Status**: ⬜ Pending

**Tests**: unit
**Gate**: quick

**Commit**: `fix(repo-tools): require a declared UI surface to be a real component module`

---

#### T20: Falhar quando um package novo não declarar piso de cobertura

**What**: Checagem que enumera os packages do workspace e falha quando algum expõe `test:unit` sem declarar `coverage.thresholds`, ligada ao comando `audit` e portanto ao job `capability-audit`.
**Where**: `tools/repo-tools/src/coverageFloors.ts`, `tools/repo-tools/src/coverageFloors.spec.ts`, `tools/repo-tools/src/cli.ts`, `tools/repo-tools/src/cli.spec.ts`
**Depends on**: None
**Reuses**: a CLI `runAudit` (T7) e os 12 `vitest.config.ts` com piso declarado em T8
**Requirement**: CIQ-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Todo package do workspace com script `test:unit` e sem bloco `coverage.thresholds` é reportado nomeando o package
- [ ] Package sem `test:unit` não é exigido — `packages/database` continua legítimo
- [ ] Edge case coberto: package com `test:unit` e nenhum `vitest.config.ts` falha exigindo a declaração, em vez de passar em silêncio
- [ ] `runAudit` sai diferente de zero quando existe qualquer package sem piso, imprimindo cada um
- [ ] Executado contra o repositório real, nenhum package viola — os 12 já declaram piso
- [ ] Gate check passa: `make test-unit`

**Status**: ⬜ Pending

**Tests**: unit
**Gate**: quick

**Commit**: `feat(repo-tools): fail when a workspace package declares no coverage floor`

---

#### T21: Propagar a contagem corrigida de rotas

**What**: Regerar o inventário com o extrator corrigido e atualizar o número publicado em toda superfície de documentação que o repetia.
**Where**: `docs/route-inventory.md`, `docs/capability-map.yaml`, `README.md`, `docs/architecture-overview.html`
**Depends on**: T18
**Reuses**: `pnpm --filter @arch-canvas/repo-tools run audit` como única fonte dos números
**Requirement**: TRU-04, UIX-01, UIX-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `docs/route-inventory.md` regenerado pela CLI, sem edição à mão
- [ ] `README.md`, `docs/architecture-overview.html` e o cabeçalho de `docs/capability-map.yaml` trazem a contagem corrigida
- [ ] O invariante `consumidas + pendentes == total` é visivelmente verdadeiro em cada lugar onde os três números aparecem
- [ ] `pnpm --filter @arch-canvas/repo-tools run audit` sai zero
- [ ] Gate check passa: `make ci` — ver nota de ambiente em T1

**Status**: ⬜ Pending

**Tests**: none
**Gate**: build

**Commit**: `docs(inventory): publish the corrected registered-route count`

---

#### T22: Corrigir a afirmação superestimada e a rastreabilidade

**What**: Reescrever a frase que atribui ao CI mais do que ele checa e fechar a linha de rastreabilidade de CIQ-07.
**Where**: `README.md`, `docs/architecture-overview.html`, `.specs/features/platform-maturity/spec.md`
**Depends on**: None
**Reuses**: o comportamento real de `repo-tools audit` (T7) como limite do que pode ser afirmado
**Requirement**: TRU-04, CIQ-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A frase do README deixa de afirmar que a distinção não depende de disciplina de quem escreve documentação e passa a declarar exatamente o que a auditoria checa: o mapa contra o código
- [ ] A frase equivalente da landing recebe a mesma correção, por ser a mesma afirmação
- [ ] `spec.md` marca CIQ-07 como `Implementing`, não `Pending`, já que T13 entregou `.github/renovate.json`
- [ ] Nenhum número ou outra afirmação é alterado nesta task
- [ ] Gate check passa: `make ci` — ver nota de ambiente em T1

**Status**: ⬜ Pending

**Tests**: none
**Gate**: build

**Commit**: `docs(readme): claim only what the capability audit enforces`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

Phase 1:  T1 → T2 → T4
          T1 → T3 → T4
Phase 2:  T5 → T6 → T7
Phase 3:  T8, T9, T10, T11, T12, T13 (sem dependência entre si)
Phase 4:  T14, T15 (independentes)
          T16 → T17
Phase 5:  T18 → T21
          T19, T20, T22 (independentes)
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
| T18: Raiz de varredura do extrator | 1 função | ✅ Granular |
| T19: Relevância da superfície declarada | 1 função | ✅ Granular |
| T20: Piso de cobertura obrigatório | 1 função + o wiring da CLI | ✅ Granular |
| T21: Propagação da contagem | 1 artefato regerado + as 3 superfícies que o citam | ⚠️ Coeso — um número único replicado, não deliverables distintos |
| T22: Afirmação e rastreabilidade | 1 frase + 1 linha de tabela | ✅ Granular |

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
| T18 | None | — | ✅ Match |
| T19 | None | — | ✅ Match |
| T20 | None | — | ✅ Match |
| T21 | T18 | T18 → T21 | ✅ Match |
| T22 | None | — | ✅ Match |

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
| T18 | Lógica de ferramenta | unit | unit | ✅ OK |
| T19 | Lógica de ferramenta | unit | unit | ✅ OK |
| T20 | Lógica de ferramenta | unit | unit | ✅ OK |
| T21 | Artefato de dados + documentação | none | none | ✅ OK |
| T22 | Documentação + spec | none | none | ✅ OK |

Todo `Tests: none` corresponde a uma linha da matriz que exige `none` — nenhum é adiamento de teste. As tasks de workflow, que não têm suíte possível, compensam com reprodução local declarada no `Done when`; T8, T10 e T12 vão além e exigem sensor de discriminação (quebrar de propósito e confirmar que o portão pega).
