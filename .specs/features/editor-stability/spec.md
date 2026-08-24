# Estabilidade do editor Specification

## Problem Statement

A rota do editor (`/w/:workspaceId/d/:diagramId`) não monta: o React aborta com o erro #185
(*Maximum update depth exceeded*) e o usuário fica com tela branca. Reproduzido em 2026-08-24 com
Playwright contra o harness `apps/web/e2e/support/runTestServer.ts` deste repo. A causa é um ciclo
de render fechado dentro de `EditorSurface`, e não há nenhum `ErrorBoundary` em `apps/web` para
transformar essa falha em algo diagnosticável — qualquer exceção em qualquer rota produz a mesma
tela branca silenciosa. O teste que pegaria isso (`e2e/crash-recovery.spec.ts`) falha há semanas e
o job E2E do CI está vermelho em `main` desde então.

## Goals

- [ ] A rota do editor monta o canvas e permanece montada, com zero erro de React no console
- [ ] Uma exceção não tratada em qualquer rota produz uma tela de recuperação legível, nunca tela branca
- [ ] Um erro de console na rota do editor reprova o CI, para que esta classe de defeito não volte silenciosamente

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Estilo visual do editor e do painel lateral | Pertence a `ui-foundations` (R21); aqui só se corrige montagem e recuperação de erro |
| Code splitting da rota do editor | Otimização de bundle, não de estabilidade; `ui-foundations` P3 |
| Reportar erro para serviço externo (Sentry etc.) | Nenhuma dependência externa nova nesta onda; o boundary registra localmente e expõe um hook |
| Mudar o contrato de `EditorSurfaceHandle` (AD-010) | A extensão é interna ao componente; nenhum consumidor muda |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Identidade de "seleção mudou" | Comparação da lista ordenada de ids já emitida com a próxima; emite só quando difere | `onSelectionChange` recebe `string[]`; comparar conteúdo é o único critério que quebra o ciclo sem perder nenhuma mudança real de seleção | y |
| Onde a guarda mora | Dentro de `EditorSurface`, não no consumidor | O ciclo nasce no componente que emite; corrigir no consumidor exigiria a mesma guarda repetida em todo caller futuro | y |
| Granularidade do `ErrorBoundary` | Um por rota, montado na composição de rotas de `App.tsx` | Um boundary global perderia o resto do shell junto; por rota, o header/navegação sobrevivem e o usuário consegue sair da tela quebrada | y |
| Comportamento do boundary | Mostra mensagem i18n + botão de recarregar; nunca tenta re-render automático | Re-render automático de um componente que acabou de estourar tende a reentrar no mesmo loop | y |
| Critério do teste de console | Falha em qualquer `console.error` ou `pageerror` na rota do editor durante o carregamento | Um filtro por texto de erro específico não pegaria a próxima variação do mesmo defeito | y |
| Ruído de console de terceiros | Uma allowlist explícita e vazia no início; qualquer entrada futura exige justificativa no próprio arquivo de teste | Allowlist vazia por padrão evita que o teste seja neutralizado por acréscimo silencioso | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: O editor abre ⭐ MVP

**User Story**: Como pessoa que desenha um diagrama, quero abrir a rota do editor e ver o canvas,
para poder trabalhar.

**Why P1**: Sem isso o produto central não existe. Todo o resto da onda é verificável só depois.

**Acceptance Criteria**:

1. WHEN `EditorSurface` recebe um `onChange` do Excalidraw cujo conjunto de ids selecionados é igual ao último já emitido THEN o sistema SHALL não chamar `onSelectionChange`
2. WHEN o conjunto de ids selecionados difere do último emitido THEN o sistema SHALL chamar `onSelectionChange` exatamente uma vez com a nova lista
3. The `useImperativeHandle` de `EditorSurface` SHALL declarar uma lista de dependências, de modo que o handle não seja recriado a cada render
4. The `initialData` passado a `<Excalidraw/>` SHALL manter identidade referencial estável entre renders do mesmo mount
5. WHEN a rota do editor carrega com um diagrama que faz bootstrap com sucesso THEN o sistema SHALL montar o canvas do Excalidraw e não emitir nenhum erro de React
6. WHILE a rota do editor está montada e ociosa o sistema SHALL não disparar nenhum ciclo de render adicional originado por `onSelectionChange`

**Independent Test**: abrir `/w/:workspaceId/d/:diagramId` autenticado e ver o canvas do Excalidraw
renderizado, com o console limpo.

---

### P1: Uma falha não vira tela branca ⭐ MVP

**User Story**: Como pessoa usando o produto, quero que um erro inesperado me mostre o que houve e
como sair, em vez de uma página em branco.

**Why P1**: Foi a tela branca que escondeu o defeito acima do usuário e da equipe.

**Acceptance Criteria**:

1. IF um componente de uma rota lança uma exceção durante render THEN o sistema SHALL renderizar uma tela de recuperação com título, mensagem e uma ação de recarregar, todos vindos do i18n
2. IF um componente de uma rota lança uma exceção THEN o sistema SHALL registrar a exceção e o stack de componentes no console uma única vez
3. WHILE a tela de recuperação está visível o sistema SHALL manter o shell da aplicação (cabeçalho e navegação) renderizado
4. WHEN a pessoa aciona a ação de recarregar THEN o sistema SHALL recarregar a rota atual
5. The tela de recuperação SHALL expor um papel ARIA `alert` para ser anunciada por leitor de tela

**Independent Test**: montar uma rota com um componente que lança e ver a tela de recuperação com o
shell intacto, em vez de `<div id="root">` vazio.

---

### P2: O defeito não volta silenciosamente

**User Story**: Como quem mantém o repositório, quero que o CI reprove quando a rota do editor
emitir erro de console, para que esta classe de falha nunca mais chegue a `main` despercebida.

**Why P2**: Não destrava o produto hoje, mas é o que impede a recaída — e o custo é um arquivo de teste.

**Acceptance Criteria**:

1. WHEN a suíte e2e abre a rota do editor THEN o sistema SHALL falhar o teste se qualquer `console.error` ou `pageerror` for emitido durante o carregamento
2. The allowlist de mensagens toleradas pelo teste SHALL começar vazia
3. WHEN a suíte e2e roda THEN o teste `crash-recovery.spec.ts` SHALL passar

**Independent Test**: reverter a guarda de seleção e ver a suíte e2e reprovar.

---

## Edge Cases

- IF `onSelectionChange` não é fornecido THEN o sistema SHALL calcular a seleção mesmo assim sem lançar, e não emitir nada
- WHEN a seleção passa de vazia para vazia (nenhum elemento selecionado, dois `onChange` seguidos) THEN o sistema SHALL não emitir
- WHEN um `applyRemoteScene` muda a cena sem mudar a seleção THEN o sistema SHALL não emitir `onSelectionChange`
- IF o `ErrorBoundary` ele mesmo lança ao renderizar a tela de recuperação THEN o sistema SHALL deixar a exceção propagar, sem laço de captura
- WHEN duas rotas diferentes estouram em sequência na mesma sessão THEN o sistema SHALL mostrar a tela de recuperação em cada uma, sem estado residual da anterior

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| ESTB-01 | P1: O editor abre | Implementing | Implementing (T1) |
| ESTB-02 | P1: O editor abre | Implementing | Implementing (T1) |
| ESTB-03 | P1: O editor abre | Implementing | Implementing (T2) |
| ESTB-04 | P1: O editor abre | Implementing | Implementing (T2) |
| ESTB-05 | P1: O editor abre | Implementing | Implementing (T5) |
| ESTB-06 | P1: O editor abre | Implementing | Implementing (T1) |
| ESTB-07 | P1: Uma falha não vira tela branca | Implementing | Implementing (T3) |
| ESTB-08 | P1: Uma falha não vira tela branca | Implementing | Implementing (T3) |
| ESTB-09 | P1: Uma falha não vira tela branca | Implementing | Implementing (T4) |
| ESTB-10 | P1: Uma falha não vira tela branca | Implementing | Implementing (T3) |
| ESTB-11 | P1: Uma falha não vira tela branca | Implementing | Implementing (T3) |
| ESTB-12 | P2: O defeito não volta silenciosamente | Implementing | Implementing (T5) |
| ESTB-13 | P2: O defeito não volta silenciosamente | Implementing | Implementing (T5) |
| ESTB-14 | P2: O defeito não volta silenciosamente | Tasks | Pending |

**Coverage:** 14 total, 14 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] `/w/:id/d/:id` monta o canvas com zero erro de React em uma sessão autenticada real
- [ ] `apps/web` e2e passa, incluindo `crash-recovery.spec.ts`
- [ ] Uma exceção injetada em qualquer rota produz tela de recuperação, não tela branca
