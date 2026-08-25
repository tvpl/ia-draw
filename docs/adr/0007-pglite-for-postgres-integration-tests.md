# ADR-0007: PGlite para testes de integração de PostgreSQL sem Docker

## Status

Aceita

## Data

2026-08-12

## Contexto

Os testes de integração de `packages/database` e de todo módulo de `apps/server` que depende de
PostgreSQL precisam de um Postgres real — constraints, índices únicos, transações e comportamento de
`ON CONFLICT` não são fielmente simuláveis por um mock. A abordagem padrão da indústria para isso é
testcontainers, que sobe um container Postgres real por suíte de teste via Docker.

O ambiente de execução usado neste projeto não tem daemon Docker disponível (o CLI `docker` está
presente, mas o socket não). `@electric-sql/pglite` roda um engine PostgreSQL genuíno compilado para
WASM, executável em Node puro, sem qualquer daemon — preservando fidelidade real de SQL/constraints
sem a dependência de infraestrutura que falta neste ambiente.

## Decisão

Todo teste de integração de PostgreSQL usa `@electric-sql/pglite` em qualquer ambiente sem daemon
Docker disponível. CI (GitHub Actions) continua usando Postgres/MinIO reais via `services:` de container,
já que ali o Docker está disponível — a produção e o CI real nunca dependem de PGlite.

## Emenda (2026-08-24, onda F11/R20)

A decisão acima continua ativa e não foi revertida — foi **delimitada**. `infra/backup` nunca
poderá cumpri-la: seus testes de integração invocam `pg_dump` e criam clusters reais via
`pg_createcluster`, coisas que PGlite não oferece e nunca vai oferecer. Enquanto esse pacote
participou do alvo padrão, `make test-integration` saía 1 em qualquer host sem um Postgres
instalado, o que contradizia na prática a promessa "sem daemon, sem instalação" que esta ADR
declara.

A suíte de `infra/backup` passa a ter alvo próprio (`make test-integration-backup`, script
`test:integration:backup`) e um job de CI dedicado com o serviço Postgres disponível. Nenhum teste
foi removido, pulado ou enfraquecido: os mesmos casos continuam rodando, por outro comando.

Leia esta ADR assim: **todo teste de integração de Postgres usa PGlite, exceto os de
`infra/backup`, que exigem um cluster real e são invocados separadamente.**

## Emenda (2026-08-25, onda R24-R28/concurrency-proof)

A decisão acima continua ativa — ganha uma segunda exceção nomeada, pelo mesmo motivo estrutural
da primeira: PGlite é uma única conexão embutida, e dois requisitos deste projeto dependem
especificamente de **duas conexões reais competindo pelo mesmo lock**, algo que uma única conexão
nunca pode exercitar, mesmo intercalando chamadas cooperativamente.

RBAC-12 ("duas remoções concorrentes deixam no máximo um administrador do workspace") e BOOT-08
("dois `first-run` concorrentes criam no máximo uma conta") seguram, respectivamente, um
`select ... for update` (`withLastAdminGuard`, `apps/server/src/modules/workspace/lastAdmin.ts`) e
um `pg_advisory_xact_lock` (`bootstrapInstance`, `apps/server/src/modules/auth/firstRun.ts`) —
mecanismos que só fazem sentido sob concorrência genuína. Os dois requisitos ficaram
`⚠️ Verified (parcial)` nas ondas que os entregaram, com o próximo passo já nomeado: provar contra
um Postgres real, do mesmo jeito que `infra/backup` já faz.

A suíte que prova os dois (`apps/server/src/modules/workspace/lastAdmin.concurrency.int.spec.ts`,
`apps/server/src/modules/auth/firstRun.concurrency.int.spec.ts`) ganhou o mesmo tratamento:
alvo próprio (`make test-integration-concurrency`, script `test:integration:concurrency`,
config `vitest.integration.concurrency.config.ts` restrita a `*.concurrency.int.spec.ts`) e um
job de CI dedicado (`concurrency-integration`) que instala Postgres via `apt-get`, sem Docker —
mesmo padrão de `backup-integration`. `vitest.integration.config.ts` (o alvo padrão) passou a
excluir explicitamente esse mesmo glob, para que `make ci`/`make test-integration` continuem
saindo 0 em qualquer host sem Postgres instalado. Nenhum teste foi removido, pulado ou
enfraquecido — os mesmos dois requisitos, antes parciais, agora provados por outro comando.

Leia esta ADR assim agora: **todo teste de integração de Postgres usa PGlite, exceto os de
`infra/backup` e os da prova de concorrência real (RBAC-12/BOOT-08), que exigem um cluster real e
são invocados separadamente, cada um com seu próprio alvo e job de CI.**

## Consequências

- PGlite não cobre comportamento específico de rede/socket do Postgres real — irrelevante para os
  testes de schema/constraint/transação que este projeto escreve.
- MinIO não tem equivalente WASM; testes de integração de asset/storage ficam reservados ao CI real
  (com Docker) desde a onda F1c.
- Ondas posteriores (F4/F5) confirmaram esta mesma disciplina de "engine real sem Docker" para outras
  dependências que ficaram disponíveis neste sandbox mesmo sem Docker — `redis-server` (AD-009) e
  instâncias Postgres adicionais via `pg_createcluster` (usadas pelos testes de backup/restore
  incremental e de teste de restore automatizado, F5).
- `infra/backup` e a prova de concorrência real (RBAC-12/BOOT-08) são as duas exceções nomeadas
  (ver Emendas): cada uma com alvo e job de CI próprios, Postgres real obrigatório, nunca parte de
  `make ci`/`make test-integration`.
- Escopo: todo teste de integração de `packages/database` e módulos de `apps/server` que dependem de
  Postgres, em qualquer ambiente sem Docker.
