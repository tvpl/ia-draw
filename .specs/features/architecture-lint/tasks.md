# Lint arquitetural Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is
the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review,
Verifier, discrimination sensor).

---

**Design**: skipped — 1 rota já existente e verificada, 1 superfície nova, extensão aditiva de um
padrão já estabelecido (`EditorSurfaceHandle`, AD-010). Ver `spec.md`'s Assumptions para a única
decisão de "como o salto se manifesta no canvas" (seleção + `scrollToContent`), que não abre
ambiguidade arquitetural nova.
**Status**: Approved

---

## Test Coverage Matrix

> Gerado por amostragem do repositório (`EditorSurface.spec.tsx`, `metadataClient.spec.ts`,
> `MetadataPanel.spec.tsx`/`.a11y.spec.tsx`, `EditorSidePanel.spec.tsx`,
> `DiagramEditorPage.spec.tsx`) e das ACs de `spec.md`. Guidelines encontradas: nenhum
> `AGENTS.md`/doc de teste dedicado — `CLAUDE.md` (raiz) documenta os comandos de gate
> (`make lint && make typecheck && make test-unit`) usados como piso; profundidade por camada
> segue o default forte (toda AC do spec + edge cases listados têm teste).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| `EditorSurfaceHandle.focusElement` (editor-adapter, imperative canvas op) | unit | Seleciona+centraliza um id existente; não faz nada (sem crash) para um id ausente; nunca chama `updateScene` com `elements` (ALNT-08..12) | `packages/editor-adapter/src/EditorSurface.spec.tsx` | `pnpm -w test:unit` |
| `lintClient` (HTTP client) | unit | Um branch por status documentado (200 com/sem avisos, não-200, falha de rede) — mesmo padrão de `metadataClient.spec.ts` | `apps/web/src/lint/lintClient.spec.ts` | `pnpm -w test:unit` |
| `LintPanel` (componente React) | unit | 1:1 com as ACs ALNT-01..12: loading, lista de avisos, estado sem avisos, estado de erro + retry, refresh, salto por `elementId` (existente e ausente), nunca bloqueia render de outro estado | `apps/web/src/lint/LintPanel.spec.tsx` | `pnpm -w test:unit` |
| `LintPanel` (acessibilidade) | unit (a11y) | ALNT-13/14: navegação só teclado até o salto, sem violações axe, texto de chrome vindo de i18n | `apps/web/src/lint/LintPanel.a11y.spec.tsx` | `pnpm -w test:unit` |
| `EditorSidePanel` (terceira aba) | unit | Aba "Lint" sempre presente (independente de `canMutate`), painel permanece montado/`hidden` ao trocar de aba — mesmo padrão já coberto para "ai"/"comments" | `apps/web/src/diagram/EditorSidePanel.spec.tsx` | `pnpm -w test:unit` |
| `DiagramEditorPage` (integração da fatia) | unit | `LintPanel` recebe `diagramId`/`liveElementIds` corretos; clique em "ir para o elemento" chama `editorSurfaceRef.current.focusElement` com o id certo | `apps/web/src/diagram/DiagramEditorPage.spec.tsx` | `pnpm -w test:unit` |
| i18n (`en`/`pt-BR` translation.json) | none | Build/typecheck gate apenas — chaves novas usadas pelos componentes acima | `apps/web/src/i18n/locales/**/translation.json` | build gate only |

## Gate Check Commands

> Gerado a partir de `CLAUDE.md` (raiz) e `Makefile`. Sandbox conhecido: `make ci` pode falhar por
> faltar `pg_lsclusters`/`redis-server`; o gate substituto documentado é
> `make lint && make typecheck && make test-unit`.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests, sem tocar rotas/servidor | `pnpm -w test:unit` |
| Full | Depois de cada task desta feature (nenhuma toca servidor, mas o `Done when` de toda task exige o gate completo do worktree) | `make lint && make typecheck && make test-unit` |
| Build | Depois da última task, antes do Verifier | `make lint && make typecheck && make test-unit` (mesmo comando — não há `test-integration` a rodar, nenhuma rota nova) |

---

## Execution Plan

Fases sequenciais — cada uma completa antes da próxima começar; tasks dentro de uma fase rodam em
ordem. Onda pequena o bastante (5 tasks) para rodar inline, sem sub-agentes de batch.

### Phase 1: Canvas primitive

```
T1
```

### Phase 2: Data + presentation

```
T2 → T3
```

### Phase 3: Wiring into the editor

```
T4 → T5
T1 → T5
T3 → T5
```

---

## Task Breakdown

### T1: `focusElement` no handle imperativo do `EditorSurface`

**What**: Adiciona `focusElement(elementId: string): boolean` a `EditorSurfaceHandle` — procura o
id na cena local (`previousSceneRef`), se existir seleciona-o (`updateScene({appState:
{selectedElementIds: {[id]: true}}})`) e centraliza o viewport nele (`scrollToContent(element,
{animate: true})`), devolvendo `true`; se não existir, não chama nada e devolve `false`. Extensão
aditiva — mesma forma de `insertLibraryItem`/`applyCollaborators`, nenhum consumidor existente
muda de comportamento.
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: None
**Reuses**: O próprio `EditorSurfaceHandle`/`useImperativeHandle` (AD-010) e `previousSceneRef` que
`applyRemoteScene`/`insertLibraryItem` já leem.
**Requirement**: ALNT-08, ALNT-09, ALNT-10, ALNT-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `focusElement` existe apenas como uma nova função no objeto de `useImperativeHandle`, tipada em `EditorSurfaceHandle`
- [x] Chamando com um id presente na cena local: `updateScene` recebe `appState.selectedElementIds` com só aquele id `true`, e `scrollToContent` é chamado com o elemento correspondente
- [x] Chamando com um id ausente da cena local: nem `updateScene` nem `scrollToContent` são chamados, função devolve `false`, nenhuma exceção lançada
- [x] Nenhuma chamada de `focusElement` passa `elements` para `updateScene` (nunca muta a cena)
- [x] Gate check passes: `make lint && make typecheck && make test-unit` (pré-existente, não relacionado: `EditorSurface.spec.tsx`'s "icon.kind external" text-wrap assertion já falhava antes desta task, confirmado com `git stash` — não é regressão desta task)
- [x] Test count: 5 testes novos cobrindo `focusElement` (seleciona+centraliza; lê a cena atual pós-mount; no-op para id ausente; no-op para tombstone `isDeleted`; nunca passa `elements`) passam, nenhum teste existente de `EditorSurface.spec.tsx` quebra além da falha pré-existente já documentada acima

**Tests**: unit
**Gate**: full

**Commit**: `feat(editor-adapter): add focusElement to EditorSurfaceHandle`

---

### T2: `lintClient` — cliente HTTP para `GET /diagrams/:id/lint`

**What**: Cria o cliente que chama a rota já verificada, no molde de `metadataClient.ts`/
`aiDockClient.ts`: `fetchImpl` injetável, um branch por status de resposta documentado (200 →
`LintWarning[]`, qualquer outro status ou falha de rede → resultado de erro tipado, nunca lança).
**Where**: `apps/web/src/lint/lintClient.ts`
**Depends on**: None
**Reuses**: O mesmo padrão de `createMetadataClient`/`createCommentClient` (injeção de `fetchImpl`,
union de resultado em vez de exceção para o caminho feliz de UI).
**Requirement**: ALNT-01, ALNT-02, ALNT-03, ALNT-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `LintWarning`/`LintRuleName` espelham exatamente o shape de `apps/server/src/modules/lint/engine.ts` (`rule`, `severity: 'warning'`, `message`, `elementIds: string[]`)
- [ ] `list(diagramId)` devolve `{ status: 'ok', warnings }` em 200, `{ status: 'error' }` em qualquer outro status ou exceção de rede — nunca lança
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`
- [ ] Test count: um teste por branch de status (200 com avisos, 200 vazio, não-200, falha de rede) passa

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add lintClient for GET /diagrams/:id/lint`

---

### T3: `LintPanel` — painel de avisos + i18n

**What**: Componente que busca via `lintClient` ao montar e sob clique em "Atualizar", renderiza
loading/erro-com-retry/sucesso-vazio/lista de avisos (ALNT-01..07), e para cada `elementId` de
cada aviso oferece um controle "ir para o elemento" — habilitado só se o id estiver em
`liveElementIds` (prop), chamando `onJumpToElement(elementId)` (prop, não conhece `EditorSurface`
diretamente — mesma separação de responsabilidade que `LibraryPanel.onInsert`/
`MetadataPanel` já usam). Anuncia loading/erro/refresh/salto em `aria-live="polite"`
(ALNT-08..14). Adiciona as chaves de i18n novas em `en`/`pt-BR`.
**Where**: `apps/web/src/lint/LintPanel.tsx`
**Depends on**: T2
**Reuses**: `createLintClient` (T2); o padrão de estado `'loading' | 'ready' | 'error'` e o botão
"Atualizar" de `CommentsSidebar`; o padrão de `data-testid="*-announcement"` já usado por
`CommentsSidebar`/`MetadataPanel`.
**Requirement**: ALNT-01, ALNT-02, ALNT-03, ALNT-04, ALNT-05, ALNT-06, ALNT-07, ALNT-08, ALNT-09, ALNT-10, ALNT-11, ALNT-12, ALNT-13, ALNT-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Ao montar, chama `lintClient.list(diagramId)` uma vez e mostra loading até resolver
- [ ] 200 com avisos: lista cada `LintWarning` com `rule` e `message` verbatim; 200 vazio: estado de sucesso explícito distinto do estado de erro; não-200/falha: estado de erro com botão de tentar novamente
- [ ] Botão "Atualizar" refaz a chamada e substitui a lista
- [ ] Cada `elementId` de cada aviso tem seu próprio controle; controle só é clicável quando o id está em `liveElementIds`; clique chama `onJumpToElement(elementId)` e anuncia o resultado em `aria-live`
- [ ] Nenhum estado do painel desabilita, esconde ou intercepta qualquer ação fora do próprio painel (não implementado por não haver nenhum acoplamento com ferramentas de canvas nesta camada — a ausência de qualquer prop/callback que module o canvas é a própria prova de ALNT-07)
- [ ] Todo texto de chrome (título, loading, erro, retry, "Atualizar", "Ir para elemento", "elemento indisponível") vem de `t(...)`, chaves novas presentes em `en` e `pt-BR`
- [ ] Painel inteiro operável só por teclado (testado com `.a11y.spec.tsx`, mesmo padrão de `MetadataPanel.a11y.spec.tsx`)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`
- [ ] Test count: testes cobrindo cada AC ALNT-01..14 relevante ao componente passam, incluindo o a11y spec

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add LintPanel for diagram lint warnings`

---

### T4: Terceira aba "Lint" em `EditorSidePanel`

**What**: `EditorSidePanel` ganha um terceiro `TabId` (`'lint'`) e um terceiro par
`role="tab"`/`role="tabpanel"`, sempre presente (nunca condicionado, ao contrário da aba "IA")
— mesmo critério de acesso que a aba "Comentários" já usa (`diagram:read` basta).
**Where**: `apps/web/src/diagram/EditorSidePanel.tsx`
**Depends on**: None
**Reuses**: A estrutura de aba existente (`aria-controls`/`aria-selected`/`hidden`) — só adiciona
um terceiro braço, sem reescrever a lógica de `active`.
**Requirement**: ALNT-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Nova prop `lintPanel: ReactNode` (sempre renderizada, sem o `| null` que `aiPanel` tem)
- [ ] Aba "Lint" aparece sempre, independente de `aiPanel` ser `null` ou não
- [ ] Painel de lint fica montado com `hidden` quando outra aba está ativa (mesma regra dos outros dois painéis) — nunca desmontado
- [ ] Chave i18n nova `comments.tabs.lint` em `en`/`pt-BR`
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`
- [ ] Test count: testes novos cobrindo a aba sempre presente + `hidden` ao trocar passam, nenhum teste existente de `EditorSidePanel.spec.tsx` quebra

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add Lint tab to EditorSidePanel`

---

### T5: Ligar `LintPanel` ao `DiagramEditorPage`

**What**: `DiagramEditorPage` passa `lintPanel={<LintPanel diagramId={...} liveElementIds={...}
onJumpToElement={...} />}` para `EditorSidePanel`, onde `onJumpToElement` chama
`editorSurfaceRef.current?.focusElement(elementId)` — o mesmo `editorSurfaceRef` que
`handleInsertLibraryItem`/`applyRemoteScene`/`applyCollaborators` já usam (AD-010, nenhum
segundo caminho até o canvas).
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx`
**Depends on**: T1, T3, T4
**Reuses**: `editorSurfaceRef` e `liveElementIds` já existentes na página (o mesmo `liveElementIds`
que `CommentsSidebar` já recebe — nenhuma segunda fonte de "quais elementos existem agora").
**Requirement**: ALNT-08, ALNT-09, ALNT-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `LintPanel` recebe `diagramId` real da rota e `liveElementIds` (o memo já existente)
- [ ] `onJumpToElement` chama `editorSurfaceRef.current?.focusElement(elementId)`, nenhum outro efeito colateral
- [ ] Doc comment da página atualizado com a mesma convenção das demais fatias (uma frase explicando de onde `lintPanel` vem e por que reusa `editorSurfaceRef`)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`
- [ ] Test count: teste novo em `DiagramEditorPage.spec.tsx` confirmando a ligação (clique em "ir para o elemento" dentro do `LintPanel` renderizado chama `focusElement` com o id certo), nenhum teste existente quebra

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): wire LintPanel into DiagramEditorPage`

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: `focusElement` no handle | 1 método, 1 arquivo | ✅ Granular |
| T2: `lintClient` | 1 cliente HTTP, 1 arquivo | ✅ Granular |
| T3: `LintPanel` + i18n | 1 componente + chaves i18n co-localizadas (mesma convenção de toda task anterior nesta frente, ex. R9/R5) | ✅ Granular |
| T4: aba "Lint" em `EditorSidePanel` | 1 componente, 1 arquivo | ✅ Granular |
| T5: ligar ao `DiagramEditorPage` | 1 arquivo (wiring) | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | Phase 1, sozinha | ✅ Match |
| T2 | None | Phase 2, primeira | ✅ Match |
| T3 | T2 | Phase 2, `T2 → T3` | ✅ Match |
| T4 | None | Phase 3, primeira | ✅ Match |
| T5 | T1, T3, T4 | Phase 3, `T4 → T5` (T1/T3 já concluídas em fases anteriores, dependência cross-phase é permitida — só não pode apontar para uma fase FUTURA) | ✅ Match |

## Test Co-location Validation

| Task | Tests field | Matrix layer | Status |
| ---- | ----------- | -------------- | ------ |
| T1 | unit | `EditorSurfaceHandle.focusElement` | ✅ Match |
| T2 | unit | `lintClient` | ✅ Match |
| T3 | unit | `LintPanel` (+ a11y) | ✅ Match |
| T4 | unit | `EditorSidePanel` (terceira aba) | ✅ Match |
| T5 | unit | `DiagramEditorPage` (integração) | ✅ Match |

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 -------------------→ T5
Phase 2:  T2 ------→ T3 --------→ T5
Phase 3:  T4 ------------------→ T5
```

Execução estritamente sequencial. Onda de 5 tasks — abaixo do limiar de ~8 tasks que dispararia a
oferta de sub-agentes de batch (`sub-agents.md`); execução inline.
