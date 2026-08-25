# Fundações de UI Validation

**Date**: 2026-08-24
**Spec**: `.specs/features/ui-foundations/spec.md`
**Design**: `.specs/features/ui-foundations/design.md`
**Diff range**: `309b8f7..6d0793f` (9 commits)
**Verifier**: passe standalone (`validate.md`), mesma limitação de autor ≠ verificador já
registrada em R17–R20.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | `8429faf` |
| T2 | ✅ Done | `cb2349b` |
| T3 | ✅ Done | `5e78c32` |
| T4 | ✅ Done | `9931485` |
| T5 | ✅ Done | `8d4eeb1` |
| T6–T9 | ✅ Done | `2cf2003` e `6d0793f` — as quatro listas em dois commits, não quatro (ver Gaps) |
| T10, T11 | ✅ Done | `c543a5a` |
| T12 | ✅ Done | `11ba3de` |
| T13 | ✅ Done | `e5f9237` — task criada durante esta execução |

---

## Spec-Anchored Acceptance Criteria

| Critério | Resultado esperado pela spec | `file:line` + asserção | Result |
| -------- | ---------------------------- | ---------------------- | ------ |
| UIF-01 build emite folha gerada | CSS emitido | `apps/web/dist/assets/index-*.css`, 148 kB emitidos pelo build | ✅ PASS |
| UIF-02 tokens declarados em um arquivo | um `@theme` | `apps/web/src/styles/theme.spec.ts:32` — `expect(theme).toContain('@theme {')` | ✅ PASS |
| UIF-03 cor sempre por token | nenhum literal em componente | `apps/web/src/styles/tokenSweep.spec.ts:59` — `expect(offenders).toEqual([])` | ✅ PASS |
| UIF-04 build sem aviso de configuração | nenhum aviso | build: só o aviso de tamanho de chunk, nenhum de configuração de estilo | ✅ PASS |
| UIF-05 suíte existente sem alteração de asserção | verde | `apps/web` 951/951; a única exceção é o teste de layout, ver Desvio | ⚠️ Parcial |
| UIF-06 login centrado, com hierarquia | formulário em cartão | `01-login.png`, captura real do harness e2e | ✅ PASS |
| UIF-07 shell com espaçamento e links distintos | navegação separada | `03-projects.png` — "Membros / Webhooks / Providers de IA" como três controles | ✅ PASS |
| UIF-08 linha delimitada, ações alinhadas, estado vazio | linha com ações à direita | `03-projects.png`; `apps/web/src/nav/*ListPage.tsx` usam `css.listRow`/`css.listRowActions` | ✅ PASS |
| UIF-09 estado de carregamento no lugar do conteúdo | `nav.loading` | as quatro páginas renderizam `{listStatus === 'loading' && <p className={css.stateBox}>` | ✅ PASS |
| UIF-10 erro com ação de tentar novamente | `errorBox` | as quatro páginas renderizam `className={css.errorBox}` no ramo de erro | ⚠️ Parcial |
| UIF-11 foco visível | anel de foco | `theme.css` `@layer base` `:focus-visible`; testes `jest-axe` existentes verdes | ✅ PASS |
| UIF-12 sem rolagem horizontal a 1024px | nenhuma | `max-w-content` mais `flex-wrap` em toda linha e barra; capturas a 1280px | ⚠️ Estrutural |
| UIF-13 painel com largura própria, sem sobrepor | `w-96 shrink-0` | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:194` — `expect(sidebar.className).toContain('w-96')` | ✅ PASS |
| UIF-14 canvas ocupa a altura restante | `flex-1 min-h-0` | `DiagramEditorPage.spec.tsx:185-186` — `toContain('flex-1')` e `toContain('min-h-0')` | ✅ PASS |
| UIF-15 rótulo e campo do dock em linhas distintas | sem sobreposição | `04-editor.png`, captura real | ✅ PASS |
| UIF-16 seções recolhíveis consistentes | mesma affordance | `EditorSidePanel.tsx` `tabClass`; `DiagramEditorPage.tsx` todos os `<details>` com a mesma classe | ✅ PASS |
| UIF-17 recolher devolve a largura | painel recolhido | **sem teste** | ⚠️ Não implementado |
| UIF-18 chunk separado para o editor | `lazy(` | `apps/web/src/bundleSplit.spec.ts:53` — `expect(app).toMatch(/const DiagramEditorPage = lazy\(/)` | ✅ PASS |
| UIF-19 estado de carregamento durante a busca | `RouteFallback` | `bundleSplit.spec.ts:53` — `expect(app).toContain('<Suspense fallback={<RouteFallback />}>')` | ✅ PASS |
| UIF-20 chunk de entrada sem o motor de canvas | nenhum import estático | `bundleSplit.spec.ts:49` — `expect(leaked).toEqual([])`; medido: entrada 1.486 kB → 246 kB | ✅ PASS |

**Status**: 16 de 20 com evidência direta; 3 parciais e 1 não implementado, todos nomeados.

⚠️ **UIF-17 não foi implementado.** A spec pede que recolher o painel devolva a largura ao canvas.
Nenhuma task nomeava um controle de recolher o painel inteiro — T11 tratou das seções internas — e
não há um. Registrado como dívida, não silenciado. É a mesma classe de lacuna de R19 (edge case sem
`Done when`) e a lição L-051 já cobre.

⚠️ **UIF-10 é parcial**: o estado de erro tem apresentação própria, mas nenhuma das quatro páginas
oferece "tentar novamente" — a spec pede a ação e ela não existia antes nem foi criada. Dívida
nomeada.

⚠️ **UIF-12 é estrutural**: a garantia vem de `max-w-content` e `flex-wrap`, não de uma medição a
1024px. As capturas foram feitas a 1280px.

---

## Desvio deliberado — teste existente alterado

`DiagramEditorPage.spec.tsx` asseverava `row.style.flexDirection`, `canvasColumn.style.flex` e
`.style.minHeight`: exatamente os estilos inline que UIF-13 remove por design. As três asserções
foram reescritas contra o mecanismo que passa a carregar a mesma garantia, com a mudança declarada
no corpo do teste, e uma quarta foi acrescentada (`w-96`/`shrink-0`) porque a largura declarada é o
que impede o painel de crescer sobre o canvas.

Isto é uma modificação de teste existente, que a regra de integridade normalmente proíbe sem
consulta. A justificativa: a spec aprovada torna o mecanismo antigo impossível, a intenção do teste
foi preservada integralmente e a cobertura aumentou. **Registrado aqui para revisão explícita.**

---

## Discrimination Sensor

| # | File | Mutação | Killed? |
| - | ---- | ------- | ------- |
| 1 | `App.tsx` | Rota do editor volta a ser import estático | ✅ 2 falharam |
| 2 | `DiagramEditorPage.tsx` | Painel lateral perde `w-96 shrink-0` | ✅ 1 falhou |
| 3 | `AppShell.tsx` | Cor literal reintroduzida num componente | ✅ 2 falharam |
| 4 | `theme.css` | `--color-accent` removido do bloco de tokens | ❌→✅ **sobreviveu**, morta após correção |

**Resultado da mutação 4**: `theme.spec.ts` usava `toContain('--color-accent')`, satisfeito por
`--color-accent-hover`. É exatamente a fraqueza de substring que a lição **L-049** registrou em R18,
recorrendo numa feature diferente. A asserção passou a exigir a declaração (`^\s*--color-accent:`)
e a mutação morreu.

**Sensor depth**: P0-full
**Result**: 4/4 mortas após correção — ✅ PASS (1 sobrevivente, recorrência de L-049)

---

## Code Quality

| Princípio | Status |
| --------- | ------ |
| Código mínimo | ✅ |
| Mudanças cirúrgicas | ✅ |
| Sem scope creep | ✅ |
| Segue os padrões existentes | ✅ |
| Nenhum teste enfraquecido, pulado ou removido | ✅ — uma modificação declarada, ver Desvio |
| Verificação visual real, não só por teste | ✅ — capturas do harness e2e |

---

## Gate Check

| Comando | Resultado |
| ------- | --------- |
| `make lint` | ✅ 0 erros |
| `make typecheck` | ✅ 25/25 |
| `apps/web` unit | ✅ 100 arquivos, 951/951 |
| `apps/web` build | ✅ CSS emitido; entrada 246 kB |
| capturas e2e | ✅ 4 telas renderizadas e inspecionadas |

---

## Gaps encontrados

### Gap 1 — Três superfícies fora do plano (Major, fechado)

`PresenterModePage`, `SharedResourcePage` e `SpecViewer` também usavam estilo inline e nenhuma task
os nomeava. Encontrados pela varredura de tokens ao escrever T2; task T13 criada.

### Gap 2 — Divisão de bundle exigia mais que a rota do editor (Major, fechado)

T12 previa apenas o editor. Quatro outras rotas alcançam o mesmo motor, então a entrada continuava
com 1.486 kB depois da primeira tentativa. Todas as cinco passaram a carregar sob demanda.

### Gap 3 — Recorrência de L-049 (Minor, fechado)

Ver Sensor, mutação 4. A lição existia e não impediu a repetição numa feature diferente — sinal de
que ela deveria ser promovida de `candidate` a `confirmed`.

### Gap 4 — UIF-17 e parte de UIF-10 não entregues (Minor, abertos)

Ver ACs. Ambos são requisitos que nenhuma task carregou para o seu `Done when`.

### Gap 5 — Commits não atômicos por task (Minor, registrado)

T6–T9 saíram em dois commits em vez de quatro. As quatro listas compartilham as mesmas receitas e
foram editadas juntas.

---

## Requirement Traceability Update

UIF-01 a UIF-20: `Pending` → `✅ Verified`, com UIF-05/10/12 parciais e UIF-17 aberto.

---

## Summary

**PASS com quatro dívidas nomeadas.** O produto deixou de ser HTML nu: login, shell, quatro listas e
o chrome do editor têm hierarquia, espaçamento e controles reconhecíveis, verificados por captura
real e não só por asserção. Nenhum `style={{}}` e nenhuma cor literal sobrevive em componente de
produção, e uma varredura reprova quem tentar reintroduzi-los.

O ganho medido além do visual: o chunk de entrada caiu de 1.486 kB para 246 kB, porque quatro rotas
além do editor alcançavam o mesmo motor de canvas e o plano só previa uma.

Um teste existente foi modificado — as asserções de layout que liam estilo inline, o mecanismo que
esta onda remove. A intenção foi preservada e a cobertura aumentou, mas a modificação está declarada
aqui e no corpo do teste para revisão.
