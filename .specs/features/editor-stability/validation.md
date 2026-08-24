# Estabilidade do editor Validation

**Date**: 2026-08-24
**Spec**: `.specs/features/editor-stability/spec.md`
**Diff range**: `fdf9c37..bd07c5d` (7 commits: T1, plano T8, T2, correção de regressão de T2, T3, T4, T5, T6)
**Verifier**: passe independente standalone (`validate.md`) — sub-agentes não estavam disponíveis
nesta sessão, então author ≠ verifier não pôde ser garantido por separação de processo. Registrado
como limitação: a cobertura abaixo foi re-derivada da `spec.md`, não da memória da implementação, e
o sensor de discriminação é a parte que não depende de julgamento.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | `f687d29` |
| T2 | ✅ Done | `edf9421`, corrigida por `ac1c9aa` (ver Gaps) |
| T3 | ✅ Done | `22922cb` |
| T4 | ✅ Done | `6de6d8a` |
| T5 | ✅ Done | `a09b125` |
| T6 | ✅ Done | `bd07c5d` — `crash-recovery.spec.ts` voltou ao verde sem uma linha alterada |

---

## Spec-Anchored Acceptance Criteria

| Critério | Resultado esperado pela spec | `file:line` + asserção | Result |
| -------- | ---------------------------- | ---------------------- | ------ |
| ESTB-01 conjunto igual → não chama | zero chamadas adicionais | `packages/editor-adapter/src/EditorSurface.spec.tsx:160` — `expect(onSelectionChange).toHaveBeenCalledTimes(1)` | ✅ PASS |
| ESTB-01 (ordem) mesma seleção reordenada → não chama | zero chamadas adicionais | `EditorSurface.spec.tsx:199` — `expect(onSelectionChange).toHaveBeenCalledTimes(1)` | ✅ PASS |
| ESTB-02 conjunto diferente → uma chamada com a nova lista | `['el-1','el-2']` | `EditorSurface.spec.tsx:174` — `expect(onSelectionChange).toHaveBeenNthCalledWith(2, ['el-1', 'el-2'])` | ✅ PASS |
| ESTB-03 handle não recriado a cada render | mesma identidade referencial | `EditorSurface.spec.tsx:238` — `expect(ref.current).toBe(handleAfterMount)` | ✅ PASS |
| ESTB-03 handle estável ainda lê a cena atual | versão 5 (edição pós-rerender) | `EditorSurface.spec.tsx:288` — `expect(sceneData.elements[0]?.version).toBe(5)` | ✅ PASS |
| ESTB-04 `initialData` estável entre renders | mesma identidade referencial | `EditorSurface.spec.tsx:251` — `expect(capturedInitialData).toBe(initialDataAfterMount)` | ✅ PASS |
| ESTB-04 (limite) nova cena chega ao canvas | o array `frameB` | `EditorSurface.spec.tsx:265` — `expect((capturedInitialData as {elements: SceneElement[]}).elements).toBe(frameB)` | ✅ PASS |
| ESTB-05 rota monta o canvas, zero erro de React | `.excalidraw` visível, `errors` vazio | `apps/web/e2e/editor-console.spec.ts:62` — `await expect(page.locator('.excalidraw')).toBeVisible(...)` | ✅ PASS |
| ESTB-06 ociosa, nenhum ciclo extra por seleção | uma chamada apesar de dois `onChange` | `EditorSurface.spec.tsx:186` — `expect(onSelectionChange).toHaveBeenCalledTimes(1)` | ✅ PASS |
| ESTB-06 (cena muda, seleção não) | `onDeltas` 1, `onSelectionChange` 1 | `EditorSurface.spec.tsx:214-215` — `expect(onDeltas).toHaveBeenCalledTimes(1)` + `expect(onSelectionChange).toHaveBeenCalledTimes(1)` | ✅ PASS |
| ESTB-07 tela de recuperação com título, mensagem e recarregar, do i18n | nenhuma chave crua renderizada, heading não vazio | `apps/web/src/app-shell/RouteErrorBoundary.spec.tsx:115-118` — `expect(screen.queryByText('errorBoundary.title')).toBeNull()` … `expect(screen.getByRole('heading').textContent).toBeTruthy()` | ✅ PASS |
| ESTB-08 registra exceção e component stack uma vez | 1 chamada, mensagem `component exploded`, stack contendo `Boom` | `RouteErrorBoundary.spec.tsx:80-84` — `expect(calls).toHaveLength(1)`, `expect(loggedError.message).toBe('component exploded')`, `expect(loggedStack).toContain('Boom')` | ✅ PASS |
| ESTB-09 shell permanece renderizado | heading e botão Sair presentes | `apps/web/src/App.spec.tsx` (bloco `ESTB-09`) — `expect(screen.getByRole('heading', { name: 'Architecture Canvas' })).toBeDefined()` | ✅ PASS |
| ESTB-10 ação de recarregar recarrega a rota | `location.reload` chamado uma vez | `RouteErrorBoundary.spec.tsx:102` — `expect(reloadSpy).toHaveBeenCalledTimes(1)` | ✅ PASS |
| ESTB-11 papel ARIA `alert` | `alert` contém o botão de recarregar | `RouteErrorBoundary.spec.tsx:67` — `expect(alert.contains(reload)).toBe(true)` | ✅ PASS |
| ESTB-12 e2e reprova em qualquer erro de console | lista de erros vazia | `apps/web/e2e/editor-console.spec.ts:69` — `expect(errors).toEqual([])` | ✅ PASS |
| ESTB-13 allowlist começa vazia | array literal vazio | `apps/web/e2e/editor-console.spec.ts:34` — `const TOLERATED_CONSOLE_MESSAGES: readonly RegExp[] = []` | ✅ PASS |
| ESTB-14 `crash-recovery` passa | suíte e2e 2/2 | execução: `2 passed (39.1s)`; o arquivo não foi alterado | ✅ PASS |

**Status**: ✅ 18/18 asserções de AC cobertas com evidência `file:line`.

---

## Edge Cases

| Edge case da spec | Evidência | Result |
| ----------------- | --------- | ------ |
| Sem `onSelectionChange`, calcula e não lança | `EditorSurface.spec.tsx:225` — `).not.toThrow()` | ✅ PASS |
| Vazia → vazia não emite | `EditorSurface.spec.tsx:186-187` | ✅ PASS |
| `applyRemoteScene` sem mudar seleção não emite | `EditorSurface.spec.tsx:214-215` | ✅ PASS |
| Duas rotas estouram em sequência, sem estado residual | `App.spec.tsx` (bloco `ESTB-09`) — `expect(screen.getAllByRole('alert')).toHaveLength(1)`; e `RouteErrorBoundary.spec.tsx:136-137` | ✅ PASS |
| Boundary que lança ao renderizar a recuperação deixa propagar | **sem teste** | ⚠️ Estrutural |

⚠️ **O último não tem teste, deliberadamente.** Um `ErrorBoundary` do React não captura exceções do
próprio render — é semântica da biblioteca, não deste código. Um teste aqui cairia no Check C
("testar comportamento de framework"), então fica registrado como garantido por construção e não por
asserção. Se essa garantia importar como requisito, ela pertence a uma spec do React, não a esta.

---

## Discrimination Sensor

Mutações aplicadas ao arquivo real, medidas, e revertidas por cópia de arquivo. `git status` foi
confirmado vazio ao final de cada rodada — nenhuma usou `git stash` (lição L-024).

| # | File | Mutação | Killed? |
| - | ---- | ------- | ------- |
| 1 | `EditorSurface.tsx` | Comparação de seleção sempre verdadeira (emite em todo `onChange`) | ✅ 5 testes falharam |
| 2 | `EditorSurface.tsx` | `sort()` removido da chave de comparação (ordem passa a importar) | ✅ 2 testes falharam |
| 3 | `EditorSurface.tsx` | Sentinela inicial `null` → `''` (primeira seleção vazia suprimida) | ✅ 3 testes falharam |
| 4 | `RouteErrorBoundary.tsx` | Deixa de registrar o component stack | ✅ 1 teste falhou |
| 5 | `RouteErrorBoundary.tsx` | Recovery screen perde `role="alert"` | ✅ 3 testes falharam |
| 6 | `App.tsx` | Rota index sem boundary próprio (volta ao boundary global) | ✅ 1 teste falhou |
| 7 | `EditorSurface.tsx` (nível e2e) | Guarda de seleção removida e `dist` reconstruído | ✅ e2e falhou com `Maximum update depth exceeded`, canvas nunca visível |

**Sensor depth**: P0-full
**Result**: 7/7 mortas — ✅ PASS

---

## Code Quality

| Princípio | Status |
| --------- | ------ |
| Código mínimo | ✅ |
| Mudanças cirúrgicas | ✅ |
| Sem scope creep | ✅ |
| Segue os padrões existentes | ✅ |
| Valores asseverados batem com a spec | ✅ |
| Profundidade por camada atendida | ✅ |
| Todo teste mapeia para um requisito | ✅ |
| Nenhum teste enfraquecido, pulado ou removido | ✅ |

**Guidelines seguidas**: `CLAUDE.md` (raiz) para comandos de gate; convenção de `*.a11y.spec.tsx`
de `shell.a11y.spec.tsx`.

---

## Gate Check

| Comando | Resultado |
| ------- | --------- |
| `make lint` | ✅ 0 erros, 6 avisos (todos pré-existentes) |
| `make typecheck` | ✅ 25/25 |
| `pnpm --filter @arch-canvas/web run test:unit` | ✅ 93 arquivos, 915/915 (905 antes desta feature) |
| `pnpm --filter @arch-canvas/editor-adapter run test:unit` | ⚠️ 89/90 — 1 falha pré-existente |
| `pnpm --filter @arch-canvas/web test:e2e` | ✅ 2/2 |
| `make test-unit` (workspace) | ❌ vermelho por **duas falhas pré-existentes**, nenhuma desta feature |

As duas falhas de `make test-unit` são as que motivaram a spec `green-gate` (R20) e ambas têm task
lá: `webConsumers.spec.ts` asseverando a contagem congelada de 4 consumidores (GATE-02, T1) e
`EditorSurface.spec.tsx` asseverando `'Amazon EC2'` contra a quebra de linha por medição de fonte
(GATE-01, T8 — task **criada durante esta execução**, ver Gaps).

---

## Gaps encontrados durante a execução

### Gap 1 — Regressão introduzida por T2 e corrigida (Major, fechado)

T2 congelou `initialData` no mount. `SharedResourcePage.tsx:86` troca `initialElements` a cada frame
de apresentação **sem remontar** o componente, então o congelamento prendeu aquela superfície ao
primeiro frame e `SharedResourcePage.spec.tsx` ficou vermelho.

Detectado porque a suíte completa de `apps/web` foi rodada, e classificado corretamente porque a
baseline foi medida num `git worktree` real em `434259e` (15/15 verde lá), não por `git stash` —
exatamente o procedimento da lição L-024. Corrigido em `ac1c9aa` amarrando a identidade a
`initialElements` em vez de ao mount, com um teste novo para o limite (`EditorSurface.spec.tsx:265`).

### Gap 2 — Task ausente no plano, criada (Minor, fechado)

Nenhuma task cobria a falha pré-existente de medição de texto, embora `GATE-01` exija `make ci`
saindo 0. `green-gate` T8 foi acrescentada em `10c95a5`.

### Gap 3 — Defeito de produto descoberto, fora do escopo (Major, aberto)

`SharedResourcePage` navega entre frames trocando `initialElements`, mas o `<Excalidraw/>` real lê
`initialData` **apenas no mount**. O mock do teste relê a prop a cada render, então PRZ-33 passa no
teste e não funciona no produto. Esta feature preservou o comportamento existente e não o corrigiu:
está fora do escopo de `editor-stability` e não tem spec. **Precisa virar entrada própria da onda.**

---

## Requirement Traceability Update

ESTB-01 a ESTB-14: `Pending` → `✅ Verified`.

---

## Summary

**PASS.** As 14 ACs e 4 dos 5 edge cases têm evidência `file:line`; o quinto é semântica do React e
está registrado como tal, não silenciado. O sensor matou 7 de 7 mutações, incluindo uma no nível e2e
que reproduz o defeito original. A rota do editor monta, `crash-recovery` voltou ao verde sem uma
asserção tocada, e uma exceção em qualquer rota agora produz tela de recuperação com o shell
sobrevivente.

Uma regressão foi introduzida e corrigida dentro da própria onda, detectada por rodar a suíte
completa e isolada por worktree na baseline real. Um defeito de produto real (Gap 3) foi descoberto
e deliberadamente não corrigido aqui.
