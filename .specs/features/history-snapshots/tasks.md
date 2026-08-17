# Histórico, snapshots e diff — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: inline (Medium scope — sem `design.md` próprio; a única decisão arquitetural real (o
painel vive dentro do editor pra poder chamar `EditorSurfaceHandle.applyRemoteScene`, AD-010) já
está resolvida na tabela de Assumptions do `spec.md`).
**Status**: Approved

---

## Test Coverage Matrix

> Gerado a partir de amostragem do codebase (`apps/web/src/nav/ConfirmArchiveDialog.spec.tsx`,
> `apps/web/src/nav/resourceClient.spec.ts`, `packages/editor-adapter/src/EditorSurface.spec.tsx`,
> `apps/web/src/a11y/shell.a11y.spec.tsx`) e a convenção de piso de cobertura deste repo (nunca
> baixado). Guidelines encontradas: nenhuma além de `CLAUDE.md`'s "Comandos" — forte default
> aplicado.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| `snapshotClient` | unit | Todo branch de status documentado: list, create (201), restore (200/404/403), diff (200/404) | `apps/web/src/history/snapshotClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Componente (`HistoryPanel`) | unit (RTL) | 1:1 às ACs SNAP-01..05 (listar com rótulo de kind, criar nomeado, criar sem nome, vazio) | `apps/web/src/history/HistoryPanel.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`RestoreConfirmDialog` + fluxo de restore) | unit (RTL) | 1:1 às ACs SNAP-06..10 (confirmar, `clientMutationId`, aplica via `applyRemoteScene`, 404, gate de `role`) | `apps/web/src/history/RestoreConfirmDialog.spec.tsx`, `apps/web/src/history/HistoryPanel.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`DiffView`) | unit (RTL) | 1:1 às ACs SNAP-11..13 (4 listas, vazio, erro 404) | `apps/web/src/history/DiffView.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Acessibilidade (`HistoryPanel`, `DiffView`) | unit (axe) | Zero violações serious/critical; SNAP-14..16 | `apps/web/src/history/*.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integração (`DiagramEditorPage`) | unit (RTL) | Painel monta, restore reflete no canvas via `applyRemoteScene` mockado | `apps/web/src/DiagramEditorPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Após task com testes unitários, escopada a um pacote | `pnpm --filter @arch-canvas/web run test:unit` |
| Full | Fechando a feature | `make lint && make typecheck && make test-unit` |

---

## Execution Plan

### Phase 1: Client

```
T1
```

### Phase 2: Componentes

```
T2
T3
T4
```

### Phase 3: i18n e integração

```
T5
T6
```

---

## Task Breakdown

### T1: `snapshotClient.ts`

**What**: Cliente HTTP pra `GET`/`POST /diagrams/:id/snapshots`, `POST .../:snapshotId:restore` e
`GET .../diff`.
**Where**: `apps/web/src/history/snapshotClient.ts`
**Depends on**: None
**Reuses**: Padrão de `aiDockClient.ts`/`memberClient.ts` (status branching, injeção de `fetchImpl`)
**Requirement**: SNAP-01, SNAP-03, SNAP-06, SNAP-11

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `list(diagramId)` devolve `SnapshotRow[]` tal como o servidor devolve (`kind`/`name`/`createdAt`)
- [x] `create(diagramId, name?)` envia `POST` com/sem `name`, devolve o snapshot criado (`201`)
- [x] `restore(diagramId, snapshotId, clientMutationId)` cobre `200`/`404`/`403`
- [x] `diff(diagramId, from, to)` devolve `{added, removed, moved, modified}`, cobre `404`
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add snapshotClient (SNAP-01/06/11)`

---

### T2: `HistoryPanel`

**What**: Painel com a linha do tempo de snapshots e a ação de criar um nomeado.
**Where**: `apps/web/src/history/HistoryPanel.tsx`
**Depends on**: T1
**Reuses**: Padrão de estado vazio/loading de `WorkspaceListPage`; mapa de rótulo por `kind`
(spec.md Assumptions)
**Requirement**: SNAP-01, SNAP-02, SNAP-03, SNAP-04, SNAP-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Lista ordenada do mais recente pro mais antigo, cada item com rótulo de `kind` traduzido
- [x] Ação "criar snapshot nomeado" visível só quando `role` concede `diagram:mutate`
- [x] Criar com nome insere no topo a partir da resposta `201`, sem novo `GET`
- [x] Criar sem nome envia sem o campo `name`
- [x] Estado vazio quando não há nenhum snapshot ainda
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add HistoryPanel (SNAP-01..05)`

---

### T3: `RestoreConfirmDialog` + fluxo de restore

**What**: Diálogo de confirmação nativo pra restaurar um snapshot, e a ação em `HistoryPanel` que
o dispara e aplica o resultado ao canvas.
**Where**: `apps/web/src/history/RestoreConfirmDialog.tsx`
**Depends on**: T1, T2
**Reuses**: Mesmo padrão `<dialog>`/`showModal()`/`close()` de `ConfirmArchiveDialog` (R3);
`EditorSurfaceHandle.applyRemoteScene` (AD-010, já existente, sem mudança)
**Requirement**: SNAP-06, SNAP-07, SNAP-08, SNAP-09, SNAP-10

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Diálogo nomeia explicitamente "cria uma revisão nova, nunca apaga revisões intermediárias"
- [x] Confirmar gera um `clientMutationId` (`crypto.randomUUID()`) e chama `snapshotClient.restore`
- [x] `200` aplica a cena via `applyRemoteScene` (recebido como prop/ref de `DiagramEditorPage`) e exibe a nova `currentRevision`
- [x] `404` informa que o snapshot não existe mais e relista
- [x] Ação de restaurar oculta quando `role` não concede `diagram:mutate`
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add restore flow with confirmation (SNAP-06..10)`

---

### T4: `DiffView`

**What**: Painel de comparação estrutural entre duas revisões/snapshots.
**Where**: `apps/web/src/history/DiffView.tsx`
**Depends on**: T1
**Reuses**: Mesmo padrão de lista/estado vazio das demais telas
**Requirement**: SNAP-11, SNAP-12, SNAP-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Seleção de dois pontos da linha do tempo chama `snapshotClient.diff` e exibe as 4 listas (`added`/`removed`/`moved`/`modified`) por `elementId`
- [x] 4 listas vazias exibe "nenhuma mudança estrutural", nunca tela em branco
- [x] `404` exibe a mensagem de erro sem quebrar o painel
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add DiffView (SNAP-11..13)`

---

### T5: i18n keys (`en`, `pt-BR`)

**What**: Chaves novas sob `history` nos dois locales, incluindo os 5 rótulos de `kind`.
**Where**: `apps/web/src/i18n/locales/{en,pt-BR}/translation.json`
**Depends on**: None
**Reuses**: Convenção de chaves já usada por `nav`
**Requirement**: SNAP-16

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Ambos os locales têm o mesmo conjunto de chaves sob `history`
- [x] `make lint` passes

**Tests**: none
**Gate**: quick

**Commit**: `feat(web): add history i18n keys`

---

### T6: Integração em `DiagramEditorPage` + acessibilidade

**What**: Monta `HistoryPanel`/`DiffView` como painel alternável dentro do editor, conectado ao
`ref` de `EditorSurface`; testes de axe e de alcançabilidade por teclado.
**Where**: `apps/web/src/DiagramEditorPage.tsx`
**Depends on**: T2, T3, T4, T5
**Reuses**: Padrão de toggle de painel de `AiDock`/R5 (`LibraryPanel`)
**Requirement**: SNAP-14, SNAP-15, SNAP-16

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Painel monta sem interferir no canvas quando fechado
- [ ] `role` efetivo resolvido uma vez e passado como prop (mesma fonte usada pelas demais fatias)
- [ ] Toda ação alcançável só por Tab/Shift+Tab/Enter
- [ ] `aria-live="polite"` anuncia sucesso/falha de criação e de restauração
- [ ] Teste roda com locale `en` trocado no meio do caminho
- [ ] Zero violações serious/critical de axe em `HistoryPanel`/`DiffView`
- [ ] Full gate passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): wire history panel into DiagramEditorPage (SNAP-14..16)`

---

## Phase Execution Map

Only real `Depends on` edges shown:

```
T1 → T2
T1 → T3
T1 → T4
T2 → T3
T2 → T6
T3 → T6
T4 → T6
T5 → T6
```

T1, T5 have no incoming edges.

6 tasks totais — cabe num único batch (≤ ~8), execução inline, sem sub-agentes.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: `snapshotClient` | 1 arquivo, 1 conceito (parametrizado por 4 operações do mesmo recurso) | ✅ Granular |
| T2: `HistoryPanel` | 1 componente | ✅ Granular |
| T3: `RestoreConfirmDialog` + fluxo | 1 componente + a ação que o dispara | ✅ Granular (2-3 arquivos relacionados, cohesivo) |
| T4: `DiffView` | 1 componente | ✅ Granular |
| T5: i18n keys | 2 arquivos, 1 bloco cohesivo | ✅ Granular |
| T6: integração + a11y | 1 arquivo modificado + testes dos componentes já criados | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | No incoming edge | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1, T2 | T1 → T3, T2 → T3 | ✅ Match |
| T4 | T1 | T1 → T4 | ✅ Match |
| T5 | None | No incoming edge | ✅ Match |
| T6 | T2, T3, T4, T5 | T2 → T6, T3 → T6, T4 → T6, T5 → T6 | ✅ Match |

---

## Test Co-location Validation

| Task | Tests field | Matriz exige | Status |
| ---- | ----------- | ------------- | ------ |
| T1 | unit | unit | ✅ Match |
| T2 | unit | unit (RTL) | ✅ Match |
| T3 | unit | unit (RTL) | ✅ Match |
| T4 | unit | unit (RTL) | ✅ Match |
| T5 | none | none (build gate only) | ✅ Match |
| T6 | unit | unit (RTL) + axe | ✅ Match |
