# Export, bundle e import — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: inline (Medium scope — sem `design.md` próprio; as três decisões reais (onde cada ação
vive, uma chamada por geração de export, texto de limitação do bundle de workspace) já estão
resolvidas na tabela de Assumptions do `spec.md`).
**Status**: Approved

---

## Test Coverage Matrix

> Gerado a partir de amostragem do codebase (`apps/web/src/nav/resourceClient.spec.ts`,
> `apps/web/src/nav/WorkspaceListPage.spec.tsx`, `apps/web/src/nav/ProjectListPage.spec.tsx`,
> `apps/web/src/a11y/shell.a11y.spec.tsx`) e a convenção de piso de cobertura deste repo (nunca
> baixado). Guidelines encontradas: nenhuma além de `CLAUDE.md`'s "Comandos" — forte default
> aplicado.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| `exportClient` | unit | Todo branch de status documentado: exports (200/429), bundle diagrama (200), import preview/confirm (200/201/400), bundle workspace (200/503) | `apps/web/src/export/exportClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Componente (`ExportMenu`) | unit (RTL) | 1:1 às ACs XPRT-01..04 (gerar uma vez, 4 links, 429, desabilita durante geração) | `apps/web/src/export/ExportMenu.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`BundleButton`, no editor) | unit (RTL) | 1:1 às ACs XPRT-05..06 (baixar, loading) | `apps/web/src/export/BundleButton.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`ImportDialog`) | unit (RTL) | 1:1 às ACs XPRT-07..12 (preview, erro 400, limite de elementos, confirmar+navegar, título vazio, gate de `role`) | `apps/web/src/export/ImportDialog.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`WorkspaceBundleAction`, em `WorkspaceListPage`) | unit (RTL) | 1:1 às ACs XPRT-13..15 (gate de `role`, confirmação sem acompanhamento, 503) | `apps/web/src/nav/WorkspaceListPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Acessibilidade (`ExportMenu`, `ImportDialog`) | unit (axe) | Zero violações serious/critical; XPRT-16..18 | `apps/web/src/export/*.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integração (`DiagramEditorPage`, `ProjectListPage`) | unit (RTL) | Menus/ação montam nos locais certos, `role` efetivo gate as ações | `apps/web/src/DiagramEditorPage.spec.tsx`, `apps/web/src/nav/ProjectListPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |

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

### Phase 2: Componentes de diagrama

```
T2
T3
```

### Phase 3: Componentes de projeto/workspace

```
T4
T5
```

### Phase 4: i18n e integração

```
T6
T7
```

---

## Task Breakdown

### T1: `exportClient.ts`

**What**: Cliente HTTP pra `POST /diagrams/:id/exports`, `POST .../bundle`,
`POST /projects/:id/import` (preview e confirm) e `POST /workspaces/:id/bundles`.
**Where**: `apps/web/src/export/exportClient.ts`
**Depends on**: None
**Reuses**: Padrão de `aiDockClient.ts`/`memberClient.ts` (status branching, injeção de `fetchImpl`)
**Requirement**: XPRT-01, XPRT-05, XPRT-07, XPRT-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `generateExports(diagramId)` devolve `{exportId, revision, formats}`, cobre `429`
- [x] `generateBundle(diagramId)` devolve `{bundleId, url, sizeBytes, manifest}`
- [x] `previewImport(projectId, fileContent)` envia sem `confirm`, devolve `{preview}`; `confirmImport(projectId, fileContent, title)` envia com `confirm: true`, devolve `{preview, diagram}` (`201`); ambos cobrem `400`
- [x] `requestWorkspaceBundle(workspaceId)` devolve `{jobId, status}`, cobre `503`
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add exportClient (XPRT-01/05/07/13)`

---

### T2: `ExportMenu`

**What**: Dropdown de export no toolbar do editor — uma geração, 4 links de download.
**Where**: `apps/web/src/export/ExportMenu.tsx`
**Depends on**: T1
**Reuses**: Padrão de menu/dropdown já usado em `DiagramEditorPage`
**Requirement**: XPRT-01, XPRT-02, XPRT-03, XPRT-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Um clique em "gerar" dispara uma única chamada e exibe os 4 links (`.excalidraw`/SVG/PNG/PDF) com `sizeBytes` formatado
- [ ] Cada link abre a `url` assinada diretamente, sem passar pelo servidor do produto de novo
- [ ] `429` exibe mensagem de "aguarde", sem travar o editor
- [ ] Botão desabilitado durante a geração em andamento
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add ExportMenu (XPRT-01..04)`

---

### T3: `BundleButton`

**What**: Ação "baixar bundle" no editor, um diagrama por vez.
**Where**: `apps/web/src/export/BundleButton.tsx`
**Depends on**: T1
**Reuses**: Mesmo padrão de loading/erro de `ExportMenu`
**Requirement**: XPRT-05, XPRT-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Clique dispara `generateBundle` e abre a `url` retornada na resposta `200`
- [ ] Indicador de carregamento durante a geração
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add BundleButton (XPRT-05/06)`

---

### T4: `ImportDialog`

**What**: Fluxo de seleção de arquivo → prévia → confirmação → navegação, em `ProjectListPage`.
**Where**: `apps/web/src/export/ImportDialog.tsx`
**Depends on**: T1
**Reuses**: Mesmo padrão `<dialog>` de `ConfirmArchiveDialog` (R3), leitura de arquivo via `File.text()`
**Requirement**: XPRT-07, XPRT-08, XPRT-09, XPRT-10, XPRT-11, XPRT-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Seleção de arquivo lê como texto e chama `previewImport`, exibe `elementCount`
- [ ] `400` (JSON inválido ou não reconhecido) exibe a mensagem sem permitir confirmar
- [ ] `400` de limite de elementos exibe a mensagem sem truncar
- [ ] Confirmar com título preenchido chama `confirmImport` e navega para `/w/:workspaceId/d/:diagramId` do diagrama criado
- [ ] Confirmar sem título preenchido não emite requisição (validação client-side)
- [ ] Ação de importar oculta quando `role` não concede `diagram:write` no projeto
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add ImportDialog (XPRT-07..12)`

---

### T5: `WorkspaceBundleAction`

**What**: Ação de linha em `WorkspaceListPage` pra solicitar o bundle do workspace.
**Where**: `apps/web/src/nav/WorkspaceListPage.tsx`
**Depends on**: T1
**Reuses**: O mesmo campo `role` por item que R3 já resolve; gate `workspace:manage_members` (mesmo de R4)
**Requirement**: XPRT-13, XPRT-14, XPRT-15

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Ação visível só quando `role` do item for `org_admin`/`workspace_admin`
- [ ] Confirmar chama `requestWorkspaceBundle` e exibe o texto explícito de "sem acompanhamento nesta UI" (spec.md Assumptions)
- [ ] `503` exibe indisponibilidade, sem retry automático
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add workspace bundle request action (XPRT-13..15)`

---

### T6: i18n keys (`en`, `pt-BR`)

**What**: Chaves novas sob `export`/`import` nos dois locales.
**Where**: `apps/web/src/i18n/locales/{en,pt-BR}/translation.json`
**Depends on**: None
**Reuses**: Convenção de chaves já usada por `nav`
**Requirement**: XPRT-18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Ambos os locales têm o mesmo conjunto de chaves sob `export`/`import`
- [ ] `make lint` passes

**Tests**: none
**Gate**: quick

**Commit**: `feat(web): add export/import i18n keys`

---

### T7: Integração + acessibilidade

**What**: Monta `ExportMenu`/`BundleButton` no toolbar de `DiagramEditorPage` e `ImportDialog` em
`ProjectListPage`; testes de axe e de alcançabilidade por teclado.
**Where**: `apps/web/src/DiagramEditorPage.tsx`
**Depends on**: T2, T3, T4, T5, T6
**Reuses**: Padrão de toggle/menu já usado por `AiDock`/R5/R6
**Requirement**: XPRT-16, XPRT-17, XPRT-18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `ExportMenu`/`BundleButton` aparecem no toolbar do editor
- [ ] `ImportDialog` alcançável a partir de `ProjectListPage`
- [ ] Toda ação alcançável só por Tab/Shift+Tab/Enter
- [ ] `aria-live="polite"` anuncia sucesso/falha de geração e de confirmação de import
- [ ] Teste roda com locale `en` trocado no meio do caminho
- [ ] Zero violações serious/critical de axe em `ExportMenu`/`ImportDialog`
- [ ] Full gate passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): wire export/import into editor and project page (XPRT-16..18)`

---

## Phase Execution Map

Only real `Depends on` edges shown:

```
T1 → T2
T1 → T3
T1 → T4
T1 → T5
T2 → T7
T3 → T7
T4 → T7
T5 → T7
T6 → T7
```

T1, T6 have no incoming edges.

7 tasks totais — cabe num único batch (≤ ~8), execução inline, sem sub-agentes.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: `exportClient` | 1 arquivo, 1 conceito (parametrizado por 4 operações) | ✅ Granular |
| T2: `ExportMenu` | 1 componente | ✅ Granular |
| T3: `BundleButton` | 1 componente | ✅ Granular |
| T4: `ImportDialog` | 1 componente | ✅ Granular |
| T5: `WorkspaceBundleAction` | 1 componente (extensão de `WorkspaceListPage`) | ✅ Granular |
| T6: i18n keys | 2 arquivos, 1 bloco cohesivo | ✅ Granular |
| T7: integração + a11y | 1 arquivo modificado + testes dos componentes já criados | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | No incoming edge | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 | ✅ Match |
| T4 | T1 | T1 → T4 | ✅ Match |
| T5 | T1 | T1 → T5 | ✅ Match |
| T6 | None | No incoming edge | ✅ Match |
| T7 | T2, T3, T4, T5, T6 | T2 → T7, T3 → T7, T4 → T7, T5 → T7, T6 → T7 | ✅ Match |

---

## Test Co-location Validation

| Task | Tests field | Matriz exige | Status |
| ---- | ----------- | ------------- | ------ |
| T1 | unit | unit | ✅ Match |
| T2 | unit | unit (RTL) | ✅ Match |
| T3 | unit | unit (RTL) | ✅ Match |
| T4 | unit | unit (RTL) | ✅ Match |
| T5 | unit | unit (RTL) | ✅ Match |
| T6 | none | none (build gate only) | ✅ Match |
| T7 | unit | unit (RTL) + axe | ✅ Match |
