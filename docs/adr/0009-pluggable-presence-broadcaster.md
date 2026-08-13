# ADR-0009: presença em tempo real via `PresenceBroadcaster` injetável

## Status

Aceita

## Data

2026-08-12

## Contexto

A F4 (colaboração em tempo real) precisa propagar cursores/seleção/presença entre clientes conectados
ao mesmo diagrama via WebSocket (CLB-01), sem nunca persistir esses dados (CLB-04 — perda de presença
nunca pode arriscar conteúdo durável). AD-006 já havia reservado Redis "restrito a presença/pub-sub"
exatamente para esta fase, mas o MVP continua sendo um monólito de processo único (AD-003, ainda não
superada) — a maioria dos deployments reais no curto prazo não terá múltiplas instâncias de
`apps/server` atrás de um load balancer.

## Decisão

Presença é propagada por uma interface `PresenceBroadcaster` (`publish`/`subscribe`) injetável em
`ws-gateway`, com duas implementações:

- `InMemoryPresenceBroadcaster` — `EventEmitter` de processo único, padrão, zero I/O externo. O
  servidor sobe e funciona inteiramente sem qualquer configuração adicional.
- `RedisPresenceBroadcaster` — pub/sub via `ioredis`, usada quando `REDIS_URL` está configurado.
  Necessária apenas quando duas ou mais instâncias de `apps/server` (atrás de um load balancer) 
  precisam compartilhar presença entre si.

A seleção entre as duas acontece em `registerAllModules` (mesmo padrão de injeção de `deps.jobs`/
`deps.storage`). A propagação cross-instância via Redis foi provada com dois processos `apps/server`
reais e um `redis-server` real (não mockado) — o `redis-server` está disponível neste sandbox mesmo
sem Docker, seguindo a mesma disciplina "engine real sem Docker" do AD-007.

## Consequências

- Sem Redis configurado, dois usuários conectados a instâncias `apps/server` diferentes não veem os
  cursores um do outro — aceitável para o MVP de processo único (AD-003); documentado no serviço
  `redis` opcional de `infra/compose/compose.yaml`.
- Presença nunca é persistida em nenhuma das duas implementações (nenhuma delas importa `Db`/drizzle) —
  a ausência de Redis nunca arrisca conteúdo durável, apenas reduz o alcance da presença a um processo.
- Escopo: `apps/server/src/modules/ws-gateway`, `infra/compose/compose.yaml`, F4 em diante.
