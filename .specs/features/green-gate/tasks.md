# Gate verde Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: skipped — nenhuma decisão arquitetural nova: um teste passa a asseverar invariante em
vez de contagem, um pacote ganha alvo próprio, e dois jobs de CI existentes são estendidos. As
decisões com alternativa real estão em `spec.md`'s Assumptions.
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Extrator de consumidores de rota | unit | GATE-02 e o edge case de zero consumidores: formato de cada consumidor, ausência de duplicata, todo consumidor apontando rota registrada, e falha explícita se o extrator devolver conjunto vazio | `tools/repo-tools/src/webConsumers.spec.ts` | `pnpm -w test:unit` |
| Suíte de integração padrão | integration | GATE-03: roda inteira num host sem cluster Postgres instalado, sem erro de spawn | `apps/server/src/**/*.int.spec.ts` | `make test-integration` |
| Suíte de integração de backup | integration | Continua cobrindo criação, verificação e restore, agora em alvo próprio com Postgres real | `infra/backup/src/*.int.spec.ts` | `pnpm --filter @arch-canvas/backup run test:integration` |
| Workflow de CI | none | GATE-06/07/08 dependem de evento real de push; a verificação é a execução do próprio workflow, não um teste local. Confirmado aqui como `none` de propósito — mesma limitação já registrada para os jobs de CI de F6 e F8. | `.github/workflows/ci.yaml` | execução do workflow |
| `Makefile` (alvos) | none | Um alvo de Make é verificado pela sua própria execução: o `Done when` de T3 exige `make ci` saindo 0 e `make test-integration` saindo 0 num host sem cluster. Confirmado aqui como `none` de propósito. | `Makefile` | `make ci` |
| Documentação (ADR, `CLAUDE.md`) | none | Prosa não tem asserção automatizável — é o residual de F7 já registrado em `STATE.md`. A verificação é a execução do comando que a prosa afirma. Confirmado aqui como `none` de propósito. | `docs/adr/`, `CLAUDE.md` | `make ci` |
| Smoke do compose | none | GATE-09..12 exigem o stack de pé, que não sobe neste ambiente; a verificação é a execução do job. Confirmado aqui como `none` de propósito. | `.github/workflows/ci.yaml` | job `compose-smoke` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois da última task, antes do Verifier | `make ci` |

---

## Execution Plan

### Phase 1: Gate local

```
T1
T2 -> T3
```

### Phase 2: CI

```
T3 -> T4
T4 -> T5
```

### Phase 3: Fechamento

```
T2 -> T6
T1 -> T7
T3 -> T7
```

---

## Task Breakdown

### T1: Teste de consumidores de rota asseverando invariante

**What**: Substitui a asserção `toHaveLength(4)` — que quebrou quando a interface passou a consumir
53 rotas — por invariantes que não envelhecem: todo consumidor tem caminho começando com `/`,
nenhum consumidor está duplicado, todo caminho consumido corresponde a uma rota registrada, e o
conjunto extraído nunca é vazio.
**Where**: `tools/repo-tools/src/webConsumers.spec.ts`
**Depends on**: None
**Reuses**: `serverRoutes.ts`, que já provê o conjunto de rotas registradas para comparação.
**Requirement**: GATE-01, GATE-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Nenhuma asserção de contagem literal de rotas permanece no arquivo
- [ ] Um consumidor apontando para uma rota inexistente reprova o teste
- [ ] Um conjunto vazio de consumidores reprova o teste
- [ ] `pnpm --filter @arch-canvas/repo-tools run test:unit` sai 0
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `test(repo-tools): assert route-consumer invariants instead of a frozen count`

---

### T2: `infra/backup` em alvo de integração próprio

**What**: Move os testes de integração de `infra/backup` para um script próprio
(`test:integration:backup`), deixando `test:integration` do pacote vazio ou ausente, de modo que a
suíte padrão do workspace deixe de tentar subir um cluster Postgres real num host que não tem um.
Nenhum teste é removido, pulado ou enfraquecido — apenas passam a ser invocados por outro alvo.
**Where**: `infra/backup/package.json`
**Depends on**: None
**Reuses**: `vitest.integration.config.ts` do próprio pacote, inalterado.
**Requirement**: GATE-03, GATE-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `pnpm --filter @arch-canvas/backup run test:integration:backup` executa exatamente os mesmos testes de antes
- [ ] Nenhum teste foi pulado, desativado ou teve asserção enfraquecida
- [ ] `pnpm -w test:integration` deixa de invocar os testes de backup
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: integration
**Gate**: full

**Commit**: `build(backup): move the cluster-dependent integration tests to their own target`

---

### T3: Alvo de Make para a suíte de backup

**What**: Acrescenta `test-integration-backup` ao `Makefile`, documentando na descrição que ele
exige um Postgres real e não roda sob a promessa de PGlite da ADR-0007. `make ci` continua chamando
apenas a suíte padrão.
**Where**: `Makefile`
**Depends on**: T2
**Reuses**: o padrão de alvo com `check-pnpm` já usado por todos os alvos de teste.
**Requirement**: GATE-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `make help` lista o alvo novo com descrição que nomeia o requisito de Postgres real
- [ ] `make test-integration` num host sem cluster Postgres sai 0
- [ ] `make ci` num checkout limpo com Node 22 sai 0
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `build(make): add a dedicated target for the cluster-dependent backup suite`

---

### T4: Job de CI para a suíte de backup

**What**: Acrescenta ao workflow um job que roda `test-integration-backup` com o serviço Postgres
disponível, de modo que a cobertura de backup continue exercitada em cada push. O job não usa
`continue-on-error`.
**Where**: `.github/workflows/ci.yaml`
**Depends on**: T3
**Reuses**: a definição de serviço Postgres já usada pelo job de integração e pelo workflow de
restore drill.
**Requirement**: GATE-06, GATE-07, GATE-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O job novo roda a suíte de backup contra o serviço Postgres
- [ ] Nenhum job de teste do workflow tem `continue-on-error`
- [ ] O job de integração existente deixa de falhar por causa de backup
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `ci: run the backup integration suite in a dedicated job`

---

### T5: Smoke do compose exercita o produto

**What**: Estende o job de smoke: além de `/health/ready`, executa o primeiro acesso pela porta
pública, autentica com as credenciais criadas e lê a lista de workspaces, falhando e nomeando o
caminho sempre que uma resposta vier com `content-type` de HTML. É o que impede que uma borda mal
roteada volte a passar como saudável.
**Where**: `.github/workflows/ci.yaml`
**Depends on**: T4
**Reuses**: o job de smoke existente e as rotas de primeiro acesso entregues em R19.
**Requirement**: GATE-09, GATE-10, GATE-11, GATE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O smoke faz `POST /auth/first-run` pela porta pública e recebe `201`
- [ ] O smoke autentica e recebe JSON com cookie de sessão pela porta pública
- [ ] O smoke lê a lista de workspaces e encontra o workspace criado no primeiro acesso
- [ ] Uma resposta com `content-type` de HTML reprova o job nomeando o caminho
- [ ] Uma segunda execução contra o mesmo volume usa as credenciais já criadas em vez de falhar
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `ci: make the compose smoke exercise first-run, login and workspace listing`

---

### T6: Emenda à ADR-0007

**What**: Registra na própria ADR-0007 que a promessa "integração roda em PGlite sem Docker" não
cobre `infra/backup`, que depende de `pg_dump` e de um cluster real e por isso passa a ter alvo e
job próprios. A emenda vai na ADR porque a promessa é lida como invariante do projeto.
**Where**: `docs/adr/0007-pglite-for-postgres-integration-tests.md`
**Depends on**: T2
**Reuses**: o formato Status/Data/Contexto/Decisão/Consequências já usado pelas ADRs `0001..0009`.
**Requirement**: GATE-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A ADR nomeia `infra/backup` como exceção explícita e diz por quê
- [ ] A ADR aponta o alvo e o job que passam a cobrir essa suíte
- [ ] O status da ADR permanece `active` — a decisão original não foi revertida, foi delimitada
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: full

**Commit**: `docs(adr): scope ADR-0007 out of the cluster-dependent backup suite`

---

### T7: Remover a armadilha registrada no `CLAUDE.md`

**What**: `CLAUDE.md` documenta hoje que `make ci` não passa neste ambiente e prescreve um gate
substituto. Com T1 e T3 fechadas isso deixa de ser verdade: a task remove a armadilha, restabelece
`make ci` como o gate único e registra o alvo de backup como a única suíte que exige Postgres real.
**Where**: `CLAUDE.md`
**Depends on**: T1, T3
**Reuses**: a própria seção de comandos e de armadilhas de ambiente do arquivo.
**Requirement**: GATE-01, GATE-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A armadilha "`make ci` pode falhar aqui" foi removida, não reescrita com ressalva
- [ ] `make ci` é apresentado como o gate único, e o alvo de backup como a exceção nomeada
- [ ] A armadilha de Node 22 permanece, porque continua verdadeira
- [ ] `make ci` sai 0 num checkout limpo, confirmado antes do commit
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs: restore make ci as the single gate now that it passes`
