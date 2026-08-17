# Presença em tempo real no editor — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Spec**: `.specs/features/realtime-presence/spec.md`
**Design**: `.specs/features/realtime-presence/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling (`apps/server/src/modules/ws-gateway/wsGateway.int.spec.ts`, `packages/shared-contracts/src/ws-messages.spec.ts`, `packages/editor-adapter/src/EditorSurface.spec.tsx`, `apps/web/src/sync/syncClient.spec.ts`, `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx`) and this repo's coverage-floor convention (`apps/web/vitest.config.ts` — floors are a ratchet, never lowered). Guidelines found: `CLAUDE.md` ("Comandos" is the authoritative gate list) and the two `vitest.config.ts` coverage floors; no `AGENTS.md`/`CONTRIBUTING.md` exists. Strong default applied (all branches, 1:1 to spec ACs, every listed edge case) since no stricter guideline exists.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Shared contract schema (`shared-contracts`) | unit | Both wire directions: payload with and without the new optional fields, plus rejection of a malformed value | `packages/shared-contracts/src/ws-messages.spec.ts` | `pnpm --filter @arch-canvas/shared-contracts run test:unit` |
| Server route / WS relay (`ws-gateway`) | integration | Two real `ws` sockets on the same diagram: identity present on the relayed payload, no self-echo, client-supplied identity ignored — 1:1 to LIVE-01..04 | `apps/server/src/modules/ws-gateway/*.int.spec.ts` | `pnpm --filter @arch-canvas/server run test:integration` |
| `editor-adapter` imperative handle | unit | The exact map handed to `updateScene` (keys, `pointer`, `username`, `color`, `selectedElementIds`) — not merely that `updateScene` was called | `packages/editor-adapter/src/EditorSurface.spec.tsx` | `pnpm --filter @arch-canvas/editor-adapter run test:unit` |
| Client transport (`PresenceClient`) | unit | All branches: ticket ok/failure, open, every received-message branch, throttle, idle, prune, backoff, policy close codes — 1:1 to LIVE-06..12, LIVE-16..19, LIVE-23 and the listed edge cases | `apps/web/src/presence/presenceClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Store (`presenceStore`) | unit | Every action and every connection phase transition | `apps/web/src/presence/presenceStore.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Pure utility (`collaboratorColor`) | unit | Determinism (same input → same output), distinct inputs spread over the palette, palette values well-formed | `apps/web/src/presence/collaboratorColor.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`ConnectionStatus`) | unit (RTL) | One assertion per connection phase's rendered text + the `aria-live` attribute itself | `apps/web/src/presence/ConnectionStatus.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Accessibility (`ConnectionStatus`) | unit (axe) | Zero serious/critical violations, explicit tab-order assertion, `aria-live="polite"` asserted as an attribute, `en` locale render — LIVE-25..27 | `apps/web/src/presence/ConnectionStatus.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integration wiring (`DiagramEditorPage`) | unit (RTL) | End to end inside the frontend: ticket → socket → collaborators reaching `updateScene`; reconnect → `catchUp` → `bootstrap` → `applyRemoteScene` | `apps/web/src/diagram/DiagramEditorPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only — a missing key surfaces as a raw key string in the RTL tests above | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Build config (`vite.config.ts`) | none | Build/lint gate only — a dev-server proxy entry has no runtime under test | `apps/web/vite.config.ts` | build gate only |
| Docs / capability map | none | `repo-tools audit` gate only | `docs/capability-map.yaml` | `pnpm --filter @arch-canvas/repo-tools run audit` |

## Gate Check Commands

> Generated from `CLAUDE.md`'s "Comandos" section and each package's `package.json#scripts`.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After a task with unit tests only, scoped to one package | `pnpm --filter @arch-canvas/<pkg> run test:unit` |
| Full | After a task with integration tests | `pnpm --filter @arch-canvas/server run test:integration` (plus the quick gate of any package the task also touched) |
| Build | Config/docs-only tasks and the closing task of a phase | `make lint && make typecheck && make test-unit` (the documented sandbox substitute for `make ci` — `CLAUDE.md`) |

---

## Execution Plan

15 tasks — packs into 2 task-budgeted batches (~7 each). Sole worker executes all phases in order.

### Phase 1: Contrato de wire e adapter

```
T1 → T2
T3
```

### Phase 2: Núcleo de presença no cliente

```
T4
T5
T6
T1 → T7
T5 → T7
T6 → T7
T7 → T8
T7 → T9
```

### Phase 3: Superfície, fiação e fechamento

```
T4 → T10
T5 → T10
T10 → T11
T3 → T12
T8 → T12
T9 → T12
T10 → T12
T12 → T13
T14
T12 → T15
```

---

## Task Breakdown

### T1: Carregar identidade do remetente em `presencePayloadSchema`

**What**: Acrescentar `senderId` e `displayName`, ambos opcionais, ao payload de `presence` — o contrato de wire que hoje impede o cliente de saber de quem é um cursor.
**Where**: `packages/shared-contracts/src/ws-messages.ts`
**Depends on**: None
**Reuses**: `uuidSchema` (`packages/shared-contracts/src/ids.ts`); a entrada `presence` já existente em `wsPayloadSchemaByType`
**Requirement**: LIVE-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `presencePayloadSchema` aceita `{status:'active'}` sem `senderId`/`displayName` (direção cliente→servidor)
- [x] `presencePayloadSchema` aceita e preserva `senderId`/`displayName` quando presentes (direção servidor→cliente)
- [x] Um `senderId` que não é UUID é rejeitado com `invalid_payload` por `parseWsMessage`
- [x] Comentário no arquivo registra que os campos são preenchidos só pelo servidor e ignorados quando vêm do cliente
- [x] Gate check passes: `pnpm --filter @arch-canvas/shared-contracts run test:unit`
- [x] Test count: 3 novos casos passam (nenhum existente removido)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared-contracts): carry sender identity in the presence payload`

---

### T2: Retransmitir a identidade do remetente no ws-gateway

**What**: Resolver o `display_name` do ator uma vez por conexão e parar de descartar `senderId`/`displayName` no relay de presença.
**Where**: `apps/server/src/modules/ws-gateway/routes.ts`
**Depends on**: T1
**Reuses**: `PresenceEvent` (`presence.ts`, já é `Record<string, unknown>` e já carrega `senderId`); o filtro de auto-eco `event.senderId === actorId`; o padrão de query de `resolveDiagramMembership` (`auth/ws-ticket.ts`); a tabela `users` (`@arch-canvas/database`)
**Requirement**: LIVE-01..04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] O `display_name` do ator é resolvido uma vez, logo após o `hello`, e antes de `presence.subscribe`
- [x] `case 'presence'` publica `senderId` e `displayName` a partir da conexão, nunca de `message.payload`
- [x] `handlePresenceEvent` repassa `senderId` e `displayName` no `send()`
- [x] O filtro que descarta `mutation_broadcast` permanece intacto (coedição continua fora de escopo, AD-002)
- [x] Teste de integração com dois sockets `ws` reais: a presença de A chega em B com `senderId` = id de A e `displayName` = nome de A
- [x] Teste de integração: A nunca recebe o eco da própria presença
- [x] Teste de integração: um `senderId` falso enviado por A é ignorado — B recebe o id real de A
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`
- [x] Test count: 3 novos casos de integração passam

**Tests**: integration
**Gate**: full

**Commit**: `fix(ws-gateway): keep the sender identity on relayed presence`

---

### T3: Expor `applyCollaborators` no handle imperativo do `EditorSurface`

**What**: Método aditivo no `EditorSurfaceHandle` que repassa um mapa de colaboradores remotos para o `updateScene` nativo do Excalidraw.
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: None
**Reuses**: o `apiRef`/`useImperativeHandle` que `applyRemoteScene` e `insertLibraryItem` já usam (AD-010); a técnica de tipo estrutural local já aplicada em `ExcalidrawSceneApi` para não importar subpath interno (EDT-07/AD-008)
**Requirement**: LIVE-13, LIVE-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `EditorSurfaceHandle.applyCollaborators(map)` existe e chama `updateScene({collaborators})`
- [ ] O tipo `RemoteCollaborator` é declarado localmente e reexportado por `packages/editor-adapter/src/index.ts`
- [ ] `applyRemoteScene` e `insertLibraryItem` continuam funcionando sem mudança de assinatura
- [ ] Teste unitário afirma o conteúdo do mapa entregue a `updateScene` (chaves, `pointer`, `username`, `color`, `selectedElementIds`), não apenas que foi chamado
- [ ] Gate check passes: `pnpm --filter @arch-canvas/editor-adapter run test:unit`
- [ ] Test count: 2 novos casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(editor-adapter): add applyCollaborators to the editor surface handle`

---

### T4: Chaves i18n de presença (pt-BR e en)

**What**: Namespace `presence` com os textos dos três estados de conexão.
**Where**: `apps/web/src/i18n/locales/{pt-BR,en}/translation.json`
**Depends on**: None
**Reuses**: a convenção de namespace por feature já usada por `saveStatus`/`aiDock`/`nav`
**Requirement**: LIVE-24, LIVE-27

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `presence.status.connecting`, `presence.status.connected` e `presence.status.disconnected` existem nos dois locales
- [ ] Os dois arquivos têm exatamente o mesmo conjunto de chaves sob `presence`
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: build

**Commit**: `feat(web): add presence i18n keys`

---

### T5: Criar o `presenceStore`

**What**: Store zustand com o estado da conexão e o mapa de presenças remotas.
**Where**: `apps/web/src/presence/presenceStore.ts`
**Depends on**: None
**Reuses**: a forma exata de `createSaveStatusStore` + `saveStatusTranslationKey` (`apps/web/src/sync/saveStatus.ts`)
**Requirement**: LIVE-18, LIVE-23, LIVE-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `createPresenceStore()` devolve um store com `connection: 'connecting'` e `remotes: {}`
- [ ] `setConnection`, `upsertRemote`, `dropRemote`, `pruneRemotes`, `clearRemotes` implementados
- [ ] `presenceStatusTranslationKey(phase)` devolve `presence.status.<phase>`
- [ ] `pruneRemotes(staleBefore)` remove só quem tem `lastSeenAt < staleBefore`
- [ ] Testes unitários cobrem cada ação e cada uma das três fases de conexão
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 7 casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add the presence store`

---

### T6: Criar `collaboratorColor`

**What**: Função pura que mapeia um `senderId` para um par de cores estável.
**Where**: `apps/web/src/presence/collaboratorColor.ts`
**Depends on**: None
**Reuses**: nada — função pura sem dependências
**Requirement**: LIVE-15

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `collaboratorColor(id)` devolve `{background, stroke}` com valores hex válidos
- [ ] Chamadas repetidas com o mesmo id devolvem exatamente o mesmo par
- [ ] Ids diferentes se espalham por mais de uma cor da paleta
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 3 casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add deterministic collaborator colors`

---

### T7: Criar o `PresenceClient` (conexão e recepção)

**What**: Cliente que emite o ticket, abre o socket e traduz mensagens `presence` recebidas em atualizações do store.
**Where**: `apps/web/src/presence/presenceClient.ts`
**Depends on**: T1, T5, T6
**Reuses**: `parseWsMessage`/`WS_PROTOCOL_VERSION` (`@arch-canvas/shared-contracts`, já dependência de `apps/web` e ainda sem nenhum consumidor); a injeção `fetchImpl` de `DiagramSyncClient`
**Requirement**: LIVE-06, LIVE-07, LIVE-08, LIVE-13, LIVE-14, LIVE-16, LIVE-17, LIVE-18, LIVE-23

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `connect()` emite `POST /diagrams/:id/ws-ticket` e abre a URL `/ws/diagrams/:id?ticket=<ticket>` pelo `WebSocketImpl` injetado
- [ ] Uma falha do ticket (não-2xx ou rede) não abre socket e leva a conexão a `disconnected`
- [ ] `close()` fecha o socket, cancela todos os temporizadores e impede reconexão posterior
- [ ] Uma mensagem `presence` com `senderId` diferente do usuário logado vira `upsertRemote` com cursor, seleção, nome e `lastSeenAt`
- [ ] Uma mensagem `presence` sem `senderId` é ignorada
- [ ] Uma mensagem `presence` com `senderId` igual ao usuário logado é ignorada
- [ ] Uma mensagem `presence` com `status:'idle'` remove o remetente
- [ ] Um fechamento de socket limpa o mapa de remotos
- [ ] Mensagem malformada é descartada sem derrubar a conexão
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 9 casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add the presence client transport`

---

### T8: Transmitir a presença local (throttle, idle e poda)

**What**: Envio de cursor com throttle trailing de 50 ms, envio de seleção, marcação de inatividade e poda de remotos silenciosos.
**Where**: `apps/web/src/presence/presenceClient.ts` (modify)
**Depends on**: T7
**Reuses**: a injeção de temporizador de `DiagramSyncClient` (`scheduleRetryTimer`); o socket e o store já montados em T7
**Requirement**: LIVE-09, LIVE-10, LIVE-11, LIVE-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] 10 chamadas de `sendCursor` dentro de 30 ms produzem exatamente 1 mensagem, com as coordenadas da última chamada
- [ ] `sendSelection` envia imediatamente, com a lista de ids recebida
- [ ] Nenhuma mensagem é enviada enquanto o socket não estiver aberto
- [ ] Após 60 s sem movimento, exatamente uma mensagem com `status:'idle'` é enviada; o movimento seguinte volta a `status:'active'`
- [ ] Um remoto sem mensagem há mais de 90 s é removido do mapa pela varredura periódica
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 6 casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): broadcast throttled local presence`

---

### T9: Reconexão com backoff no `PresenceClient`

**What**: Reagendamento com backoff exponencial limitado, ticket novo por tentativa, e o callback `onReconnected`.
**Where**: `apps/web/src/presence/presenceClient.ts` (modify)
**Depends on**: T7
**Reuses**: a fórmula de backoff de `DiagramSyncClient` (`Math.min(1000 * 2 ** attempt, 30_000)`); as constantes de close code do servidor (`WS_CLOSE_FORBIDDEN` 4403, `WS_CLOSE_PAYLOAD_TOO_LARGE` 4413)
**Requirement**: LIVE-19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Um fechamento inesperado agenda nova tentativa com atraso crescente e limitado
- [ ] Cada tentativa emite um `POST /diagrams/:id/ws-ticket` novo (ticket é de uso único)
- [ ] Uma reconexão bem-sucedida invoca `onReconnected` exatamente uma vez
- [ ] Um fechamento com código `4403` ou `4413` não agenda nova tentativa
- [ ] Um `close()` explícito não agenda nova tentativa
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 5 casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): reconnect the presence client with capped backoff`

---

### T10: Criar o componente `ConnectionStatus`

**What**: Indicador textual do estado da conexão em tempo real, numa região `aria-live="polite"`.
**Where**: `apps/web/src/presence/ConnectionStatus.tsx`
**Depends on**: T4, T5
**Reuses**: o padrão do `<p data-testid="save-status">` de `DiagramEditorPage` (texto por chave i18n derivada do estado)
**Requirement**: LIVE-24, LIVE-25

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Renderiza um texto distinto para `connecting`, `connected` e `disconnected`
- [ ] O elemento carrega `aria-live="polite"` e um `data-testid` estável
- [ ] O texto muda quando o store muda de fase, sem remontar
- [ ] Testes unitários afirmam o texto de cada uma das três fases e o atributo `aria-live`
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 4 casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add the realtime connection status indicator`

---

### T11: Teste de acessibilidade do `ConnectionStatus`

**What**: Suíte a11y dedicada: axe, ordem de tabulação e segundo locale.
**Where**: `apps/web/src/presence/ConnectionStatus.a11y.spec.tsx`
**Depends on**: T10
**Reuses**: o template completo de `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx` (`jest-axe`, helper `seriousOrCriticalViolations`, troca de locale com restauração no `afterEach`)
**Requirement**: LIVE-25, LIVE-26, LIVE-27

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Zero violações sérias ou críticas de axe nas três fases
- [ ] O indicador não está na ordem de tabulação (nenhum elemento focável é introduzido por ele)
- [ ] `aria-live="polite"` afirmado como atributo, e o anúncio muda quando a fase muda
- [ ] Renderiza no locale `en` além do `pt-BR`
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 4 casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add connection status accessibility suite`

---

### T12: Ligar a presença ao `DiagramEditorPage`

**What**: Ciclo de vida do `PresenceClient`, envio de cursor/seleção, entrega do mapa de colaboradores ao canvas e o indicador na coluna do canvas.
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx`
**Depends on**: T3, T8, T9, T10
**Reuses**: o `selection` já levantado por `onSelectionChange` (não duplica a fiação); o `editorSurfaceRef` de AD-010; `useAuth()` como única fonte de identidade (AD-011)
**Requirement**: LIVE-06, LIVE-08, LIVE-09, LIVE-10, LIVE-13, LIVE-24

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] O `PresenceClient` é criado depois que o bootstrap resolve e fechado no unmount
- [ ] Movimento de ponteiro sobre o wrapper do canvas chama `sendCursor`
- [ ] Mudança de seleção chama `sendSelection` reusando o `selection` já existente
- [ ] Uma presença remota recebida chega ao canvas por `applyCollaborators`
- [ ] `<ConnectionStatus/>` renderiza na coluna do canvas
- [ ] Testes RTL com `WebSocket` fake global cobrem: URL aberta com o ticket, colaborador remoto chegando a `updateScene`, e fechamento no unmount
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 4 novos casos passam (nenhum existente removido)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): wire live presence into the diagram editor`

---

### T13: Catch-up de cena na reconexão

**What**: Fechar o laço morto de `catchUp()`: reconexão dispara catch-up, e um catch-up com operações novas repinta o canvas por `applyRemoteScene`.
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx` (modify)
**Depends on**: T12
**Reuses**: `DiagramSyncClient.catchUp()`/`bootstrap()`/`onReconcile` (`apps/web/src/sync/syncClient.ts`, hoje sem nenhum caller); `handleApproved`'s padrão de `bootstrap()` + `applyRemoteScene` já presente nesta página
**Requirement**: LIVE-20, LIVE-21, LIVE-22

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `onReconnected` do `PresenceClient` chama `DiagramSyncClient.catchUp()`
- [ ] Um catch-up com `appliedCount > 0` busca a cena por `bootstrap()` e a aplica por `applyRemoteScene`
- [ ] Um catch-up com `appliedCount === 0` não busca cena nenhuma e não toca no canvas
- [ ] O `<EditorSurface/>` nunca é remontado para refletir a cena remota (AD-010)
- [ ] Uma falha de `catchUp()` ou de `bootstrap()` é capturada, sem propagar para a árvore React
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [ ] Test count: 4 novos casos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): catch up the scene after a presence reconnect`

---

### T14: Proxiar `/ws` no servidor de desenvolvimento do Vite

**What**: Acrescentar o prefixo `/ws` ao proxy do dev server, com upgrade de WebSocket habilitado.
**Where**: `apps/web/vite.config.ts`
**Depends on**: None
**Reuses**: o `API_ROUTE_PREFIXES` já existente no mesmo arquivo
**Requirement**: LIVE-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `/ws` está no conjunto proxiado e a sua entrada carrega `ws: true`
- [ ] Os prefixos existentes continuam com o comportamento atual (sem `ws: true` desnecessário)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: build

**Commit**: `build(web): proxy the websocket route in the dev server`

---

### T15: Marcar a capacidade de presença como entregue

**What**: A entrada "Colaboração em tempo real e presença" deixa de ser `backend-only` e passa a apontar para a superfície de UI.
**Where**: `docs/capability-map.yaml`
**Depends on**: T12
**Reuses**: o formato de entrada já usado pelas outras capacidades com `ui_surface` preenchido
**Requirement**: LIVE-06, LIVE-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `ui_surface` aponta para o arquivo real que expõe a capacidade
- [ ] `status: backend-only` removido dessa entrada
- [ ] Gate check passes: `pnpm --filter @arch-canvas/repo-tools run audit` sai 0
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: build

**Commit**: `docs(capability-map): mark realtime presence as delivered`

---

## Phase Execution Map

Tasks dentro de uma fase executam na ordem do arquivo mesmo onde não há dependência de dado; o
diagrama abaixo mostra só arestas reais de `Depends on`, sem setas fantasma de ordem de leitura.

```
Phase 1:  T1 ------→ T2
          T3
Phase 2:  T4
          T5
          T6
                     T1 ---┐
                     T5 ---┼--→ T7 ------→ T8
                     T6 ---┘     T7 ------→ T9
Phase 3:            T4 ---┐
                     T5 ---┼--→ T10 ------→ T11
                     T3 ---┐
                     T8 ---┼--→ T12 ------→ T13
                     T9 ---┤
                     T10 ---┘
                     T12 ------→ T15
                     T14
```

Em prosa: `T1 → T2`; `T1 → T7`, `T5 → T7`, `T6 → T7`; `T7 → T8`; `T7 → T9`; `T4 → T10`, `T5 → T10`;
`T10 → T11`; `T3 → T12`, `T8 → T12`, `T9 → T12`, `T10 → T12`; `T12 → T13`; `T12 → T15`.
T1, T3, T4, T5, T6 e T14 não têm aresta de entrada.

**Batching for sub-agent delegation** (15 tasks > ~8 → pacotes de fases inteiras): Batch 1 = Phase 1 + Phase 2 (T1-T9, 9 tasks). Batch 2 = Phase 3 (T10-T15, 6 tasks). Nesta execução o mesmo agente roda os dois lotes em sequência.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: schema de payload | 1 schema, 1 arquivo | ✅ Granular |
| T2: relay do ws-gateway | 1 arquivo, 1 conserto coeso | ✅ Granular |
| T3: `applyCollaborators` | 1 método no handle existente | ✅ Granular |
| T4: chaves i18n | 2 arquivos, 1 bloco coeso | ✅ Granular |
| T5: `presenceStore` | 1 store | ✅ Granular |
| T6: `collaboratorColor` | 1 função pura | ✅ Granular |
| T7: `PresenceClient` (conexão/recepção) | 1 classe, 1 responsabilidade | ✅ Granular |
| T8: transmissão local | mesma classe, capacidade distinta | ✅ Granular |
| T9: reconexão | mesma classe, capacidade distinta | ✅ Granular |
| T10: `ConnectionStatus` | 1 componente | ✅ Granular |
| T11: suíte a11y | 1 arquivo de teste | ✅ Granular |
| T12: fiação da página | 1 arquivo, 1 integração coesa | ✅ Granular |
| T13: catch-up na reconexão | mesmo arquivo, capacidade distinta | ✅ Granular |
| T14: proxy do Vite | 1 arquivo de config | ✅ Granular |
| T15: mapa de capacidades | 1 arquivo de docs | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | sem aresta de entrada | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | None | sem aresta de entrada | ✅ Match |
| T4 | None | sem aresta de entrada | ✅ Match |
| T5 | None | sem aresta de entrada | ✅ Match |
| T6 | None | sem aresta de entrada | ✅ Match |
| T7 | T1, T5, T6 | T1 → T7, T5 → T7, T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T7 | T7 → T9 | ✅ Match |
| T10 | T4, T5 | T4 → T10, T5 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T3, T8, T9, T10 | T3 → T12, T8 → T12, T9 → T12, T10 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | None | sem aresta de entrada | ✅ Match |
| T15 | T12 | T12 → T15 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Shared contract schema | unit | unit | ✅ OK |
| T2 | Server route / WS relay | integration | integration | ✅ OK |
| T3 | `editor-adapter` handle | unit | unit | ✅ OK |
| T4 | i18n JSON | none | none | ✅ OK |
| T5 | Store | unit | unit | ✅ OK |
| T6 | Pure utility | unit | unit | ✅ OK |
| T7 | Client transport | unit | unit | ✅ OK |
| T8 | Client transport | unit | unit | ✅ OK |
| T9 | Client transport | unit | unit | ✅ OK |
| T10 | Component | unit (RTL) | unit | ✅ OK |
| T11 | Accessibility | unit (axe) | unit | ✅ OK |
| T12 | Integration wiring | unit (RTL) | unit | ✅ OK |
| T13 | Integration wiring | unit (RTL) | unit | ✅ OK |
| T14 | Build config | none | none | ✅ OK |
| T15 | Docs / capability map | none | none | ✅ OK |
