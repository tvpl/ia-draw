# ADR-0014: Tailwind v4 com tokens como camada de estilo de apps/web

## Status

Aceita

## Data

2026-08-24

## Contexto

`apps/web` não tinha camada de estilo nenhuma: zero arquivos CSS, zero usos de `className` e nove
`style={{}}` inline, todos concentrados na rota do editor — onde produziram a sobreposição entre o
painel lateral e o canvas. A única folha carregada era a do Excalidraw, e por isso só a barra de
ferramentas do canvas parecia pronta enquanto login, shell, listas e painéis eram HTML nu.

Os 91 arquivos de teste de front, incluindo os de acessibilidade com `jest-axe`, passavam: eles
validam papel, rótulo e foco, nunca aparência.

## Decisão

`apps/web` adota Tailwind CSS v4 com configuração CSS-first. Os tokens de cor, espaçamento, raio,
tipografia e sombra são declarados uma única vez num bloco `@theme` em
`apps/web/src/styles/theme.css`, e componentes consomem apenas utilitários. Nenhum valor literal de
cor existe em componente de produção e nenhum `style={{}}` permanece — uma varredura
(`tokenSweep.spec.ts`) reprova quem os reintroduzir, com isenção nomeada e justificada para
`presence/collaboratorColor.ts`, que gera cor de cursor por participante e é lógica de domínio.

A folha da aplicação é carregada depois da do Excalidraw e nenhuma regra dela seleciona dentro do
canvas (EDT-07/AD-008).

## Consequências

- Uma dependência de build nova. O Biome não ordena classes de Tailwind e nenhum segundo linter será
  adicionado só para isso.
- Tema escuro fica fora até a paleta clara estabilizar; a decisão dobra a superfície de token.
- Receitas compartilhadas entre telas vivem em `apps/web/src/styles/classNames.ts` como strings de
  utilitário — não introduzem camada de CSS nem componente de abstração, e o markup lê como se tivesse
  sido digitado inline.
- Descartado: CSS Modules com tokens à mão. Exigiria escrever escalas, estados e densidade antes de
  estilizar a primeira tela, com 41 componentes esperando.
