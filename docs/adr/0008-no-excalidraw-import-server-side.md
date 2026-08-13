# ADR-0008: nenhum pacote server-side importa `@excalidraw/excalidraw` por valor

## Status

Aceita

## Data

2026-08-12

## Contexto

Durante a onda F1b, o orquestrador tentou subir o entrypoint real de produção (`node
apps/server/dist/index.js`) pela primeira vez — todas as ondas anteriores só haviam confirmado o
servidor sob Vitest (que roda por trás do Vite). O boot real quebrou com `ERR_MODULE_NOT_FOUND`.

A causa raiz: o bundle publicado de `@excalidraw/excalidraw` importa `roughjs/bin/rough` sem a extensão
`.js`. O resolvedor ESM estrito do Node rejeita isso; bundlers como Vite/webpack resolvem de forma
lenient e escondem o problema. Qualquer coisa no grafo de import do servidor que carregasse
`@excalidraw/excalidraw` (ou `@arch-canvas/editor-adapter`, que o reexporta) por valor — não só por
`import type` — quebrava o boot real, mesmo que a suíte de testes inteira estivesse verde.

`packages/diagram-domain` (mesclagem/reconciliação de cena no servidor) foi o primeiro pacote afetado,
seguido por `packages/diagram-ir` (compilador IR→cena, F2b) e `apps/server/src/modules/ws-gateway`
(relay de mutação via WebSocket, F4) — todos manipulam `SceneElement`/diffs de elemento no servidor.

## Decisão

Nenhum pacote ou módulo que roda server-side (`apps/server/**`, `packages/diagram-domain`,
`packages/diagram-ir`, `packages/ai-tools`, e qualquer pacote futuro na mesma situação) pode importar
`@excalidraw/excalidraw` ou `@arch-canvas/editor-adapter` **por valor** — somente `import type` (que é
apagado na compilação, nunca chega ao bundle JS real). Elementos de cena construídos ou mesclados no
servidor usam implementações locais, dependency-free, com tipos de dados espelhando o shape real do
Excalidraw (ver `packages/diagram-domain/src/mergeScene.ts` para o padrão de referência).

Todo pacote/módulo server-side novo confirma isso ao final do build: `pnpm -w build && grep -rn
"excalidraw" <pacote>/dist/*.js` não deve mostrar nenhum import/require real (comentários/strings em
mensagens de erro são aceitáveis).

## Consequências

- Pequena duplicação da regra de desempate LWW (poucas linhas, documentadas e testadas
  independentemente) em vez de reusar `applyRemote` do `editor-adapter`.
- Cada novo pacote server-side que precisar de lógica de elemento de cena precisa da mesma disciplina —
  o grep acima faz parte do gate de build de toda onda que toca código server-side manipulando cena.
- `apps/server/src/core/no-egress.spec.ts` (guardrail de rede) foi estendido para também servir de
  ponto de referência do que é código server-side "sensível" a esta regra.
- Escopo: todo pacote/módulo server-side atual e futuro que manipula `SceneElement`/diffs de elemento.
