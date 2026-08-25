# Prova de concorrência real Specification

## Problem Statement

RBAC-12 ("duas remoções concorrentes deixam no máximo um administrador") e BOOT-08 ("dois
`first-run` concorrentes criam no máximo uma conta") são garantias reais no código —
`withLastAdminGuard` e `bootstrapInstance` seguram um lock dentro da transação especificamente
para isso — mas nenhum teste prova a corrida de verdade. `make test-integration` roda sobre
PGlite (ADR-0007), que é uma única conexão embutida: duas chamadas concorrentes contra ela nunca
correm de verdade, só se intercalam cooperativamente. Os dois requisitos ficaram marcados
`⚠️ Verified (parcial)` nas ondas que os entregaram, com o próximo passo já nomeado: provar contra
um cluster Postgres real, do mesmo jeito que `infra/backup` já faz.

## Goals

- [ ] RBAC-12 é provado com duas requisições HTTP genuinamente concorrentes contra um Postgres real
- [ ] BOOT-08 é provado com dois `POST /auth/first-run` genuinamente concorrentes contra um Postgres real
- [ ] O novo alvo segue o mesmo padrão de exceção nomeada que `test-integration-backup` já
      estabeleceu — não entra no `make ci` padrão, tem alvo e job próprios
- [ ] `docs/adr/0007-*.md` ganha uma Emenda nomeando esta segunda exceção

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Migrar todo `make test-integration` para Postgres real | Reverteria a decisão central da ADR-0007 (PGlite = sem daemon, sem instalação); o gap é só nestes dois requisitos que dependem de concorrência genuína entre conexões |
| Provar concorrência em qualquer outro requisito do sistema | RBAC-12 e BOOT-08 são os dois únicos requisitos hoje marcados parciais por esta razão específica — este item fecha os dois, não abre uma varredura nova |
| Usar testcontainers/Docker | Mesmo motivo da ADR-0007 original: sem Docker neste sandbox; o padrão já estabelecido por `infra/backup` (Postgres real instalado via `apt-get`/`pg_createcluster`, sem container) é o que este item reusa |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde a suíte roda | Novo pacote de testes em `apps/server`, arquivos `*.concurrency.int.spec.ts`, config `vitest.integration.concurrency.config.ts` própria, contra `process.env.DATABASE_URL` obrigatório (sem fallback para PGlite) | Reusa exatamente o harness HTTP que `rbac-matrix.int.spec.ts` já usa (`buildServer` + `registerModule` + `app.inject`), só trocando o driver de banco — menor mudança possível para obter concorrência real | y |
| Como a concorrência é exercitada | `Promise.all` disparando duas chamadas (`app.inject` ou requisição HTTP real) ao mesmo tempo contra o MESMO Postgres real; a serialização correta vem do lock do banco (`select ... for update` / `pg_advisory_xact_lock`), não de qualquer coordenação no lado do teste | É exatamente o que PGlite não pode oferecer — duas conexões reais competindo pelo mesmo lock. `Promise.all` mais um `pg.Pool` com mais de uma conexão é suficiente; não precisa de dois processos Node separados | y |
| Nome do alvo/comando | `make test-integration-concurrency` → `pnpm --filter @arch-canvas/server run test:integration:concurrency` | Espelha literalmente `test-integration-backup` → `test:integration:backup`, mesmo padrão, mesma legibilidade | y |
| Comportamento sem Postgres real disponível | Falha alto e cedo com mensagem nomeando a variável `DATABASE_URL` ausente/inalcançável, nunca um stack trace de conexão recusada sem contexto | Mesmo padrão de erro acionável que o resto do projeto já segue (ver `loadConfig`, `firstRun.ts`) | y |

**Open questions:** none — resolvidas acima.

---

## User Stories

### P1: RBAC-12 provado contra concorrência real ⭐ MVP

**User Story**: Como responsável técnico validando este projeto, quero uma prova executável de que
duas remoções concorrentes de administrador nunca esvaziam um workspace, para confiar na garantia
sem precisar ler o código do lock.

**Why P1**: É uma garantia de integridade de dados marcada parcial por falta de prova, não por
falta de mecanismo.

**Acceptance Criteria**:

1. WHEN a suíte roda contra um Postgres real com um workspace de exatamente dois administradores
   THEN o sistema SHALL disparar duas remoções concorrentes (uma por administrador) via
   `Promise.all`
2. WHEN as duas remoções concorrentes resolvem THEN o sistema SHALL observar exatamente uma
   resposta `204` e exatamente uma resposta `409`
3. WHEN as duas remoções concorrentes resolvem THEN o sistema SHALL observar exatamente um
   administrador restante na tabela de associação do workspace
4. IF a suíte roda sem `DATABASE_URL` apontando para um Postgres real alcançável THEN o sistema
   SHALL falhar com uma mensagem nomeando a variável ausente, antes de tentar qualquer conexão

**Independent Test**: rodar `make test-integration-concurrency` com um Postgres local instalado e
ver a suíte verde; rodar sem `DATABASE_URL` e ver a mensagem de erro nomeada, não um stack trace.

---

### P1: BOOT-08 provado contra concorrência real ⭐ MVP

**User Story**: Como responsável técnico validando este projeto, quero uma prova executável de que
dois `first-run` concorrentes nunca criam duas contas administradoras, para confiar na garantia sem
precisar ler o código do advisory lock.

**Why P1**: Mesma classe de garantia que RBAC-12, mesmo motivo de estar parcial.

**Acceptance Criteria**:

1. WHEN a suíte roda contra um Postgres real com a tabela `users` vazia THEN o sistema SHALL
   disparar dois `POST /auth/first-run` concorrentes com corpos diferentes via `Promise.all`
2. WHEN os dois `first-run` concorrentes resolvem THEN o sistema SHALL observar exatamente uma
   resposta `201` e exatamente uma resposta `409`
3. WHEN os dois `first-run` concorrentes resolvem THEN o sistema SHALL observar exatamente uma
   linha na tabela `users`

**Independent Test**: rodar `make test-integration-concurrency` e ver a suíte verde, provando que a
segunda tentativa nunca cria uma segunda conta.

---

### P2: A exceção fica documentada e isolada do gate padrão

**User Story**: Como pessoa nova neste repositório, quero que o alvo de concorrência real não
apareça escondido dentro de `make ci`, para não ver o gate padrão exigir um Postgres instalado.

**Why P2**: É a mesma promessa que `test-integration-backup` já protege — quebrá-la aqui
contradiria a Emenda de 2026-08-24 na mesma ADR.

**Acceptance Criteria**:

1. The sistema SHALL manter `make ci`/`make test-integration` executáveis sem qualquer Postgres
   real instalado, exatamente como antes desta mudança
2. WHEN o CI roda THEN o sistema SHALL executar a suíte de concorrência em um job próprio com um
   Postgres real disponível
3. The `docs/adr/0007-*.md` SHALL ganhar uma Emenda nomeando esta segunda exceção, no mesmo formato
   da Emenda de 2026-08-24

**Independent Test**: `make ci` num checkout limpo sem Postgres instalado continua saindo 0.

---

## Edge Cases

- IF as duas requisições concorrentes de RBAC-12 chegam a um workspace com MAIS de dois
  administradores THEN esse cenário SHALL não ser o caso testado — a prova exige exatamente dois,
  o número mínimo em que a corrida importa
- WHEN o Postgres real usado pela suíte já tem dados de uma corrida anterior (banco não limpo)
  THEN o sistema SHALL criar seu próprio schema/dados isolados por execução, nunca assumir um
  banco vazio global

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CCP-01 | P1: RBAC-12 provado contra concorrência real | Tasks | ✅ Verified |
| CCP-02 | P1: RBAC-12 provado contra concorrência real | Tasks | ✅ Verified |
| CCP-03 | P1: RBAC-12 provado contra concorrência real | Tasks | ✅ Verified |
| CCP-04 | P1: RBAC-12 provado contra concorrência real | Tasks | ✅ Verified |
| CCP-05 | P1: BOOT-08 provado contra concorrência real | Tasks | ✅ Verified |
| CCP-06 | P1: BOOT-08 provado contra concorrência real | Tasks | ✅ Verified |
| CCP-07 | P1: BOOT-08 provado contra concorrência real | Tasks | ✅ Verified |
| CCP-08 | P2: A exceção fica documentada e isolada do gate padrão | Tasks | ✅ Verified |
| CCP-09 | P2: A exceção fica documentada e isolada do gate padrão | Tasks | Pending |
| CCP-10 | P2: A exceção fica documentada e isolada do gate padrão | Tasks | Pending |

**Coverage:** 10 total, 10 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] `make test-integration-concurrency` prova RBAC-12 e BOOT-08 contra Postgres real
- [ ] `make ci` continua saindo 0 sem Postgres instalado
- [ ] RBAC-12 e BOOT-08 deixam de estar `⚠️ Parcial` em suas specs
- [ ] `docs/adr/0007-*.md` documenta a segunda exceção
