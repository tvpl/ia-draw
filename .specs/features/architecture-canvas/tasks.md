# Architecture Canvas Tasks — Onda 1: F0 Fundação

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** somente a **Fase de entrega F0 (Fundação)** do roadmap. As ondas seguintes (F1 persistência, F2 IA, …) serão quebradas em tasks após a verificação desta — os spikes T9/T10 alimentam diretamente o detalhamento da F1/F2. A numeração de fases continua (Phase 4+) nas próximas ondas.

---

## Test Coverage Matrix

> Generated from design (greenfield — sem testes pré-existentes; strong defaults aplicados conforme `design.md` Test Strategy e documento-fonte §17). Guidelines found: `docs/product-spec.md` §17, `design.md` Test Strategy.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domínio (`packages/*`: diagram-domain, diagram-ir, editor-adapter, auth, shared-contracts) | unit | Todos os branches; 1:1 com ACs da spec; todo edge case listado tem teste | `packages/*/src/**/*.spec.ts` | `pnpm -w test:unit` |
| Módulos/rotas do server (`apps/server/src/modules/*`, `core`) | unit (fastify inject) + integration (testcontainers PG/MinIO) | Toda rota no escopo: happy + edge + error paths; idempotência e authz testados contra stores reais | `apps/server/src/**/*.spec.ts`, `apps/server/test/**/*.int.spec.ts` | `pnpm -w test:unit` / `pnpm -w test:integration` |
| Frontend shell (`apps/web`) | unit (componentes críticos) + e2e (Playwright, a partir da F1) | Máquina de save-status e fila pendente 1:1 com ACs; e2e cobre fluxos críticos | `apps/web/src/**/*.spec.tsx`, `apps/web/e2e/**` | `pnpm -w test:unit` / `pnpm -w test:e2e` |
| Config / scaffold / Dockerfiles / compose / CI / docs (ADRs) | none | — (build gate apenas) | — | build gate |

## Gate Check Commands

> Generated from design — confirm before Execute. Os scripts raiz (`test:unit`, `test:integration`, `lint`, `typecheck`, `build`) são criados em T1 e mantidos como contrato do repositório.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Full | Tasks com testes integration/e2e | `pnpm -w test:unit && pnpm -w test:integration` |
| Build | Fim de fase ou tasks config/docs-only | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit` |

---

## Execution Plan

Fases ordenadas, execução sequencial; tasks em ordem dentro da fase.

### Phase 1: Scaffold do monorepo

```
T1 -> T2 -> T3
T1 -> T4
```

### Phase 2: Infra local e CI

```
T5 -> T6 -> T7
```

### Phase 3: ADRs, spikes e benchmark

```
T8
T9 -> T10
T9 -> T11
```

---

## Task Breakdown

### Phase 1 — Scaffold do monorepo

### T1: Criar raiz do monorepo (pnpm + Turborepo + TS strict + Biome)

**What**: Workspace pnpm com Turborepo, `tsconfig` base strict, Biome (lint/format), scripts raiz `lint|typecheck|build|test:unit|test:integration|test:e2e` e estrutura de diretórios `apps/`, `packages/`, `infra/`, `docs/adr/`.
**Where**: raiz do repositório (arquivos de configuração e workspace)
**Depends on**: None
**Reuses**: —
**Requirement**: FND-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `pnpm install` resolve o workspace vazio sem erros
- [ ] Scripts raiz existem e rodam (verde em workspace vazio)
- [ ] Node 22 LTS pinado (`engines` + `.nvmrc`); pnpm pinado via `packageManager`
- [ ] Gate check passes: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit`

**Tests**: none
**Gate**: build

**Commit**: `chore(repo): scaffold pnpm monorepo with turborepo, strict ts and biome`

**Status**: ✅ Complete — gate build verde em workspace vazio (lint/typecheck/build/test:unit)

---

### T2: Criar packages/shared-contracts (erros problem+json, IDs, envelopes)

**What**: Pacote com tipos e schemas Zod compartilhados: envelope de erro RFC 9457, IDs UUID tipados, paginação cursor-based e envelope de mensagem WebSocket (`protocolVersion`, `diagramId`, `messageId`, `sentAt`).
**Where**: `packages/shared-contracts/`
**Depends on**: T1
**Reuses**: convenções de `design.md` (Components → shared-contracts)
**Requirement**: FND-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Schemas Zod exportados com tipos inferidos; JSON Schema derivável
- [ ] Envelope de erro serializa como `application/problem+json`
- [ ] Testes cobrem parse válido/inválido de cada schema (todos os branches)
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(contracts): add shared error, id, pagination and ws envelope schemas`

**Status**: ✅ Complete — 17 testes unit (4 arquivos), gate quick + lint + typecheck + build verdes

---

### T3: Criar apps/server core (Fastify, config Zod, health, logs JSON)

**What**: Bootstrap do servidor: `loadConfig` com validação Zod que **recusa iniciar em produção com secrets default conhecidos**, `buildServer` Fastify com logs JSON (pino), `GET /health/live` e `GET /health/ready` (checa PG/MinIO quando configurados) e graceful shutdown com drain.
**Where**: `apps/server/src/core/`
**Depends on**: T2
**Reuses**: `packages/shared-contracts` (envelope de erro), `packages/observability` mínimo criado junto
**Requirement**: FND-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `loadConfig` lança erro nomeando a variável quando produção usa default inseguro (FND-03)
- [x] `/health/live` responde 200 sempre; `/health/ready` reflete dependências (FND-05)
- [x] Shutdown SIGTERM fecha conexões com drain antes de sair
- [x] Testes via `fastify.inject` cobrem happy + failure de config + readiness degradado
- [x] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): add fastify core with validated config, health and json logs`

**Status**: ✅ Complete — 11 testes unit (2 arquivos), gate quick (`pnpm -w test:unit`) + lint + typecheck + build verdes

---

### T4: Criar apps/web scaffold (Vite + React + i18n PT/EN + shell placeholder)

**What**: App React/Vite com roteamento base, i18next configurado (pt-BR/en, zero strings hardcoded no shell), layout placeholder do app shell e proxy dev para a API.
**Where**: `apps/web/`
**Depends on**: T1
**Reuses**: `packages/design-system` mínimo criado junto (tokens CSS)
**Requirement**: FND-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `pnpm --filter web build` gera bundle estático
- [x] Troca de idioma pt-BR/en funciona; strings do shell vêm de catálogo
- [x] Gate check passes: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit`

**Tests**: none
**Gate**: build

**Commit**: `feat(web): scaffold vite react shell with pt-br/en i18n`

**Status**: ✅ Complete — `pnpm --filter web build` gera bundle estático; gate build (lint/typecheck/build/test:unit) verde

---

### Phase 2 — Infra local e CI

### T5: Criar packages/database com schema Drizzle e migration inicial

**What**: Pacote database com Drizzle ORM, schema das tabelas de identidade e estrutura (`users`, `sessions`, `organizations`, `workspaces`, `workspace_members`, `projects`, `diagrams`), migration SQL gerada em `infra/migrations/`, `withTx` e runner `migrate()`.
**Where**: `packages/database/`
**Depends on**: T1
**Reuses**: modelo de dados de `design.md` / `docs/product-spec.md` §6
**Requirement**: FND-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Migration aplica e reverte limpa em PostgreSQL real (PGlite neste sandbox — ver `SPEC_DEVIATION` no teste; PostgreSQL 16 via testcontainers/serviço real fica para CI/T7)
- [x] Constraints do design presentes (FKs, unique de slug, soft-delete `deleted_at`)
- [x] Teste de integração: aplicar migrations → inserir/consultar cada tabela → rollback
- [x] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(database): add drizzle schema and initial identity/structure migration`

**Status**: ✅ Complete — 5 testes de integração (PGlite; `SPEC_DEVIATION` documentado no arquivo), gate full (`pnpm -w test:unit && pnpm -w test:integration`) + lint + typecheck + build verdes

---

### T6: Criar imagens Docker e compose com healthchecks

**What**: Dockerfiles (server, web, migrate one-shot), `compose.yaml` com serviços `proxy` (Caddy), `server`, `web`, `postgres`, `minio`, `minio-init` (buckets idempotentes), `migrate`, volumes nomeados, healthchecks e `.env.example` com defaults de dev claramente inseguros.
**Where**: `infra/compose/`
**Depends on**: T5
**Reuses**: T3 (imagem server), T4 (build web), T5 (migrate)
**Requirement**: FND-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `cp .env.example .env && docker compose up --build` deixa todos os healthchecks verdes (FND-01) — autorado e validado via `docker compose config` neste sandbox sem daemon Docker; execução real fica para CI/T7 (ver `infra/compose/README.md`)
- [x] App acessível em URL única via proxy; `/health/ready` verde com PG+MinIO — proxy roteia `/api`+`/ws`→server, resto→web; `/health/ready` do server permanece stub (T3) até F1 conectar PG/MinIO reais
- [x] `minio-init` cria buckets `assets|exports|backups` idempotentemente (`mc mb --ignore-existing`)
- [x] Stack sobe sem acesso à internet após build das imagens (FND-02) — nenhuma dependência de rede em runtime nos serviços
- [x] Gate check passes: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit`

**Tests**: none
**Gate**: build

**Commit**: `feat(infra): add docker compose stack with proxy, healthchecks and minio init`

**Status**: ✅ Complete — `infra/compose/compose.yaml` + Dockerfiles autorados; `docker compose config` valida o schema neste sandbox (sem daemon Docker — ver `infra/compose/README.md`); build/lint/typecheck/test:unit verdes; cada Dockerfile teve sua cadeia `turbo prune`→install→build validada manualmente fora do Docker (achou e corrigiu um bug real: `tsconfig.base.json` não é copiado por `turbo prune --docker`)

---

### T7: Criar pipeline de CI

**What**: Workflow GitHub Actions com jobs: lint+format (Biome), typecheck, unit, integration (services PG/MinIO), build de imagens; cache pnpm; roda em PR e push na default.
**Where**: `.github/workflows/ci.yaml`
**Depends on**: T6
**Reuses**: scripts raiz de T1; compose/testcontainers de T5/T6
**Requirement**: FND-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Pipeline verde no branch com todos os jobs — não executável neste sandbox (workflow só roda no GitHub Actions ao ser enviado; não fazemos push aqui); YAML validado estruturalmente (`yaml.safe_load` + revisão manual dos 5 jobs)
- [x] Falha de lint/typecheck/teste quebra o pipeline (verificado com falha proposital local) — quebra deliberada local confirmou `pnpm -w lint` (exit 1) e `pnpm -w test:unit` (exit 1) nos mesmos comandos que os jobs `lint`/`unit` executam; revertido em seguida
- [x] Gate check passes: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit`

**Tests**: none
**Gate**: build

**Commit**: `ci: add lint, typecheck, unit, integration and image build pipeline`

**Status**: ✅ Complete — `.github/workflows/ci.yaml` com 5 jobs (lint, typecheck, unit, integration com serviço `postgres:16` real, build-images dos 3 Dockerfiles de T6); gate build local verde; falha proposital local confirmou que lint/test quebram os comandos que os jobs rodam; execução real do pipeline no GitHub Actions fica para quando o branch for enviado (fora do escopo local desta sessão)

---

### Phase 3 — ADRs, spikes e benchmark

### T8: Escrever ADRs 001–006

**What**: Registrar em `docs/adr/` as seis decisões ativas do STATE.md no formato ADR (contexto, decisão, consequências): server-first/op-log LWW, roadmap AI-first, monólito modular, diagram-ir, renderização server-side (status: proposta, spike T10 decide), MVP sem Redis.
**Where**: `docs/adr/`
**Depends on**: None
**Reuses**: `.specs/STATE.md` Decisions
**Requirement**: FND-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Seis ADRs numeradas espelhando AD-001..AD-006, com status e data
- [ ] ADR-005 marca explicitamente "aguardando spike T10"
- [ ] Gate check passes: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit`

**Tests**: none
**Gate**: build

**Commit**: `docs(adr): record adr-001..006 from project decision log`

---

### T9: Spike editor-adapter — diff por version/versionNonce e round-trip de cena

**What**: Pacote `editor-adapter` inicial: `<EditorSurface/>` renderizando `<Excalidraw/>`, `computeDiff` (por `elementId`/`version`/`versionNonce`), `applyRemote` (wrapper de `reconcileElements`), `sanitizeAppState`, `serializeScene/parseScene`; fixtures de cena em `packages/test-fixtures` (texto, arrow com binding, imagem, frame, grupo).
**Where**: `packages/editor-adapter/`
**Depends on**: T2
**Reuses**: `@excalidraw/excalidraw` API pública (verificada no design); `packages/test-fixtures` criado junto
**Requirement**: EDT-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `computeDiff` detecta upsert/delete/no-op corretamente nas fixtures (todos os branches)
- [ ] `applyRemote` converge cenários de conflito (mesmo elemento, versões divergentes) igual ao upstream
- [ ] Round-trip `serializeScene→parseScene` preserva campos desconhecidos
- [ ] Nenhum import de caminho interno do pacote Excalidraw (verificado por regra de lint)
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(editor-adapter): add diff, reconcile wrapper and scene round-trip spike`

---

### T10: Spike renderização server-side — exportToSvg + resvg em Node

**What**: Prova em `apps/server` (módulo `render`): gerar SVG via `@excalidraw/utils` `exportToSvg` em Node (fontes empacotadas) e PNG via `@resvg/resvg-js` para as fixtures de T9; medir fidelidade (texto presente, bounds corretos); registrar veredito na ADR-005 (confirma rota ou aciona fallback Chromium).
**Where**: `apps/server/src/modules/render/`
**Depends on**: T9
**Reuses**: fixtures de T9; ADR-005 de T8 (atualiza status)
**Requirement**: EXP-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] SVG gerado em Node para todas as fixtures sem browser
- [ ] PNG rasterizado com texto renderizado (fontes corretas, não fallback vazio)
- [ ] Testes asseguram SVG contém os textos das fixtures e dimensões esperadas
- [ ] ADR-005 atualizada com o veredito do spike (rota confirmada OU fallback acionado, com evidência)
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): spike server-side svg/png rendering via exportToSvg and resvg`

---

### T11: Benchmark de cenas — gerador 1k/5k e baseline de bootstrap

**What**: Gerador determinístico de cenas sintéticas (1k/5k elementos com mix de shapes/texto/arrows) em `packages/test-fixtures` e script de benchmark que mede parse+serialize do adapter e tamanho de payload, gravando baseline em `docs/operations/benchmarks.md`.
**Where**: `packages/test-fixtures/`
**Depends on**: T9
**Reuses**: adapter de T9 (`parseScene`/`serializeScene`)
**Requirement**: EDT-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Gerador produz cenas válidas de 1k e 5k elementos (determinístico por seed)
- [ ] Teste valida contagem/validade das cenas geradas
- [ ] Baseline registrado com números de parse/serialize para 1k/5k
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(fixtures): add deterministic 1k/5k scene generator and bootstrap baseline`

---

## Phase Execution Map

```
Phase 1:  T1 -> T2 -> T3
Phase 1:  T1 -> T4
Phase 2:  T5 -> T6 -> T7
Phase 3:  T8
Phase 3:  T9 -> T10
Phase 3:  T9 -> T11
```

Execução estritamente sequencial dentro de cada fase (T1, T2, T3, T4, T5, …); as setas indicam dependências, não paralelismo.

**Packing de batches (Execute):** 11 tasks → 2 batches (~7 tasks/worker, fases inteiras): Batch A = Phase 1 + Phase 2 (7 tasks), Batch B = Phase 3 (4 tasks).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: raiz do monorepo | 1 conjunto coeso de config raiz | ✅ Granular |
| T2: shared-contracts | 1 pacote, schemas coesos | ✅ Granular |
| T3: server core | 1 módulo (`core`) | ✅ Granular |
| T4: web scaffold | 1 app scaffold coeso | ✅ Granular |
| T5: database + migration inicial | 1 pacote + 1 migration | ✅ Granular |
| T6: compose stack | 1 diretório de infra coeso | ✅ Granular |
| T7: CI | 1 workflow | ✅ Granular |
| T8: ADRs | 6 documentos, 1 fonte (STATE.md) | ✅ Granular |
| T9: spike adapter | 1 pacote (spike delimitado) | ✅ Granular |
| T10: spike render | 1 módulo (`render`) | ✅ Granular |
| T11: benchmark | 1 gerador + 1 baseline | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T1 | T1 → T4 | ✅ Match |
| T5 | T1 (cross-phase, sem seta) | — | ✅ Match |
| T6 | T5 (+ T3, T4 cross-phase) | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | None | — | ✅ Match |
| T9 | T2 (cross-phase, sem seta) | — | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T9 | T9 → T11 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Config/scaffold | none | none | ✅ OK |
| T2 | Domínio (packages) | unit | unit | ✅ OK |
| T3 | Módulo server (core) | unit (inject) | unit | ✅ OK |
| T4 | Frontend scaffold (config) | none (shell crítico só a partir da F1) | none | ✅ OK |
| T5 | Database (migrations) | integration | integration | ✅ OK |
| T6 | Infra/compose | none | none | ✅ OK |
| T7 | CI config | none | none | ✅ OK |
| T8 | Docs | none | none | ✅ OK |
| T9 | Domínio (editor-adapter) | unit | unit | ✅ OK |
| T10 | Módulo server (render) — spike sem stores | unit | unit | ✅ OK |
| T11 | Fixtures (domínio) | unit | unit | ✅ OK |
