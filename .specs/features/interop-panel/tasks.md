# Interop Mermaid/Structurizr no painel de export/import — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is
the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review,
Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: inline (Medium scope — sem `design.md` próprio; a única decisão de arquitetura real
— como expressar "prévia" sem uma rota de dry-run — já está resolvida na tabela de Assumptions do
`spec.md`).
**Status**: Done (T1-T3 implementados, Verifier PASS — `.specs/features/interop-panel/validation.md`)

---

## Test Coverage Matrix

> Gerado a partir de amostragem do codebase (`apps/web/src/export/exportClient.spec.ts`,
> `apps/web/src/export/ExportMenu.spec.tsx`, `apps/web/src/export/ImportDialog.spec.tsx`,
> `apps/web/src/export/*.a11y.spec.tsx`, `apps/web/src/library/InventoryView.spec.tsx` para o
> padrão de download via `Blob`) e a convenção de piso de cobertura deste repo (nunca baixado).
> Guidelines encontradas: nenhuma além de `CLAUDE.md`'s "Comandos" — forte default aplicado.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| `exportClient` (extensão) | unit | Todo branch de status documentado: export DSL (200/erro), import DSL (201/400/erro) para os 2 formatos | `apps/web/src/export/exportClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`ExportMenu`, extensão) | unit (RTL) | 1:1 às ACs INT-01..05 (2 botões, download via Blob, limitations, erro, disabled independente) | `apps/web/src/export/ExportMenu.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`ImportDialog`, extensão) | unit (RTL) | 1:1 às ACs INT-06..15 (seletor de formato, prévia client-side, confirmar, 400, erro, título opcional, arquivo vazio, gate de `role` já existente) | `apps/web/src/export/ImportDialog.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Acessibilidade (`ExportMenu`, `ImportDialog`, extensão) | unit (axe) | Zero violações serious/critical nos novos estados; INT-16 | `apps/web/src/export/*.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Após task com testes unitários, escopada a um pacote | `pnpm --filter @arch-canvas/web run test:unit` |
| Full | Fechando a feature | `make lint && make typecheck && make test-unit` |

---

## Execution Plan

Fatia pequena, um único worker inline (3 tasks, bem abaixo do budget de ~7).

### Phase 1: Cliente

```
T1
```

### Phase 2: Componentes

```
T1 → T2
T1 → T3
```

---

## Task Breakdown

### T1: Estender `exportClient.ts` com `exportDsl`/`importDsl`

**What**: Duas funções novas no cliente HTTP existente — `exportDsl(diagramId, format)` chamando
`POST /diagrams/:id/export:mermaid`/`:structurizr` (sem corpo) e `importDsl(projectId, format,
dsl, title?)` chamando `POST /projects/:id/import:mermaid`/`:structurizr` com `{dsl, title?}` —
cada uma com seu tipo de resultado discriminado, mesmo padrão das funções já existentes no
arquivo.
**Where**: `apps/web/src/export/exportClient.ts`
**Depends on**: None
**Reuses**: Padrão de status-branching e `doFetch` já estabelecido no arquivo (`generateExports`,
`confirmImport`)
**Requirement**: INT-01, INT-02, INT-04, INT-09, INT-10, INT-11, INT-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `exportDsl(diagramId, 'mermaid' | 'structurizr')` envia `POST /diagrams/:id/export:<format>` e devolve `{status:'ok', dsl, limitations}` no `200`, `{status:'error'}` em qualquer outro status
- [x] `importDsl(projectId, 'mermaid' | 'structurizr', dsl, title?)` envia `POST /projects/:id/import:<format>` com `{dsl}` (e `title` apenas quando não-vazio) e devolve `{status:'ok', diagramId, diagram, limitations}` no `201`, `{status:'invalid', message}` no `400`, `{status:'error'}` em qualquer outro status
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add mermaid/structurizr interop client functions (INT-01/02/09-12)`

---

### T2: Estender `ExportMenu` com export Mermaid/Structurizr

**What**: Dois botões novos dentro do mesmo `<details>` — "Exportar Mermaid"/"Exportar
Structurizr" — cada um chamando `exportDsl`, disparando download client-side via
`Blob`/`URL.createObjectURL` (mesmo padrão de `InventoryView.tsx`) e exibindo `limitations`.
Estado de `disabled`/erro independente por formato, sem afetar o botão "Gerar exports" dos 4
formatos do R7.
**Where**: `apps/web/src/export/ExportMenu.tsx`, `apps/web/src/export/ExportMenu.spec.tsx`,
`apps/web/src/export/ExportMenu.a11y.spec.tsx`,
`apps/web/src/i18n/locales/{en,pt-BR}/translation.json`
**Depends on**: T1
**Reuses**: `InventoryView.tsx`'s `handleExportCsv` (Blob/createObjectURL/click/revoke), estado
`Phase`/`aria-live` já existente em `ExportMenu`
**Requirement**: INT-01, INT-02, INT-03, INT-04, INT-05, INT-16, INT-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Clicar "Exportar Mermaid"/"Exportar Structurizr" chama a rota correspondente exatamente uma vez e dispara o download de `diagram-<id>.mmd`/`.dsl` no `200`
- [x] `limitations` não-vazio aparece como texto visível junto ao botão daquele formato; vazio mostra confirmação explícita de "nenhuma limitação"
- [x] Resposta não-`200` mostra erro genérico na região `aria-live` existente, sem travar o resto da página
- [x] Cada botão desabilita independentemente enquanto sua própria chamada está em andamento
- [x] Botões e textos são alcançáveis por teclado; toda string nova vem de `translation.json` (pt-BR e en)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add mermaid/structurizr export to ExportMenu (INT-01..05/16/17)`

---

### T3: Estender `ImportDialog` com seletor de formato + prévia DSL

**What**: `<fieldset>`/`radiogroup` de formato (`.excalidraw` padrão / Mermaid / Structurizr)
dentro do mesmo `<dialog>`. Selecionar Mermaid/Structurizr troca o `accept` do input de arquivo e
o caminho de leitura: em vez de `previewImport` (chamada ao servidor), o conteúdo lido vira prévia
somente-leitura no cliente; confirmar chama `importDsl` diretamente (sem endpoint de preview),
exibe `limitations` e navega para o diagrama criado no `201`; título fica opcional para estes dois
formatos (diferente do `.excalidraw`).
**Where**: `apps/web/src/export/ImportDialog.tsx`, `apps/web/src/export/ImportDialog.spec.tsx`,
`apps/web/src/export/ImportDialog.a11y.spec.tsx`,
`apps/web/src/i18n/locales/{en,pt-BR}/translation.json`
**Depends on**: T1
**Reuses**: Estrutura de `<dialog>`/`resetState`/`handleFileChange`/`handleConfirm` já existente em
`ImportDialog`
**Requirement**: INT-06, INT-07, INT-08, INT-09, INT-10, INT-11, INT-12, INT-13, INT-14, INT-15,
INT-16, INT-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Diálogo abre com `.excalidraw` selecionado por padrão; escolher Mermaid/Structurizr troca `accept` e descarta prévia/arquivo anterior
- [x] Selecionar arquivo sob Mermaid/Structurizr lê como texto e exibe a prévia somente-leitura sem nenhuma chamada de rede
- [x] Confirmar chama `POST /projects/:id/import:<format>` exatamente uma vez com `{dsl, title?}`; `201` exibe `limitations` (mesmo vazio) e navega para `/w/:workspaceId/d/:diagramId`; `400` mostra a mensagem do servidor e não navega; qualquer outro status mostra erro genérico e não navega
- [x] Confirmar com título vazio é permitido para Mermaid/Structurizr (diferente do `.excalidraw`); arquivo com conteúdo vazio mantém o botão de confirmar desabilitado
- [x] `canImport` continua escondendo o gatilho inteiro (os 3 formatos) para quem não tem `diagram:write`
- [x] Seletor, prévia e botão de confirmar são alcançáveis por teclado; toda string nova vem de `translation.json` (pt-BR e en)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: build (última task da feature)

**Commit**: `feat(web): add mermaid/structurizr import to ImportDialog (INT-06..17)`

---

## Phase Execution Map

```
Phase 1 → Phase 2

Phase 1:  T1
Phase 2:  T1 ------→ T2
          T1 ------→ T3
```

Execução estritamente sequencial dentro de cada fase — um agente por vez, uma task de cada vez;
T2 é implementada antes de T3 por convenção de ordem (export antes de import), mas nenhuma das
duas depende do resultado da outra, só de T1.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Estender `exportClient.ts` | 1 arquivo, 2 funções coesas (mesmo módulo/responsabilidade) | ✅ Granular |
| T2: Estender `ExportMenu` | 1 componente + seus próprios testes/a11y/i18n | ✅ Granular |
| T3: Estender `ImportDialog` | 1 componente + seus próprios testes/a11y/i18n | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | (nenhuma seta) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ---------------------------- | ---------------- | ---------- | ------ |
| T1: exportClient | `exportClient` (extensão) | unit | unit | ✅ OK |
| T2: ExportMenu | Componente `ExportMenu` + a11y | unit (RTL + axe) | unit | ✅ OK |
| T3: ImportDialog | Componente `ImportDialog` + a11y | unit (RTL + axe) | unit | ✅ OK |

---

## Tips

- **Phases are ordered** - T1 antes de T2/T3; T2 antes de T3 (mesma fase, ordem sequencial)
- **Reuses = Token saver** - `InventoryView`'s Blob pattern, `ExportMenu`/`ImportDialog`'s próprio
  estado existente
- **One commit per task** - 3 commits atômicos, um por task
