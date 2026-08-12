# ADR-0003: MVP como monólito modular

## Status

Aceita

## Data

2026-08-11

## Contexto

O MVP precisa expor REST, WebSocket e execução de jobs em background. A alternativa considerada era
separar esses três eixos em serviços independentes desde o início (`api`, `realtime`, `worker`),
seguindo o desenho de deploy já cogitado para fases futuras de escala.

Rodar três (ou mais) serviços separados desde o MVP eleva a superfície operacional do `docker compose`
para cerca de 10 serviços, sem entregar benefício de escala no volume de uso inicial. As fronteiras
entre REST, WebSocket e jobs já existem nos packages do monorepo, o que torna o split futuro trivial
quando for necessário.

## Decisão

O MVP roda como monólito modular: um único processo Node (`apps/server`) expõe REST, WebSocket e
executa jobs, cortando o compose para cerca de 7 serviços em vez de 10. As fronteiras de módulo são
mantidas nos packages do monorepo, não no processo.

## Consequências

- Escala independente por módulo (REST vs. WebSocket vs. jobs) só fica disponível após um split
  futuro.
- Um crash no processo derruba REST, WebSocket e jobs juntos no MVP — não há isolamento de falha entre
  eles até o split.
- Escopo afetado: `apps/server`, `infra/compose`, topologia de deploy.
- O split para serviços separados é uma extração mecânica quando a escala exigir, porque as fronteiras
  de módulo já existem nos packages (`diagram-domain`, `diagram-ir`, `ai-tools`, etc.).
