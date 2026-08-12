# Architecture Canvas Tasks — Onda 2a: F1 Identidade, Workspaces e RBAC

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** primeira sub-onda da Fase de entrega **F1 (Persistência server-first)** — identidade, sessão, RBAC e CRUD de workspace/projeto/diagrama (metadados). Cobre integralmente a história "P1: Contas, workspaces e RBAC" (AUTH-01..05). **Não cobre** ainda a persistência do canvas em si (operation log, bootstrap, WebSocket sync — onda F1b: EDT-01..06, REC-01..05) nem snapshots/export/backup (onda F1c: VER, EXP, OPS). `packages/database` (schema base) e `apps/server` core/health já existem da onda F0.

---

## Test Coverage Matrix

> Reaproveitada da onda F0 (mesma matriz vale para todo o feature). Guidelines found: `docs/product-spec.md` §17, `design.md` Test Strategy.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domínio (`packages/*`) | unit | Todos os branches; 1:1 com ACs da spec; todo edge case listado tem teste | `packages/*/src/**/*.spec.ts` | `pnpm -w test:unit` |
| Módulos/rotas do server (`apps/server/src/modules/*`) | unit (fastify inject) + integration (PGlite local / testcontainers CI) | Toda rota no escopo: happy + edge + error paths; idempotência e authz testados contra store real | `apps/server/src/**/*.spec.ts`, `apps/server/**/*.int.spec.ts` | `pnpm -w test:unit` / `pnpm -w test:integration` |
| Config / migrations | none | — (build gate apenas) | — | build gate |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Full | Tasks com testes integration | `pnpm -w test:unit && pnpm -w test:integration` |
| Build | Fim de fase ou tasks config-only | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` |

---

## Execution Plan

### Phase 4: RBAC e auditoria (base pura)

```
T12
T13
```

### Phase 5: Identidade e sessão

```
T14 -> T15
```

### Phase 6: Workspaces, projetos, diagramas e aplicação de RBAC

```
T16 -> T17 -> T18
```

(A numeração de tasks continua de T12 em diante, seguindo a onda F0 T1-T11; a de phases continua de Phase 4, seguindo as Phases 1-3 da onda F0.)

---

## Task Breakdown

### Phase 4 — RBAC e auditoria (base pura)

### T12: packages/auth — motor de política RBAC puro

**What**: `can(actor: { role: Role }, action: Action, resource: { workspaceId, ownerId? }): Decision` em `packages/auth/`, sem dependência de runtime (sem DB, sem HTTP). Papéis: `org_admin`, `workspace_admin`, `editor`, `reviewer`, `viewer`. Ações mínimas: `workspace:read|write|manage_members`, `project:read|write`, `diagram:read|write`, `diagram:mutate` (escrita no canvas — reviewer NUNCA tem, mesmo tendo `diagram:write` para metadados). Hierarquia: org_admin ⊇ workspace_admin ⊇ editor > reviewer > viewer (reviewer não é subconjunto de editor: pode comentar/ler, nunca mutar canvas).
**Where**: `packages/auth/`
**Depends on**: None (independe de F0; só requer o workspace do monorepo)
**Reuses**: convenções de `packages/shared-contracts` (tsconfig/vitest já estabelecidos)
**Requirement**: AUTH-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tabela de decisão cobre as 5×N combinações papel×ação relevantes (matriz explícita nos testes, não só casos soltos)
- [x] `reviewer` nunca recebe `diagram:mutate` mesmo com `diagram:write` concedido para metadados
- [x] `viewer` só recebe ações `*:read`
- [x] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(auth): add pure rbac policy engine with role hierarchy`

**Status**: ✅ Complete — `packages/auth/` (`can(actor, action, resource)`, 5 roles × 8 ações, sem dependência de runtime); 52 testes unit (matriz explícita 5×8 + casos de decoupling write/mutate + viewer read-only), gate quick (`pnpm -w test:unit`) verde. **Interpretação registrada**: o texto do task descreve `reviewer` como tendo `diagram:write` "concedido para metadados"; a matriz implementada nega `diagram:write` a `reviewer` (idêntico a `viewer` no conjunto mínimo de 8 ações) porque T17 exige explicitamente 403 de `reviewer` em `POST/PATCH/DELETE` de diagrama/projeto — dar `diagram:write` a `reviewer` aqui contradiria esse done-when concreto de T17. O invariante central do bullet (mutate nunca é derivado de write, e `reviewer` nunca recebe `diagram:mutate`) está coberto literalmente pelos testes; a frase "editor > reviewer > viewer" é tratada como ranking organizacional (comentários/aprovações futuras em F3 CMT-01), não como exigência de um `true` extra no conjunto mínimo de ações desta onda. Documentado em comentário no código-fonte (`rbac.ts`).

---

### T13: packages/database — tabela audit_events + helper de auditoria

**What**: Migration adicionando `audit_events` (`actor_id`, `action`, `resource_type`, `resource_id`, `ip_hash`, `metadata_json`, `created_at`, append-only — sem `updated_at`, sem UPDATE/DELETE permitido pela camada de acesso). Helper `recordAuditEvent(db, event)` em `packages/database/` que só faz INSERT.
**Where**: `packages/database/`
**Depends on**: None
**Reuses**: padrão de schema/migration já estabelecido em T5 (Drizzle + `infra/migrations/`)
**Requirement**: AUTH-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Migration aplica limpa sobre a migration inicial de T5 (sem conflito)
- [x] `recordAuditEvent` insere e é lido de volta corretamente (teste de integração via PGlite, mesmo padrão SPEC_DEVIATION de T5)
- [x] Índice em `(resource_type, resource_id)` e em `created_at` para consulta futura de `GET /audit-events`
- [x] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(database): add append-only audit_events table and record helper`

**Status**: ✅ Complete — migration `0001_neat_the_enforcers.sql` adiciona `audit_events` (`actor_id` nullable, `action`, `resource_type`, `resource_id`, `ip_hash`, `metadata_json`, `created_at`; sem `updated_at`) com índices `audit_events_resource_idx (resource_type, resource_id)` e `audit_events_created_at_idx (created_at)`; `recordAuditEvent(db, event)` em `packages/database/src/audit.ts` só faz INSERT. 4 testes de integração novos (PGlite, mesmo padrão SPEC_DEVIATION de T5) cobrindo round-trip, append-only (duas chamadas → duas linhas, nunca update), `actorId` nulo para eventos de sistema, e existência dos dois índices via `pg_indexes`. Gate full (`pnpm -w test:unit && pnpm -w test:integration`) verde — 9 testes de integração no pacote (5 pré-existentes + 4 novos).

---

### Phase 5 — Identidade e sessão

### T14: apps/server — módulo auth (contas locais, sessão em cookie, /me)

**What**: Em `apps/server/src/modules/auth/`: criação de conta local com hash Argon2id (`argon2`), tabela `sessions` (migration nova: `id`, `user_id`, `created_at`, `expires_at`, `revoked_at`) com cookie de sessão opaco `HttpOnly`, `Secure` (condicional a HTTPS/produção — permitir `Secure=false` só em dev local via config, nunca em produção), `SameSite=Lax`. Rotas `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh` (rotaciona o token de sessão), `GET /me` (retorna usuário autenticado ou 401). Middleware `requireSession` reutilizável pelas rotas futuras.
**Where**: `apps/server/src/modules/auth/`
**Depends on**: T12
**Reuses**: `packages/auth` (RBAC engine), `packages/database` (schema + `withTx`), `@arch-canvas/shared-contracts` (problem+json em erros)
**Requirement**: AUTH-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Login com senha correta verifica hash Argon2id e emite cookie `HttpOnly; SameSite=Lax` (+ `Secure` quando `config.publicUrl` é https)
- [x] Login com senha incorreta retorna 401 sem vazar se o email existe
- [x] `GET /me` sem cookie retorna 401; com cookie válido retorna o usuário
- [x] `POST /auth/refresh` rotaciona o token (o token antigo deixa de funcionar)
- [x] `POST /auth/logout` revoga a sessão (cookie subsequente falha)
- [x] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add local account auth with argon2id and session cookies`

**Status**: ✅ Complete — `apps/server/src/modules/auth/` (`createLocalAccount`/`verifyLocalPassword` via `argon2` argon2id, `createSession`/`rotateSession`/`revokeSession`/`verifySession` sobre a tabela `sessions` já existente de T5, `requireSession` preHandler reutilizável, `registerAuthModule` com `POST /auth/login|logout|refresh` e `GET /me`). 8 testes de integração (PGlite) cobrindo os 5 done-when + Secure ligado/desligado conforme `config.publicUrl`. Gate full verde. **Achados/decisões registradas**: (1) a tabela `sessions` descrita no "What" deste task já existia integralmente desde T5 (mesmos campos) — nenhuma migration nova foi necessária para ela; (2) `users.password_hash` (coluna nova, nullable) foi adicionado via migration `0002_mighty_arclight.sql` em `packages/database` — extensão mínima e necessária de schema para viabilizar contas locais, não coberta por T5; `packages/database/src/tx.ts` passou a exportar o tipo `Schema` para permitir tipagem consistente do `db` fora do pacote; (3) `apps/server/src/core/config.ts` ganhou `PUBLIC_URL` (default `http://localhost:3000`) — necessário para a regra `Secure` condicional; (4) `apps/server/vitest.config.ts` (unit) passou a excluir `**/*.int.spec.ts` (o padrão `*.spec.ts` já capturava esses arquivos, duplicando execução entre os gates quick/full); (5) **deferido deliberadamente**: `apps/server/src/index.ts` não foi conectado a um `pg.Pool` real (sem `DATABASE_URL` em produção) — as rotas ficam expostas via `registerAuthModule(app, {db, config})` mas o boot real do processo contra Postgres real não pôde ser exercitado neste sandbox (sem Docker); T16 segue o mesmo padrão de app+db injetados em teste.

---

### T15: apps/server — emissão de ticket WebSocket de uso único

**What**: `issueWsTicket(sessionUserId, diagramId): { ticket, expiresAt }` em `apps/server/src/modules/auth/` — token opaco de uso único, TTL 30s, hash armazenado em tabela nova `ws_tickets` (`token_hash`, `user_id`, `diagram_id`, `expires_at`, `used_at`). `consumeWsTicket(ticket): { userId, diagramId } | null` marca `used_at` atomicamente (uma única consulta UPDATE...WHERE used_at IS NULL RETURNING, para não permitir reuso em corrida). Endpoint stub `POST /diagrams/{id}/ws-ticket` protegido por `requireSession` + RBAC `diagram:read` — o WebSocket gateway real que consome isso é escopo da onda F1b, este task só entrega emissão/consumo.
**Where**: `apps/server/src/modules/auth/`
**Depends on**: T14
**Reuses**: `requireSession` de T14, RBAC de T12
**Requirement**: AUTH-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Ticket emitido é consumível exatamente uma vez; segunda tentativa de consumo retorna `null`
- [ ] Ticket expirado (TTL 30s) não é consumível
- [ ] `POST /diagrams/{id}/ws-ticket` sem sessão retorna 401; com sessão sem acesso ao workspace do diagrama retorna 404 (não 403 — ver T18 IDOR)
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add single-use websocket ticket issuance and consumption`

---

### Phase 6 — Workspaces, projetos, diagramas e aplicação de RBAC

### T16: apps/server — CRUD de workspaces e membros

**What**: Em `apps/server/src/modules/workspace/`: `GET/POST/PATCH/DELETE /workspaces`, `GET/POST/PATCH/DELETE /workspaces/{id}/members`. Toda rota chama `can()` de `packages/auth` com o papel do actor resolvido de `workspace_members`. Criar workspace exige usuário autenticado (torna-se `workspace_admin` automaticamente); demais operações exigem o papel adequado (ex.: adicionar membro exige `workspace:manage_members`). Toda mutação bem-sucedida chama `recordAuditEvent` (T13).
**Where**: `apps/server/src/modules/workspace/`
**Depends on**: T14, T13
**Reuses**: `requireSession` (T14), RBAC (T12), `recordAuditEvent` (T13)
**Requirement**: AUTH-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Criar workspace com slug duplicado retorna 409 (constraint unique de T5)
- [ ] `workspace_admin` pode adicionar/remover membros; `editor`/`reviewer`/`viewer` recebem 403
- [ ] Mutação bem-sucedida gera uma linha em `audit_events`
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add workspace and member crud with rbac enforcement`

---

### T17: apps/server — CRUD de projetos e diagramas (metadados)

**What**: Em `apps/server/src/modules/workspace/` (ou submódulo `project/`, sua escolha de organização interna — mantenha coeso): `GET/POST/PATCH/DELETE /projects`, `GET/POST/PATCH/DELETE /diagrams` operando apenas em metadados (`title`, `description`, `status`, `tags`, `owner_id` — **não** no conteúdo do canvas, que é escopo F1b). `status` de diagrama restrito ao enum `draft|in_review|approved|archived`. Toda rota escopada por workspace via `packages/auth`.
**Where**: `apps/server/src/modules/workspace/`
**Depends on**: T16
**Reuses**: mesmo padrão RBAC + auditoria de T16
**Requirement**: EDT-01 (parcial — metadados apenas; bootstrap real de canvas é F1b)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `reviewer`/`viewer` conseguem `GET` mas recebem 403 em `POST/PATCH/DELETE` de projeto/diagrama
- [ ] `status` fora do enum é rejeitado com 400 (problem+json)
- [ ] Diagrama criado herda `workspace_id` do projeto via join, nunca aceito diretamente do payload
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add project and diagram metadata crud scoped by workspace`

---

### T18: apps/server — matriz IDOR + enforcement imediato de troca de papel

**What**: Suíte de integração dedicada (`apps/server/src/modules/workspace/rbac-matrix.int.spec.ts`) cobrindo a matriz completa papel × operação (workspace/project/diagram × read/write/delete/manage_members) das rotas de T16/T17, incluindo: (a) usuário sem vínculo com o workspace recebe 404 (nunca 403) em qualquer rota daquele workspace — IDOR; (b) downgrade de papel (`PATCH /workspaces/{id}/members/{userId}`) é refletido na PRÓXIMA requisição imediatamente após — como cada rota resolve o papel fresco do banco por requisição (sem cache), isso satisfaz "dentro de 10 segundos" por construção para REST; documentar explicitamente que o enforcement sobre conexões WebSocket já abertas é escopo da onda F1b (quando o WS gateway existir) e citar isso na spec.md.
**Where**: `apps/server/src/modules/workspace/`
**Depends on**: T17
**Reuses**: rotas de T16/T17
**Requirement**: AUTH-04, AUTH-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Toda combinação papel×operação da matriz tem uma assertiva explícita (200/201/403/404 conforme o caso)
- [ ] Não-membro de workspace recebe 404 em GET de workspace/project/diagram (nunca 403, nunca vazamento de existência)
- [ ] Downgrade de `editor` para `viewer` faz a chamada seguinte (mesma sessão) receber 403 em mutação
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `test(server): add full rbac idor matrix and immediate role-downgrade enforcement`

---

## Phase Execution Map

```
Phase 4:  T12
Phase 4:  T13
Phase 5:  T14 -> T15
Phase 6:  T16 -> T17 -> T18
```

Execução estritamente sequencial dentro de cada fase. Cross-phase: T14 depende de T12 (Phase 4→5); T16 depende de T14 e T13 (Phase 5→6, Phase 4→6).

**Packing de batches (Execute):** 7 tasks (T12-T18) → 1 batch (dentro do orçamento ~7 tasks/worker) — execução inline ou um único worker, sem necessidade de múltiplos batches para esta sub-onda.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T12: RBAC engine | 1 módulo puro | ✅ Granular |
| T13: audit_events | 1 tabela + 1 helper | ✅ Granular |
| T14: auth module | 1 módulo coeso (contas+sessão) | ✅ Granular |
| T15: WS ticket | 1 função + 1 rota | ✅ Granular |
| T16: workspace CRUD | 1 módulo coeso | ✅ Granular |
| T17: project/diagram CRUD | 1 módulo coeso (metadados) | ✅ Granular |
| T18: IDOR matrix + role enforcement | 1 suíte de teste dedicada | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T12 | None | — | ✅ Match |
| T13 | None | — | ✅ Match |
| T14 | T12 (cross-phase, sem seta) | — | ✅ Match |
| T15 | T14 | T14 → T15 | ✅ Match |
| T16 | T14, T13 (cross-phase, sem seta) | — | ✅ Match |
| T17 | T16 | T16 → T17 | ✅ Match |
| T18 | T17 | T17 → T18 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T12 | Domínio (packages/auth) | unit | unit | ✅ OK |
| T13 | Database (migration+helper) | integration | integration | ✅ OK |
| T14 | Módulo server (auth) | integration | integration | ✅ OK |
| T15 | Módulo server (auth) | integration | integration | ✅ OK |
| T16 | Módulo server (workspace) | integration | integration | ✅ OK |
| T17 | Módulo server (workspace) | integration | integration | ✅ OK |
| T18 | Módulo server (workspace, test-only) | integration | integration | ✅ OK |
