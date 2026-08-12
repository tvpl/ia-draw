# Architecture Canvas Tasks — Onda 2b: F1 Persistência do Canvas (op-log, bootstrap, recovery)

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** segunda sub-onda de F1 — o **núcleo do invariante server-first**: op-log de operações, bootstrap, `operations:batch` idempotente com ACK pós-commit, catch-up por revisão e a fila local + máquina de save-status no cliente. Cobre a história "P1: Edição server-first" (EDT-01..05, exceto EDT-06 que depende do módulo de assets/MinIO — onda F1c) e "P1: Recuperação após crash" (REC-01..05) por inteiro. **Escopo explicitamente fora desta onda:** broadcast em tempo real / WebSocket multi-usuário (`ws-gateway`) — por AD-002 essa é a onda F4; tudo aqui funciona sobre REST puro (o cliente reconecta e chama `bootstrap`/`operations?afterSequence=`, não precisa de push ao vivo para satisfazer EDT/REC nesta fase). `EDT-07` já está ✅ Verified desde F0.

`packages/editor-adapter` (F0) já expõe `computeDiff`, `applyRemote` (wrapper de `reconcileElements`), `serializeScene`/`parseScene` e os tipos `ElementDelta`/`SceneElement`/`SceneIndex` — reutilize esses tipos no servidor em vez de duplicá-los. `apps/server/src/core` (F0) já tem `buildServer`/`loadConfig`/health. `apps/server/src/modules/auth` e `workspace` (onda F1a, se já executada) já têm `requireSession` e RBAC — reutilize.

---

## Test Coverage Matrix

> Reaproveitada das ondas anteriores. Guidelines found: `docs/product-spec.md` §17, `design.md` Test Strategy.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domínio (`packages/*`) | unit | Todos os branches; 1:1 com ACs da spec; todo edge case listado tem teste | `packages/*/src/**/*.spec.ts` | `pnpm -w test:unit` |
| Módulos/rotas do server (`apps/server/src/modules/*`) | unit + integration (PGlite local / Postgres real no CI) | Toda rota: happy + edge + error; idempotência e authz contra store real | `apps/server/src/**/*.spec.ts`, `apps/server/**/*.int.spec.ts` | `pnpm -w test:unit` / `pnpm -w test:integration` |
| Frontend shell (`apps/web`) | unit (fila/state machine) + e2e (Playwright) | Máquina de save-status e fila pendente 1:1 com ACs; e2e cobre o fluxo crítico de crash/reload | `apps/web/src/**/*.spec.tsx`, `apps/web/e2e/**` | `pnpm -w test:unit` / `pnpm -w test:e2e` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Full | Tasks com testes integration | `pnpm -w test:unit && pnpm -w test:integration` |
| Build | Fim de fase (não-final) | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` |
| E2E-Build | Última task da onda (T26) — inclui lint/typecheck/build, não só os testes | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration && pnpm -w test:e2e` |

---

## Execution Plan

### Phase 7: Domínio de operações e schema

```
T19
T20
```

### Phase 8: API de sincronização (diagram-sync)

```
T20 -> T21 -> T22 -> T23
T19 -> T21
```

### Phase 9: Cliente — fila local e save-status

```
T22 -> T24 -> T25
```

### Phase 10: Prova end-to-end

```
T24 -> T26
T25 -> T26
```

---

## Task Breakdown

### Phase 7 — Domínio de operações e schema

### T19: packages/diagram-domain — envelope de operação, limites e reconciliação server-side

**What**: `OperationEnvelope` (Zod): `{ clientMutationId: uuid, baseRevision: number, actorId: uuid, deltas: ElementDelta[] }` reaproveitando o tipo `ElementDelta` já exportado por `@arch-canvas/editor-adapter` (importar, não duplicar). Limites: máximo de elementos por lote (ex.: 500) e tamanho serializado máximo (256 KB, mesmo limite do protocolo WS documentado em `shared-contracts`), validados e retornando erro problem+json específico quando excedidos. `reconcileOperation(currentScene: SceneIndex, deltas: ElementDelta[]): { scene: SceneIndex, applied: ElementDelta[] }` — aplica os deltas ao índice de cena current usando a mesma semântica LWW de `applyRemote`/`computeDiff` de T9 (reexporte ou componha, não reimplemente o tie-break).
**Where**: `packages/diagram-domain/`
**Depends on**: None (depende apenas de `packages/editor-adapter`, já existente)
**Reuses**: `@arch-canvas/editor-adapter` (`ElementDelta`, `SceneElement`, `SceneIndex`, `applyRemote`), `@arch-canvas/shared-contracts` (limite de 256 KB já definido como `MAX_WS_MESSAGE_BYTES`)
**Requirement**: EDT-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Envelope válido passa; envelope com >500 elementos ou >256KB serializado é rejeitado com erro específico
- [x] `reconcileOperation` aplica upserts/deletes corretamente e usa o mesmo desempate de `versionNonce` de `applyRemote`
- [x] Nenhum tipo duplicado — `ElementDelta` etc. importados de `editor-adapter`, não redefinidos
- [x] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(diagram-domain): add operation envelope validation and server reconcile`

**Status**: ✅ Complete — `packages/diagram-domain` added (`envelope.ts`: `OperationEnvelope` Zod schema + `parseOperationEnvelope` with distinct `payload_too_large`/`too_many_elements`/`invalid_envelope` errors; `reconcile.ts`: `reconcileOperation` composing `applyRemote`/`buildSceneIndex` from editor-adapter, no LWW reimplementation). 10 unit tests, `pnpm -w test:unit` green (11/11 packages).

---

### T20: packages/database — diagram_operations e diagram_snapshots

**What**: Migration + schema Drizzle para `diagram_operations` (`id`, `diagram_id`, `sequence` monotônico por diagrama, `client_mutation_id`, `actor_id`, `base_revision`, `elements_delta_json` JSONB, `operation_summary` JSONB, `created_at`) e `diagram_snapshots` (`id`, `diagram_id`, `revision`, `kind` enum `auto|named|published|pre_ai|restore_point`, `name`, `scene_json_key`, `checksum`, `created_by`, `immutable` boolean, `created_at`). Constraint única `(diagram_id, client_mutation_id)` em `diagram_operations` (idempotência — EDT-04). Índice em `(diagram_id, sequence)`.
**Where**: `packages/database/`
**Depends on**: None
**Reuses**: padrão de schema/migration de T5/T13 (mesmo estilo Drizzle, mesma convenção de teste PGlite conforme AD-007)
**Requirement**: VER-01 (schema pré-requisito; a lógica de compaction real é onda F1c)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Migration aplica limpa sobre as migrations anteriores (T5, T13)
- [ ] Teste de integração: inserir duas operações com o mesmo `(diagram_id, client_mutation_id)` — a segunda viola a constraint única (prova de idempotência no nível de dado, EDT-04)
- [ ] `sequence` é gerado de forma monotônica por diagrama (teste com múltiplas inserções)
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(database): add diagram_operations and diagram_snapshots schema`

---

### Phase 8 — API de sincronização (diagram-sync)

### T21: apps/server — GET /diagrams/{id}/bootstrap

**What**: Em `apps/server/src/modules/diagram-sync/`: rota `GET /diagrams/{id}/bootstrap` retornando `{ scene: SceneElement[], revision: number, assets: [], permissions: Decision }` — para um diagrama sem snapshot ainda, `scene` é `[]` e `revision` é `0` (reconstituído a partir do op-log vazio; a lógica de "snapshot mais recente + operações após" pode ser um TODO documentado para quando F1c implementar compaction, mas o contrato da rota já deve estar correto). RBAC: exige `diagram:read`; 404 se o usuário não pertence ao workspace (reaproveita o padrão IDOR de T18/onda F1a).
**Where**: `apps/server/src/modules/diagram-sync/`
**Depends on**: T19, T20
**Reuses**: `requireSession`/RBAC de F1a (`apps/server/src/modules/auth`, `packages/auth`), `packages/diagram-domain`
**Requirement**: EDT-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Bootstrap de diagrama novo retorna cena vazia, `revision: 0`, permissões corretas para o papel do actor
- [ ] Usuário fora do workspace recebe 404 (não 403)
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add diagram bootstrap endpoint`

---

### T22: apps/server — POST /diagrams/{id}/operations:batch (idempotente, ACK pós-commit)

**What**: Rota que recebe um `OperationEnvelope` (T19), valida RBAC (`diagram:mutate` — reviewer/viewer recebem 403), grava a operação em `diagram_operations` **dentro de uma transação** e só então responde ACK — nunca antes do commit. Reenvio do mesmo `clientMutationId` retorna o ACK original sem gravar nova linha (idempotência via a constraint única de T20 + `ON CONFLICT DO NOTHING` ou consulta prévia — sua escolha de implementação, mas deve ser atômico/livre de corrida). Se `baseRevision` do envelope estiver desatualizada, responde as operações faltantes (não rejeita automaticamente — o cliente reconcilia). Se a escrita no banco falhar (erro simulado via mock do cliente de banco no teste), a rota retorna um erro HTTP claro e **nunca** um ACK de sucesso — essa é a garantia server-side por trás de REC-03.
**Where**: `apps/server/src/modules/diagram-sync/`
**Depends on**: T21
**Reuses**: `reconcileOperation` (T19), transação `withTx` (`packages/database`)
**Requirement**: EDT-03, EDT-04, REC-03, REC-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] ACK só é retornado após commit real (teste: mock de commit lento — resposta não chega antes do commit resolver)
- [ ] Reenvio do mesmo `clientMutationId` produz exatamente uma linha em `diagram_operations` e um ACK idempotente (não um erro)
- [ ] Falha simulada de escrita no banco retorna erro HTTP (nunca 200/ack) — prova server-side de REC-03
- [ ] Duas operações concorrentes no MESMO `elementId` convergem: a cena final reflete o desempate de `versionNonce`, e ambas as operações permanecem no op-log (histórico não perde a "perdedora") — prova de REC-05
- [ ] `reviewer`/`viewer` recebem 403 ao tentar mutar
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add idempotent operations batch endpoint with post-commit ack`

---

### T23: apps/server — GET /diagrams/{id}/operations?afterSequence= (catch-up)

**What**: Rota que retorna todas as operações com `sequence > afterSequence` para o diagrama, ordenadas, permitindo ao cliente reconciliar após reconexão com uma revisão desatualizada. RBAC igual às demais rotas do módulo (`diagram:read`); rejeita (403/404 conforme o caso) se o actor não tem acesso.
**Where**: `apps/server/src/modules/diagram-sync/`
**Depends on**: T22
**Reuses**: mesmo padrão RBAC do módulo
**Requirement**: REC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cliente com revisão desatualizada recebe exatamente as operações faltantes, em ordem de `sequence`
- [ ] Actor sem `diagram:read` no workspace recebe 404
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add operations catch-up endpoint for stale-revision reconnect`

---

### Phase 9 — Cliente: fila local e save-status

### T24: apps/web — EditorSurface real + fila de mutações locais com debounce

**What**: Substituir o placeholder do shell (F0/T4) por um componente que monta `<EditorSurface/>` de `@arch-canvas/editor-adapter` de verdade em uma rota de diagrama (`/w/:workspaceId/d/:diagramId` ou similar — sua escolha de roteamento, documente). `onChange` do adapter alimenta uma fila local (Zustand — conforme `design.md` Tech Decisions: TanStack Query para server state, Zustand só para estado efêmero como esta fila) que agrupa deltas em lotes com `clientMutationId` (gerado no cliente, uuid), `baseRevision` e debounce de 500-1000ms, com flush forçado em `visibilitychange`, `pagehide` e navegação interna do router. A fila é **cache/fila apenas** — nunca fonte da verdade (pode usar `localStorage`/`IndexedDB` só como persistência da fila pendente entre reloads, nunca como snapshot autoritativo da cena).
**Where**: `apps/web/src/`
**Depends on**: T22 (contrato da API que a fila chama)
**Reuses**: `@arch-canvas/editor-adapter` (`EditorSurface`, `computeDiff`), `@arch-canvas/shared-contracts` (schemas)
**Requirement**: EDT-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Uma edição no canvas gera uma mutação na fila com `clientMutationId`/`baseRevision`/deltas corretos
- [ ] Debounce agrupa edições rápidas sucessivas em um único lote dentro da janela 500-1000ms (teste com fake timers)
- [ ] Evento `visibilitychange`/`pagehide` força o flush imediato mesmo dentro da janela de debounce
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add real editor surface with debounced local mutation queue`

---

### T25: apps/web — máquina de save-status e cliente de sincronização

**What**: Store (Zustand) com estado exatamente um de `Salvo | Salvando… | Offline — N alterações pendentes | Conflito | Somente leitura`, e um cliente que: no boot, chama `GET /bootstrap`; ao ter lotes na fila de T24, chama `POST /operations:batch`, só transita para `Salvo` após ACK do servidor; em erro de rede, transita para `Offline — N` (N = tamanho da fila) e faz retry com backoff; ao reconectar, chama `GET /operations?afterSequence=` com a última revisão conhecida, aplica as operações faltantes via `reconcileOperation`/`applyRemote` e reporta o resultado da reconciliação (nunca sobrescreve silenciosamente uma revisão mais nova).
**Where**: `apps/web/src/`
**Depends on**: T24
**Reuses**: fila de T24, endpoints de T21/T22/T23
**Requirement**: EDT-05, REC-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Estado nunca assume um valor fora dos 5 definidos (teste de máquina de estados exaustivo)
- [ ] `Salvo` só é atingido após resposta 2xx do `operations:batch` (mock de resposta pendente mantém `Salvando…`)
- [ ] Falha de rede transita para `Offline — N alterações pendentes` com N correto
- [ ] Reconexão com fila pendente reenvia e reporta o resultado, sem sobrescrever uma revisão mais nova recebida via catch-up
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add save-status state machine and reconnect reconciliation client`

---

### Phase 10 — Prova end-to-end

### T26: E2E Playwright — crash/reload sem perda (REC-01)

**What**: Teste Playwright: autenticar, criar diagrama, realizar ~20-100 edições (ajuste o número ao que for praticável em CI sem tornar o teste frágil/lento — documente a escolha) observando o indicador `Salvo` após cada lote, fechar o contexto do browser abruptamente (sem logout/cleanup gracioso), abrir uma **nova** instância de contexto Playwright (simulando outra máquina) na mesma URL do diagrama, autenticar novamente, e verificar que todas as edições confirmadas como `Salvo` estão presentes na cena renderizada.
**Where**: `apps/web/e2e/`
**Depends on**: T24, T25
**Reuses**: infraestrutura de teste e2e já configurada no monorepo (Playwright + Chromium pré-instalado no ambiente, `PLAYWRIGHT_BROWSERS_PATH`/`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` já setados no ambiente de execução — não rodar `playwright install`)
**Requirement**: REC-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Teste roda contra o `apps/server` real (subido no `beforeAll` do teste ou via um `webServer` do Playwright config apontando para PostgreSQL via PGlite/instância de teste) — documente exatamente como o servidor de teste é levantado
- [ ] 100% das edições marcadas `Salvo` antes do "crash" reaparecem no novo contexto
- [ ] Gate check passes: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration && pnpm -w test:e2e`

**Tests**: e2e
**Gate**: e2e-build

**Commit**: `test(web): add e2e crash-and-reload zero-loss journey`

---

## Phase Execution Map

```
Phase 7:  T19
Phase 7:  T20
Phase 8:  T19 -> T21
Phase 8:  T20 -> T21 -> T22 -> T23
Phase 9:  T22 -> T24 -> T25
Phase 10: T24 -> T26
Phase 10: T25 -> T26
```

Execução estritamente sequencial dentro de cada fase; T19/T20 (Phase 7) são independentes entre si e podem ser feitas em qualquer ordem, mas ambas antes de Phase 8.

**Packing de batches (Execute):** 8 tasks (T19-T26) → 1 batch (dentro do orçamento ~7-8 tasks/worker).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T19: envelope + reconcile server-side | 1 pacote coeso | ✅ Granular |
| T20: schema operations+snapshots | 1 migration + 1 schema | ✅ Granular |
| T21: bootstrap endpoint | 1 rota | ✅ Granular |
| T22: operations:batch endpoint | 1 rota (a mais crítica — cobre 3 ACs coesos: idempotência, ack pós-commit, convergência LWW, todos no mesmo endpoint) | ✅ Granular (coesão justifica o escopo) |
| T23: catch-up endpoint | 1 rota | ✅ Granular |
| T24: fila local + editor real | 1 componente + 1 store coesos | ✅ Granular |
| T25: save-status + cliente de sync | 1 store + 1 cliente coesos | ✅ Granular |
| T26: e2e crash/reload | 1 teste e2e | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T19 | None | — | ✅ Match |
| T20 | None | — | ✅ Match |
| T21 | T19, T20 | T19→T21, T20→T21 | ✅ Match |
| T22 | T21 | T21→T22 (via T20→T21→T22 chain) | ✅ Match |
| T23 | T22 | T22→T23 | ✅ Match |
| T24 | T22 | T22→T24 | ✅ Match |
| T25 | T24 | T24→T25 | ✅ Match |
| T26 | T24, T25 | T24→T26, T25→T26 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T19 | Domínio (diagram-domain) | unit | unit | ✅ OK |
| T20 | Database (migration) | integration | integration | ✅ OK |
| T21 | Módulo server (diagram-sync) | integration | integration | ✅ OK |
| T22 | Módulo server (diagram-sync) | integration | integration | ✅ OK |
| T23 | Módulo server (diagram-sync) | integration | integration | ✅ OK |
| T24 | Frontend (apps/web) | unit | unit | ✅ OK |
| T25 | Frontend (apps/web) | unit | unit | ✅ OK |
| T26 | Frontend e2e | e2e | e2e | ✅ OK |
