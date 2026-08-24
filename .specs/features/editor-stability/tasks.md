# Estabilidade do editor Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.** Do not search for skill files by filesystem path.

---

**Design**: skipped — a correção é local a um componente já existente (`EditorSurface`) e a adição
de um `ErrorBoundary` é o padrão canônico do React, sem decisão arquitetural nova. As duas escolhas
com alternativa real (onde a guarda mora, granularidade do boundary) estão em `spec.md`'s
Assumptions.
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| `EditorSurface` (emissão de seleção) | unit | ESTB-01/02/06 e os edge cases: seleção igual não emite, seleção diferente emite uma vez, vazio→vazio não emite, `applyRemoteScene` sem mudança de seleção não emite, ausência de `onSelectionChange` não lança | `packages/editor-adapter/src/EditorSurface.spec.tsx` | `pnpm -w test:unit` |
| `EditorSurface` (identidade de handle e `initialData`) | unit | ESTB-03/04: o objeto do handle e o `initialData` mantêm identidade entre renders do mesmo mount | `packages/editor-adapter/src/EditorSurface.spec.tsx` | `pnpm -w test:unit` |
| `RouteErrorBoundary` | unit | ESTB-07..11: renderiza a tela de recuperação, registra uma vez, expõe `role="alert"`, ação de recarregar, sem estado residual entre rotas | `apps/web/src/app-shell/RouteErrorBoundary.spec.tsx` | `pnpm -w test:unit` |
| Composição de rotas | unit | Toda rota renderiza dentro de um boundary; o shell permanece montado quando o filho estoura | `apps/web/src/App.spec.tsx` | `pnpm -w test:unit` |
| Rota do editor (fim a fim) | e2e | ESTB-05/12/13/14: canvas monta, zero `console.error`/`pageerror`, allowlist vazia | `apps/web/e2e/editor-console.spec.ts` | `pnpm --filter @arch-canvas/web test:e2e` |
| i18n (`en`/`pt-BR`) | none | Chaves da tela de recuperação; cobertas pelo gate de build e pelos testes acima | `apps/web/src/i18n/locales/` | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois da última task, antes do Verifier | `make lint && make typecheck && make test-unit && pnpm --filter @arch-canvas/web test:e2e` |

---

## Execution Plan

### Phase 1: Quebrar o ciclo de render

```
T1
T2
```

### Phase 2: Recuperação de erro

```
T3 -> T4
```

### Phase 3: Rede de segurança

```
T1 -> T5
T2 -> T5
T4 -> T5
T5 -> T6
```

---

## Task Breakdown

### T1: Guarda de estabilidade na emissão de seleção

**What**: `EditorSurface.onChange` passa a memorizar a última lista de ids emitida e só chama
`onSelectionChange` quando o conjunto muda. A comparação é sobre a lista de ids selecionados,
independente de ordem de chaves do `appState`. É esta task que remove o loop infinito de render que
hoje derruba a rota do editor com o erro React #185.
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: None
**Reuses**: o próprio `onChange` e o padrão de `previousSceneRef`, que já guarda estado entre
`onChange` sem causar render.
**Requirement**: ESTB-01, ESTB-02, ESTB-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Dois `onChange` consecutivos com o mesmo conjunto de ids selecionados produzem exatamente uma chamada de `onSelectionChange`
- [x] Um `onChange` com conjunto diferente produz exatamente uma chamada com a nova lista
- [x] Dois `onChange` seguidos sem nenhum elemento selecionado produzem exatamente uma chamada, com lista vazia (a transição vazia→vazia não emite; a primeira emissão sempre acontece)
- [x] `onDeltas` mantém o comportamento atual, inalterado
- [x] Changeset criado para `@arch-canvas/editor-adapter`
- [x] Gate check passes: `make lint` (0 erros) e `make typecheck` (25/25) verdes; `editor-adapter` 85/86 — a única falha e a pre-existente `icon.kind "external"` (`'Amazon\nEC2'` vs `'Amazon EC2'`, quebra de linha por medicao de fonte sob jsdom), confirmada numa baseline limpa ANTES desta task e ja registrada em `STATE.md` (F10/R14). `make test-unit` completo segue vermelho pelas duas falhas pre-existentes que R20 fecha (nova task T8).

**Tests**: unit
**Gate**: full

**Commit**: `fix(editor-adapter): emit selection changes only when the selection actually changes`

---

### T2: Identidade estável do handle imperativo e de `initialData`

**What**: `useImperativeHandle` ganha lista de dependências, de modo que o objeto do handle deixe de
ser recriado a cada render, e o `initialData` passado a `<Excalidraw/>` passa a ser memoizado no
mount. Nenhum método do handle muda de assinatura — AD-010 permanece intacta.
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: None
**Reuses**: o handle já definido em `EditorSurfaceHandle`.
**Requirement**: ESTB-03, ESTB-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] O objeto exposto pelo `ref` mantém identidade referencial entre dois renders do mesmo mount
- [x] `initialData` mantém identidade referencial entre dois renders do mesmo mount
- [x] Todo método do handle continua operando sobre a cena atual, não sobre a do primeiro render
- [x] Nenhum teste existente de `EditorSurface.spec.tsx` muda de asserção
- [x] Gate check passes: `make lint` (0 erros) e `make typecheck` (25/25) verdes; `editor-adapter` 88/89, a unica falha e a mesma pre-existente da T1 (green-gate T8)

**Tests**: unit
**Gate**: full

**Commit**: `fix(editor-adapter): keep the imperative handle and initialData referentially stable`

---

### T3: Componente `RouteErrorBoundary`

**What**: Cria o boundary de rota: captura exceção de render de um filho, registra a exceção e o
stack de componentes uma única vez, e renderiza uma tela de recuperação com `role="alert"`, título,
mensagem e ação de recarregar, todos vindos do i18n. Não tenta re-render automático.
**Where**: `apps/web/src/app-shell/RouteErrorBoundary.tsx`
**Depends on**: None
**Reuses**: as chaves de i18n existentes como modelo de nomenclatura; nenhuma dependência nova.
**Requirement**: ESTB-07, ESTB-08, ESTB-10, ESTB-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Um filho que lança durante render produz a tela de recuperação, e não propaga
- [x] A exceção e o stack de componentes são registrados exatamente uma vez
- [x] A tela de recuperação expõe `role="alert"` e uma ação de recarregar acionável por teclado
- [x] Todo texto vem do i18n, com chaves presentes em `en` e `pt-BR`
- [x] Sem violação `jest-axe` na tela de recuperação
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/web` 913/913 (905 antes desta task, mais os 8 testes novos)

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add a route-level error boundary with a recovery screen`

---

### T4: Montar o boundary em cada rota

**What**: Envolve cada elemento de rota da tabela de rotas com `RouteErrorBoundary`, mantendo o
shell (cabeçalho e navegação) fora do boundary para que ele sobreviva à falha do filho. Cada rota
recebe seu próprio boundary — nunca um único global.
**Where**: `apps/web/src/App.tsx`
**Depends on**: T3
**Reuses**: a estrutura de rotas já existente, incluindo `AuthLayout` (AD-012) e `ProtectedRoute`.
**Requirement**: ESTB-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Toda rota da tabela renderiza dentro de um `RouteErrorBoundary`
- [ ] Um filho que lança deixa o shell renderizado e visível
- [ ] Duas rotas que estouram em sequência mostram a tela de recuperação cada uma, sem estado residual
- [ ] `/share/:token` continua fora de `AuthProvider` (AD-012 preservada)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): wrap every route element in a route error boundary`

---

### T5: e2e que reprova em erro de console na rota do editor

**What**: Teste Playwright que autentica, abre `/w/:workspaceId/d/:diagramId`, aguarda o canvas
montar e falha se qualquer `console.error` ou `pageerror` tiver sido emitido. A allowlist de
mensagens toleradas nasce vazia e qualquer entrada futura exige justificativa escrita no próprio
arquivo.
**Where**: `apps/web/e2e/editor-console.spec.ts`
**Depends on**: T1, T2, T4
**Reuses**: `e2e/support/runTestServer.ts` e `fixedSeed.ts`, o harness que já boota um servidor real
sobre PGlite (AD-007).
**Requirement**: ESTB-05, ESTB-12, ESTB-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O teste abre a rota do editor autenticado e o seletor do canvas do Excalidraw resolve
- [ ] Qualquer `console.error` ou `pageerror` durante o carregamento reprova o teste
- [ ] A allowlist declarada no arquivo está vazia
- [ ] Revertendo T1 localmente, o teste reprova — confirmado antes do commit
- [ ] Gate check passes: `make lint && make typecheck && make test-unit && pnpm --filter @arch-canvas/web test:e2e`

**Tests**: e2e
**Gate**: build

**Commit**: `test(web): fail the e2e suite on any console error in the editor route`

---

### T6: Recolocar `crash-recovery` em verde

**What**: Roda `crash-recovery.spec.ts` contra o editor corrigido e ajusta apenas o que for
necessário por mudança legítima de comportamento — nunca enfraquecendo asserção. Se o teste passar
sem alteração, a task registra isso e commita apenas a atualização de rastreabilidade da spec.
**Where**: `apps/web/e2e/crash-recovery.spec.ts`
**Depends on**: T5
**Reuses**: o próprio teste, que já cobre REC-01 e falhava só por causa do canvas que não montava.
**Requirement**: ESTB-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `pnpm --filter @arch-canvas/web test:e2e` passa com os dois arquivos de teste
- [ ] Nenhuma asserção de `crash-recovery.spec.ts` foi enfraquecida, pulada ou removida
- [ ] A tabela de Requirement Traceability de `spec.md` está atualizada
- [ ] Gate check passes: `make lint && make typecheck && make test-unit && pnpm --filter @arch-canvas/web test:e2e`

**Tests**: e2e
**Gate**: build

**Commit**: `test(web): restore the crash-recovery e2e suite to green`
