# ADR-0004: IR declarativa `diagram-ir/v1` como núcleo da geração por IA

## Status

Aceita

## Data

2026-08-11

## Contexto

A IA precisa criar e editar diagramas de arquitetura de forma consistente e determinística. A
alternativa considerada era o LLM operar diretamente sobre a cena do Excalidraw via uma sequência de
tool calls incrementais (mover elemento, criar nó, ligar aresta, ...) tanto para criação quanto para
edição.

Uma IR (intermediate representation) declarativa e coerente, emitida em um único shot pelo LLM, supera
dezenas de tool calls em custo, latência e consistência visual — o layout final fica determinístico e
reproduzível no servidor em vez de depender da ordem e da qualidade de cada chamada de ferramenta. A
mesma IR também serve como formato de import/export (Mermaid, Structurizr) e permite geração
programática de diagramas sem envolver um LLM.

## Decisão

Uma IR declarativa versionada, `diagram-ir/v1` (JSON Schema com nós, containers, arestas semânticas,
swimlanes e hints de layout), é a peça central da geração por IA e do architecture-as-code. O LLM emite
a IR completa em um shot para criação; tool calls ficam restritas a edição incremental. Layout é sempre
determinístico, calculado no servidor a partir da IR.

## Consequências

- Mais um schema para versionar e manter compatível ao longo do tempo (`diagram-ir/v1`, `v2`, ...).
- Conversões IR↔cena precisam de testes de round-trip próprios para não silenciosamente perder
  informação semântica entre uma representação e outra.
- Escopo afetado: `packages/diagram-ir`, `packages/ai-tools`, pipeline de geração por IA, import/export
  de formatos externos.
