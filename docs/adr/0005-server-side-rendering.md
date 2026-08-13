# ADR-0005: Renderização server-side via exportToSvg + rasterização

## Status

Aceita — rota SVG-first confirmada pelo spike T10

## Data

2026-08-11 (proposta) — 2026-08-12 (decidida, após o spike T10)

## Contexto

Thumbnails, exportação para PNG/PDF e preview de diagramas gerados por IA precisam ser renderizados no
servidor, sem depender do browser do usuário. A alternativa considerada é rodar Chromium headless no
worker para renderizar a cena como o browser faria.

Chromium como dependência dura do worker significa uma imagem de container pesada e uma superfície de
segurança maior (um browser completo embutido no processo de jobs). A rota `exportToSvg` do pacote
`@excalidraw/utils`, executada em Node, seguida de rasterização SVG→PNG (`resvg`), é leve e
determinística — mas depende de fidelidade suficiente sem os globais de browser que o Excalidraw
normalmente assume (fontes, medição de texto, canvas).

## Decisão

Renderização server-side (thumbnails, PNG/PDF, preview) usa `exportToSvg` do pacote `@excalidraw/utils`
em Node, com rasterização via `@resvg/resvg-js`. Chromium headless não entra no MVP.

**Evidência do spike (T10, `apps/server/src/modules/render/`):** `exportToSvg` rodando em Node, com
jsdom + `canvas` (node-canvas) + um shim mínimo de `FontFace`, produziu para a fixture de texto um SVG
com a fonte real (Excalifont) embutida como woff2/base64 — não um placeholder ou caixa vazia — e o
texto literal presente no XML:

```
viewBox="0 0 274.86328125 45" width="274.86328125" height="45"
...<text ...>Hello architecture canvas</text>
```

A mesma cadeia (`exportToSvg` → `resvg`) rodou sem erro para as 5 fixtures de T9 (texto, arrow com
binding, imagem, frame, grupo), produzindo em cada caso um PNG não vazio com os magic bytes corretos.
7 testes automatizados cobrem isso em `apps/server/src/modules/render/render.spec.ts`.

## Consequências

- Rota confirmada: fidelidade de texto e dimensões é real, não um fallback degradado — decisão
  original (AD-005) se mantém sem precisar do fallback Chromium.
- Custo operacional real, descoberto pelo spike, que a decisão original não previa: `exportToSvg` (e o
  próprio `@excalidraw/excalidraw`, usado pelas fixtures) leem `window`/`document`/`FontFace`
  diretamente do escopo global, sem nenhum modo headless oficial. Rodar em Node exige instalar um
  ambiente DOM (jsdom) e um binário nativo de canvas (`canvas`/node-canvas) no processo do servidor —
  trocamos "sem Chromium" por "com jsdom + canvas nativo", mais leve que Chromium mas não gratuito;
  revisar o tamanho final da imagem do servidor quando os módulos de export/thumbnail forem
  implementados de verdade (F1+).
- Achado adicional: os tipos TypeScript publicados de `@excalidraw/utils@0.1.3-test32` (a única tag
  `latest` disponível — o pacote nunca teve um release estável, só tags de teste) referenciam
  `@excalidraw/common`/`@excalidraw/element/*` como pacotes separados que não são dependências reais
  publicadas do pacote. Isso quebra a resolução de tipos do `exportToSvg` para quem consome o pacote de
  fora do monorepo do Excalidraw — contornado em `apps/server/src/modules/render/svg.ts` com um tipo
  escrito à mão e `@ts-expect-error` documentado, apontando para a assinatura real lida do `.d.ts`
  fonte. Acompanhar releases futuros de `@excalidraw/utils` que corrijam isso.
- Escopo afetado: módulo de jobs/render do `apps/server`, exports, thumbnails, preview de IA.
