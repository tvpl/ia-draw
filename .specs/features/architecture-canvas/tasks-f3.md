# Architecture Canvas Tasks — Onda 4: F3 Documentação, Apresentação/Protótipos, Lint, Architecture-as-Code, Comentários

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow.

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** as cinco histórias P2 completas — geração de documentação (DOC-01..04), modo apresentação/protótipos navegáveis + wireframe kit (PRS-01..05), lint arquitetural e C4 (LNT-01..03), architecture-as-code via Mermaid/Structurizr (AAC-01..02), comentários e revisão assíncrona (CMT-01..02). Fecha inteiramente a "visão completa" do documento-fonte (§15), deixando só F4 (realtime, P3) e F5 (hardening) no roadmap. Consome `packages/diagram-ir` (F2b) para o round-trip Mermaid/Structurizr e para regenerar cenas a partir de DSL importado; consome o módulo `snapshot` (F1c) para publicação imutável de apresentações; consome `packages/auth`/RBAC (F1a) para a permissão de comentário do papel reviewer.

---

## ⚠️ Lições críticas de ondas anteriores — leia antes de escrever qualquer linha

1. **AD-008 (obrigatório, todo pacote/módulo server-side)**: nenhum pacote/módulo que roda server-side (`apps/server/**`, `packages/diagram-domain`, `packages/diagram-ir`, `packages/ai-tools`, e agora os novos módulos desta onda) pode importar `@excalidraw/excalidraw` ou `@arch-canvas/editor-adapter` **por valor** — somente `import type`. O bundle publicado do Excalidraw quebra o boot real do Node (`node dist/index.js`) mesmo quando os testes Vitest passam (o transform do Vite é lenient, o resolvedor ESM estrito do Node não é). Todo elemento de cena construído/lido no servidor usa tipos de dados puros. Confirme ao final de cada batch: `pnpm -w build && grep -rn "excalidraw" <pacote-tocado>/dist/*.js` sem nenhum `import`/`require` real.
2. **L-008 (wiring de produção)**: qualquer módulo de rota novo DEVE ser registrado em `apps/server/src/core/registerModules.ts` (única função usada tanto pelo `index.ts` real quanto pelos testes de integração) **na mesma task que o cria** — nunca deixe para uma task de "integração" posterior. A última task desta onda (T70) faz o smoke-test final: sobe o servidor compilado sob `node` puro de verdade e faz `curl` em cada rota nova (esperando `401` sem sessão, nunca `404`).
3. **Reuso do "compact semantic representation" (T58)**: três histórias desta onda (DOC-01, LNT-01/02, AAC-02) precisam do mesmo formato — elementos + edges da cena resolvidos para dados simples com labels e metadados semânticos. O módulo `ai-engine/buildContext.ts` (F2c) já resolve exatamente esse problema, mas **não deve ser importado por outros módulos** (acoplaria docgen/lint/aac ao módulo de IA por um detalhe de implementação, e arriscaria uma mudança em código já verificado da F2c). Em vez disso, T58 cria a MESMA lógica (resolução de label via `text`/bound-text, resolução de binding de arrow, formato `{ elements, edges }`) como função pura e independente em `packages/diagram-domain` — reaproveite o padrão do `mergeScene.ts` (AD-008: dependency-free, `import type` apenas). É duplicação deliberada de ~40 linhas, no mesmo espírito do desempate LWW duplicado entre `diagram-domain` e `editor-adapter`.
4. **Gate de build só na última task de cada batch**: toda task intermediária roda `Quick` (`test:unit`) ou `Full` quando toca integração; a ÚLTIMA task de CADA batch (não só da onda) declara `Gate: build` (`pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`) — F1a shipou 29 arquivos de drift de formatação Biome não detectado por pular essa disciplina.
5. **PGlite para integração (AD-007)**: testes de integração de Postgres usam `@electric-sql/pglite`, nunca testcontainers, neste sandbox sem Docker daemon.

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domínio puro (`packages/diagram-domain`, `packages/diagram-ir/interop`) | unit | Todos os branches; 1:1 com ACs; casos de round-trip com limitação documentada | `packages/*/src/**/*.spec.ts` | `pnpm -w test:unit` |
| Módulos de rota (`apps/server/src/modules/{docgen,lint,presentation,interop,comment}`) | unit (lógica pura) + integração (rotas, RBAC, PGlite) | Toda rota nova tem teste 401/403/200 + AC correspondente | `apps/server/src/modules/**/*.spec.ts`, `**/*.int.spec.ts` | `pnpm -w test:unit && pnpm -w test:integration` |
| Wiring de produção | boot real + curl manual | Toda rota nova responde (nunca 404) sob `node dist/...` puro | smoke-test na task final (T70) | manual, documentado no commit |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Full | Tasks que tocam integração/DB | `pnpm -w test:unit && pnpm -w test:integration` |
| Build | Última task de CADA batch | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` |

---

## Execution Plan

### Phase 21: Fundações (schema + interop de IR) — paralelizável

```
T58
T59
T60 -> T61
```

### Phase 22: Docgen e lint — consomem T58/T59

```
T58 -> T62
T59 -> T62
T62 -> T63
T58 -> T64
T59 -> T64
```

### Phase 23: Apresentação/protótipos — consome T59

```
T59 -> T65
T65 -> T66
```

### Phase 24: Wireframe kit, AaC, comentários — fecham a onda

```
T67
T58 -> T68
T60 -> T68
T61 -> T68
T59 -> T69
```

### Phase 25: Wiring final e gate real

```
T62 -> T70
T63 -> T70
T64 -> T70
T65 -> T70
T66 -> T70
T67 -> T70
T68 -> T70
T69 -> T70
```

---

## Task Breakdown

### Phase 21 — Fundações

### T58: packages/diagram-domain — extração de semântica compacta da cena

**What**: `extractSceneSemantics(scene: readonly SceneElement[], metadata?: readonly { elementId: string; semantics?: Record<string, unknown> }[]): { elements: SemanticElement[]; edges: SemanticEdge[] }`. `SemanticElement { elementId, type, label: string | null, semantics? }` (label resolvido do próprio `.text` se for elemento `text`, senão do texto de um `text` filho vinculado por `containerId`, senão `null`). `SemanticEdge { from, to, label }` resolvido de `arrow`s via `startBinding`/`endBinding`, ignorando arrows sem os dois endpoints resolvidos. Função pura, sem I/O, dependency-free — tipos de `SceneElement` só via `import type` de `@arch-canvas/editor-adapter` (AD-008). Documente no topo do arquivo, com uma linha, por que essa lógica é deliberadamente paralela (não importada) à de `ai-engine/buildContext.ts`.
**Where**: `packages/diagram-domain/src/sceneSemantics.ts`
**Depends on**: None
**Reuses**: padrão dependency-free de `packages/diagram-domain/src/mergeScene.ts` (AD-008)
**Requirement**: DOC-01, LNT-01, AAC-02 (base compartilhada)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Elemento `text` solto → label = seu próprio `.text`
- [x] Retângulo com `text` filho vinculado (`containerId`) → label = texto do filho
- [x] Elemento sem nenhum texto associado → label `null`
- [x] Arrow com `startBinding`/`endBinding` resolvidos → um `SemanticEdge`; arrow com um binding ausente → omitido do array
- [x] Elemento com `isDeleted: true` → excluído de `elements` e de qualquer `edge` que o referencie
- [x] `metadata` opcional → `semantics` do elemento correspondente é anexado quando presente, omitido quando ausente
- [x] `grep -rn "excalidraw" packages/diagram-domain/dist/*.js` (após build) sem import/require real

**Tests**: unit
**Gate**: quick

**Commit**: `feat(diagram-domain): add dependency-free scene semantics extractor for F3 modules`
**Status**: ✅ Complete — `extractSceneSemantics` in `packages/diagram-domain/src/sceneSemantics.ts`, a fresh independent implementation (not importing `ai-engine/buildContext.ts`, per task instruction and L-003) documented at the top of the file with the deliberate-duplication rationale. Resolves element labels (own `.text` for `text` elements, else a bound-text child via `containerId`, else `null`), resolves `SemanticEdge`s from `arrow` `startBinding`/`endBinding` (omitting arrows with an unresolved or dangling binding), excludes `isDeleted` elements from both `elements` and any edge referencing them, and attaches optional per-element `semantics` from the `metadata` argument only when present. 8 tests in `src/sceneSemantics.spec.ts` covering every Done-when bullet (loose text label, bound-text label, no-label element, full/partial arrow bindings, bound arrow label, deleted-element exclusion from elements+edges, metadata present/absent). `pnpm -w test:unit` green (29/29 in `diagram-domain`, 179/179 server, 22/22 web). `pnpm -w build` succeeds; `grep -rn "excalidraw" packages/diagram-domain/dist/*.js` matches only two doc-comment lines in `mergeScene.js` (no real import/require). **Deviation**: `pnpm -w build` initially failed on an unrelated pre-existing environment issue — `apps/server/node_modules/@arch-canvas/ai-tools` was a dangling symlink pointing at a stale scratch path (`/tmp/f2c-verify-scratch/packages/ai-tools`) left over from a prior verification run's worktree, not created by this task. Fixed by relinking it to the real in-repo package (`../../../../packages/ai-tools`); no source files were touched to fix it.

---

### T59: packages/database — schema de spec_documents, comments, presentations, presentation_frames

**What**: Quatro tabelas Drizzle novas, seguindo as convenções já existentes (`uuid` PK, `created_at`/`updated_at` quando aplicável, FKs, índices). `specDocuments { id, diagramId FK, sourceRevision integer, version integer, markdownKey text, status enum('draft'|'current'|'superseded'), generatedBy uuid FK users, createdAt }` com índice único `(diagram_id, version)`. `comments { id, diagramId FK, elementId text nullable, frameId uuid nullable, parentId uuid nullable (self-FK, thread), body text, status enum('open'|'resolved'), authorId FK users, createdAt, updatedAt }` com índice em `(diagram_id, element_id)`. `presentations { id, diagramId FK, name text, publishedSnapshotId uuid nullable FK diagram_snapshots, settingsJson jsonb, createdAt, updatedAt }`. `presentationFrames { id, presentationId FK, elementId text nullable, frameId text nullable, position integer, notes text nullable, navLinksJson jsonb, createdAt }` com índice em `(presentation_id, position)`. Gere a migration SQL (`drizzle-kit generate`) e valide com `migrate()` contra PGlite.
**Where**: `packages/database/src/schema.ts`, `packages/database/migrations/`
**Depends on**: None
**Reuses**: convenções de `diagramSnapshots`/`diagramElementsMeta` já existentes no mesmo arquivo
**Requirement**: DOC-02, PRS-01, PRS-02, PRS-03, CMT-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `migrate()` aplica a migration nova do zero contra PGlite sem erro
- [x] Inserir uma linha em cada uma das 4 tabelas com FKs válidas → sucesso
- [x] Inserir `comments` com `parent_id` apontando para outro comment (thread) → sucesso
- [x] Índice único `(diagram_id, version)` em `spec_documents` rejeita duplicata

**Tests**: unit (integração leve via PGlite, mesmo padrão de `migrate.int.spec.ts`)
**Gate**: quick

**Commit**: `feat(database): add spec_documents, comments, presentations, presentation_frames schema`
**Status**: ✅ Complete — 4 new Drizzle tables in `packages/database/src/schema.ts` following existing conventions exactly (uuid PK via `.primaryKey().defaultRandom()`, `references(() => table.id)` FKs, `timestamp(..., { withTimezone: true }).notNull().defaultNow()`, new `pgEnum`s `spec_document_status`/`comment_status`). `comments.parentId` is a self-referencing FK typed via `AnyPgColumn` (drizzle's documented pattern for self-joins). Migration generated with `drizzle-kit generate` → `infra/migrations/0008_colorful_bruce_banner.sql`. New integration spec `packages/database/src/collab.int.spec.ts` (4 tests, same PGlite pattern as `migrate.int.spec.ts`, AD-007): migration applies from scratch, one row inserted per table with valid FKs, a `comments` reply with `parentId` pointing to a root comment persists and round-trips, and a duplicate `(diagram_id, version)` insert into `spec_documents` is rejected with Postgres `23505` (unique_violation) via `spec_documents_diagram_version_unique`. `pnpm --filter @arch-canvas/database test:integration` green (6 files/29 tests, including the 4 new); `pnpm -w test:unit` and `pnpm -w build` both green. **Deviation**: none functional; `packages/database`'s own `tsc --noEmit` was run directly as a pre-check before `drizzle-kit generate` to confirm the self-referencing FK typed cleanly.

---

### T60: packages/diagram-ir — interop Mermaid (import/export)

**What**: `packages/diagram-ir/src/interop/mermaid.ts`. `parseMermaidFlowchart(dsl: string): IrDocument` — subconjunto suportado: `flowchart`/`graph` com nós (`id[label]`, `id(label)`, `id{label}`), edges (`A --> B`, `A -->|label| B`), `subgraph ... end` mapeado para `IrContainer(kind: 'group')`. Erros de sintaxe não reconhecida NÃO travam o parse inteiro — colete como `limitations: string[]` no retorno (`{ ir, limitations }`) e ignore a linha, nunca invente semântica. `toMermaidFlowchart(ir: IrDocument): { dsl: string; limitations: string[] }` — deriva `flowchart TD` a partir de nodes/containers/edges; containers viram `subgraph`; qualquer `IrEdge.semantics.mode` que não tenha equivalente direto em Mermaid (ex. `data` vs `dependency`) é anotado como comentário `%%` e listado em `limitations`.
**Where**: `packages/diagram-ir/src/interop/mermaid.ts`
**Depends on**: None (consome o schema `diagram-ir/v1` já existente da F2b, `packages/diagram-ir/src/schema.ts`)
**Reuses**: `validateIr` (F2b) para garantir que todo `IrDocument` produzido é válido antes de retornar
**Requirement**: AAC-01, AAC-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Flowchart com 4 nós, 1 subgraph e 3 edges (uma com label) → `IrDocument` válido (`validateIr` não lança), containers/edges corretos
- [x] DSL com uma linha de sintaxe não reconhecida → parse continua, linha aparece em `limitations`, resto do documento correto
- [x] `toMermaidFlowchart` de um `IrDocument` com edge `mode: 'data'` → DSL válido + `limitations` menciona a perda de semântica
- [x] Round-trip parse→export→parse de um documento simples preserva nós e edges (rótulos podem diferir por normalização, documentado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(diagram-ir): add Mermaid flowchart import/export with documented round-trip limitations`
**Status**: ✅ Complete — `parseMermaidFlowchart`/`toMermaidFlowchart` in `packages/diagram-ir/src/interop/mermaid.ts`, both returning `{ ir, limitations }`/`{ dsl, limitations }`. Parser supports `flowchart`/`graph` headers (direction skipped, not representable in the IR), `id[label]`/`id(label)`/`id{label}` node defs, `A --> B`/`A -->|label| B` edges, and nested `subgraph <id>[<label>] ... end` blocks mapped to `IrContainer(kind: 'group')`; any unrecognized line is skipped and reported verbatim (with line number) in `limitations`, never aborting the parse or inventing semantics. `validateIr` runs on every parsed document before it's returned. Imported edges get a documented baseline `semantics: { mode: 'dependency', direction: 'oneway' }` (Mermaid arrows carry no semantic-mode concept); `toMermaidFlowchart` treats that baseline as the only "no information lost" case — any other `mode` (e.g. `'data'`) or `direction: 'bidirectional'` is still exported as a plain `-->` but is additionally annotated with a `%%` DSL comment and a `limitations` entry, so the loss is never silent. 4 tests in `src/interop/mermaid.spec.ts` covering exactly the 4 Done-when ACs (4 nodes/1 subgraph/3 edges with one label; unrecognized-line resilience; `mode: 'data'` export limitation; parse→export→parse round-trip preserving node/edge ids and labels). `pnpm -w test:unit` and package `tsc --noEmit` both green. **Deviation**: `kind` has no Mermaid-flowchart equivalent, so a documented default (`'c4-context'`) is assigned on import rather than left unset (the schema requires it) — noted in the file's top-of-module comment, not surfaced as a `limitations` entry since it's a fixed, predictable default rather than a per-document data loss.

---

### T61: packages/diagram-ir — interop Structurizr DSL (import/export)

**What**: `packages/diagram-ir/src/interop/structurizr.ts`, mesmo contrato `{ ir, limitations }` / `{ dsl, limitations }` do T60. Subconjunto suportado do Structurizr DSL: bloco `model { softwareSystem "Name" { container "Name" { ... } } }` e `relationship` (`a -> b "label"`) mapeados para `IrNode`/`IrContainer(kind: 'boundedContext')`/`IrEdge`. Qualquer bloco fora do subconjunto (`views`, `styles`, `deploymentEnvironment`) é ignorado e registrado em `limitations`, nunca causa falha total do parse.
**Where**: `packages/diagram-ir/src/interop/structurizr.ts`, `packages/diagram-ir/src/interop/index.ts` (barrel exportando `mermaid.ts` + `structurizr.ts`)
**Depends on**: T60 (mesmo pacote/diretório — sequencial para não colidir no barrel `interop/index.ts`)
**Reuses**: `validateIr` (F2b)
**Requirement**: AAC-01, AAC-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] DSL com `softwareSystem` contendo 2 `container`s e 1 `relationship` → `IrDocument` válido com container `boundedContext` e edge correspondente
- [x] Bloco `views { ... }` presente → ignorado sem falha, mencionado em `limitations`
- [x] `toStructurizr` de um `IrDocument` simples → DSL parseável de volta (round-trip básico)
- [x] `packages/diagram-ir/src/interop/index.ts` exporta as 4 funções (`parseMermaidFlowchart`, `toMermaidFlowchart`, `parseStructurizrDsl`, `toStructurizrDsl`)

**Tests**: unit
**Gate**: build

**Commit**: `feat(diagram-ir): add Structurizr DSL import/export with documented round-trip limitations`
**Status**: ✅ Complete — `parseStructurizrDsl`/`toStructurizrDsl` in `packages/diagram-ir/src/interop/structurizr.ts`, same `{ ir, limitations }`/`{ dsl, limitations }` contract as T60. Parser supports `workspace { model { ... } }` as transparent structural wrappers, `<id> = softwareSystem "Name" { ... }` → `IrContainer(kind: 'boundedContext')`, `<id> = container "Name"` → `IrNode` (child of the enclosing softwareSystem), and `a -> b "label"` → `IrEdge` (dropped, with a `limitations` entry, if either endpoint id was never declared — same "skip incomplete, never guess" discipline as T58/T60). `views`/`styles`/`deploymentEnvironment` blocks are skipped with brace-depth tracking (handles nested braces inside the ignored block) and a single `limitations` entry per block; any OTHER unrecognized line that opens a block (`component`, `properties`, ...) also pushes a silent stack frame so its eventual closing `}` can't desync the parser's real frame stack — a deliberate robustness addition beyond the literal task text. `person "Name"` is accepted as a bonus node type (documented deviation — without it, any relationship touching a person/actor, extremely common in real Structurizr files, would be silently dropped as dangling). `packages/diagram-ir/src/interop/index.ts` barrel exports all 4 functions (`parseMermaidFlowchart`, `toMermaidFlowchart`, `parseStructurizrDsl`, `toStructurizrDsl`). 4 tests in `src/interop/structurizr.spec.ts` covering exactly the 4 Done-when ACs (2-container softwareSystem + relationship; ignored `views` block; export→reparse round trip; barrel exports). **Full `Gate: build` run, batch-wide**: `pnpm -w lint` (found and fixed pre-existing Biome formatting drift in this batch's own new files, including the drizzle-kit-generated `infra/migrations/meta/*.json` from T59 — none pre-existed on the branch before this batch), `pnpm -w typecheck`, `pnpm -w build`, `pnpm -w test:unit` (all packages), `pnpm -w test:integration` (20 files / 198 tests) — all green. `grep -rn "excalidraw" packages/diagram-ir/dist/**/*.js` → zero matches (package has no Excalidraw dependency at all, AD-008 trivially satisfied); `packages/diagram-domain/dist/*.js` → only the two pre-existing doc-comment lines in `mergeScene.js`. **Deviation**: none beyond the `person` scope extension and the T58/T59 deviations already noted above.

---

### Phase 22 — Docgen e lint

### T62: apps/server — módulo docgen: geração de spec Markdown

**What**: `registerDocgenModule(app, { db, storage })`. `POST /diagrams/{id}/specs:generate` — RBAC `diagram:mutate`-ou-menos (revisor pode gerar leitura, mas gerar É uma escrita em `spec_documents`; use `diagram:mutate` mesmo padrão de export/snapshot) — carrega a cena materializada (reusa `materializeScene` de `snapshot/scene.ts`) + `diagram_elements_meta`, chama `extractSceneSemantics` (T58), monta Markdown estruturado com seções (Visão Geral, Componentes, Fluxos, Decisões) referenciando `elementId` real em cada entidade citada (DOC-01). Todo campo sem informação no canvas/metadados vira literalmente `"não especificado"` ou `"pergunta aberta"` — nunca inventa protocolo, SLA ou decisão (DOC-03). Salva o Markdown no MinIO (`markdownKey`) e insere linha em `spec_documents` com `sourceRevision = diagrams.current_revision`, `version` incremental, `status: 'current'` (as anteriores da mesma diagram viram `'superseded'`). `GET /diagrams/{id}/specs` lista versões (paginação cursor-based, mesmo padrão dos outros list-endpoints).
**Where**: `apps/server/src/modules/docgen/`
**Depends on**: T58, T59
**Reuses**: `extractSceneSemantics` (T58), `materializeScene` (snapshot/F1c), `resolveWorkspaceRole`/`can` (auth/F1a), storage client (F1c)
**Requirement**: DOC-01, DOC-02, DOC-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Cena com 3 componentes rotulados e 2 edges com label → Markdown gerado cita os 3 `elementId`s reais em seções distintas
- [x] Componente sem nenhum metadado semântico → seção correspondente contém literalmente "não especificado", nunca um valor inventado
- [x] `GET /diagrams/{id}/specs` retorna a versão mais recente com `status: 'current'` e as anteriores como `'superseded'`
- [x] Reviewer (sem `diagram:mutate`) chamando `:generate` → 403; consegue `GET /specs` normalmente
- [x] `spec_documents.sourceRevision` bate exatamente com `diagrams.current_revision` no momento da geração

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(docgen): generate structured Markdown spec from scene semantics with source-revision linkage`

---

### T63: apps/server — docgen: regeneração de seção única

**What**: `POST /diagrams/{id}/specs/{version}:regenerate-section` com body `{ section: string }` (um dos nomes de seção fixos do template de T62). Recarrega a cena atual, recalcula SOMENTE a seção pedida via a mesma lógica de T62, grava uma NOVA linha em `spec_documents` (nova `version`) cujo Markdown é idêntico ao anterior exceto pela seção regenerada (DOC-04) — nunca faz PATCH in-place em uma versão existente (immutabilidade de versão, mesmo espírito de `diagram_snapshots.immutable`).
**Where**: `apps/server/src/modules/docgen/regenerateSection.ts`, wired em `routes.ts`
**Depends on**: T62
**Reuses**: geração de seção de T62 (extraia a função de seção individual de T62 para reuso, não duplique)
**Requirement**: DOC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Regenerar a seção "Fluxos" de uma spec com 4 seções → nova versão tem as outras 3 seções byte-idênticas e só "Fluxos" mudou
- [x] Versão anterior permanece inalterada no storage (nunca sobrescrita)
- [x] Seção inexistente no body → 400 com erro claro
- [x] Nova versão tem `sourceRevision` igual ao `current_revision` no momento da regeneração (pode ter avançado desde a versão anterior)

**Tests**: unit + integration
**Gate**: quick

---

### T64: apps/server — módulo lint: avisos arquiteturais e C4

**What**: `lintDiagram(semantics: { elements, edges }, elementsMeta, workspaceRules?): LintWarning[]` (função pura em `lint/engine.ts`) detectando, cada um como `LintWarning { rule, severity: 'warning', message, elementIds }` — NUNCA bloqueia: componente órfão (sem nenhum edge), fluxo sem direção clara (arrow sem `startBinding` ou `endBinding` resolvido — já filtrado por T58, então detecte via elementos `arrow` brutos separadamente), trust boundary ausente (heurística: mais de N componentes com `dataClassification` sensível fora de qualquer `container(kind: 'trustBoundary')`), SPOF (componente com >1 edge de entrada e nenhum componente do mesmo `semantic_type` redundante no diagrama — heurística documentada, não perfeita), segredo desenhado como texto (regex heurística tipo `/api[_-]?key|password|secret/i` no label), ambientes misturados (dois componentes com `environment` diferente conectados sem boundary entre eles), conector sem `protocol` em metadados (LNT-01). Onde há `semantic_type`/metadata de nível C4, aplica validações soft por nível (Context/Container/Component/Deployment — ex. Context não deveria conter Component-level detail) (LNT-02). `workspaceRules` (lidas de `workspaces.settingsJson.lintRules`, reuso da coluna já existente — sem nova tabela) permite habilitar/desabilitar regras por workspace (LNT-03). Rota `GET /diagrams/{id}/lint`.
**Where**: `apps/server/src/modules/lint/`
**Depends on**: T58, T59
**Reuses**: `extractSceneSemantics` (T58), `workspaces.settingsJson` (coluna já existente, F1a) para regras customizadas — sem migration nova
**Requirement**: LNT-01, LNT-02, LNT-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Fixture com 1 componente órfão e 1 conector sem `protocol` → `lintDiagram` retorna warnings para AMBOS, canvas permanece editável (nenhum efeito colateral, função pura)
- [x] Fixture com metadata C4 `level: 'context'` contendo um elemento com detalhe de Component → warning soft, não erro
- [x] Workspace com regra "SPOF" desabilitada em `settingsJson.lintRules` → warning de SPOF não aparece para diagramas desse workspace, outras regras continuam ativas
- [x] `GET /diagrams/{id}/lint` retorna 200 com array de warnings (nunca 4xx só por existirem warnings — lint nunca bloqueia, EARS "as warnings only")

**Tests**: unit + integration
**Gate**: build

**Commit**: `feat(lint): add architectural + C4 lint engine with per-workspace rule overrides`

---

### Phase 23 — Apresentação/protótipos

### T65: apps/server — módulo presentation: frames, ordenação, links de navegação

**What**: `registerPresentationModule(app, { db })`. `GET/POST /presentations` (por diagrama), `PATCH /presentations/{id}`, `POST/PATCH/DELETE /presentations/{id}/frames`. Cada frame referencia uma área do canvas (`elementId` de um frame do Excalidraw ou `frameId` lógico), tem `position` (ordenação, reordenável via PATCH em lote), `notes` (privadas — nunca retornadas a um viewer sem permissão de edição/apresentação), `navLinksJson: { targetFrameId: string }[]` (links clicáveis elemento→frame) (PRS-01, PRS-03). RBAC: criar/editar apresentação exige `diagram:mutate` (mesmo nível de export/snapshot).
**Where**: `apps/server/src/modules/presentation/`
**Depends on**: T59
**Reuses**: `resolveWorkspaceRole`/`can` (F1a), padrão de rota CRUD de `snapshot`/`library`
**Requirement**: PRS-01, PRS-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Criar apresentação com 4 frames, reordenar via PATCH → `GET` retorna na nova ordem
- [x] Frame com `navLinksJson` apontando para outro frame da mesma apresentação → persiste e é retornado intacto
- [x] `navLinksJson` apontando para um `targetFrameId` inexistente na mesma apresentação → 400
- [x] Reviewer tentando criar/editar apresentação → 403; `GET` funciona

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(presentation): add frames CRUD with ordering and navigation links`

---

### T66: apps/server — presentation: publicação imutável, link somente-leitura, export PDF

**What**: `POST /presentations/{id}:publish` — cria um `diagram_snapshots` com `kind: 'published'`, `immutable: true` (reusa `createSnapshot` de `snapshot/snapshots.ts` passando o `kind` correto — hoje só `named`/`auto`/`pre_ai`/`restore_point` são usados em produção, `'published'` já existe no enum desde o schema original mas nunca foi exercitado; confirme que `createSnapshot` aceita `kind` como parâmetro, ajuste a assinatura se hoje for fixa), grava `publishedSnapshotId` em `presentations`. `GET /presentations/{id}/published` — rota de leitura pública (RBAC: exige pelo menos papel `viewer` do workspace, respeita expiração se `settingsJson.expiresAt` estiver no passado → 404) servindo os frames + a cena imutável do snapshot publicado, nunca a cena ao vivo (PRS-02). `POST /presentations/{id}:export-pdf` — para cada frame, materializa a cena do snapshot publicado recortada pela área do frame, gera SVG (reusa `render/svg.ts`) e concatena via `svgToPdfBuffer` (reuso do pipeline PDF já existente em `export/pdf.ts`, F1c) em um PDF multi-página, upload para MinIO, retorna URL assinada (PRS-05).
**Where**: `apps/server/src/modules/presentation/publish.ts`, `exportPdf.ts`
**Depends on**: T65
**Reuses**: `createSnapshot` (snapshot/F1c), `render/svg.ts` + `export/pdf.ts` `svgToPdfBuffer` (F1c, AD-005)
**Requirement**: PRS-02, PRS-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `:publish` cria snapshot `kind: 'published', immutable: true` e vincula `publishedSnapshotId`
- [x] `GET .../published` após uma edição posterior ao publish continua servindo a cena DO SNAPSHOT (não a cena ao vivo — teste explícito: mutar a cena depois de publicar, confirmar que o link publicado não mudou)
- [x] `settingsJson.expiresAt` no passado → `GET .../published` retorna 404
- [x] `:export-pdf` de uma apresentação com 3 frames → PDF com 3 páginas, cada uma renderizada a partir do snapshot publicado

**Tests**: unit + integration
**Gate**: build

**Commit**: `feat(presentation): add immutable publish, expiring read-only link, and server-side PDF export`

---

### Phase 24 — Wireframe kit, AaC, comentários

### T67: packages/library-content — kit de wireframe low-fi

**What**: Novo preset de biblioteca `wireframe-lofi` em `packages/library-content` seguindo o formato já existente de `library_items` (F2a): telas (screen container), botões, inputs, listas — cada um com `stable_key` estável (ex. `wireframe.button.primary`), `scene_json` (elemento(s) de dados puros, sem cor/estilo de alta fidelidade — traços cinza, cantos retos), `metadata_json` marcando `category: 'wireframe'`. Insira no manifest para ficar disponível tanto para inserção manual (biblioteca já suporta busca/insert desde F2a) quanto para geração por IA (o `stable_key` já é resolvível por `compile()`/`search_library` tool desde F2b/F2c — nenhuma mudança de código nesses pacotes é necessária, só dados) (PRS-04).
**Where**: `packages/library-content/src/presets/wireframe-lofi.ts`, wired no manifest
**Depends on**: None
**Reuses**: mecanismo de `library_items`/manifest já existente (F2a) — nenhuma rota nova
**Requirement**: PRS-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `manifest.spec.ts` (já existente) continua verde com o novo preset incluído
- [x] Preset tem pelo menos 4 componentes: tela, botão, input, lista — cada um com `stable_key` único e resolvível
- [x] Um teste de integração existente do módulo `library` (F2a) consegue listar/buscar o novo preset por categoria `wireframe` sem mudança de código no módulo `library`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(library-content): add low-fi wireframe kit preset (screens, buttons, inputs, lists)`

---

### T68: apps/server — módulo interop: rotas de import/export Mermaid e Structurizr

**What**: `registerInteropModule(app, { db, storage, jobs })`. `POST /diagrams/{id}/import:mermaid` e `:structurizr` — corpo `{ dsl: string, title?: string }`, chama o parser correspondente (T60/T61), reporta `limitations` explicitamente na resposta (nunca as esconde), compila a `IrDocument` resultante para cena via `compile()` (reuso do compilador `diagram-ir`, F2b) e cria um novo diagrama com aquela cena (mesmo padrão de `createDiagram` + operação inicial usado em `export/import.ts` para `.excalidraw`) — resposta inclui `diagramId` + `limitations`. `POST /diagrams/{id}/export:mermaid` e `:structurizr` — carrega a cena atual + metadata, `extractSceneSemantics` (T58) NÃO é suficiente sozinho para reconstruir uma `IrDocument` completa (falta `kind`/containers explícitos) — construa uma `IrDocument` best-effort a partir da semântica extraída (nodes = elements, containers = agrupamentos existentes se detectáveis, edges = edges), documente no código exatamente quais campos são heurísticos, então chame `toMermaidFlowchart`/`toStructurizrDsl` (T60/T61) e retorne o DSL + `limitations` combinadas (RBAC leitura: `diagram:view`) (AAC-01, AAC-02).
**Where**: `apps/server/src/modules/interop/`
**Depends on**: T58, T60, T61
**Reuses**: `compile()` (diagram-ir/F2b), `createDiagram` + padrão de `export/import.ts` (F1c), `extractSceneSemantics` (T58)
**Requirement**: AAC-01, AAC-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Import de um flowchart Mermaid de 3 nós → novo diagrama criado, cena editável com 3 componentes posicionados por layout determinístico, resposta lista `limitations` (mesmo vazia, campo presente)
- [x] Import de DSL Mermaid com sintaxe inválida em uma linha → diagrama ainda é criado com o que foi parseável, `limitations` menciona a linha ignorada (nunca 500)
- [x] Export de uma cena com 2 componentes conectados → DSL Mermaid válido retornado, contém os 2 labels
- [x] Export de uma cena com um edge `mode: 'data'` → DSL retornado + `limitations` menciona a perda de semântica desse edge
- [x] Usuário sem `diagram:view` no workspace → 404 (IDOR-safe, mesmo padrão de toda outra rota)

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(interop): add Mermaid/Structurizr import (new diagram) and export (DSL from scene) routes`

---

### T69: apps/server — módulo comment: threads, menções, resolução

**What**: `registerCommentModule(app, { db })`. `GET/POST/PATCH /diagrams/{id}/comments` — criar comment (`body`, `elementId?`, `frameId?`, `parentId?` para reply em thread), listar (thread-aware: retorna árvore ou lista flat com `parentId`, documentado), `PATCH` para `status: 'resolved'`/`'open'` e edição do próprio `body`. Menções: parse simples de `@userId`/`@email` no `body`, valida que o usuário mencionado é membro do workspace (silenciosamente ignora menção inválida, não falha o comment inteiro) (CMT-01). RBAC: papel `reviewer` (que já é bloqueado de `diagram:mutate` desde F1a/AUTH) é explicitamente PERMITIDO em `comment:create`/`comment:resolve` — adicione essas actions em `packages/auth`'s matriz se ainda não existirem, com teste direto na matriz isolada (não só via rota) confirmando reviewer aceito em `comment:*` e rejeitado em `diagram:mutate` no mesmo teste (CMT-02).
**Where**: `apps/server/src/modules/comment/`, `packages/auth/src/policy.ts` (novas actions `comment:create`/`comment:resolve` se a matriz não as cobrir ainda)
**Depends on**: T59
**Reuses**: `resolveWorkspaceRole`/`can` (F1a), padrão de rota de `snapshot`/`presentation`
**Requirement**: CMT-01, CMT-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Criar comment anexado a `elementId`, depois um reply com `parentId` apontando pro primeiro → thread persistida, sobrevive a um restart simulado (reabrir conexão PGlite/reler do banco)
- [x] Comment com `@` de um membro válido do workspace → menção registrada; `@` de não-membro → menção ignorada, comment ainda criado com sucesso
- [x] Papel `reviewer` faz `POST /comments` → 201; o MESMO usuário faz `POST /operations:batch` (mutação de cena) no mesmo diagrama → 403 — os dois asserts no mesmo teste
- [x] Teste isolado em `packages/auth` (sem HTTP) confirma `can({role: 'reviewer'}, 'comment:create', ...)` allowed e `can({role: 'reviewer'}, 'diagram:mutate', ...)` denied

**Tests**: unit + integration
**Gate**: build

**Commit**: `feat(comment): add threaded async comments with mentions and reviewer-permitted RBAC`

---

### Phase 25 — Wiring final e gate real

### T70: wiring de produção + smoke-test real + gate final da onda

**What**: Registra os 5 módulos novos (`docgen`, `lint`, `presentation`, `interop`, `comment`) em `apps/server/src/core/registerModules.ts` (L-008), na MESMA ordem de dependência das outras chamadas (depois de `snapshot`/`export`, que os módulos de presentation/docgen reusam). Roda `pnpm -w build`, sobe `node apps/server/dist/index.js` de verdade (mesmo procedimento das ondas anteriores — banco real ou PGlite acessível, `DATABASE_URL` configurado) e faz `curl` em pelo menos uma rota de cada módulo novo (`POST /diagrams/{id}/specs:generate`, `GET /diagrams/{id}/lint`, `GET /presentations`, `POST /diagrams/{id}/import:mermaid`, `GET /diagrams/{id}/comments`) SEM sessão — todas devem responder `401`, nunca `404` (confirma que a rota existe e está registrada, não só que compila). Atualiza a tabela de Requirement Traceability em `spec.md` para DOC/PRS/LNT/AAC/CMT (Pending → Implementing, deixando "Verified" para o Verifier independente). Roda o gate `Build` completo.
**Where**: `apps/server/src/core/registerModules.ts`
**Depends on**: T62, T63, T64, T65, T66, T67, T68, T69
**Reuses**: `registerAllModules` (padrão já estabelecido desde F1b)
**Requirement**: (wiring — não amarrado a um único requirement ID)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Todas as 5 rotas novas respondem `401` (nunca `404`) via `curl` contra `node dist/index.js` real, sem sessão
- [x] `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` — tudo verde
- [x] `spec.md`'s Requirement Traceability: DOC-01..04, PRS-01..05, LNT-01..03, AAC-01..02, CMT-01..02 todas em "Implementing" com nota do commit
- [x] `grep -rn "excalidraw" apps/server/dist/**/*.js` (após build) sem import/require real fora dos arquivos já allowlisted em `no-egress.spec.ts`

**Tests**: unit + integration
**Gate**: build

**Commit**: `chore(server): wire F3 modules (docgen/lint/presentation/interop/comment) into production entrypoint`

---

## Phase Execution Map

```
Phase 21: T58
Phase 21: T59
Phase 21: T60 -> T61
Phase 22: T58 -> T62
Phase 22: T59 -> T62
Phase 22: T62 -> T63
Phase 22: T58 -> T64
Phase 22: T59 -> T64
Phase 23: T59 -> T65
Phase 23: T65 -> T66
Phase 24: T67
Phase 24: T58 -> T68
Phase 24: T60 -> T68
Phase 24: T61 -> T68
Phase 24: T59 -> T69
Phase 25: T62 -> T70
Phase 25: T63 -> T70
Phase 25: T64 -> T70
Phase 25: T65 -> T70
Phase 25: T66 -> T70
Phase 25: T67 -> T70
Phase 25: T68 -> T70
Phase 25: T69 -> T70
```

**Packing de batches (Execute):**

- **Batch 1** (T58-T61, 4 tasks): fundações — schema DB + interop de IR. Paralelizável internamente (T58/T59/T60 sem dependência mútua; T61 depende só de T60).
- **Batch 2** (T62-T66, 5 tasks): docgen completo + lint + presentation completo. Depende do Batch 1 mergeado.
- **Batch 3** (T67-T70, 4 tasks): wireframe kit + AaC routes + comments + wiring/gate final. T70 depende de TODAS as tasks anteriores da onda — deve ser a última do último batch.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T58: extração de semântica | 1 função pura coesa | ✅ Granular |
| T59: schema DB (4 tabelas) | 1 migration coesa (schema desta onda) | ✅ Granular |
| T60: interop Mermaid | 1 par parse/export coeso | ✅ Granular |
| T61: interop Structurizr | 1 par parse/export coeso | ✅ Granular |
| T62: docgen geração | 1 módulo/rota coeso | ✅ Granular |
| T63: docgen regeneração de seção | 1 rota coesa | ✅ Granular |
| T64: lint engine | 1 módulo/rota coeso | ✅ Granular |
| T65: presentation CRUD | 1 módulo/rota coeso | ✅ Granular |
| T66: presentation publish/PDF | 1 módulo, 2 rotas relacionadas | ✅ Granular |
| T67: wireframe kit | dados de preset, sem código de rota | ✅ Granular |
| T68: interop routes | 1 módulo/rota coeso | ✅ Granular |
| T69: comment module | 1 módulo/rota coeso | ✅ Granular |
| T70: wiring + gate | 1 arquivo de wiring + smoke-test | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T58 | None | — | ✅ Match |
| T59 | None | — | ✅ Match |
| T60 | None | — | ✅ Match |
| T61 | T60 | T60→T61 | ✅ Match |
| T62 | T58, T59 | T58→T62, T59→T62 | ✅ Match |
| T63 | T62 | T62→T63 | ✅ Match |
| T64 | T58, T59 | T58→T64, T59→T64 | ✅ Match |
| T65 | T59 | T59→T65 | ✅ Match |
| T66 | T65 | T65→T66 | ✅ Match |
| T67 | None | — | ✅ Match |
| T68 | T58, T60, T61 | T58→T68, T60→T68, T61→T68 | ✅ Match |
| T69 | T59 | T59→T69 | ✅ Match |
| T70 | T62, T63, T64, T65, T66, T67, T68, T69 | todas presentes | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T58 | Domínio (diagram-domain) | unit | unit | ✅ OK |
| T59 | Database (schema) | unit | unit | ✅ OK |
| T60 | Domínio (diagram-ir) | unit | unit | ✅ OK |
| T61 | Domínio (diagram-ir) | unit | unit | ✅ OK |
| T62 | Módulo de rota (docgen) | unit + integration | unit + integration | ✅ OK |
| T63 | Módulo de rota (docgen) | unit + integration | unit + integration | ✅ OK |
| T64 | Módulo de rota (lint) | unit + integration | unit + integration | ✅ OK |
| T65 | Módulo de rota (presentation) | unit + integration | unit + integration | ✅ OK |
| T66 | Módulo de rota (presentation) | unit + integration | unit + integration | ✅ OK |
| T67 | Dados (library-content) | unit | unit | ✅ OK |
| T68 | Módulo de rota (interop) | unit + integration | unit + integration | ✅ OK |
| T69 | Módulo de rota (comment) | unit + integration | unit + integration | ✅ OK |
| T70 | Wiring de produção | boot real + curl manual | unit + integration | ✅ OK (gate build cobre unit+integration; smoke-test manual documentado separadamente no Done-when) |
