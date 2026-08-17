# Apresentação e protótipos navegáveis — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.** Do not search for skill files by filesystem path.

**Deviation from the skill's default sub-agent delegation, declared up front (documented again in
the final report):** this session's toolset has no Agent/Task-spawning tool available (verified by
search before Execute started). Every batch below is therefore executed directly by the same
orchestrating session, sequentially, task by task — never by a separately-dispatched sub-agent. The
phase/batch structure, the gate-after-each-batch discipline, and one atomic commit per task are all
preserved exactly as the skill specifies; only the "who runs the batch" mechanism differs. The
Verify phase's "author != verifier, fresh agent, no shared context" requirement is affected the
same way and is called out again at the bottom of this file and in the final report.

---

**Design**: `.specs/features/presentation-mode/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Por amostragem de `apps/server/src/modules/share/routes.ts` + `presentation.int.spec.ts` +
> `publish.int.spec.ts` (backend), e de `apps/web/src/share/*.spec.tsx`,
> `packages/editor-adapter/src/EditorSurface.spec.tsx` (frontend/precedente R11). Nenhum limiar de
> cobertura por arquivo além dos pisos globais já configurados (`CIQ-04`, checados por
> `repo-tools audit`), que esta fatia não pode baixar.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Rota pública (`share/routes.ts`) | integration (PGlite) | Ramo `presentation` publicado (com `scene`/`published:true`) e não publicado (sem os dois, byte-a-byte igual a hoje); 1:1 ao Problem Statement | `apps/server/src/modules/share/share.int.spec.ts` | `pnpm --filter @arch-canvas/server run test:unit` |
| Handle imperativo (`EditorSurface`) | unit | `scrollToFrame` com `elementId` casando por `frameId`, casando por `id`, sem casar nenhum (fallback cena inteira), `elementId: null` (no-op); API sem `scrollToContent` não lança | `packages/editor-adapter/src/EditorSurface.spec.tsx` | `pnpm --filter @arch-canvas/editor-adapter run test:unit` |
| Clientes HTTP (`presentationClient`, `shareLinkClient`) | unit | Todo ramo de status documentado por método (200/201/204/400/403/404/erro de rede) | `apps/web/src/presentation/presentationClient.spec.ts`, `apps/web/src/share/shareLinkClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Funções puras compartilhadas (`frameLabel`, `cropSceneForFrame`) | unit | Cada ramo do OR de recorte testado separadamente (L-001: casar por `id` sozinho, casar por `frameId` sozinho, nenhum dos dois); rótulo com/sem `frameId` | `apps/web/src/presentation/frameLabel.spec.ts`, `apps/web/src/presentation/cropSceneForFrame.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Telas novas (`PresentationListPage`, `PresentationEditorPage`, `PresenterModePage`, `FrameViewer`) | unit (RTL) | 1:1 às ACs que a tela implementa + Edge Cases aplicáveis; ACs de nível de TELA traçadas para teste de nível de tela, nunca só a callback de um filho (L-037) | `apps/web/src/presentation/*.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| `SharedResourcePage` (mudança) | unit (RTL) | SHR-27/28 continuam verdes sem alteração de asserção; novos casos (`scene` presente → visualizador; `scene` ausente → placeholder inalterado; notas nunca aparecem mesmo com `scene`) | `apps/web/src/share/SharedResourcePage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Acessibilidade das 4 superfícies | unit (axe) | Zero violação `serious`/`critical`; teclado; `aria-live` asserido pelo atributo (L-030); revelação one-shot do link de apresentação some do DOM ao trocar de estado (L-038); segundo locale | `apps/web/src/presentation/*.a11y.spec.tsx`, `apps/web/src/share/SharedResourcePage.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Fiação de rota (`App.tsx`) | unit (RTL) | As 3 rotas novas autenticadas exigem sessão; `PresenterModePage` renderiza fora do `AppShell`; rota pública continua irmã de `AuthLayout` | `apps/web/src/App.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Fiação de página existente (`DiagramEditorPage`) | unit (RTL) | O único acréscimo (link "Apresentações") aparece para `diagram:read`, nunca quebra o layout existente | `apps/web/src/diagram/DiagramEditorPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| JSON de i18n | none | Gate de build/lint apenas | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| `docs/capability-map.yaml` / `docs/route-inventory.md` / changeset | none | `repo-tools audit` sai `0`; `route-inventory.md` regenerado (nunca editado à mão) | `docs/*`, `.changeset/*.md` | `pnpm --filter @arch-canvas/repo-tools run audit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Task com testes unitários de um pacote só | `pnpm --filter @arch-canvas/<pkg> run test:unit` |
| Full | Task que atravessa pacotes, rota nova, ou fiação de `App.tsx`/`DiagramEditorPage.tsx` | `make lint && make typecheck && make test-unit` |
| Backend | Task que toca `apps/server` | `pnpm --filter @arch-canvas/server run test:unit` (integration quando aplicável — PGlite, sem Docker, AD-007) |
| Close | Fechamento de fase/onda | `make lint && make typecheck && make test-unit` (+ `make test-integration` se PGlite disponível) |

`make ci` não é usado diretamente neste sandbox (falta `pg_lsclusters`/`redis-server`, CLAUDE.md) —
o gate substituto acima é o critério de "Done when" de toda task.

---

## Execution Plan

28 tasks, 6 fases, 2 ondas lógicas (Onda 1: Fundação + Editor + Publicação, T1-T16; Onda 2:
Presenter + Visão pública + Export + Fechamento, T17-T28). Executadas sequencialmente por esta
mesma sessão (ver deviation acima) — a estrutura de fase/gate abaixo é preservada como se fossem
batches de sub-agente.

### Fase 1 — Fundação independente (Onda 1)

```
T1
T2
T3
T4
T5
T6
```

### Fase 2 — Lista + editor de frames (Onda 1)

```
T3 -> T7
T6 -> T7
T7 -> T8
T3 -> T9
T5 -> T9
T6 -> T9
T9 -> T10
T9 -> T11
T9 -> T12
```

### Fase 3 — Publicar + link + a11y + fecho da Onda 1

```
T3 -> T13
T13 -> T14
T4 -> T14
T7 -> T15
T9 -> T15
T10 -> T15
T11 -> T15
T12 -> T15
T13 -> T15
T14 -> T15
T15 -> T16
```

### Fase 4 — FrameViewer + Presenter mode (Onda 2)

```
T5 -> T17
T17 -> T18
T2 -> T19
T17 -> T19
T19 -> T20
T8 -> T20
T19 -> T21
```

### Fase 5 — Visão pública + export (Onda 2)

```
T4 -> T22
T5 -> T22
T17 -> T22
T22 -> T23
T3 -> T24
T22 -> T25
T5 -> T25
```

### Fase 6 — Fechamento da Onda 2

```
T20 -> T26
T24 -> T26
T25 -> T26
T26 -> T27
T27 -> T28
```

---

## Task Breakdown

### T1: Backend — `GET /share/:token` inclui a cena publicada de uma apresentação

**What**: `ShareModuleDeps` ganha `storage: StorageClient`; o ramo `resourceType === 'presentation'` do handler lê `presentation.publishedSnapshotId`, e quando presente busca o snapshot (`getSnapshotById`) e sua cena (`storage.getObject(EXPORT_BUCKET, snapshot.sceneJsonKey)`), retornando `scene` (array) e `published: true` além do que já existe hoje. Sem `publishedSnapshotId`, ou snapshot não resolvido, resposta idêntica à de hoje (sem `scene`/`published`). `registerModules.ts` passa `storage` ao registrar o módulo.
**Where**: `apps/server/src/modules/share/routes.ts`, `apps/server/src/core/registerModules.ts`
**Depends on**: None
**Reuses**: `getSnapshotById` (`../snapshot/snapshots.js`), `EXPORT_BUCKET` (`../storage/index.js`) — mesmos usados por `presentation/publish.ts`
**Requirement**: Problem Statement (mudança de protocolo), habilita PRZ-29/30

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Presentation publicada: `GET /share/:token` devolve `resourceType:'presentation'`, `published: true`, `scene` igual à cena do snapshot (nunca a live — mesmo teste de "frozen after later live edit" de `publish.int.spec.ts`, adaptado à rota pública)
- [ ] Presentation NÃO publicada: resposta idêntica à de hoje — sem `scene`, sem `published` (teste de regressão explícito, corpo comparado campo a campo)
- [ ] `presentation.publishedSnapshotId` presente mas snapshot não resolvido (caso defensivo): resposta cai no mesmo formato "não publicada", nunca lança 500
- [ ] `frames` continuam com `notes` redigido pela mesma regra de hoje (papel do link, não do requisitante)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/server run test:unit`
- [ ] Test count: ≥3 testes novos em `share.int.spec.ts`, nenhum existente quebrado

**Tests**: integration
**Gate**: backend

**Commit**: `feat(server): include published scene in public presentation share links`

---

### T2: `EditorSurface` ganha `scrollToFrame`

**What**: Novo método no handle `EditorSurfaceHandle`: `scrollToFrame(elementId: string | null): void`. Filtra a cena local por `el.frameId === elementId || el.id === elementId` (mesma regra de `exportPdf.ts`'s `sceneForFrame`); chama `api.scrollToContent?.(target, { fitToViewport: true, animate: true })` quando a API real expõe o método; `elementId: null` ou zero membros → no-op.
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: None
**Reuses**: `ExcalidrawSceneApi` (interface estrutural já existente no arquivo), `previousSceneRef`
**Requirement**: PRZ-37 (habilita)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `elementId` casando por `frameId` chama `scrollToContent` com os elementos certos
- [ ] `elementId` casando por `id` (o próprio frame element) chama `scrollToContent` com os elementos certos — testado separadamente do caso anterior (L-001, ramo OR)
- [ ] `elementId` sem nenhum membro correspondente: fallback, `scrollToContent` chamado com a cena inteira (mesmo heurístico do servidor)
- [ ] `elementId: null`: no-op, `scrollToContent` nunca chamado
- [ ] API mockada sem `scrollToContent`: método não lança
- [ ] Nenhum teste existente de `EditorSurface.spec.tsx` quebra
- [ ] Gate check passes: `pnpm --filter @arch-canvas/editor-adapter run test:unit`
- [ ] Test count: 5 testes novos

**Tests**: unit
**Gate**: quick

**Commit**: `feat(editor-adapter): add scrollToFrame to EditorSurface imperative handle`

---

### T3: `presentationClient.ts`

**What**: Cliente HTTP dedicado, `fetchImpl` injetável, com `list`, `create`, `get`, `addFrame`, `updateFrame`, `deleteFrame`, `reorderFrames`, `publish`, `exportPdf` — cada um com união discriminada por status (`'ok' | 'forbidden' | 'not_found' | 'invalid' | 'error'`, adaptada por rota conforme os status reais que cada uma devolve).
**Where**: `apps/web/src/presentation/presentationClient.ts`
**Depends on**: None
**Reuses**: convenções de `apps/web/src/share/shareLinkClient.ts`/`apps/web/src/nav/memberClient.ts` (chamadas `fetchImpl(...)` literais para `repo-tools audit`)
**Requirement**: PRZ-03, PRZ-06, PRZ-09, PRZ-10, PRZ-14, PRZ-19, PRZ-23, PRZ-43 (habilita)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `list(diagramId)` emite `GET /presentations?diagramId=` e devolve o array `{presentation, frames}[]`
- [ ] `create(diagramId, name)` emite `POST /presentations`, `201` → `{status:'ok', presentation}`, outro status → `{status:'error'}`
- [ ] `get(id)` emite `GET /presentations/:id`, `200`/`404`/erro mapeados
- [ ] `addFrame`/`updateFrame`/`deleteFrame` emitem as rotas corretas com o corpo documentado, `400` (nav link inválido) vira `{status:'invalid'}` distinto de `{status:'error'}`
- [ ] `reorderFrames(id, updates)` emite `PATCH /presentations/:id/frames` com `{frames: updates}`
- [ ] `publish(id)` emite `POST /presentations/:id:publish`
- [ ] `exportPdf(id)` emite `POST /presentations/:id:export-pdf`, `400`/`404` mapeados distintamente
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥16 testes (2+ por método)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add presentationClient for the presentation module's 8 routes`

---

### T4: `shareLinkClient.ts` — link de apresentação + `resolve()` estendido

**What**: `createForPresentation(presentationId, role, expiresAt)`, mesmo formato de retorno de `createForDiagram`, emitindo `POST /presentations/:id/share-links`. `resolve()`'s ramo `presentation` ganha `frames` (antes só contava `.length`) e `scene: readonly SceneElement[] | null` (novo campo do backend, T1).
**Where**: `apps/web/src/share/shareLinkClient.ts`
**Depends on**: None (independente de T1 no código — o teste cobre o novo shape de resposta com um fixture local, sem precisar do servidor real)
**Reuses**: `createForDiagram` como modelo estrutural
**Requirement**: PRZ-27, PRZ-28, PRZ-29, PRZ-30, PRZ-32

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `createForPresentation` emite `POST /presentations/:id/share-links` com `{role, expiresAt}`, mapeia `201`/`403`/outro exatamente como `createForDiagram`
- [ ] `resolve()` com `resourceType:'presentation'` e `scene` ausente: `{status:'presentation', ..., scene: null}` — SHR-27/28 continuam intactos
- [ ] `resolve()` com `resourceType:'presentation'` e `scene` presente: `{status:'presentation', ..., scene, published: true}`, `frames` populado (com `notes` como veio do servidor, nunca filtrado de novo no cliente)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥5 testes novos, todos os existentes de `shareLinkClient.spec.ts` continuam passando

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add createForPresentation and extend resolve() with published scene`

---

### T5: `frameLabel.ts` + `cropSceneForFrame.ts`

**What**: Duas funções puras compartilhadas. `frameLabel(frame, position, t)` → `"Frame {{position}}"` com o rótulo lógico (`frameId`) entre parênteses quando presente. `cropSceneForFrame(scene, frame)` → mesma regra de `apps/server/src/modules/presentation/exportPdf.ts`'s `sceneForFrame` (comentário cruzado nos dois arquivos apontando um pro outro).
**Where**: `apps/web/src/presentation/frameLabel.ts`, `apps/web/src/presentation/cropSceneForFrame.ts`
**Depends on**: None
**Reuses**: nenhuma dependência de I/O — funções puras

**Requirement**: PRZ-29, PRZ-33, PRZ-37, PRZ-40, Edge Case (elementId órfão)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `cropSceneForFrame`: `elementId` casando por `frameId` isolado, por `id` isolado (L-001), sem nenhum membro (fallback cena inteira), `elementId: null` (fallback cena inteira)
- [ ] `frameLabel`: com `frameId`, sem `frameId` nem `elementId`, com `elementId` apenas
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 6 testes novos

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add frameLabel and cropSceneForFrame shared helpers`

---

### T6: Chaves de i18n — namespace `presentation`

**What**: Chaves `pt-BR`/`en` para as 4 superfícies (lista, editor, presenter, visualizador — este último reaproveitando/estendendo `share.public.*` já existente).
**Where**: `apps/web/src/i18n/locales/{pt-BR,en}/translation.json`
**Depends on**: None
**Requirement**: PRZ-48 (habilita — usado por toda task de UI subsequente)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Toda chave usada pelas tasks T7-T25 existe nos dois locales antes de cada uma delas ser escrita (chaves adicionadas incrementalmente conforme necessário, este task planta a base: `presentation.list.*`, `presentation.editor.*`, `presentation.frame.*`, `presentation.publish.*`, `presentation.presenter.*`, `presentation.export.*`)
- [ ] `pt-BR` e `en` têm exatamente o mesmo conjunto de chaves (checado por teste ou script simples de diff de chaves)
- [ ] Gate check passes: `make lint` (JSON válido) + `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: none (build/lint gate)
**Gate**: quick

**Commit**: `feat(web): add i18n keys for the presentation-mode namespace`

---

### T7: `PresentationListPage`

**What**: Rota `/w/:workspaceId/d/:diagramId/present` — lista apresentações (`presentationClient.list`), formulário de criar (`presentationClient.create`), navega para o editor da recém-criada.
**Where**: `apps/web/src/presentation/PresentationListPage.tsx`
**Depends on**: T3, T6
**Reuses**: bootstrap do diagrama (mesma chamada de `DiagramEditorPage`) para `canMutate`

**Requirement**: PRZ-01, PRZ-02, PRZ-03, PRZ-04

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Lista renderiza para qualquer papel com `diagram:read`
- [ ] Formulário de criar só aparece com `canMutate`
- [ ] Submeter emite `POST /presentations` com `{diagramId, name}`
- [ ] `201` navega para `/present/:id` da apresentação criada
- [ ] Falha na criação mostra erro, sem navegar
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥6 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add PresentationListPage`

---

### T8: Fiar `/present` no `App.tsx` + link em `DiagramEditorPage`

**What**: Rota `/w/:workspaceId/d/:diagramId/present` (irmã não-aninhada da rota do editor, mesmo padrão de `/inventory`). Em `DiagramEditorPage`, UM `<Link>` novo para a rota (dentro de um `<details>` "Apresentações", mesmo padrão de `LibraryPanel`/`MetadataPanel`) — sem nenhuma outra mudança de layout.
**Where**: `apps/web/src/App.tsx`, `apps/web/src/diagram/DiagramEditorPage.tsx`
**Depends on**: T7
**Reuses**: `ProtectedRoute`, padrão `<details>` já estabelecido

**Requirement**: PRZ-01 (rota), Design (interação de superfícies)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `/w/:workspaceId/d/:diagramId/present` renderiza `PresentationListPage` atrás de `ProtectedRoute`
- [ ] `DiagramEditorPage` ganha exatamente um link novo, visível para qualquer papel que já pode abrir a página (nenhum gate extra — a própria lista decide o que mostrar)
- [ ] Nenhum teste existente de `App.spec.tsx`/`DiagramEditorPage.spec.tsx` quebra
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): wire /present route and link it from DiagramEditorPage`

---

### T9: `PresentationEditorPage` — listar e adicionar frames

**What**: Rota `/present/:presentationId`. Lista frames (`presentationClient.get`) em ordem de `position`. Formulário de adicionar frame: `<select>` alimentado pelos elementos `type:'frame'` da cena viva (via `DiagramSyncClient.bootstrap`, somente leitura) OU um campo de texto livre para rótulo lógico (`frameId`) — exatamente um dos dois, nunca ambos.
**Where**: `apps/web/src/presentation/PresentationEditorPage.tsx`
**Depends on**: T3, T5, T6
**Reuses**: `DiagramSyncClient.bootstrap` (só leitura, sem fila/presença)

**Requirement**: PRZ-05, PRZ-06, PRZ-07, PRZ-08, PRZ-11, PRZ-12

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Frames listados em ordem de `position`
- [ ] Escolher um frame do canvas emite `POST .../frames` com `elementId` (sem `frameId`)
- [ ] Digitar rótulo lógico emite `POST .../frames` com `frameId` (sem `elementId`)
- [ ] Nem escolher nem digitar bloqueia o envio, sem requisição
- [ ] `201` insere o frame ao final da lista exibida
- [ ] Falha (403/404/400) mostra erro, lista inalterada
- [ ] Campo de notas não aparece quando o servidor devolveu `notes: null`
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥8 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add PresentationEditorPage with frame list and add-frame form`

---

### T10: `PresentationEditorPage` — editar notas e remover frame

**What**: Editar notas de um frame existente (`presentationClient.updateFrame`) e removê-lo (`presentationClient.deleteFrame`, com confirmação).
**Where**: `apps/web/src/presentation/PresentationEditorPage.tsx`
**Depends on**: T9

**Requirement**: PRZ-09, PRZ-10, PRZ-11, PRZ-12

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Salvar notas emite `PATCH .../frames/:frameId` com `{notes}`
- [ ] Confirmar remoção emite `DELETE .../frames/:frameId`, item some da lista só após `204`
- [ ] Falha em qualquer uma mostra erro, lista/notas inalteradas
- [ ] Controle de editar notas ausente para papel sem `diagram:mutate`
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥6 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add frame notes editing and deletion to PresentationEditorPage`

---

### T11: `PresentationEditorPage` — reordenar frames

**What**: Botões "▲"/"▼" por linha; cada clique recalcula o array completo `{id, position}` e emite `PATCH .../frames` em lote.
**Where**: `apps/web/src/presentation/PresentationEditorPage.tsx`
**Depends on**: T9

**Requirement**: PRZ-13, PRZ-14, PRZ-15, PRZ-16, PRZ-17

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Mover emite o PATCH com TODAS as posições recalculadas, não só a do frame movido
- [ ] Primeiro frame: "▲" desabilitado; último: "▼" desabilitado
- [ ] `200` renderiza a ordem devolvida pelo servidor
- [ ] Falha reverte a ordem exibida para a última confirmada
- [ ] Botões alcançáveis só por teclado (foco nativo de `<button>`)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥5 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add frame reordering to PresentationEditorPage`

---

### T12: `PresentationEditorPage` — configurar navegação de protótipo

**What**: Por frame, escolher 0+ outros frames da mesma apresentação como alvo de `navLinksJson`; salvar emite `PATCH .../frames/:frameId`.
**Where**: `apps/web/src/presentation/PresentationEditorPage.tsx`
**Depends on**: T9

**Requirement**: PRZ-18, PRZ-19, PRZ-20, PRZ-21

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Lista de alvos nunca inclui o próprio frame em edição
- [ ] Salvar emite `PATCH` com `{navLinksJson: [{targetFrameId}, ...]}`
- [ ] `400` (link inválido) mostra erro e mantém os links previamente salvos exibidos
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥4 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add prototype nav-link configuration to PresentationEditorPage`

---

### T13: `PresentationEditorPage` — publicar/republicar

**What**: Controle de publicar (`presentationClient.publish`), visível só com `canMutate`. Estado "publicado" após `200`. Republicar exige confirmação com aviso explícito de que links já distribuídos passam a mostrar o novo conteúdo.
**Where**: `apps/web/src/presentation/PresentationEditorPage.tsx`
**Depends on**: T3

**Requirement**: PRZ-22, PRZ-23, PRZ-24, PRZ-25

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Controle ausente sem `canMutate`
- [ ] Confirmar emite `POST .../:publish`
- [ ] `200` muda o rótulo do botão para "republicar" e mostra `publishedSnapshotId`
- [ ] Republicar mostra o aviso ANTES de confirmar (o aviso é um passo bloqueante, não só uma nota estática)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥5 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add publish/republish control to PresentationEditorPage`

---

### T14: `PresentationEditorPage` — link de compartilhamento de apresentação

**What**: Painel de criar/listar (session-only)/revogar link de apresentação, reproduzindo o padrão de `ShareLinkPanel` (formulário papel+expiração, revelação one-shot, lista só desta sessão) contra `shareLinkClient.createForPresentation`/`revoke`. Desabilitado, com texto explicando o motivo, até a primeira publicação.
**Where**: `apps/web/src/presentation/PresentationSharePanel.tsx` (novo, específico desta página — não importa `ShareLinkPanel`, ver design.md)
**Depends on**: T13, T4

**Requirement**: PRZ-26, PRZ-27, PRZ-28

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Desabilitado com texto explicativo antes de `publishedSnapshotId` existir
- [ ] Habilitado após publicar; criar link emite `POST /presentations/:id/share-links` com `{role, expiresAt}`
- [ ] `201` mostra a URL completa uma única vez, com o mesmo aviso de revelação única de R11 — e a URL some do DOM depois de revogar (L-038: asserido removendo do documento, não só o callback)
- [ ] `403` mostra a mesma mensagem de teto de papel de R11
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥6 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add presentation share-link creation panel`

---

### T15: A11y — `PresentationListPage` + `PresentationEditorPage`

**What**: Specs `*.a11y.spec.tsx` para as duas telas: zero violação axe séria/crítica, `aria-live` em cada ação assíncrona (criar/editar/remover frame, reorder, publicar, criar link), foco por teclado, segundo locale.
**Where**: `apps/web/src/presentation/PresentationListPage.a11y.spec.tsx`, `apps/web/src/presentation/PresentationEditorPage.a11y.spec.tsx`
**Depends on**: T7, T9, T10, T11, T12, T13, T14

**Requirement**: PRZ-46, PRZ-47, PRZ-48

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Zero violação axe `serious`/`critical` em cada estado renderizável das duas telas
- [ ] Cada ação assíncrona tem uma região com `aria-live="polite"` — asserida pelo atributo, não só pelo texto (L-030)
- [ ] Toda ação alcançável só por Tab/Enter (teste percorre sem clique de mouse)
- [ ] Telas renderizam corretamente com locale `en`
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit (axe)
**Gate**: quick

**Commit**: `test(web): add accessibility coverage for presentation list and editor pages`

---

### T16: Fechamento da Onda 1

**What**: Gate completo, revisão de que nenhuma AC de PRZ-01..28 ficou sem teste correspondente (checagem manual contra a Requirement Traceability do spec).
**Where**: N/A (revisão + gate)
**Depends on**: T15

**Requirement**: PRZ-01..28 (fechamento)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `make lint && make typecheck && make test-unit` verde
- [ ] `make test-integration` verde (se PGlite disponível neste ambiente) ou explicitamente registrado como pulado com o motivo
- [ ] Cada PRZ-01..28 tem pelo menos um teste identificável (arquivo:linha) nas tasks T1-T15

**Tests**: none (gate only)
**Gate**: close

**Commit**: `chore(presentation-mode): close wave 1 gate` (só se algo precisar de correção; caso contrário nenhum commit vazio — task apenas verifica)

---

### T17: `FrameViewer` (componente compartilhado)

**What**: Componente puro de apresentação: frame atual, indicador de posição, anterior/próximo, botões de navegação de protótipo (um por `navLinksJson` do frame atual). Recebe os frames e um `renderCanvas(frame)` para não acoplar a um tipo específico de fonte de cena (viva vs. congelada).
**Where**: `apps/web/src/presentation/FrameViewer.tsx`
**Depends on**: T5

**Requirement**: PRZ-31, PRZ-33, PRZ-38, PRZ-40, Edge Case (frame único)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Indicador de posição mostra "Frame X de Y" (i18n)
- [ ] Anterior/próximo desabilitados nas extremidades; ambos desabilitados com 1 frame só, mas links de protótipo continuam funcionando mesmo assim
- [ ] Clicar num link de protótipo chama `onNavigate` com o índice do alvo, fora da sequência linear
- [ ] `renderCanvas` é chamado com o frame atual a cada troca
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥7 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add shared FrameViewer component`

---

### T18: A11y — `FrameViewer`

**What**: Spec de acessibilidade isolada do componente (fora do contexto de presenter/visão pública), garantindo que a base compartilhada não introduz violação alguma antes de ser composta nas duas telas que a consomem.
**Where**: `apps/web/src/presentation/FrameViewer.a11y.spec.tsx`
**Depends on**: T17

**Requirement**: PRZ-46, PRZ-47

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Zero violação axe `serious`/`critical`
- [ ] Navegação anterior/próximo/link de protótipo alcançável só por teclado
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit (axe)
**Gate**: quick

**Commit**: `test(web): add accessibility coverage for FrameViewer`

---

### T19: `PresenterModePage`

**What**: Rota `/present/:presentationId/presenter`, fora do `AppShell`. Bootstrap da cena VIVA (somente leitura, sem fila de mutação nem presença). `EditorSurface` com `viewModeEnabled` sempre `true`. `FrameViewer` compõe a navegação; cada troca de frame chama `scrollToFrame` no handle. Teclado: seta direita/`PageDown`/`Space` (próximo), seta esquerda/`PageUp` (anterior), `Escape` (sair para o editor de apresentação).
**Where**: `apps/web/src/presentation/PresenterModePage.tsx`
**Depends on**: T2, T17

**Requirement**: PRZ-35, PRZ-36, PRZ-37, PRZ-38, PRZ-39, PRZ-40, PRZ-41

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Monta com `viewModeEnabled: true`; nenhuma fila de mutação nem `PresenceClient` instanciados nesta rota
- [ ] Troca de frame chama `scrollToFrame(frame.elementId)` no handle
- [ ] Setas/`PageDown`/`PageUp`/`Space` navegam; `Escape` volta para `/present/:presentationId`
- [ ] Nenhuma requisição de escrita (`POST`/`PATCH`/`DELETE`) é emitida em nenhum momento da navegação
- [ ] Controle de abrir desabilitado (na página que o lança, T20) quando a apresentação tem 0 frames
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥8 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add PresenterModePage with keyboard navigation`

---

### T20: Fiar `/present/:id/presenter` + lançador em `PresentationEditorPage`

**What**: Rota nova em `App.tsx`, autenticada, sem `AppShell`. Botão "Apresentar" em `PresentationEditorPage`, desabilitado com 0 frames.
**Where**: `apps/web/src/App.tsx`, `apps/web/src/presentation/PresentationEditorPage.tsx`
**Depends on**: T19, T8

**Requirement**: PRZ-35, PRZ-41

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Rota renderiza `PresenterModePage` atrás de `ProtectedRoute`, sem `AppShell` ao redor
- [ ] Botão "Apresentar" navega para a rota; desabilitado com 0 frames
- [ ] Nenhum teste existente de `App.spec.tsx` quebra
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): wire the presenter mode route`

---

### T21: A11y — `PresenterModePage`

**What**: Spec de acessibilidade: navegação inteira por teclado, `Escape` funcional, zero violação axe.
**Where**: `apps/web/src/presentation/PresenterModePage.a11y.spec.tsx`
**Depends on**: T19

**Requirement**: PRZ-46, PRZ-47, PRZ-48

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Zero violação axe `serious`/`critical`
- [ ] Navegar do frame 1 ao último e sair, só por teclado
- [ ] Renderiza corretamente em `en`
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit (axe)
**Gate**: quick

**Commit**: `test(web): add accessibility coverage for PresenterModePage`

---

### T22: `SharedResourcePage` — visualizador de frames real

**What**: O ramo `resourceType:'presentation'` passa a checar `result.scene`. Presente → `FrameViewer` com `renderCanvas` recortando a cena por `cropSceneForFrame` e montando `EditorSurface` (`viewModeEnabled` sempre `true`, sem `ref`/handle — a cena já vem pré-recortada, sem necessidade de viewport dinâmico). Ausente → placeholder de R11 inalterado.
**Where**: `apps/web/src/share/SharedResourcePage.tsx`
**Depends on**: T4, T5, T17

**Requirement**: PRZ-29, PRZ-30, PRZ-31, PRZ-32, PRZ-33, PRZ-34

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `scene` presente: `FrameViewer` renderiza, frame 1 primeiro, cena recortada corretamente
- [ ] `scene` ausente: placeholder idêntico ao de R11 — teste `SHR-27`/`SHR-28` (mensagem exata) continua passando sem alteração de asserção
- [ ] `notes` nunca renderizado em nenhum dos dois estados
- [ ] Navegar frames/link de protótipo não emite requisição nova (mock de `fetchImpl` chamado exatamente 1x no total)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥6 testes novos, 0 existentes quebrados

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): render the real frame viewer on published presentation share links`

---

### T23: A11y — `SharedResourcePage` (estado de apresentação publicada)

**What**: Estende `SharedResourcePage.a11y.spec.tsx` com o novo estado (apresentação publicada, `scene` presente).
**Where**: `apps/web/src/share/SharedResourcePage.a11y.spec.tsx`
**Depends on**: T22

**Requirement**: PRZ-46, PRZ-47, PRZ-48

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Zero violação axe `serious`/`critical` no novo estado
- [ ] Navegação de frames alcançável só por teclado, sem `AuthProvider` montado (mesma garantia AD-012 de todo teste deste arquivo)
- [ ] Estados existentes (placeholder, diagrama, inválido) continuam com zero violações
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit (axe)
**Gate**: quick

**Commit**: `test(web): extend SharedResourcePage a11y coverage for the frame viewer state`

---

### T24: `PresentationEditorPage` — exportar PDF

**What**: Controle de exportar (`presentationClient.exportPdf`), desabilitado com motivo até publicada + ≥1 frame. Estado de carregamento síncrono. `200` mostra link para `url` + `pageCount`.
**Where**: `apps/web/src/presentation/PresentationEditorPage.tsx`
**Depends on**: T3

**Requirement**: PRZ-42, PRZ-43, PRZ-44, PRZ-45

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Desabilitado (com texto) sem publicação ou com 0 frames
- [ ] Confirmar emite `POST .../:export-pdf`, mostra carregando até responder
- [ ] `200` mostra link para `url` (abre em nova aba) + `pageCount`; nenhum download automático disparado
- [ ] `400`/`404`/erro mostram mensagens específicas, controle nunca preso em carregando
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥6 testes

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add PDF export control to PresentationEditorPage`

---

### T25: Edge cases — recorte, frame único, cena vazia

**What**: Cobertura explícita dos Edge Cases do spec que não couberam nas tasks anteriores: `elementId` órfão (frame do canvas apagado depois) cai no fallback documentado, cena vazia renderiza canvas vazio (nunca mensagem de link inválido).
**Where**: `apps/web/src/presentation/cropSceneForFrame.spec.ts` (extensão), `apps/web/src/share/SharedResourcePage.spec.tsx` (extensão)
**Depends on**: T22, T5

**Requirement**: Edge Cases (spec.md)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `elementId` sem membros correspondentes na cena atual: fallback para a cena inteira, sem lançar
- [ ] `scene: []`: `FrameViewer`/`EditorSurface` renderizam canvas vazio, nunca a mensagem de link inválido
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: ≥3 testes novos

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): cover orphaned frame element and empty-scene edge cases`

---

### T26: Varredura final de i18n + changeset

**What**: Confere que toda chave usada pelas tasks T17-T25 existe nos dois locales (`pt-BR`/`en`); adiciona as que faltarem. Adiciona uma entrada de changeset descrevendo a fatia.
**Where**: `apps/web/src/i18n/locales/{pt-BR,en}/translation.json`, `.changeset/*.md`
**Depends on**: T20, T24, T25

**Requirement**: PRZ-48

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `pt-BR` e `en` têm o mesmo conjunto de chaves usadas nas 4 superfícies
- [ ] Changeset novo descreve a fatia (mesmo formato dos changesets de R9/R10/R11)
- [ ] Gate check passes: `make lint`

**Tests**: none
**Gate**: quick

**Commit**: `chore(web): complete i18n coverage for presentation-mode and add changeset`

---

### T27: `capability-map.yaml` + `repo-tools audit`

**What**: Atualiza a entrada "Apresentações navegáveis e protótipos" de `docs/capability-map.yaml`: `ui_surface: apps/web/src/presentation/PresentationEditorPage.tsx`, remove `status: backend-only`. Roda `repo-tools audit`, que regenera `docs/route-inventory.md`.
**Where**: `docs/capability-map.yaml`, `docs/route-inventory.md` (gerado)
**Depends on**: T26

**Requirement**: Success Criteria (spec.md — `repo-tools audit` deixa de marcar as rotas como `pending-product`)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `pnpm --filter @arch-canvas/repo-tools run audit` sai `0`
- [ ] `docs/route-inventory.md` regenerado (nunca editado à mão) mostra as 8 rotas de `presentation` + `POST /presentations/:id/share-links` como consumidas, não `pending-product`
- [ ] Nenhuma outra entrada de `capability-map.yaml` alterada

**Tests**: none
**Gate**: quick

**Commit**: `docs(presentation-mode): mark the presentation capability as UI-covered`

---

### T28: Fechamento da Onda 2 / fatia completa

**What**: Gate completo final, revisão de que cada PRZ-01..48 tem teste identificável.
**Where**: N/A
**Depends on**: T27

**Requirement**: PRZ-01..48 (fechamento)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `make lint && make typecheck && make test-unit` verde
- [ ] `make test-integration` verde (se PGlite disponível) ou pulado com motivo registrado
- [ ] Toda PRZ-01..48 rastreada a pelo menos um teste (arquivo:linha)

**Tests**: none (gate only)
**Gate**: close

**Commit**: N/A — task de verificação, sem mudança de código própria (o Verifier assume a partir daqui)

---

## Nota sobre o Verifier (Fase de Verify)

O mesmo limite de ferramentas declarado no topo deste arquivo se aplica à Verify: não há um segundo
agente disponível para rodar como verificador genuinamente independente nesta sessão. A Verify é
conduzida pela mesma sessão, mas em uma cópia de trabalho isolada (worktree/scratch separado, nunca
`git stash`) e seguindo `references/validate.md` à risca — evidência por `file:line`, sensor de
discriminação por mutação real, sem reaproveitar nenhuma alegação das tasks acima sem reconferir
contra o código. A limitação (author == verifier no nível de "mesma sessão de IA") é declarada
explicitamente em `validation.md` e no relatório final, não escondida.
