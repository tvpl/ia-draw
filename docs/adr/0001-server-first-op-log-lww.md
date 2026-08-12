# ADR-0001: Sincronização e persistência por op-log LWW nativo do Excalidraw

## Status

Aceita

## Data

2026-08-11

## Contexto

O Excalidraw expõe seu próprio modelo de reconciliação por elemento: cada elemento de cena carrega
`version` e `versionNonce`, e o upstream exporta `reconcileElements` para resolver divergências entre
uma cena local e uma remota. A alternativa considerada era adotar um CRDT genérico (Yjs) sobre o
documento inteiro.

Updates Yjs são binários opacos. Validar permissão por elemento, gerar um `operation_summary` legível
e auditar mudanças exigiria materializar o documento inteiro a cada lote só para inspecioná-lo. O
modelo LWW por elemento, em contraste, é nativo do upstream e produz auditoria, diff e replay legíveis
sem trabalho extra.

## Decisão

Sincronização e persistência usam o op-log LWW nativo do Excalidraw (`version`/`versionNonce` +
`reconcileElements`), com deltas JSON de domínio gravados em `diagram_operations`. Yjs/CRDT fica
descartado para o MVP.

## Consequências

- Sem merge granular de texto colaborativo dentro do mesmo elemento; conflitos no mesmo elemento
  resolvem por last-writer-wins, com a variante perdedora preservada no histórico de operações.
- `diagram_operations` grava deltas legíveis (JSONB), não blobs binários — auditoria e replay são
  diretos.
- Escopo afetado: `diagram-domain`, `editor-adapter`, `apps/server` (persistência e realtime), modelo
  de dados (`diagram_operations`, `diagram_snapshots`).
- Se a perda de merge granular de texto se mostrar inaceitável em uso real, uma ADR futura pode
  reabrir Yjs para esse caso específico, sem reverter o restante do modelo.
