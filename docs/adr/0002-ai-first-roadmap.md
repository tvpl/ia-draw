# ADR-0002: Roadmap AI-first — geração por IA antes de colaboração realtime

## Status

Aceita

## Data

2026-08-11

## Contexto

O diferencial declarado do produto é a geração de diagramas de arquitetura de alta qualidade por IA.
A alternativa considerada era seguir a ordem convencional de plataformas colaborativas: entregar
colaboração realtime multiplayer (cursores ao vivo, presença, coedição simultânea) antes de qualquer
recurso de IA.

Colaboração realtime multiplayer é a infraestrutura mais cara do roadmap (presença, coordenação
multi-node, Redis) e não bloqueia o valor central do produto. Adiá-la não impede uso em equipe: edição
concorrente sem cursores ao vivo já é viável via op-log + reconexão (ADR-0001).

## Decisão

O roadmap é AI-first: a fase de IA geradora (F2) é entregue antes da colaboração realtime multiplayer
(F4); comentários assíncronos (F3) também antecedem o realtime.

## Consequências

- Coedição simultânea com cursores ao vivo chega meses depois do MVP.
- Até a fase de realtime, edição concorrente resolve inteiramente por op-log e reconexão (ADR-0001),
  sem presença nem cursores compartilhados.
- Escopo afetado: roadmap e priorização de todas as fases de entrega.
