# ADR-0005: Renderização server-side via exportToSvg + rasterização

## Status

Proposta — aguardando veredito do spike T10

## Data

2026-08-11

## Contexto

Thumbnails, exportação para PNG/PDF e preview de diagramas gerados por IA precisam ser renderizados no
servidor, sem depender do browser do usuário. A alternativa considerada é rodar Chromium headless no
worker para renderizar a cena como o browser faria.

Chromium como dependência dura do worker significa uma imagem de container pesada e uma superfície de
segurança maior (um browser completo embutido no processo de jobs). A rota `exportToSvg` do pacote
`@excalidraw/utils`, executada em Node, seguida de rasterização SVG→PNG (`resvg`/`sharp`), é leve e
determinística — mas depende de fidelidade suficiente sem os globais de browser que o Excalidraw
normalmente assume (fontes, medição de texto, canvas).

## Decisão

Renderização server-side (thumbnails, PNG/PDF, preview) usa `exportToSvg` do pacote `@excalidraw/utils`
em Node, com rasterização via `resvg`/`sharp`. Chromium headless fica reservado como fallback, apenas
se a fidelidade da rota SVG-first se mostrar insuficiente. Um spike obrigatório na Fase 0 (T10) valida
essa rota antes de qualquer módulo de produção depender dela.

**Este ADR está proposto, não decidido.** A confirmação final da rota (ou o acionamento do fallback
Chromium) depende do veredito do spike T10, que ainda não rodou no momento em que este documento foi
escrito. Este documento será atualizado com a evidência concreta assim que o spike concluir.

## Consequências

*A registrar quando o spike T10 concluir e este ADR for atualizado para seu status final.*

Consequências já conhecidas independente do veredito:

- Possíveis diferenças de fidelidade (fontes, embeds) entre o render server-side e o render real do
  browser existem em qualquer rota SVG-first; o spike mede o quanto isso importa nas fixtures reais.
- Escopo afetado: módulo de jobs/render do `apps/server`, exports, thumbnails, preview de IA.
