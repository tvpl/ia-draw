# Prova de concorrência real Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: skipped — reusa o harness HTTP (`buildServer`/`registerModule`/`app.inject`) que
`rbac-matrix.int.spec.ts` já estabelece, só trocando PGlite por um `pg.Pool` real; e reusa
literalmente o padrão de alvo/job próprio que `test-integration-backup` já estabeleceu (ADR-0007).
Nenhuma decisão arquitetural nova.
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| RBAC-12 sob concorrência real | integration (Postgres real) | CCP-01..04: duas remoções concorrentes, exatamente um 204/um 409, um admin restante | `apps/server/src/modules/workspace/lastAdmin.concurrency.int.spec.ts` | `make test-integration-concurrency` |
| BOOT-08 sob concorrência real | integration (Postgres real) | CCP-05..07: dois first-run concorrentes, exatamente um 201/um 409, uma linha em `users` | `apps/server/src/modules/auth/firstRun.concurrency.int.spec.ts` | `make test-integration-concurrency` |
| Isolamento do alvo padrão | none | CCP-08: `make ci`/`make test-integration` continuam sem exigir Postgres real — verificado pelo próprio gate rodando limpo | `Makefile`, `.github/workflows/ci.yaml` | `make ci` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de T1 | `make test-integration-concurrency` (exige Postgres local instalado) |
| Full | Depois de cada task de código | `make lint && make typecheck && make test-unit` |
| Build | Depois da última task, antes do Verifier | `make ci` (sem Postgres) + `make test-integration-concurrency` (com Postgres) |

---

## Execution Plan

### Phase 1: Infraestrutura da suíte

```
T1
```

### Phase 2: As duas provas

```
T1 -> T2
T1 -> T3
```

### Phase 3: CI e documentação

```
T2 -> T4
T3 -> T4
T4 -> T5
T5 -> T6
T6 -> T7
```

---

## Task Breakdown

### T1: Config, script e alvo de Make para o novo pacote de testes

**What**: `apps/server/vitest.integration.concurrency.config.ts` (`include: ['src/**/*.concurrency.int.spec.ts']`,
sem `environment: jsdom` — estes testes não tocam Excalidraw). `test:integration:concurrency` em
`apps/server/package.json`. `test-integration-concurrency` no `Makefile`, mesmo formato de
`test-integration-backup` (comentário citando ADR-0007 e exigindo `DATABASE_URL`).
**Where**: `apps/server/vitest.integration.concurrency.config.ts`, `apps/server/package.json`, `Makefile`
**Depends on**: None
**Reuses**: formato de `apps/server/vitest.integration.config.ts` e do alvo `test-integration-backup`.
**Requirement**: CCP-08, CCP-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `pnpm --filter @arch-canvas/server run test:integration:concurrency` existe e roda só arquivos `*.concurrency.int.spec.ts`
- [ ] `make test-integration-concurrency` chama esse script
- [ ] Rodar o alvo sem `DATABASE_URL` falha com mensagem nomeando a variável, antes de tentar conectar
- [ ] `make ci`/`make test-integration` continuam passando sem qualquer Postgres real instalado
- [ ] Gate check passes: `make lint && make typecheck`

**Tests**: none
**Gate**: full

**Commit**: `chore(server): add the real-Postgres concurrency test target`

---

### T2: Prova de RBAC-12 contra Postgres real

**What**: `lastAdmin.concurrency.int.spec.ts` — sobe `buildServer` + `registerAuthModule` +
`registerWorkspaceModule` sobre um `pg.Pool` real (lido de `DATABASE_URL`), roda as migrações via
`drizzle-orm/node-postgres/migrator`, semeia um workspace com exatamente dois administradores (A e
B), dispara `DELETE /workspaces/:id/members/:userIdA` (sessão de B) e `DELETE .../:userIdB`
(sessão de A) via `Promise.all`, afirma exatamente um `204` e um `409`, e consulta o banco para
confirmar exatamente um administrador restante.
**Where**: `apps/server/src/modules/workspace/lastAdmin.concurrency.int.spec.ts`
**Depends on**: T1
**Reuses**: o mesmo padrão de setup de `rbac-matrix.int.spec.ts`, trocando PGlite por `pg.Pool`.
**Requirement**: CCP-01, CCP-02, CCP-03, CCP-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O teste dispara as duas remoções via `Promise.all`, nunca sequencialmente
- [ ] Exatamente uma resposta é `204` e a outra é `409`
- [ ] O banco mostra exatamente um administrador restante no workspace
- [ ] O teste falha alto e cedo, com mensagem nomeada, se `DATABASE_URL` estiver ausente
- [ ] Gate check passes: `make test-integration-concurrency` (requer Postgres local)

**Tests**: integration
**Gate**: quick

**Commit**: `test(server): prove RBAC-12 against real Postgres concurrency`

---

### T3: Prova de BOOT-08 contra Postgres real

**What**: `firstRun.concurrency.int.spec.ts` — mesmo harness sobre Postgres real, tabela `users`
vazia, dois `POST /auth/first-run` concorrentes com corpos diferentes (e-mails distintos) via
`Promise.all`, afirma exatamente um `201` e um `409`, e consulta o banco para confirmar exatamente
uma linha em `users`.
**Where**: `apps/server/src/modules/auth/firstRun.concurrency.int.spec.ts`
**Depends on**: T1
**Reuses**: o mesmo setup de banco que T2 estabelece (fábrica de `pg.Pool` + migração, extraída
para um helper compartilhado se o formato repetir idêntico entre os dois arquivos).
**Requirement**: CCP-05, CCP-06, CCP-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O teste dispara os dois `first-run` via `Promise.all`, nunca sequencialmente
- [ ] Exatamente uma resposta é `201` e a outra é `409`
- [ ] O banco mostra exatamente uma linha em `users`
- [ ] Gate check passes: `make test-integration-concurrency` (requer Postgres local)

**Tests**: integration
**Gate**: quick

**Commit**: `test(server): prove BOOT-08 against real Postgres concurrency`

---

### T4: Job de CI dedicado

**What**: Novo job `concurrency-integration:` em `ci.yaml`, espelhando `backup-integration:`
literalmente — `apt-get install postgresql postgresql-client`, `DATABASE_URL` local, roda
`pnpm --filter @arch-canvas/server run test:integration:concurrency`.
**Where**: `.github/workflows/ci.yaml`
**Depends on**: T2, T3
**Reuses**: o job `backup-integration:` como template direto.
**Requirement**: CCP-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O job instala Postgres via `apt-get`, sem Docker
- [ ] O job roda `test:integration:concurrency` e falha o workflow se a suíte falhar
- [ ] O job é independente de `integration:`/`backup-integration:` — nenhum depende do outro
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `ci: run the concurrency proof in its own job with a real Postgres`

---

### T5: Emenda na ADR-0007

**What**: Acrescenta uma segunda Emenda em `docs/adr/0007-*.md`, nomeando esta suíte como a
segunda exceção nomeada ao "todo teste de integração usa PGlite" — mesmo formato da Emenda de
2026-08-24.
**Where**: `docs/adr/0007-*.md`
**Depends on**: T4
**Reuses**: formato da Emenda existente.
**Requirement**: CCP-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A Emenda nomeia RBAC-12 e BOOT-08 como o motivo, e o alvo/job novo como a solução
- [ ] A regra geral da ADR é atualizada para citar as DUAS exceções nomeadas, não só `infra/backup`
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(adr): record the second named exception to PGlite-only integration tests`

---

### T6: Atualizar `rbac-clarity` e `instance-bootstrap`

**What**: RBAC-12 em `rbac-clarity/spec.md` e BOOT-08 em `instance-bootstrap/spec.md` deixam de
estar `⚠️ Verified (parcial)` — viram `✅ Verified` com uma nota em cada `validation.md` apontando
para esta feature como a prova que faltava.
**Where**: `.specs/features/rbac-clarity/spec.md`, `.specs/features/rbac-clarity/validation.md`,
`.specs/features/instance-bootstrap/spec.md`, `.specs/features/instance-bootstrap/validation.md`
**Depends on**: T5
**Reuses**: nenhum.
**Requirement**: CCP-01..07 (fechamento documental)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] RBAC-12 e BOOT-08 aparecem `✅ Verified` nas suas tabelas de rastreabilidade
- [ ] Cada `validation.md` cita o arquivo de teste desta feature como a evidência nova
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(specs): close the RBAC-12 and BOOT-08 concurrency gaps`

---

### T7: Fechar a dívida no roadmap e no handoff

**What**: Atualiza `remediation-roadmap.md` e a subseção `platform-remediation` de `.specs/
STATE.md`, marcando R27 como fechada.
**Where**: `.specs/features/platform-maturity/remediation-roadmap.md`, `.specs/STATE.md`
**Depends on**: T6
**Reuses**: nenhum.
**Requirement**: CCP-01..09 (fechamento documental)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] R27 aparece fechada no roadmap
- [ ] `.specs/STATE.md` reflete o novo alvo e job no handoff
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(specs): close R27 in the remediation handoff`
