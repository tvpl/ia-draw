# Platform Maturity — Tasks (Onda F8: Governança e contrato)

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/platform-maturity/design.md` (F8 section — OpenAPI generation approach, evals threshold, GOV decisions)
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling (`tools/repo-tools/src/*.spec.ts`, `apps/server/src/modules/*/*.spec.ts`) and `package.json` scripts. Guidelines found: none as a standalone `AGENTS.md`/`CONTRIBUTING.md` — conventions inferred from the existing test suite (760+ unit tests, PGlite integration tests per ADR-0007) and confirmed against F6/F7's own matrices in this feature dir.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| `tools/repo-tools` generator/audit logic (pure functions) | unit | All branches; 1:1 to spec ACs (API-01/02); every listed edge case (empty doc, divergent route, missing schema) | `tools/repo-tools/src/*.spec.ts` | `pnpm --filter @arch-canvas/repo-tools run test:unit` |
| `apps/server/src/openapi/*` (doc builder, threshold checker) | unit | All branches; 1:1 to spec ACs (API-01/03) | `apps/server/src/openapi/**/*.spec.ts`, `apps/server/src/modules/ai-engine/evals/*.spec.ts` | `pnpm --filter @arch-canvas/server run test:unit` |
| `routeSchemas` exports per module (metadata only, no new logic) | none | build gate only — correctness proven by the Phase 3 audit extension (cross-checks against real registered routes), not a per-module unit test | `apps/server/src/modules/*/routes.ts` | build gate only |
| CI workflow changes (`.github/workflows/ci.yaml`) | none | build gate only — cannot be unit-tested locally (depends on a real PR event: `base.sha`/`head.sha`), same limitation already logged in `STATE.md` for F6's CI jobs | `.github/workflows/ci.yaml` | `make lint` (YAML is biome-checked) |
| Governance docs/config (`CODEOWNERS`, PR template, `.changeset/config.json`, ADR template, `CLAUDE.md` note, `STATE.md` format) | none | build gate only | `CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `.changeset/*`, `docs/adr/TEMPLATE.md`, `CLAUDE.md`, `.specs/STATE.md` | build gate only |

**Coverage Expectation defaults applied**: the three pieces of real logic this wave introduces (the OpenAPI builder, the audit's route-parity check, the eval-threshold checker) get full branch coverage 1:1 to the ACs they implement; everything else is metadata/config with no behavior of its own, gated by build/lint plus the Phase 3 cross-check that proves the metadata matches reality.

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks touching only one package's unit tests | `pnpm --filter <pkg> run test:unit` |
| Full | After tasks touching CI wiring or cross-package behavior (Phase 3, Phase 4) | `make lint && make typecheck && make test-unit` |
| Build | Config/docs-only tasks (Phase 5, most of Phase 2) | `make lint` (biome parses JSON/YAML/MD structure; catches syntax errors) |

`/gate` (`.claude/commands/gate.md`, shipped in F7) wraps the Full level, including the documented sandbox fallback when `make ci` can't reach `pg_lsclusters`/`redis-server`.

---

## Execution Plan

Phases are ordered and run sequentially — each phase completes before the next begins, and tasks within a phase execute in order. **Every task's `Depends on` is exactly its immediate predecessor in this ordering** (or `None` for the two genuine starting points, T1 and T26) — this wave has no non-adjacent dependencies, so the execution order and the dependency graph are the same thing, kept deliberately simple to avoid drift between the two.

### Phase 1: Fundação do gerador OpenAPI (API-01)

```
T1 → T2 → T3 → T4
```

### Phase 2a: `routeSchemas` — lote 1 (6 módulos)

```
T4 → T5 → T6 → T7 → T8 → T9 → T10
```

### Phase 2b: `routeSchemas` — lote 2 (6 módulos)

```
T10 → T11 → T12 → T13 → T14 → T15 → T16
```

### Phase 2c: `routeSchemas` — lote 3 (4 módulos)

```
T16 → T17 → T18 → T19 → T20
```

### Phase 2d: `routeSchemas` — lote 4, arquivos fora do padrão `routes.ts` (3 arquivos)

Descoberta durante o Batch 1 (ver nota em T21–T23) — fecha o gap de escopo do `design.md` antes que a Phase 3 tropece nele.

```
T20 → T21 → T22 → T23
```

### Phase 3: Portão de CI do OpenAPI (API-02)

```
T23 → T24 → T25
```

### Phase 4: Limiar de sucesso dos evals de IA (API-03)

Independente de Phase 1-3 (domínio isolado — evals não depende do gerador OpenAPI), mas roda
depois por ordem de execução, não por necessidade real. `T26` começa sem dependência.

```
T26 → T27 → T28
```

### Phase 5: Governança (GOV-01..06)

Cada task é independente das outras (docs/config sem sobreposição de arquivo), executadas em
sequência só por ordem de fase. `T35` (fechamento do handoff) é a única com dependência real —
roda por último porque resume tudo que a onda entregou.

```
T28 → T29 → T30 → T31 → T32 → T33 → T34 → T35
```

---

## Task Breakdown

### T1: `RouteSchemaMap` type

**What**: Define o tipo `RouteSchemaMap` (`Record<"METHOD path", { query?, params?, body?, response?, websocket?: true }>`, todos os campos `ZodType | undefined`) que todo `routes.ts` vai usar pra exportar seus schemas.
**Where**: `apps/server/src/openapi/types.ts`
**Depends on**: None
**Reuses**: nenhum tipo existente (primeira peça nova)
**Requirement**: API-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `RouteSchemaMap` exportado com os 5 campos opcionais
- [x] `websocket?: true` documentado como alternativa a `response` pra rotas de upgrade WS (ws-gateway, T19)
- [x] Sem erros de TypeScript

**Tests**: none
**Gate**: build

---

### T2: Construtor do documento OpenAPI 3.1

**What**: Função `buildOpenApiDocument(registry: Record<string, RouteSchemaMap>): OpenApiDocument` que itera as chaves `"MÉTODO path"`, converte cada schema Zod via `z.toJSONSchema()` (nativo do Zod 4, sem lib nova) e monta `paths`/`components.schemas` de um doc `openapi: "3.1.0"`. Falha (lança erro nomeando o motivo) se o registro estiver vazio — cobre o Edge Case "IF a geração do OpenAPI produzir um documento sem nenhuma rota THEN o CI SHALL falhar".
**Where**: `apps/server/src/openapi/buildDocument.ts`
**Depends on**: T1
**Reuses**: `RouteSchemaMap` (T1)
**Requirement**: API-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Doc gerado é `openapi: "3.1.0"` válido nas chaves obrigatórias (`info`, `paths`)
- [x] Uma rota com `websocket: true` vira uma entrada documentada sem `requestBody`/`responses` JSON forçados (nota explícita no doc, não um schema inventado)
- [x] Registro vazio lança erro citando "nenhuma rota no registro" (não gera doc vazio silenciosamente)
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:unit`
- [x] Test count: 6 novos testes (doc válido; conversão de query/body/response; rota `websocket`; registro vazio falha; múltiplos módulos mesclados; nomes de rota com params `:id` viram `{id}` no path OpenAPI) — +1 teste adicionado durante T10 (ver nota abaixo), total 7

**Tests**: unit
**Gate**: quick

---

### T3: `routeSchemas` piloto em `ai-provider` + registro agregador

**What**: Exporta `routeSchemas: RouteSchemaMap` de `ai-provider/routes.ts` (aponta pros schemas Zod já existentes: `listQuerySchema`, `idParamsSchema`, `createBodySchema`, `updateBodySchema` — mapeados pras 5 rotas reais do módulo) e cria `apps/server/src/openapi/registry.ts`, que importa e mescla `routeSchemas` de cada módulo já convertido (só `ai-provider` por enquanto).
**Where**: `apps/server/src/modules/ai-provider/routes.ts` (modify — só adiciona o export, zero mudança de comportamento)
**Depends on**: T2
**Reuses**: schemas Zod já existentes no arquivo
**Requirement**: API-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `routeSchemas` cobre as 5 rotas reais de `ai-provider` (confirmar contra `app.get/post/patch` no arquivo)
- [x] `apps/server/src/openapi/registry.ts` criado, exporta `registry: Record<string, RouteSchemaMap>` com a entrada `ai-provider`
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:unit`
- [x] Test count: 1 novo teste (`registry['ai-provider']` tem as 5 chaves esperadas)

**Tests**: unit
**Gate**: quick

---

### T4: script `openapi` + wiring no `Makefile`

**What**: `apps/server/package.json` ganha `"openapi": "tsx src/openapi/generate.ts"` (script novo que chama `buildOpenApiDocument(registry)` e escreve `docs/openapi.json` na raiz do repo); `Makefile` ganha `make openapi` chamando `pnpm --filter @arch-canvas/server run openapi`.
**Where**: `apps/server/src/openapi/generate.ts` (novo — CLI entrypoint fino, sem lógica própria além de escrever o arquivo)
**Depends on**: T3
**Reuses**: `buildOpenApiDocument` (T2), `registry` (T3)
**Requirement**: API-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `make openapi` roda e escreve `docs/openapi.json` com a rota de `ai-provider` presente
- [x] `docs/openapi.json` commitado (snapshot inicial, só `ai-provider` — as Phases 2a/b/c vão expandindo o mesmo arquivo)
- [x] Gate check passes: `make lint && make typecheck`

**Tests**: none
**Gate**: build

---

### T5–T10: `routeSchemas` — lote 1 (Phase 2a)

Mesmo padrão de T3 (export `routeSchemas` apontando pros schemas Zod já existentes no arquivo + registrar em `apps/server/src/openapi/registry.ts` + regenerar `docs/openapi.json` via `make openapi`), um módulo por task, cada uma dependendo só da task imediatamente anterior. **Tests: none** (metadata only — a correção real é provada pela Phase 3). **Gate: build** (`make lint && make typecheck && make openapi` sem erro).

| Task | Módulo | Where | Depends on |
| ---- | ------ | ----- | ---------- |
| T5 | `auth` | `apps/server/src/modules/auth/routes.ts` | T4 |
| T6 | `workspace` | `apps/server/src/modules/workspace/routes.ts` | T5 |
| T7 | `asset` | `apps/server/src/modules/asset/routes.ts` | T6 |
| T8 | `snapshot` | `apps/server/src/modules/snapshot/routes.ts` | T7 |
| T9 | `export` | `apps/server/src/modules/export/routes.ts` | T8 |
| T10 | `share` | `apps/server/src/modules/share/routes.ts` | T9 |

**Requirement**: API-01 (cada task)

**Done when** (cada task, T5–T10 status noted individually below):

**T5 (`auth`)**:
- [x] `routeSchemas` cobre toda rota real do módulo (conferir contra `app.get/post/patch/put/delete` no arquivo)
- [x] Entrada adicionada em `apps/server/src/openapi/registry.ts`
- [x] `make openapi` regenera `docs/openapi.json` incluindo as rotas deste módulo, sem erro
- [x] Gate check passes: `make lint && make typecheck`

**T6 (`workspace`)**:
- [x] `routeSchemas` cobre as 9 rotas registradas diretamente em `workspace/routes.ts` (as rotas de `project-diagram-routes.ts`, registradas por um arquivo separado que não é um `routes.ts`, ficam fora da cobertura desta wave — mesmo escopo "os 17 `routes.ts`" do design.md)
- [x] Entrada adicionada em `apps/server/src/openapi/registry.ts`
- [x] `make openapi` regenera `docs/openapi.json` incluindo as rotas deste módulo, sem erro
- [x] Gate check passes: `make lint && make typecheck`

**T7 (`asset`)**:
- [x] `routeSchemas` cobre as 2 rotas reais do módulo (two-phase upload: `:initiate`, `:complete`)
- [x] Entrada adicionada em `apps/server/src/openapi/registry.ts`
- [x] `make openapi` regenera `docs/openapi.json` incluindo as rotas deste módulo, sem erro
- [x] Gate check passes: `make lint && make typecheck`

**T8 (`snapshot`)**:
- [x] `routeSchemas` cobre as 4 rotas reais do módulo (criar/listar snapshots, restore, diff)
- [x] Entrada adicionada em `apps/server/src/openapi/registry.ts`
- [x] `make openapi` regenera `docs/openapi.json` incluindo as rotas deste módulo, sem erro
- [x] Gate check passes: `make lint && make typecheck`

**T9 (`export`)**:
- [x] `routeSchemas` cobre as 4 rotas reais do módulo (exports, bundle, import, bulk bundles)
- [x] Entrada adicionada em `apps/server/src/openapi/registry.ts`
- [x] `make openapi` regenera `docs/openapi.json` incluindo as rotas deste módulo, sem erro
- [x] Gate check passes: `make lint && make typecheck`

**T10 (`share`)**:
- [x] `routeSchemas` cobre as 4 rotas reais do módulo (criar share-link p/ diagrama, p/ apresentação, resolver token, revogar)
- [x] Entrada adicionada em `apps/server/src/openapi/registry.ts`
- [x] `make openapi` regenera `docs/openapi.json` incluindo as rotas deste módulo, sem erro
- [x] Gate check passes: `make lint && make typecheck`
- Nota: `createShareLinkBodySchema` usa `z.coerce.date()`, que `z.toJSONSchema()` não representa por padrão (lança erro) — corrigido em `buildDocument.ts` (T2) com `unrepresentable: 'any'`, commit separado antes deste.

---

### T11–T16: `routeSchemas` — lote 2 (Phase 2b)

Mesmo padrão. **Tests: none**. **Gate: build**.

| Task | Módulo | Where | Depends on |
| ---- | ------ | ----- | ---------- |
| T11 | `comment` | `apps/server/src/modules/comment/routes.ts` | T10 |
| T12 | `diagram-sync` | `apps/server/src/modules/diagram-sync/routes.ts` | T11 |
| T13 | `docgen` | `apps/server/src/modules/docgen/routes.ts` | T12 |
| T14 | `interop` | `apps/server/src/modules/interop/routes.ts` | T13 |
| T15 | `library` | `apps/server/src/modules/library/routes.ts` | T14 |
| T16 | `lint` | `apps/server/src/modules/lint/routes.ts` | T15 |

**Requirement**: API-01 (cada task)
**Done when** (cada task): idêntico ao bloco T5–T10.

**T11 (`comment`)**:
- [x] `routeSchemas` cobre toda rota real do módulo (conferir contra `app.get/post/patch/put/delete` no arquivo) — 3 rotas (`POST`/`GET /diagrams/:id/comments`, `PATCH /diagrams/:id/comments/:commentId`)
- [x] Entrada adicionada em `apps/server/src/openapi/registry.ts`
- [x] `make openapi` regenera `docs/openapi.json` incluindo as rotas deste módulo, sem erro
- [x] Gate check passes: `make lint && make typecheck`

---

### T17–T20: `routeSchemas` — lote 3 (Phase 2c)

Mesmo padrão, com uma exceção anotada: **T19 (`ws-gateway`)** tem uma única rota, e é upgrade WebSocket (`{ websocket: true }`), não REST/JSON — sua entrada em `routeSchemas` usa `{ websocket: true }` (T1's campo dedicado) em vez de inventar um schema de request/response que não existe. **Tests: none**. **Gate: build**.

| Task | Módulo | Where | Depends on |
| ---- | ------ | ----- | ---------- |
| T17 | `presentation` | `apps/server/src/modules/presentation/routes.ts` | T16 |
| T18 | `webhook` | `apps/server/src/modules/webhook/routes.ts` | T17 |
| T19 | `ws-gateway` | `apps/server/src/modules/ws-gateway/routes.ts` | T18 |
| T20 | `ai-engine` | `apps/server/src/modules/ai-engine/routes.ts` | T19 |

**Requirement**: API-01 (cada task)
**Done when** (cada task): idêntico ao bloco T5–T10 (T19 usa `{ websocket: true }` em vez de schemas JSON).

---

### T21–T23: `routeSchemas` — lote 4, arquivos de rota fora do padrão `routes.ts` (Phase 2d)

**Descoberto durante a execução do Batch 1** (T6): `extractServerRoutes` (o extrator que o F6 já usa e que a Phase 3 desta onda reusa em T24) escaneia **toda** a árvore de `apps/server/src`, não só arquivos chamados `routes.ts` — o commit `2757437` (F6) já fixou isso de propósito. `design.md` tinha escopado F8 aos "17 `routes.ts`", o que ficou incompleto: existem 3 arquivos a mais que registram rotas reais fora desse padrão de nome, encontrados só quando o Batch 1 leu `workspace/routes.ts` por completo e notou que o módulo tinha rotas a mais do que as 9 documentadas ali. Sem esta fase, T25 (Phase 3, paridade de auditoria) falharia citando essas rotas como "sem entrada no OpenAPI" — mais barato fechar o gap agora do que descobrir isso como um "bug" na Phase 3.

Mesmo padrão de T5–T10 (export `routeSchemas` + registrar em `apps/server/src/openapi/registry.ts` + regenerar `docs/openapi.json`). **Tests: none**. **Gate: build**.

| Task | Arquivo | Rotas | Chave no registry | Where | Depends on |
| ---- | ------- | ----- | ------------------ | ----- | ---------- |
| T21 | `apps/server/src/core/server.ts` | 3 (`/health/live`, `/health/ready`, `/metrics` — sem query/body, entradas vazias em `routeSchemas`) | `core` | `apps/server/src/core/server.ts` (modify) | T20 |
| T22 | `apps/server/src/modules/presentation/publishRoutes.ts` | 3 | `presentation-publish` (distinta de `presentation`, já coberta em T17) | `apps/server/src/modules/presentation/publishRoutes.ts` (modify) | T21 |
| T23 | `apps/server/src/modules/workspace/project-diagram-routes.ts` | 10 | `workspace-project-diagram` (distinta de `workspace`, já coberta em T6) | `apps/server/src/modules/workspace/project-diagram-routes.ts` (modify) | T22 |

**Requirement**: API-01 (cada task)

**Done when** (cada task):
- [ ] `routeSchemas` cobre toda rota real do arquivo (conferir contra `app.get/post/patch/put/delete`)
- [ ] Entrada adicionada em `apps/server/src/openapi/registry.ts` com a chave listada acima (não colide com a chave do módulo `routes.ts` irmão)
- [ ] `make openapi` regenera `docs/openapi.json` incluindo estas rotas, sem erro
- [ ] Gate check passes: `make lint && make typecheck`

---

### T24: extensão do `repo-tools audit` — paridade de rotas do OpenAPI

**What**: Nova função `checkOpenApiParity(sourceRoot)` em `tools/repo-tools`, chamada por `runAudit` junto de `checkCapabilityMap`/`checkCoverageFloors`: lê `docs/openapi.json`, cruza suas chaves de rota contra `extractServerRoutes(sourceRoot)` (já existe) e retorna uma violação nomeada pra cada rota real sem entrada no OpenAPI e pra cada entrada do OpenAPI sem rota real correspondente.
**Where**: `tools/repo-tools/src/openApiParity.ts`
**Depends on**: T23
**Reuses**: `extractServerRoutes` (já existe, `tools/repo-tools/src/serverRoutes.ts`)
**Requirement**: API-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Rota real sem entrada no OpenAPI → violação nomeando a rota exata
- [ ] Entrada do OpenAPI sem rota real → violação nomeando a entrada exata
- [ ] `docs/openapi.json` ausente ou sem nenhuma rota → violação explícita (cobre o Edge Case do spec.md)
- [ ] Wired em `runAudit` (`tools/repo-tools/src/cli.ts`) — `/audit` agora cobre TRU-03/UIX-01 (F6) + CIQ-04 (F6) + API-02 (F8) num único comando
- [ ] Gate check passes: `pnpm --filter @arch-canvas/repo-tools run test:unit`
- [ ] Test count: 4 novos testes (rota sem schema; schema sem rota; doc vazio; caso limpo passa)

**Tests**: unit
**Gate**: quick

---

### T25: job de CI — regenerar e comparar `docs/openapi.json`

**What**: Adiciona um step ao job `capability-audit` existente (`.github/workflows/ci.yaml`): roda `make openapi`, depois `git diff --exit-code docs/openapi.json` (falha nomeando o arquivo se divergir do commitado — mesmo padrão de erro que TRU-03 já usa pro `route-inventory.md`), depois `pnpm --filter @arch-canvas/repo-tools run audit` (agora cobre a paridade de T24).
**Where**: `.github/workflows/ci.yaml` (modify — um step novo dentro do job `capability-audit`)
**Depends on**: T24
**Reuses**: job `capability-audit` já existente (F6)
**Requirement**: API-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Step novo roda `make openapi && git diff --exit-code docs/openapi.json`
- [ ] Step roda `pnpm --filter @arch-canvas/repo-tools run audit` na sequência
- [ ] `make lint` confirma o YAML bem formado (biome cobre `.github/workflows/*.yaml`)
- [ ] Não pode ser testado localmente contra um evento real de PR (mesma limitação já registrada em `STATE.md` pra outros jobs de CI) — verificado manualmente rodando os dois comandos do step em sequência neste ambiente

**Tests**: none
**Gate**: build

---

### T26: checker de limiar de sucesso dos evals

**What**: Função pura `checkEvalThreshold(results: { passed: boolean }[], threshold: number): { rate: number; ok: boolean }` — calcula `passed.length / results.length`, compara contra `threshold`. Constante `EVAL_SUCCESS_THRESHOLD = 1.0` (100% — a suíte é 100% determinística hoje, ver `design.md`).
**Where**: `apps/server/src/modules/ai-engine/evals/threshold.ts`
**Depends on**: None (Phase 4 é um domínio independente de Phase 1-3, ver nota da Execution Plan)
**Reuses**: nenhum
**Requirement**: API-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `checkEvalThreshold` retorna `rate` e `ok` corretos pra taxa acima/igual/abaixo do limiar
- [ ] `EVAL_SUCCESS_THRESHOLD` exportado e documentado (comentário explica por que é 100% hoje)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/server run test:unit`
- [ ] Test count: 4 novos testes (100% passa; abaixo do limiar falha `ok`; limiar customizado; lista vazia não divide por zero)

**Tests**: unit
**Gate**: quick

---

### T27: script `runThresholdCheck` sobre a suíte de evals existente

**What**: Script CLI fino que roda `evals.spec.ts` via Vitest com reporter JSON, lê o resultado e chama `checkEvalThreshold` (T26), imprimindo "X/Y evals passed, limiar Z%" e saindo com código não-zero se `ok` for falso. Não reescreve a suíte existente (`evals.spec.ts`, T57) — só a envolve.
**Where**: `apps/server/src/modules/ai-engine/evals/runThresholdCheck.ts`
**Depends on**: T26
**Reuses**: `checkEvalThreshold` (T26), suíte `evals.spec.ts` já existente (T57)
**Requirement**: API-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Rodar o script localmente contra a suíte real imprime "10/10 evals passed, limiar 100%" e sai 0
- [ ] Um cenário simulado abaixo do limiar (teste unitário injetando um resultado fake) sai não-zero com a mesma mensagem citando a taxa real
- [ ] Gate check passes: `pnpm --filter @arch-canvas/server run test:unit`
- [ ] Test count: 2 novos testes (saída 0 com resultado 100%; saída não-zero com resultado abaixo do limiar, mensagem cita taxa e limiar)

**Tests**: unit
**Gate**: quick

---

### T28: job de CI dedicado "AI evals"

**What**: Novo job `ai-evals` em `.github/workflows/ci.yaml`, rodando `runThresholdCheck` (T27) isolado dos outros testes unitários — nome próprio no CI, distinguível de uma falha genérica de `test:unit`.
**Where**: `.github/workflows/ci.yaml` (modify — job novo)
**Depends on**: T27
**Reuses**: `runThresholdCheck.ts` (T27)
**Requirement**: API-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Job `ai-evals` roda `runThresholdCheck` e falha citando a taxa/limiar se abaixo, nunca só "testes falharam"
- [ ] `make lint` confirma o YAML bem formado
- [ ] Verificado manualmente rodando o job localmente (`act` não disponível neste ambiente — rodar o comando do step diretamente, mesma limitação de evento real de PR já registrada)

**Tests**: none
**Gate**: build

---

### T29: `CODEOWNERS`

**What**: Declara dono (`@tvpl` — único colaborador real do repo hoje, confirmado via `gh api repos/tvpl/ia-draw/collaborators`; troca por time real quando squads existirem, decisão já registrada no `spec.md`) pra cada domínio de primeiro nível: `apps/server/`, `apps/web/`, `packages/`, `infra/`, `.github/`, `docs/`, `.specs/`.
**Where**: `CODEOWNERS` (raiz)
**Depends on**: T28
**Reuses**: nenhum
**Requirement**: GOV-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Todo domínio de primeiro nível tem uma linha de dono — nenhum sem dono
- [ ] `make lint` confirma o arquivo bem formado (biome trata `CODEOWNERS` como texto genérico, sem erro)

**Tests**: none
**Gate**: build

---

### T30: template de Pull Request

**What**: `.github/PULL_REQUEST_TEMPLATE.md` com campos obrigatórios: IDs de requisito afetados, link pra spec correspondente, checklist confirmando que `/gate` (F7) rodou antes do PR.
**Where**: `.github/PULL_REQUEST_TEMPLATE.md`
**Depends on**: T29
**Reuses**: `.claude/commands/gate.md` (F7, referenciado no checklist)
**Requirement**: GOV-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Campo "Requirement IDs" presente e obrigatório (marcado como tal no texto)
- [ ] Campo "Spec link" presente
- [ ] Checklist inclui `/gate` rodado

**Tests**: none
**Gate**: build

---

### T31: Changesets — config

**What**: `@changesets/cli` como devDependency da raiz; `.changeset/config.json` com `"access": "restricted"` (nunca publica no npm — todo `packages/*` já é `"private": true`, ver `design.md`).
**Where**: `.changeset/config.json`
**Depends on**: T30
**Reuses**: nenhum
**Requirement**: GOV-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `.changeset/config.json` válido, `access: restricted`
- [ ] `@changesets/cli` instalado como devDependency da raiz
- [ ] `make lint` confirma JSON bem formado

**Tests**: none
**Gate**: build

---

### T32: portão de CI — changeset obrigatório

**What**: Job novo `changeset-check` em `.github/workflows/ci.yaml` (só roda em `pull_request`, mesmo padrão do job `commit-lint` já existente — usa `BASE_SHA`/`HEAD_SHA` de `github.event.pull_request`): falha nomeando o package se `packages/<nome>/src/**` mudou sem um arquivo novo em `.changeset/`.
**Where**: `.github/workflows/ci.yaml` (modify — job `changeset-check`)
**Depends on**: T31
**Reuses**: padrão do job `commit-lint` já existente
**Requirement**: GOV-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Job novo compara `packages/*/src/**` alterado contra `.changeset/*.md` novo no mesmo PR
- [ ] `make lint` confirma o YAML bem formado
- [ ] Não pode ser testado localmente contra um evento real de PR — mesma limitação já registrada em `STATE.md`

**Tests**: none
**Gate**: build

---

### T33: template de ADR

**What**: `docs/adr/TEMPLATE.md` extraindo o formato já usado por `0001..0009` (Status/Contexto/Decisão/Consequências) — não inventa um formato novo, documenta o existente.
**Where**: `docs/adr/TEMPLATE.md`
**Depends on**: T32
**Reuses**: `docs/adr/0001-server-first-op-log-lww.md` como referência de formato
**Requirement**: GOV-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Template tem as mesmas seções que `0001..0009` usam
- [ ] `CLAUDE.md` ganha uma linha referenciando o template

**Tests**: none
**Gate**: build

---

### T34: nota GOV-04 (uma spec por domínio) no `CLAUDE.md`

**What**: Uma linha no `CLAUDE.md` (seção "Requisitos e progresso rastreável") confirmando explicitamente o padrão já em uso desde F6 (`ai-dock/spec.md` como exemplar): uma spec por domínio em `.specs/features/`, nunca uma spec monolítica pra múltiplos domínios.
**Where**: `CLAUDE.md` (modify)
**Depends on**: T33
**Reuses**: `ai-dock/spec.md` (F6) como exemplar citado
**Requirement**: GOV-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Linha adicionada, cita `ai-dock` como exemplar real
- [ ] `make lint` limpo

**Tests**: none
**Gate**: build

---

### T35: `STATE.md` — `Handoff` vira `Handoffs` por frente (GOV-06)

**What**: Reestrutura a seção `## Handoff` de `.specs/STATE.md` pra `## Handoffs` (plural), com uma subseção `### <feature-slug> (branch: ...)` por frente ativa — migra o handoff atual (só `platform-maturity`) pro novo formato, provando que funciona com 1 frente e comporta N sem colisão de merge (Edge Case do spec.md). Esta é também a task que fecha a onda F8 — o handoff final de F8 já nasce no formato novo, resumindo tudo entregue nas Phases 1-5.
**Where**: `.specs/STATE.md` (modify)
**Depends on**: T34
**Reuses**: estrutura de `## Decisions` (formato AD-NNN) como referência de "uma entrada versionável por vez" que já funciona bem em merges
**Requirement**: GOV-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `## Handoffs` substitui `## Handoff`, com `### platform-maturity (branch: feature/improvements-2)` como única subseção hoje
- [ ] Conteúdo migrado sem perda (branch, fase, entregas de F8, próximo passo, armadilhas, lições)
- [ ] `python3 .claude/skills/tlc-spec-driven/scripts/validate_state.py platform-maturity` continua saindo 0 (o script não depende do formato exato do Handoff, só do `validation.md`)

**Tests**: none
**Gate**: build

---

## Phase Execution Map

Visual representation of task ordering. Every arrow below has a matching `Depends on` in the task body above, and every `Depends on` above has a matching arrow here — this wave's dependency graph is a single line, split into phase-labeled rows for readability (the boundary task repeats at the start of the next phase's row to show the connecting arrow explicitly; Phase 4 starts a fresh line at T26 because it has no real dependency on Phase 3):

```
Phase 1:   T1 → T2 → T3 → T4
Phase 2a:            T4 → T5 → T6 → T7 → T8 → T9 → T10
Phase 2b:                                        T10 → T11 → T12 → T13 → T14 → T15 → T16
Phase 2c:                                                                    T16 → T17 → T18 → T19 → T20
Phase 2d:                                                                                        T20 → T21 → T22 → T23
Phase 3:                                                                                                          T23 → T24 → T25
Phase 4 (independent):                                                                                                   T26 → T27 → T28
Phase 5:                                                                                                                        T28 → T29 → T30 → T31 → T32 → T33 → T34 → T35
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

**How phase-based execution works:**

At Execute, the agent counts total tasks and packs phases into **task-budgeted batches** (~7 tasks per worker, whole phases). This wave has **35 tasks across 8 phases** (grew from 32/7 mid-execution — Phase 2d was added after Batch 1 found 3 route-registering files outside the `routes.ts` naming pattern; see the note on T21–T23) — well above the ~8-task single-batch threshold, so the sub-agent offer is mandatory here (see [sub-agents.md](../../../.claude/skills/tlc-spec-driven/references/sub-agents.md)). Packing, updated after the addition (Batches 1-2 already dispatched under the original numbering, unaffected since T1-T20 didn't shift):

| Batch | Phases | Tasks | Count |
| ----- | ------ | ----- | ----- |
| 1 | Phase 1 + Phase 2a | T1–T10 | 10 — done |
| 2 | Phase 2b + Phase 2c | T11–T20 | 10 |
| 3 | Phase 2d + Phase 3 + Phase 4 | T21–T28 | 8 |
| 4 | Phase 5 | T29–T35 | 7 |

Batches run sequentially: each worker executes ALL its tasks in order, then reports a compact summary before the next batch starts.

**The orchestrating agent's role during Execute:**
1. Count total tasks and pack phases into ~7-task batches - offer batch sub-agents if that yields more than one batch and the user accepts
2. Dispatch the next batch (to a worker, or execute inline)
3. Receive the compact batch summary
4. Update tasks.md with results
5. If the batch summary shows all tasks complete: proceed to the next batch
6. If a task failed: decide fix/escalate before dispatching the next batch

---

## Task Granularity Check

| Task | Escopo | Status |
| ---- | ------ | ------ |
| T1–T2 | 1 arquivo cada (tipo, depois builder) | ✅ Granular |
| T3–T20 | 1 módulo/arquivo por task (export + registro) | ✅ Granular — 18 tasks quase idênticas, mas cada uma é literalmente "1 file change" (a definição própria de task atômica), e módulos diferentes não podem ser cohesivamente fundidos numa task só sem violar "Where nomeia 1 arquivo" |
| T21–T23 | 1 arquivo por task (mesmo padrão de T3–T20, aplicado aos 3 arquivos de rota fora do padrão `routes.ts` encontrados no Batch 1) | ✅ Granular |
| T24 | 1 arquivo novo (`openApiParity.ts`) + wiring de 2 linhas no `cli.ts` já existente | ✅ Granular (cohesivo — o wiring é parte do mesmo commit da função que ele chama, não um arquivo novo) |
| T25, T28, T32 | 1 arquivo YAML modificado (job/step novo) cada | ✅ Granular |
| T26, T27 | 1 arquivo novo cada (função pura, depois o script que a usa) | ✅ Granular |
| T29, T30, T31, T33, T34, T35 | 1 arquivo cada | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | — (início) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | T11 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | T13 | T13 → T14 | ✅ Match |
| T15 | T14 | T14 → T15 | ✅ Match |
| T16 | T15 | T15 → T16 | ✅ Match |
| T17 | T16 | T16 → T17 | ✅ Match |
| T18 | T17 | T17 → T18 | ✅ Match |
| T19 | T18 | T18 → T19 | ✅ Match |
| T20 | T19 | T19 → T20 | ✅ Match |
| T21 | T20 | T20 → T21 | ✅ Match |
| T22 | T21 | T21 → T22 | ✅ Match |
| T23 | T22 | T22 → T23 | ✅ Match |
| T24 | T23 | T23 → T24 | ✅ Match |
| T25 | T24 | T24 → T25 | ✅ Match |
| T26 | None | — (Phase 4 inicia sozinha, sem arco de entrada) | ✅ Match |
| T27 | T26 | T26 → T27 | ✅ Match |
| T28 | T27 | T27 → T28 | ✅ Match |
| T29 | T28 | T28 → T29 | ✅ Match |
| T30 | T29 | T29 → T30 | ✅ Match |
| T31 | T30 | T30 → T31 | ✅ Match |
| T32 | T31 | T31 → T32 | ✅ Match |
| T33 | T32 | T32 → T33 | ✅ Match |
| T34 | T33 | T33 → T34 | ✅ Match |
| T35 | T34 | T34 → T35 | ✅ Match |

Nenhuma task depende de uma fase posterior. Nenhum arco no diagrama fica sem `Depends on`
correspondente, e nenhum `Depends on` fica sem arco correspondente.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ----------------------------- | ----------------- | ----------- | ------ |
| T1 | Type only | none | none | ✅ OK |
| T2 | `apps/server/src/openapi/*` builder | unit | unit | ✅ OK |
| T3 | `routeSchemas` export (metadata) + `registry.ts` | none / n/a | none — mas `registry.ts` ganha 1 teste próprio dentro da task | ✅ OK |
| T4 | Script/CLI entrypoint, sem lógica própria | none | none | ✅ OK |
| T5–T20 | `routeSchemas` exports (metadata only) | none | none | ✅ OK |
| T21–T23 | `routeSchemas` exports (metadata only, non-`routes.ts` files) | none | none | ✅ OK |
| T24 | `tools/repo-tools` audit logic | unit | unit | ✅ OK |
| T25, T28, T32 | CI YAML | none | none | ✅ OK |
| T26 | `checkEvalThreshold` pure function | unit | unit | ✅ OK |
| T27 | `runThresholdCheck` script (wraps T26 + existing suite) | unit | unit | ✅ OK |
| T29, T30, T31, T33, T34, T35 | Docs/config | none | none | ✅ OK |

Nenhuma violação — nenhuma task com `Tests: none` cria uma camada de domínio/lógica que a matriz
exige testar (a única lógica real desta onda — o builder OpenAPI, a paridade de auditoria, o
checker de limiar e seu script — está em T2/T24/T26/T27, todas `Tests: unit`).

---

## Tips

- **Phases are ordered** - Each phase completes before the next; tasks run in order within a phase
- **Reuses = Token saver** - Always reference existing code
- **T5-T20 são mecânicas** - mesmo padrão 16 vezes; a variação real está em quantas rotas cada módulo tem e se alguma é WebSocket (só `ws-gateway`, T19)
- **Done when = Testable** - If you can't verify it, rewrite it
- **Requirement ID = Traceable** - Every task traces back to a spec requirement
- **One commit per task** - Plan the commit message format in advance
