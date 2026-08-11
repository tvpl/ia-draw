# STATE

## Decisions

### AD-001
- **Decision**: Sincronização e persistência por op-log LWW nativo do Excalidraw (`version`/`versionNonce` + `reconcileElements`) com deltas JSON de domínio em `diagram_operations`; Yjs CRDT descartado para o MVP.
- **Reason**: Updates Yjs são binários opacos — validar permissão por elemento, gerar `operation_summary` e auditar exigiria materializar o documento a cada batch. O LWW por elemento é o modelo nativo do upstream e dá auditoria, diff e replay legíveis de graça.
- **Trade-off**: Sem merge granular de texto colaborativo dentro do mesmo elemento; conflitos no mesmo elemento resolvem por last-writer-wins (variantes preservadas no histórico).
- **Scope**: `diagram-domain`, `editor-adapter`, `apps/server` (persistência e realtime), modelo de dados (`diagram_operations`, `diagram_snapshots`).
- **Date**: 2026-08-11
- **Status**: active

### AD-002
- **Decision**: Roadmap AI-first — IA geradora (F2) entregue antes da colaboração realtime multiplayer (F4); comentários assíncronos antes do realtime (F3).
- **Reason**: O diferencial declarado do produto é geração de diagramas de alta qualidade por IA; realtime multiplayer é a infra mais cara (presença, multi-node, Redis) e não bloqueia o valor central.
- **Trade-off**: Coedição simultânea chega meses depois; até lá, edição concorrente resolve por op-log + reconexão, sem cursores ao vivo.
- **Scope**: Roadmap, priorização de todas as fases.
- **Date**: 2026-08-11
- **Status**: active

### AD-003
- **Decision**: MVP como monólito modular — um processo Node (`apps/server`: REST + WebSocket + jobs) em vez de api/realtime/worker separados; fronteiras mantidas nos packages do monorepo.
- **Reason**: Corta a superfície operacional do compose (~7 serviços em vez de 10) sem sacrificar o split futuro, que fica trivial porque as fronteiras já existem nos packages.
- **Trade-off**: Escala independente de módulos só após split; um crash derruba REST+WS+jobs juntos no MVP.
- **Scope**: `apps/server`, `infra/compose`, topologia de deploy.
- **Date**: 2026-08-11
- **Status**: active

### AD-004
- **Decision**: IR declarativa `diagram-ir/v1` (JSON Schema versionado: nós, containers, edges semânticos, swimlanes, layout hints) como peça central da geração por IA e do architecture-as-code; LLM emite IR one-shot para criação, tool calls só para edição incremental; layout sempre determinístico no servidor.
- **Reason**: Um shot de IR coerente supera dezenas de tool calls em custo, latência e consistência visual; a mesma IR alimenta import/export Mermaid/Structurizr e geração programática sem LLM.
- **Trade-off**: Mais um schema para versionar e manter compatível; conversões IR↔cena precisam de testes de round-trip próprios.
- **Scope**: `packages/diagram-ir`, `packages/ai-tools`, pipeline de geração, import/export.
- **Date**: 2026-08-11
- **Status**: active

### AD-005
- **Decision**: Renderização server-side (thumbnails, PNG/PDF, preview) via `exportToSvg` do pacote utils em Node + rasterização resvg/sharp; Chromium headless somente como fallback se a fidelidade exigir. Spike obrigatório na F0 valida a rota.
- **Reason**: Evita Chromium como dependência dura do worker (imagem pesada, superfície de segurança); a rota SVG-first é leve e determinística.
- **Trade-off**: Possíveis diferenças de fidelidade (fontes, embeds) vs render do browser; o spike decide e o fallback existe.
- **Scope**: módulo de jobs do `apps/server`, exports, thumbnails, preview de IA.
- **Date**: 2026-08-11
- **Status**: active

### AD-006
- **Decision**: MVP sem Redis — jobs via pg-boss sobre PostgreSQL; Redis entra apenas na fase de colaboração realtime multi-node (F4), restrito a presença/pub-sub.
- **Reason**: Um store a menos para operar e fazer backup no MVP; Redis nunca seria fonte da verdade de qualquer forma.
- **Trade-off**: Throughput de fila limitado pelo PostgreSQL (irrelevante na escala interna); migração de fila para BullMQ/Redis se o volume exigir.
- **Scope**: `infra/compose`, módulo de jobs, F4.
- **Date**: 2026-08-11
- **Status**: active

## Handoff

- **Feature**: architecture-canvas (`.specs/features/architecture-canvas/`)
- **Phase / Task**: Tasks — design.md e tasks.md (onda F0, T1..T11) escritos e validados; aguardando aprovação para Execute
- **Completed**: Specify aprovado pelo usuário (spec.md 77 requisitos); design.md (arquitetura completa, APIs upstream verificadas); tasks.md F0 com 11 tasks em 3 fases, validate_tasks 0 erros; traceability FND-01..05 + EDT-07 → In Tasks
- **In-progress** (file:line): none
- **Next step**: usuário aprova tasks.md + escolhe execução inline vs sub-agents (2 batches: A=T1..T7, B=T8..T11) → Execute Batch A
- **Blockers**: aprovação do usuário para iniciar implementação
- **Uncommitted files**: none (após commit desta sessão)
- **Branch**: claude/architecture-canvas-system-cdwop7
