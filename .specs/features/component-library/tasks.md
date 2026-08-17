# Biblioteca de componentes e metadados — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/component-library/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generado a partir de amostragem do codebase (`packages/editor-adapter/src/EditorSurface.spec.tsx`,
> `apps/web/src/nav/resourceClient.spec.ts`, `apps/web/src/ai-dock/AiDockClient.spec.ts`,
> `apps/web/src/a11y/shell.a11y.spec.tsx`) e a convenção de piso de cobertura deste repo (nunca
> baixado). Guidelines encontradas: nenhuma além de `CLAUDE.md`'s "Comandos" — forte default
> aplicado.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| `EditorSurfaceHandle.insertLibraryItem` | unit | Ambos os ramos de `icon.kind` (`inline`→imagem, `external`→fallback retângulo+label), posicionamento no centro do viewport | `packages/editor-adapter/src/EditorSurface.spec.tsx` | `pnpm --filter @arch-canvas/editor-adapter run test:unit` |
| `libraryClient`/`metadataClient` | unit | Todo branch de status documentado (200/404→null/403/erro genérico), incl. `format=csv` devolvendo string | `apps/web/src/library/{libraryClient,metadataClient}.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Componente (`LibraryPanel`) | unit (RTL) | 1:1 às ACs CLIB-01..07 (listar, buscar, inserir inline, fallback external, somente-leitura, loading, erro) | `apps/web/src/library/LibraryPanel.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`MetadataPanel`) | unit (RTL) | 1:1 às ACs CLIB-08..13 (buscar ao selecionar, 404→formulário vazio, salvar, 403→somente-leitura, vazio, descarte ao trocar seleção) | `apps/web/src/library/MetadataPanel.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`InventoryView`) | unit (RTL) | 1:1 às ACs CLIB-14..17 (listar, elemento removido marcado, export CSV, vazio) | `apps/web/src/library/InventoryView.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Acessibilidade (3 componentes) | unit (axe) | Zero violações serious/critical; CLIB-18..20 | `apps/web/src/library/*.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integração (`DiagramEditorPage`) | unit (RTL) | Painéis alternam corretamente, `role` efetivo gate as ações, seleção propaga pro `MetadataPanel` | `apps/web/src/DiagramEditorPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Após task com testes unitários, escopada a um pacote | `pnpm --filter @arch-canvas/<pkg> run test:unit` |
| Full | Fechando a feature | `make lint && make typecheck && make test-unit` |

---

## Execution Plan

### Phase 1: Fundação no editor-adapter

```
T1
```

### Phase 2: Clients

```
T2
T3
```

### Phase 3: Componentes

```
T4
T5
T6
```

### Phase 4: i18n e integração

```
T7
T8
```

---

## Task Breakdown

### T1: `EditorSurfaceHandle.insertLibraryItem`

**What**: Estende o handle imperativo de `EditorSurface` (AD-010) com `insertLibraryItem(item)` —
imagem via `addFiles` pro caso `icon.kind === 'inline'`, retângulo+label de fallback pro caso
`external`, posicionado no centro do viewport atual.
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: None
**Reuses**: `applyRemoteScene`'s padrão de cast estrutural pro `ExcalidrawSceneApi`; posicionamento
via `api.getAppState()`.
**Requirement**: CLIB-03, CLIB-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `insertLibraryItem` adicionado à interface `EditorSurfaceHandle` e implementado, sem quebrar `applyRemoteScene` existente
- [x] `icon.kind === 'inline'`: chama `addFiles` com um `fileId` determinístico por inserção e cria um elemento `image` + texto vinculado com `item.name`
- [x] `icon.kind === 'external'`: cria retângulo + texto vinculado, sem nenhuma chamada de rede/`fetch` para `sourceUrl`
- [x] Ambos os casos posicionam no centro do viewport visível (`scrollX`/`scrollY`/`zoom` da `appState` mockada no teste)
- [x] Gate check passes: `pnpm --filter @arch-canvas/editor-adapter run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(editor-adapter): insert library item as canvas element (CLIB-03/04)`

---

### T2: `libraryClient.ts`

**What**: Cliente HTTP genérico injetável (`fetchImpl`) pra `GET /libraries`.
**Where**: `apps/web/src/library/libraryClient.ts`
**Depends on**: None
**Reuses**: Padrão de `aiDockClient.ts`/`memberClient.ts` (status branching, injeção de fetch)
**Requirement**: CLIB-01, CLIB-06, CLIB-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `list(workspaceId?)` implementado, `GET /libraries?workspaceId=` só quando fornecido
- [x] Branch de sucesso (200) e erro genérico (não-2xx) cobertos
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add libraryClient (CLIB-01)`

---

### T3: `metadataClient.ts`

**What**: Cliente HTTP pra `GET`/`PATCH .../metadata` e `GET .../inventory` (json/csv).
**Where**: `apps/web/src/library/metadataClient.ts`
**Depends on**: None
**Reuses**: Mesmo padrão de T2
**Requirement**: CLIB-08, CLIB-09, CLIB-10, CLIB-14, CLIB-16

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `get(diagramId, elementId)` devolve `null` no `404` (nunca lança), objeto no `200`
- [x] `patch(diagramId, elementId, body)` devolve o objeto salvo (nunca otimista)
- [x] `inventory(diagramId, format)` devolve `InventoryRow[]` pra `'json'` e `string` pra `'csv'`
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add metadataClient (CLIB-08/14)`

---

### T4: `LibraryPanel`

**What**: Painel de listagem/busca/inserção da biblioteca.
**Where**: `apps/web/src/library/LibraryPanel.tsx`
**Depends on**: T1, T2
**Reuses**: Padrão de estado vazio/loading/erro de `WorkspaceListPage`
**Requirement**: CLIB-01, CLIB-02, CLIB-03, CLIB-04, CLIB-05, CLIB-06, CLIB-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Lista agrupada por categoria a partir de `libraryClient.list`
- [x] Busca client-side por `name`/`aliases`/`tags`, sem nova chamada de rede
- [x] Botão "inserir" chama `insertLibraryItem` via o `ref` de `EditorSurface` (`onInsert` prop — `DiagramEditorPage`/T8 wires it to the ref, same indirection `AiDock`'s `onApproved` already uses so `LibraryPanel` never touches the canvas ref directly)
- [x] Modo somente-leitura quando `role` não concede `diagram:write` (sem botão de inserir)
- [x] Estados de loading e erro-com-retry cobertos
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add LibraryPanel (CLIB-01..07)`

---

### T5: `MetadataPanel`

**What**: Painel de classificação semântica do elemento selecionado.
**Where**: `apps/web/src/library/MetadataPanel.tsx`
**Depends on**: T3
**Reuses**: `onSelectionChange` já exposto por `EditorSurface`
**Requirement**: CLIB-08, CLIB-09, CLIB-10, CLIB-11, CLIB-12, CLIB-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Busca metadata ao selecionar um único elemento; `404` vira formulário vazio, não erro
- [x] Salvar envia `PATCH` e reflete só o valor devolvido pelo servidor
- [x] Formulário oculto (só leitura) quando `role` não concede `diagram:write`
- [x] Estado "selecione um elemento" quando nada ou múltiplos selecionados
- [x] Troca de seleção com edição não salva descarta sem confirmação
- [x] Validação client-side de `metadataJson` antes de enviar (JSON inválido nunca chama a rota)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add MetadataPanel (CLIB-08..13)`

---

### T6: `InventoryView`

**What**: Tabela de inventário com export CSV.
**Where**: `apps/web/src/library/InventoryView.tsx`
**Depends on**: T3
**Reuses**: Mesmo padrão de tabela/estado vazio das demais listas
**Requirement**: CLIB-14, CLIB-15, CLIB-16, CLIB-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Lista via `metadataClient.inventory(diagramId, 'json')`
- [ ] Elemento com `elementType: null` marcado como "removido do canvas", não escondido
- [ ] Botão de export CSV chama `format=csv` e dispara download via `Blob`
- [ ] Estado vazio quando nenhum elemento classificado
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add InventoryView (CLIB-14..17)`

---

### T7: i18n keys (`en`, `pt-BR`)

**What**: Chaves novas sob `library`/`metadata`/`inventory` nos dois locales.
**Where**: `apps/web/src/i18n/locales/{en,pt-BR}/translation.json`
**Depends on**: None
**Reuses**: Convenção de chaves já usada por `nav`/`aiDock`
**Requirement**: CLIB-20

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Ambos os locales têm o mesmo conjunto de chaves sob `library`/`metadata`/`inventory`
- [x] `make lint` passes

**Tests**: none
**Gate**: quick

**Commit**: `feat(web): add library/metadata/inventory i18n keys`

---

### T8: Integração em `DiagramEditorPage` + acessibilidade

**What**: Monta `LibraryPanel`/`MetadataPanel` como painéis alternáveis e `InventoryView` alcançável
a partir do editor; testes de axe nos 3 componentes (arquivos `.a11y.spec.tsx` irmãos de cada
componente já criado em T4-T6); testes de alcançabilidade por teclado.
**Where**: `apps/web/src/DiagramEditorPage.tsx` (modify)
**Depends on**: T4, T5, T6, T7
**Reuses**: Padrão de toggle de painel de `AiDock`
**Requirement**: CLIB-18, CLIB-19, CLIB-20

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Painéis alternam sem perder estado do canvas
- [ ] `role` efetivo passado como prop, resolvido uma vez por `DiagramEditorPage` (mesma fonte que já resolve `mutatePermissions`)
- [ ] Toda ação alcançável só por Tab/Shift+Tab/Enter
- [ ] `aria-live="polite"` anuncia sucesso/falha de inserção e de salvamento de metadata
- [ ] Teste roda com locale `en` trocado no meio do caminho
- [ ] Zero violações serious/critical de axe nos 3 componentes
- [ ] Full gate passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): wire library/metadata/inventory panels into DiagramEditorPage (CLIB-18..20)`

---

## Phase Execution Map

Only real `Depends on` edges shown:

```
T1 → T4
T2 → T4
T3 → T5
T3 → T6
T4 → T8
T5 → T8
T6 → T8
T7 → T8
```

T1, T2, T3, T7 have no incoming edges.

8 tasks totais — cabe num único batch (≤ ~8), execução inline, sem sub-agentes.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | 1 método num arquivo existente | ✅ Granular |
| T2 | 1 client, 1 arquivo | ✅ Granular |
| T3 | 1 client, 1 arquivo | ✅ Granular |
| T4 | 1 componente | ✅ Granular |
| T5 | 1 componente | ✅ Granular |
| T6 | 1 componente | ✅ Granular |
| T7 | 2 arquivos JSON, mudança cohesiva | ✅ Granular (2-3 arquivos relacionados, OK) |
| T8 | 1 arquivo modificado + testes de a11y dos 3 componentes já criados | ✅ Granular (integração, não criação nova) |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | No incoming edge | ✅ Match |
| T2 | None | No incoming edge | ✅ Match |
| T3 | None | No incoming edge | ✅ Match |
| T4 | T1, T2 | T1 → T4, T2 → T4 | ✅ Match |
| T5 | T3 | T3 → T5 | ✅ Match |
| T6 | T3 | T3 → T6 | ✅ Match |
| T7 | None | No incoming edge | ✅ Match |
| T8 | T4, T5, T6, T7 | T4 → T8, T5 → T8, T6 → T8, T7 → T8 | ✅ Match |

---

## Test Co-location Validation

| Task | Tests field | Matriz exige | Status |
| ---- | ----------- | ------------- | ------ |
| T1 | unit | unit | ✅ Match |
| T2 | unit | unit | ✅ Match |
| T3 | unit | unit | ✅ Match |
| T4 | unit | unit (RTL) | ✅ Match |
| T5 | unit | unit (RTL) | ✅ Match |
| T6 | unit | unit (RTL) | ✅ Match |
| T7 | none | none (build gate only) | ✅ Match |
| T8 | unit | unit (RTL) + axe | ✅ Match |
