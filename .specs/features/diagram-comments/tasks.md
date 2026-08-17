# Comentários e revisão no diagrama — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: inline (escopo Medium — sem `design.md` próprio; a tabela de Assumptions da `spec.md` já resolveu as duas decisões arquiteturais reais: painel lateral único com abas em vez de dois painéis docados, e `commentClient.ts` dedicado em vez do `resourceClient` genérico).
**Status**: Done (8/8 tasks) — aguardando o Verifier independente

---

## Test Coverage Matrix

> Gerada por amostragem do código (`apps/web/src/nav/memberClient.spec.ts`, `apps/web/src/nav/WorkspaceMembersPage.spec.tsx`, `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx`, `apps/web/src/ai-dock/aiDockStore.spec.ts`, `apps/web/src/diagram/DiagramEditorPage.spec.tsx`) e do piso de cobertura já praticado nesta frente (nunca rebaixado). Guidelines encontradas: `CLAUDE.md` (comandos e gate) e `.claude/commands/gate.md`; nenhuma guideline de cobertura numérica — default forte aplicado.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Cliente HTTP (`commentClient`) | unit | Toda ramificação de status documentada: `list` 200/404/erro, `create` 201/404/erro, `setStatus` 200/403/erro; corpo do request asserido (presença/ausência de `elementId` e `parentId`) | `apps/web/src/comments/commentClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Lógica pura (`commentThreads`) | unit | 1:1 com CMT2-06/09/10 e o edge case de `parentId` órfão; todas as ramificações de âncora (ausente, viva, removida) | `apps/web/src/comments/commentThreads.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`CommentsSidebar`) | unit (RTL) | 1:1 com CMT2-05/07..19 (T4) e CMT2-20..29 (T5), incluindo todo edge case listado que se aplica ao painel | `apps/web/src/comments/CommentsSidebar.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente (`EditorSidePanel`) | unit (RTL) | 1:1 com CMT2-01..04, incluindo o estado sem aba de IA | `apps/web/src/diagram/EditorSidePanel.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Acessibilidade (`CommentsSidebar`) | unit (axe) | Zero violações sérias/críticas em pelo menos 2 estados; foco por teclado explícito; região `aria-live`; render no locale `en` — CMT2-30..32 | `apps/web/src/comments/CommentsSidebar.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integração do editor (`DiagramEditorPage`) | unit (RTL, integration-style) | Layout com a coluna lateral, aba ativa por `mutatePermissions`, painel de comentários presente para papel sem mutação | `apps/web/src/diagram/DiagramEditorPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| JSON de i18n (`translation.json` × 2) | none | Só gate de lint/build; a cobertura de string vive nos testes de componente e a11y | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |

## Gate Check Commands

> Extraídas de `Makefile`, `apps/web/package.json` e `.claude/commands/gate.md`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Depois de uma task com testes unitários restritos a `apps/web` | `pnpm --filter @arch-canvas/web run test:unit` |
| Full | Fechando a feature ou depois de uma task que toca fiação/artefato fora de `apps/web` | `make lint && make typecheck && make test-unit` |
| Build | Task só de config/JSON, sem teste próprio | `make lint && make typecheck` |

Nenhuma task desta onda toca `apps/server`: o backend das 3 rotas está completo e verificado desde F3. Por isso `make test-integration` não entra em nenhum gate aqui (rode-o à parte se quiser confirmar que nada regrediu; ver a armadilha de sandbox em `CLAUDE.md`).

---

## Execution Plan

8 tasks no total — cabe num único batch (≤ ~8), executado inline por um só worker, sem split em sub-agentes.

Fases (semânticas, executadas em ordem):

- **Fase 1 — Fundação**: T1, T2, T3. Sem dependências entre si; cada uma entrega uma peça isolada e testável (cliente HTTP, chaves de i18n, lógica pura de thread).
- **Fase 2 — Painel**: T4 → T5 → T6. Constrói o `CommentsSidebar` sobre as três peças da fase 1 e fecha com a cobertura de acessibilidade.
- **Fase 3 — Integração no editor**: T7 → T8. Container de abas e a fiação em `DiagramEditorPage`.

Arestas reais de dependência:

```
T1 → T4
T2 → T4
T3 → T4
T4 → T5
T5 → T6
T5 → T7
T7 → T8
```

---

## Task Breakdown

### T1: Criar `commentClient`

**What**: Cliente HTTP dedicado das 3 rotas de comentário — `list`, `create`, `setStatus` — com uma união de status por método.
**Where**: `apps/web/src/comments/commentClient.ts`
**Depends on**: None
**Reuses**: estilo de `apps/web/src/nav/memberClient.ts` (injeção de `fetchImpl`, uma união por método, **chamada literal `fetchImpl(...)`** em todo call site para o extrator de `tools/repo-tools/src/webConsumers.ts` enxergar as rotas); formas de resposta de `apps/server/src/modules/comment/routes.ts` e `comments.ts` (`CommentRow`), espelhadas sem inventar campo
**Requirement**: CMT2-05, CMT2-08, CMT2-13..18, CMT2-21..23, CMT2-25, CMT2-29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `list(diagramId)` → `{status:'ok', comments}` (200), `{status:'not_found'}` (404), `{status:'error'}` (qualquer outro status ou falha de rede)
- [x] `create(diagramId, {body, elementId?, parentId?})` → `{status:'created', comment}` (201), `{status:'not_found'}` (404), `{status:'error'}`
- [x] `create` omite `elementId`/`parentId` do corpo JSON quando não informados (nunca envia `null`/`undefined` explícito)
- [x] `setStatus(diagramId, commentId, status)` → `{status:'ok', comment}` (200), `{status:'forbidden'}` (403), `{status:'error'}`
- [x] Todo call site escreve `fetchImpl(` literalmente, com a URL em template literal
- [x] Testes unitários cobrem cada ramificação acima e asseriram o corpo enviado no `create` (com e sem âncora, com e sem `parentId`)
- [x] Gate check passa: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add dedicated commentClient`

---

### T2: Adicionar chaves de i18n do bloco `comments`

**What**: Novo bloco de topo `comments` nos dois locales, cobrindo abas, lista, composer, âncora, resposta, resolver/reabrir, filtro, atualizar e anúncios.
**Where**: `apps/web/src/i18n/locales/{en,pt-BR}/translation.json`
**Depends on**: None
**Reuses**: convenção de bloco de topo por capacidade já usada por `aiDock`
**Requirement**: CMT2-32

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Os dois arquivos têm conjunto de chaves idêntico sob `comments`
- [x] Inclui no mínimo: `comments.title`, `tabs.ai`, `tabs.comments`, `loading`, `empty`, `error`, `notFound`, `composer.label`, `composer.submit`, `composer.anchor.{none,element,multiple}`, `anchorMissing`, `reply.{label,submit,action}`, `resolve`, `reopen`, `resolvedBadge`, `showResolved`, `refresh`, `announce.{created,replied,resolved,reopened,failed}`
- [x] `make lint` passa (formatação de JSON incluída)

**Tests**: none (camada "JSON de i18n" da Test Coverage Matrix exige `none`; as strings são exercidas pelos testes de T4/T5/T6)
**Gate**: build

**Commit**: `feat(web): add comments i18n keys for pt-BR and en`

---

### T3: Criar `commentThreads`, agrupamento puro de threads

**What**: Módulo puro que converte a lista flat do `GET` em threads (raiz + respostas) e classifica a âncora de cada raiz contra os ids da cena carregada.
**Where**: `apps/web/src/comments/commentThreads.ts`
**Depends on**: None
**Reuses**: contrato de `parentId`/`elementId` documentado em `apps/server/src/modules/comment/comments.ts` (lista flat, mais antigo primeiro)
**Requirement**: CMT2-06, CMT2-09, CMT2-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `buildThreads(comments, liveElementIds)` devolve uma thread por comentário com `parentId` nulo, na ordem em que apareceram na entrada
- [x] Todo comentário cuja cadeia de `parentId` alcança uma raiz entra em `replies` daquela raiz, preservando a ordem de entrada — inclusive quando a cadeia tem mais de um nível
- [x] Um comentário cujo `parentId` aponta para um id ausente da entrada vira raiz de thread própria, nunca é descartado (edge case da spec)
- [x] A âncora da raiz é classificada em três estados: sem `elementId`; `elementId` presente em `liveElementIds`; `elementId` ausente de `liveElementIds` (âncora removida)
- [x] Testes unitários cobrem 1:1 CMT2-06/09/10 e o edge case do `parentId` órfão
- [x] Gate check passa: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add comment thread grouping helper`

---

### T4: Criar `CommentsSidebar` — lista e criação

**What**: O painel de comentários: carrega a lista, exibe threads com âncora, estados de carregando/vazio/erro, e o campo de novo comentário ancorado na seleção.
**Where**: `apps/web/src/comments/CommentsSidebar.tsx`
**Depends on**: T1, T2, T3
**Reuses**: `commentClient` (T1), `buildThreads` (T3), chaves de i18n (T2); padrão de componente com `fetchImpl` injetável e região `aria-live` de `apps/web/src/nav/WorkspaceMembersPage.tsx`
**Requirement**: CMT2-05, CMT2-07..19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Emite `GET /diagrams/:id/comments` uma única vez ao montar e exibe as threads devolvidas
- [x] Exibe a mensagem de carregando enquanto o `GET` inicial está em voo, e o estado vazio quando a resposta não tem comentário nenhum
- [x] Qualquer status diferente de 200 no `GET` deixa a lista vazia e exibe a mensagem de erro genérica
- [x] Cada thread exibe a âncora nos três estados de T3 (sem âncora, âncora viva com o `elementId`, âncora removida), sem nunca ocultar um comentário órfão
- [x] O campo de novo comentário aparece independentemente de `canMutate`
- [x] Enviar fica desabilitado com corpo vazio ou só de espaços
- [x] `POST` carrega `elementId` quando há exatamente 1 selecionado; não carrega `elementId` com 0 selecionados; não carrega `elementId` com 2+ selecionados e o painel exibe o aviso de não-ancorado
- [x] `201` acrescenta o comentário devolvido à lista, limpa o campo e não dispara um segundo `GET`; `404` exibe a mensagem de "não existe ou sem acesso"; outra falha exibe o erro genérico — nos dois casos de falha nada entra na lista
- [x] Um segundo envio durante um envio em voo não emite segunda requisição
- [x] Texto já digitado sobrevive a uma mudança de seleção (edge case da spec)
- [x] Testes RTL cobrem 1:1 cada bullet acima
- [x] Gate check passa: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add CommentsSidebar with threaded list and composer`

---

### T5: Estender `CommentsSidebar` — resolver, reabrir, responder, filtrar, atualizar

**What**: As ações sobre threads existentes no mesmo painel: resolver/reabrir a raiz, responder na raiz, filtro de resolvidas e recarga manual.
**Where**: `apps/web/src/comments/CommentsSidebar.tsx` (modificar)
**Depends on**: T4
**Reuses**: `commentClient.setStatus`/`create` (T1), a mesma região `aria-live` e o mesmo tratamento de falha introduzidos em T4
**Requirement**: CMT2-20..29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Toda thread aberta oferece resolver, sem depender de papel nem de `canMutate`
- [x] Resolver emite `PATCH` no id da **raiz** com `{status:'resolved'}` e só reflete o novo status depois do `200`
- [x] Uma thread resolvida oferece reabrir, emitindo `PATCH` com `{status:'open'}`
- [x] Qualquer status diferente de 200 no `PATCH` mantém o status anterior e informa a falha
- [x] Toda thread oferece responder; a resposta vai com `parentId` igual ao id da raiz, mesmo quando a thread já tem respostas
- [x] `201` da resposta a coloca dentro da própria thread, depois dos comentários já exibidos
- [x] Threads com raiz `resolved` ficam ocultas por padrão e aparecem quando "mostrar resolvidas" é acionado
- [x] "Atualizar" reemite o `GET` e substitui a lista pelo conteúdo da resposta
- [x] Testes RTL cobrem 1:1 cada bullet acima, sem remover nenhum teste de T4
- [x] Gate check passa: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add resolve, reply, filter and refresh to CommentsSidebar`

---

### T6: Cobertura de acessibilidade do `CommentsSidebar`

**What**: Suíte axe + teclado + `aria-live` + locale `en` do painel, no molde já estabelecido.
**Where**: `apps/web/src/comments/CommentsSidebar.a11y.spec.tsx`
**Depends on**: T5
**Reuses**: helper `seriousOrCriticalViolations` e a estrutura de `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx`
**Requirement**: CMT2-30, CMT2-31, CMT2-32

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `jest-axe` roda em pelo menos 2 estados (lista populada com thread aberta; estado com resolvidas visíveis e formulário de resposta aberto), com zero violações sérias/críticas
- [x] Teste explícito de foco por teclado em cada controle do painel (campo, enviar, responder, resolver/reabrir, mostrar resolvidas, atualizar)
- [x] Teste de que a região de resultado é `aria-live="polite"` e anuncia uma ação concluída
- [x] Teste de render no locale `en`, restaurando `pt-BR` no `afterEach`
- [x] Gate check passa: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add CommentsSidebar accessibility coverage`

---

### T7: Criar `EditorSidePanel`, container de abas

**What**: Container slot-based da coluna lateral do editor: `role="tablist"` com "IA" e "Comentários", um `tabpanel` por aba, o inativo com `hidden` e ambos sempre montados.
**Where**: `apps/web/src/diagram/EditorSidePanel.tsx`
**Depends on**: T5
**Reuses**: chaves `comments.tabs.*` (T2); o painel de comentários pronto (T5) como slot nos testes
**Requirement**: CMT2-01, CMT2-02, CMT2-03, CMT2-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Recebe `aiPanel: ReactNode | null` e `commentsPanel: ReactNode`; quando `aiPanel` é `null` a aba "IA" não é renderizada
- [x] Exatamente um `tabpanel` visível por vez; o inativo permanece montado com o atributo `hidden` (preserva estado do dock de IA e o texto digitado no comentário)
- [x] Aba ativa inicial: "IA" quando há `aiPanel`, "Comentários" quando não há
- [x] Semântica ARIA de abas completa (`role`, `aria-selected`, `aria-controls`, `aria-labelledby`), com as abas alcançáveis por teclado
- [x] Testes RTL cobrem 1:1 CMT2-01..04, incluindo que o conteúdo do painel inativo sai da árvore de acessibilidade
- [x] Gate check passa: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add EditorSidePanel tab container`

---

### T8: Ligar o painel de comentários ao `DiagramEditorPage`

**What**: Trocar o `AiDock` irmão direto pela coluna `EditorSidePanel`, alimentada com o dock (só quando `canMutate`), o `CommentsSidebar`, a seleção e os ids da cena carregada; e regerar o inventário de rotas.
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx` (+ o `DiagramEditorPage.spec.tsx` correspondente)
**Depends on**: T7
**Reuses**: estado `selection` e `initialElements` que a página já mantém; `handleApproved` inalterado
**Requirement**: CMT2-01..04, CMT2-11 (ponto de integração)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A linha do editor continua com 2 filhos: a coluna do canvas (`flex:1`/`minHeight:0` inalterados) e a coluna lateral
- [x] `CommentsSidebar` recebe `diagramId`, `selection` e os ids derivados de `initialElements`
- [x] Com `mutatePermissions.allowed: false` não existe aba nem dock de IA, e o painel de comentários é o ativo
- [x] A asserção de layout existente em `DiagramEditorPage.spec.tsx` é **atualizada** para o novo layout (mesma precisão, nada afrouxado); nenhum outro teste do arquivo é alterado e nenhum é removido
- [x] `pnpm --filter @arch-canvas/repo-tools run audit` regenera `docs/route-inventory.md` com as 3 rotas de comentário em `consumed`, e o arquivo regenerado entra no commit
- [x] Contagem de testes de `@arch-canvas/web` só cresce em relação ao início da onda
- [x] Gate check passa: `make lint && make typecheck && make test-unit`

**Tests**: unit (RTL, integration-style)
**Gate**: full

**Commit**: `feat(web): wire the comments panel into the diagram editor`

---

## Phase Execution Map

```
T1 → T4
T2 → T4
T3 → T4
T4 → T5
T5 → T6
T5 → T7
T7 → T8
```

T1, T2 e T3 não têm aresta de entrada — são as três peças de fundação da fase 1.

Execução é estritamente sequencial: uma task por vez, na ordem T1..T8.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: `commentClient` | 1 arquivo, 3 métodos coesos | ✅ Granular |
| T2: chaves de i18n | 2 arquivos, 1 bloco coeso espelhado | ✅ Granular |
| T3: `commentThreads` | 1 arquivo, 1 função pura | ✅ Granular |
| T4: `CommentsSidebar` (lista e criação) | 1 componente | ✅ Granular |
| T5: `CommentsSidebar` (ações sobre thread) | mesmo componente, modificar | ✅ Granular |
| T6: suíte de a11y | 1 arquivo de teste | ✅ Granular |
| T7: `EditorSidePanel` | 1 componente | ✅ Granular |
| T8: fiação no editor | 1 componente + seu spec | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | sem aresta de entrada | ✅ Match |
| T2 | None | sem aresta de entrada | ✅ Match |
| T3 | None | sem aresta de entrada | ✅ Match |
| T4 | T1, T2, T3 | T1→T4, T2→T4, T3→T4 | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | T5 | T5→T6 | ✅ Match |
| T7 | T5 | T5→T7 | ✅ Match |
| T8 | T7 | T7→T8 | ✅ Match |

Nenhuma dependência aponta para uma fase posterior: as arestas cruzando fase vão sempre de 1 → 2 e de 2 → 3.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Cliente HTTP | unit | unit | ✅ OK |
| T2 | JSON de i18n | none | none | ✅ OK |
| T3 | Lógica pura | unit | unit | ✅ OK |
| T4 | Componente `CommentsSidebar` | unit (RTL) | unit | ✅ OK |
| T5 | Componente `CommentsSidebar` | unit (RTL) | unit | ✅ OK |
| T6 | Acessibilidade | unit (axe) | unit | ✅ OK |
| T7 | Componente `EditorSidePanel` | unit (RTL) | unit | ✅ OK |
| T8 | Integração do editor | unit (RTL) | unit | ✅ OK |

`Tests: none` aparece só em T2, exatamente a camada que a Test Coverage Matrix marca como `none` (JSON de i18n, gate de lint/build). As strings adicionadas ali são exercidas pelos testes de T4, T5 e T6, que consultam por rótulo visível nos dois locales — não é diferimento de teste.

---

## Tips

(herdados do template da skill — não repetidos aqui)
