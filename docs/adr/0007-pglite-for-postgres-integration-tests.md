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

## Consequências

- PGlite não cobre comportamento específico de rede/socket do Postgres real — irrelevante para os
  testes de schema/constraint/transação que este projeto escreve.
- MinIO não tem equivalente WASM; testes de integração de asset/storage ficam reservados ao CI real
  (com Docker) desde a onda F1c.
- Ondas posteriores (F4/F5) confirmaram esta mesma disciplina de "engine real sem Docker" para outras
  dependências que ficaram disponíveis neste sandbox mesmo sem Docker — `redis-server` (AD-009) e
  instâncias Postgres adicionais via `pg_createcluster` (usadas pelos testes de backup/restore
  incremental e de teste de restore automatizado, F5).
- Escopo: todo teste de integração de `packages/database` e módulos de `apps/server` que dependem de
  Postgres, em qualquer ambiente sem Docker.
