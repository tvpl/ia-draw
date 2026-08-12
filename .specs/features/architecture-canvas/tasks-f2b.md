# Architecture Canvas Tasks — Onda 3b: F2 IR Declarativa, Layout e Compilador

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow.

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** segunda sub-onda de F2 — o pacote `packages/diagram-ir` completo (schema `diagram-ir/v1`, engines de layout determinístico, compilador IR→cena, métricas geométricas). Cobre AIG-01, AIG-02, AIG-03, AIG-07 da história "P1: Geração de diagramas por IA via IR declarativa". **Não cobre** ainda o agente de IA em si, tool calling, preview/aprovação/undo (AIG-04..06, AIE-01..05 — onda F2c, que consome este pacote). Depende de `packages/library-content` (onda F2a, para resolução de `stable_key`) — pode ser autorada/iniciada em paralelo a F2a, mas T47 (compilador) precisa de F2a já mergeada para resolver componentes reais nos testes.

---

## ⚠️ Lição crítica de ondas anteriores — leia antes de escrever qualquer linha

Duas ondas seguidas (`F1b`→correção pós-batch, ver `.specs/features/architecture-canvas/tasks-f1b.md` nota após T26) descobriram que qualquer pacote que roda **server-side** e importa `@arch-canvas/editor-adapter` (ou `@excalidraw/excalidraw` diretamente) **por valor** (não `import type`) quebra o boot do servidor real sob Node puro — o bundle publicado do Excalidraw só resolve sob um bundler (Vite/webpack), nunca sob `node dist/index.js`. `packages/diagram-domain` já foi corrigido para nunca importar nada além de `import type` de `editor-adapter` (ver `packages/diagram-domain/src/mergeScene.ts`).

`packages/diagram-ir` roda **inteiramente server-side** (o compilador IR→cena executa no módulo `ai-engine` do `apps/server`, nunca no browser — ver design.md §8.3/8.4). **Portanto: `packages/diagram-ir` NUNCA pode importar `@excalidraw/excalidraw` nem `@arch-canvas/editor-adapter` por valor, em nenhum arquivo.** Elementos de cena compilados devem ser construídos como dados puros (campos com defaults sensatos — `id`, `type`, `x`, `y`, `width`, `height`, `strokeColor`, `backgroundColor`, `version: 1`, `versionNonce`, etc.), nunca via `restoreElements` do pacote Excalidraw. Se precisar do formato exato de um elemento válido para referência, leia `packages/editor-adapter/src/types.ts` e os fixtures de `packages/test-fixtures` (esses são seguros de importar como `import type`/dados JSON, nunca como chamada de função do pacote Excalidraw). Ao final do batch, confirme (como as ondas anteriores passaram a fazer): `pnpm -w build` seguido de `grep -rn "excalidraw" packages/diagram-ir/dist/*.js` não deve mostrar nenhum `import`/`require` real (comentários/strings são aceitáveis).

---

## Test Coverage Matrix

> Reaproveitada das ondas anteriores.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domínio (`packages/diagram-ir`) | unit + property-based (para métricas geométricas) | Todos os branches; 1:1 com ACs; edge cases; nenhum overlap/crossing para cenas geradas até 200 elementos | `packages/diagram-ir/src/**/*.spec.ts` | `pnpm -w test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Build | Última task da onda — inclui lint/typecheck/build | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit` |

---

## Execution Plan

### Phase 18: Schema e validação da IR

```
T43
```

### Phase 19: Engines de layout

```
T43 -> T44
T43 -> T45
T43 -> T46
```

### Phase 20: Compilador e métricas

```
T44 -> T47
T45 -> T47
T46 -> T47
T47 -> T48
```

---

## Task Breakdown

### Phase 18 — Schema e validação da IR

### T43: packages/diagram-ir — schema diagram-ir/v1 e validação

**What**: `IrDocument` (Zod): `{ version: 'v1', kind: 'aws-multi-az' | 'c4-context' | 'c4-container' | 'microservices' | 'event-driven' | 'business-flow' | 'wireframe' | 'network-topology', nodes: IrNode[], containers: IrContainer[], edges: IrEdge[], layoutHints?: Record<string, unknown> }`. `IrNode { id, label, componentKey?, semantics?: { technology?, provider?, environment?, dataClassification?, criticality? } }`. `IrContainer { id, label, kind: 'vpc'|'zone'|'boundedContext'|'swimlane'|'trustBoundary'|'group', children: string[] }` (ids de nodes ou de outros containers, aninhamento permitido). `IrEdge { from, to, semantics: { mode: 'sync'|'async'|'data'|'dependency', protocol?, direction: 'oneway'|'bidirectional', label? } }`. `validateIr(json: unknown): IrDocument` valida e retorna erros estruturados (não genéricos) apontando o `path` do campo inválido. Exporte o JSON Schema equivalente (via `zod-to-json-schema` ou biblioteca similar — pesquise a API atual antes de assumir, Knowledge Verification Chain) para ser usado como o contrato de tool-calling do LLM na onda F2c.
**Where**: `packages/diagram-ir/`
**Depends on**: None
**Reuses**: convenções de pacote já estabelecidas (tsconfig/vitest)
**Requirement**: AIG-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `validateIr` aceita um documento completo válido com nós, containers aninhados e edges de cada `mode`
- [x] Rejeita: edge referenciando `from`/`to` inexistente; container referenciando `children` inexistente; `kind` fora do enum
- [x] JSON Schema exportado é um objeto válido (testável por um validador JSON Schema genérico, ex. `ajv`, contra os mesmos casos válidos/inválidos acima)
- [x] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(diagram-ir): add diagram-ir/v1 schema, validation and json schema export`

**Status**: ✅ Complete — `packages/diagram-ir` scaffolded; `irDocumentSchema`/`validateIr`/`IrValidationError`/`IR_JSON_SCHEMA` in `src/schema.ts`, 10 tests in `src/schema.spec.ts`. JSON Schema exported via zod v4's native `z.toJSONSchema()` (verified live — no separate `zod-to-json-schema` package needed, that targets zod v3), validated against `ajv`'s 2020-12 dialect. `pnpm -w test:unit` green (20/20 packages).

---

### Phase 19 — Engines de layout

### T44: packages/diagram-ir — layout grid-zones (cloud zones e C4)

**What**: `layoutGridZones(ir: IrDocument): PositionedNode[]` — posiciona nodes dentro de seus containers em um grid determinístico (linhas/colunas calculadas por contagem de filhos, espaçamento fixo configurável), containers aninhados recebem padding crescente por nível, containers-irmãos são distribuídos lado a lado sem sobreposição. `PositionedNode { id, x, y, width, height }`. Puramente geométrico — sem qualquer dependência de renderização.
**Where**: `packages/diagram-ir/src/layout/`
**Depends on**: T43
**Reuses**: —
**Requirement**: AIG-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cenário com 2 containers-irmãos contendo 3 nodes cada produz zero overlaps (bounding boxes não se interceptam) — teste geométrico explícito
- [ ] Containers aninhados (container dentro de container) são posicionados sem overlap entre pai e filhos de outro ramo
- [ ] Determinístico: mesma IR produz exatamente as mesmas posições em duas chamadas
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(diagram-ir): add deterministic grid-zones layout for cloud/c4 containers`

---

### T45: packages/diagram-ir — layout em camadas (elk-layered) para fluxos

**What**: `layoutElkLayered(ir: IrDocument): Promise<PositionedNode[]>` usando `elkjs` (roda puro em Node, sem dependência de browser — confirme isso ao instalar, Knowledge Verification Chain) para posicionar nodes e rotear edges em camadas direcionadas, apropriado para microsserviços/event-driven/fluxos de negócio lineares. Mapeia `IrEdge` para as conexões do ELK; `IrContainer` vira um "compound node" do ELK quando aplicável.
**Where**: `packages/diagram-ir/src/layout/`
**Depends on**: T43
**Reuses**: `elkjs`
**Requirement**: AIG-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Uma cadeia linear de 5 nodes conectados produz posições em ordem topológica crescente (sem ciclos na entrada de teste)
- [ ] Zero overlaps entre bounding boxes dos nodes posicionados
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(diagram-ir): add elk-layered layout engine for flows and microservices`

---

### T46: packages/diagram-ir — layout de swimlane para fluxos de negócio

**What**: `layoutSwimlane(ir: IrDocument): PositionedNode[]` — cada `IrContainer` com `kind: 'swimlane'` vira uma raia horizontal (ou vertical, sua escolha documentada) de largura/altura fixa por raia; nodes dentro de uma raia são ordenados por sua posição topológica nas edges que os conectam (aproximação por ordenação de grafo, não precisa ser um layout de grafo completo — um ordenamento por BFS/DFS a partir dos nodes sem edges de entrada já satisfaz "sem overlap e em ordem sensata de fluxo").
**Where**: `packages/diagram-ir/src/layout/`
**Depends on**: T43
**Reuses**: —
**Requirement**: AIG-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] 3 raias com 2-4 nodes cada produzem zero overlap entre raias e entre nodes da mesma raia
- [ ] Nodes conectados por uma edge de `mode: 'dependency'` aparecem em ordem consistente com a direção da edge
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(diagram-ir): add swimlane layout engine for business flows`

---

### Phase 20 — Compilador e métricas

### T47: packages/diagram-ir — compilador IR→cena (resolução de biblioteca + elementos)

**What**: `compile(ir: IrDocument, library: LibraryItem[]): CompiledScene` — para cada `IrNode`, resolve `componentKey` contra `library` por `stable_key` (retorna erro estruturado se referenciar uma chave inexistente/não autorizada — pré-requisito de AIG-06 na onda F2c), escolhe o layout engine por `ir.kind` (grid-zones para `aws-multi-az`/`c4-*`, elk-layered para `microservices`/`event-driven`/`network-topology`, swimlane para `business-flow`, sua escolha razoável para `wireframe`), e constrói os elementos de cena finais **como dados puros** (ver a lição no topo deste arquivo — nunca via `restoreElements`/`@excalidraw/excalidraw`). Cada elemento recebe `id`, `type` (`rectangle` para nodes/containers, `arrow` para edges — mapeamento simples), posição/tamanho do layout, `version: 1`, `versionNonce` (gerado deterministicamente por seed nos testes, aleatório em produção), rótulo (`label`/texto associado), e os campos mínimos que fazem um `SceneElement` bem-formado segundo `packages/editor-adapter/src/types.ts` (leia esse arquivo para saber exatamente quais campos são esperados — sem chamar nenhuma função do pacote).
**Where**: `packages/diagram-ir/src/compile.ts`
**Depends on**: T44, T45, T46
**Reuses**: os três layout engines, `packages/library-content` (F2a, para os testes de resolução real — se F2a ainda não estiver mergeada quando você iniciar, use um manifesto de teste local equivalente e documente a integração pendente como uma nota, não bloqueie a task)
**Requirement**: AIG-02, AIG-06 (validação de escopo de componente — a rejeição de patch em si é F2c, mas a resolução que a torna possível é aqui)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Componente com `componentKey` presente na `library` resolve para o elemento certo (ícone/metadados herdados)
- [ ] Componente com `componentKey` ausente da `library` retorna erro estruturado, não lança exceção genérica nem produz elemento parcial
- [ ] Elementos compilados passam por uma checagem de "bem-formado" equivalente à usada pelos fixtures de `packages/test-fixtures` (mesmos campos obrigatórios presentes)
- [ ] `pnpm -w build` seguido de `grep -rn "excalidraw" packages/diagram-ir/dist/*.js` não mostra nenhum import/require real (só pode aparecer em comentários, se houver)
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(diagram-ir): add ir-to-scene compiler with library resolution`

---

### T48: packages/diagram-ir — métricas geométricas determinísticas

**What**: `geometryMetrics(scene: CompiledScene): { overlaps: number, crossings: number, truncatedLabels: number, whitespaceBalance: number }`. `overlaps`: conta pares de bounding boxes de nodes que se interceptam. `crossings`: conta pares de edges (aproximadas como segmentos de reta entre centros dos nodes conectados) que se cruzam geometricamente. `truncatedLabels`: estima largura do texto do rótulo contra a largura do elemento usando uma tabela de largura média de caractere por fonte (heurística determinística documentada — não precisa medir a fonte real pixel-a-pixel; documente a limitação) e conta quantos excedem. `whitespaceBalance`: uma métrica simples de dispersão (ex. desvio padrão normalizado da distância entre centros de elementos vizinhos) — documente a fórmula escolhida. Teste de propriedade: gere IRs sintéticas variadas (reaproveite o gerador seedado de `packages/test-fixtures`/onda F0 como inspiração, ou crie um gerador de IR próprio seedado) com até 200 elementos e confirme `overlaps === 0` e `crossings === 0` para saídas de `compile()` usando os layout engines de T44-T46 (prova da AC "zero overlapping nodes and zero truncated labels for scenes up to 200 elements" — AIG-03). Este teste roda em CI sem qualquer chamada de rede/LLM (AIG-07 — "runnable in CI with a mock provider": aqui não há provider algum, é puramente determinístico).
**Where**: `packages/diagram-ir/src/metrics.ts`
**Depends on**: T47
**Reuses**: `compile()` (T47), os layout engines
**Requirement**: AIG-03, AIG-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `geometryMetrics` retorna 0 para uma cena manualmente construída sem overlaps/crossings, e valores > 0 para uma cena com overlap/crossing propositais (teste positivo E negativo, não só o caminho feliz)
- [ ] Property-based test: N cenas sintéticas (documente N — sugestão: pelo menos 20 variações) até 200 elementos, todas com `overlaps === 0` e `crossings === 0` após `compile()` + layout
- [ ] Gate check passes (última task da onda — inclui lint/typecheck/build): `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit`

**Tests**: unit
**Gate**: build

**Commit**: `feat(diagram-ir): add deterministic geometry metrics and zero-overlap property tests`

---

## Phase Execution Map

```
Phase 18: T43
Phase 19: T43 -> T44
Phase 19: T43 -> T45
Phase 19: T43 -> T46
Phase 20: T44 -> T47
Phase 20: T45 -> T47
Phase 20: T46 -> T47
Phase 20: T47 -> T48
```

**Packing de batches (Execute):** 6 tasks (T43-T48) → 1 batch (dentro do orçamento ~7 tasks/worker).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T43: schema IR | 1 pacote/schema coeso | ✅ Granular |
| T44: layout grid-zones | 1 função de layout | ✅ Granular |
| T45: layout elk-layered | 1 função de layout | ✅ Granular |
| T46: layout swimlane | 1 função de layout | ✅ Granular |
| T47: compilador | 1 função coesa (compile) | ✅ Granular |
| T48: métricas geométricas | 1 módulo coeso | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T43 | None | — | ✅ Match |
| T44 | T43 | T43→T44 | ✅ Match |
| T45 | T43 | T43→T45 | ✅ Match |
| T46 | T43 | T43→T46 | ✅ Match |
| T47 | T44, T45, T46 | T44→T47, T45→T47, T46→T47 | ✅ Match |
| T48 | T47 | T47→T48 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T43 | Domínio (diagram-ir) | unit | unit | ✅ OK |
| T44 | Domínio (diagram-ir) | unit | unit | ✅ OK |
| T45 | Domínio (diagram-ir) | unit | unit | ✅ OK |
| T46 | Domínio (diagram-ir) | unit | unit | ✅ OK |
| T47 | Domínio (diagram-ir) | unit | unit | ✅ OK |
| T48 | Domínio (diagram-ir) | unit + property-based | unit | ✅ OK |
