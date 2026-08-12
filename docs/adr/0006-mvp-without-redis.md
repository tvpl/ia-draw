# ADR-0006: MVP sem Redis

## Status

Aceita

## Data

2026-08-11

## Contexto

O MVP precisa de uma fila de jobs em background (renderização, exportação, execução de runs de IA). A
alternativa considerada era introduzir Redis desde o início como store de fila (por exemplo via
BullMQ), antecipando a necessidade que a fase de colaboração realtime multiplayer (F4) vai ter para
presença e pub-sub.

Um store adicional no MVP significa mais uma peça para operar e fazer backup, sem que Redis chegasse a
ser fonte da verdade de qualquer dado em nenhum cenário — PostgreSQL e object storage já cumprem esse
papel (invariante do produto). O volume de jobs esperado no MVP não se aproxima do limite de throughput
de uma fila baseada em PostgreSQL.

## Decisão

O MVP não usa Redis. Jobs em background rodam via `pg-boss` sobre o PostgreSQL já existente. Redis
entra apenas na fase de colaboração realtime multi-node (F4), e ali restrito a presença/pub-sub — nunca
como fonte da verdade.

## Consequências

- Throughput de fila fica limitado pelo PostgreSQL; irrelevante na escala interna esperada do MVP.
- Se o volume de jobs crescer além do que o PostgreSQL sustenta confortavelmente, a migração para
  BullMQ/Redis fica disponível como opção posterior, sem mudança de contrato para os produtores de job.
- Escopo afetado: `infra/compose` (um serviço a menos no MVP), módulo de jobs do `apps/server`, e a
  futura F4 (que introduz Redis apenas para presença/pub-sub).
