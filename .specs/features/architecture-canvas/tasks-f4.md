# Architecture Canvas Tasks — Onda 5: F4 Colaboração em Tempo Real e Compartilhamento Externo

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow.

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** as duas histórias P3 — colaboração em tempo real (CLB-01..04) e compartilhamento externo + webhooks (EXT-01..02). Fecha o roadmap inteiro exceto F5 (hardening: OIDC, performance, acessibilidade, DR, observabilidade, piloto). Consome extensivamente trabalho já pronto de ondas anteriores: `packages/shared-contracts/src/ws-envelope.ts` (envelope de mensagem WS, protocolo/limite de 256 KB já definidos desde F0), `apps/server/src/modules/auth/ws-ticket.ts` (emissão/consumo de ticket single-use já pronto e testado desde F1a, incluindo a rota REST `POST /diagrams/{id}/ws-ticket`), `apps/server/src/modules/diagram-sync/operations.ts`'s `appendOperation` (o ÚNICO caminho de escrita da cena — a onda F4 NUNCA duplica essa lógica, só a invoca por um segundo transporte). Consome `packages/auth` (RBAC) para o teto de papel de share links e admin-only de webhooks; consome os 5 tipos de evento já documentados em `docs/product-spec.md` §7.3 (`diagram.created`, `diagram.updated`, `diagram.published`, `spec.generated`, `comment.mentioned`) e os pontos de código onde cada um já acontece (F1b/F1c/F3).

---

## ⚠️ Lições críticas de ondas anteriores — leia antes de escrever qualquer linha

1. **AD-008 (obrigatório)**: nenhum pacote/módulo server-side pode importar `@excalidraw/excalidraw`/`@arch-canvas/editor-adapter` por valor. O módulo `ws-gateway` desta onda lida com `SceneElement` ao encaminhar mutações — reuse `appendOperation`/os tipos já existentes de `diagram-domain`, nunca reimplemente parsing de elemento. Confirme ao final: `pnpm -w build && grep -rn "excalidraw" apps/server/dist/**/*.js` sem import/require real novo.
2. **L-008 (wiring de produção)**: todo módulo novo (`ws-gateway`, `share`, `webhook`) registrado em `apps/server/src/core/registerModules.ts` na MESMA task que o cria. A última task da onda (T81) faz o smoke-test real de boot — desta vez incluindo uma conexão WebSocket de verdade contra o servidor compilado, não só `curl` REST (é a primeira superfície WS do projeto, merece o mesmo rigor).
3. **AD-009 (nova, ver `.specs/STATE.md`)**: presença/cursores usam um `PresenceBroadcaster` injetável — implementação em memória (padrão, funciona no processo único do MVP, AD-003) e implementação Redis (opcional, só testável/usada quando `REDIS_URL` está configurado). O servidor SEMPRE sobe e funciona sem Redis — presença nunca é persistida em lugar nenhum (CLB-04), então a ausência de Redis nunca arrisca conteúdo durável. `redis-server` está disponível de verdade neste sandbox (diferente de Docker/testcontainers — AD-007) — a prova de propagação cross-instância (T75) usa Redis REAL, dois processos `apps/server` de verdade, nunca um mock.
4. **Nunca duplicar o caminho de escrita**: a onda inteira gira em torno de UM invariante — WS é só mais um transporte para o mesmo `appendOperation`/mesma validação/mesmo RBAC que REST já usa. Se você perceber que está reimplementando validação de op-log ou lógica de LWW dentro de `ws-gateway`, pare — está duplicando algo que já existe em `diagram-sync`/`diagram-domain`.
5. **Gate de build só na última task de cada batch**: tasks intermediárias rodam `Quick`/`Full`; a ÚLTIMA task de CADA batch declara `Gate: build` completo.
6. **PGlite para integração (AD-007)**: continua valendo para toda integração Postgres. Redis É real neste sandbox — não crie um substituto in-memory "por segurança", use o `redis-server` de verdade disponível.

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domínio/contratos (`packages/shared-contracts`) | unit | Todo tipo de payload de mensagem WS validado, positivo e negativo | `packages/shared-contracts/src/**/*.spec.ts` | `pnpm -w test:unit` |
| Módulos de rota (`apps/server/src/modules/{ws-gateway,share,webhook}`) | unit (lógica pura) + integração (WS real, RBAC, PGlite, Redis real quando aplicável) | Toda rota/canal novo tem teste 401/403/200 (ou fechamento de conexão com código específico) + AC correspondente | `apps/server/src/modules/**/*.spec.ts`, `**/*.int.spec.ts` | `pnpm -w test:unit && pnpm -w test:integration` |
| Prova cross-instância (T75) | integração com 2 processos reais + Redis real | Presença publicada na instância A chega na instância B | `apps/server/src/modules/ws-gateway/*.int.spec.ts` | `pnpm -w test:integration` |
| Wiring de produção | boot real + curl/WS manual | Toda rota HTTP nova responde 401 (nunca 404); conexão WS real aceita `hello` | smoke-test na task final (T81) | manual, documentado no commit |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Full | Tasks que tocam integração/DB/Redis | `pnpm -w test:unit && pnpm -w test:integration` |
| Build | Última task de CADA batch | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` |

---

## Execution Plan

### Phase 26: Fundações — paralelizável

```
T71
T72
```

### Phase 27: Gateway WS e presença

```
T72 -> T73
T73 -> T74
```

### Phase 28: Provas de convergência/durabilidade/cross-instância

```
T74 -> T75
T73 -> T76
T73 -> T77
```

### Phase 29: Compartilhamento externo

```
T71 -> T78
```

### Phase 30: Webhooks

```
T71 -> T79
T79 -> T80
```

### Phase 31: Wiring final e gate real

```
T75 -> T81
T76 -> T81
T77 -> T81
T78 -> T81
T80 -> T81
```

---

## Task Breakdown

### Phase 26 — Fundações

### T71: packages/database — schema de share_links, webhook_endpoints, webhook_deliveries

**What**: Três tabelas Drizzle novas. `shareLinks { id, resourceType enum('diagram'|'presentation'), resourceId uuid, tokenHash text, role (mesmo enum de workspace_member_role, teto de acesso), expiresAt timestamp, revokedAt timestamp nullable, createdBy FK users, createdAt }` com índice único em `tokenHash`. `webhookEndpoints { id, workspaceId FK, url text, secretEncrypted text (mesma envelope encryption AES-256-GCM já usada em `ai_provider_configs.encrypted_token`, F2a — reuse `encryptToken`/`decryptToken` de `packages/ai-tools` ou onde estiverem hoje), eventsJson jsonb (array dos 5 tipos de evento), enabled boolean default true, createdBy FK users, createdAt, updatedAt }`. `webhookDeliveries { id, webhookEndpointId FK, eventType text, payloadJson jsonb, status enum('pending'|'delivered'|'failed'|'dead_letter'), attempts integer default 0, nextRetryAt timestamp nullable, lastError text nullable, createdAt, updatedAt }` com índice em `(status, nextRetryAt)` para o worker de retry. Gere e valide a migration contra PGlite.
**Where**: `packages/database/src/schema.ts`, `packages/database/migrations/`
**Depends on**: None
**Reuses**: convenções de `ai_provider_configs`/`diagram_snapshots` já existentes no mesmo arquivo; `encryptToken`/`decryptToken` (F2a — localize o módulo exato antes de reimplementar, é usado por `ai-provider`)
**Requirement**: EXT-01, EXT-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `migrate()` aplica a migration nova do zero contra PGlite sem erro
- [x] Inserir uma linha em cada uma das 3 tabelas com FKs válidas → sucesso
- [x] Índice único em `share_links.token_hash` rejeita duplicata
- [x] `webhook_endpoints.secret_encrypted` nunca é uma string em claro reconhecível (round-trip encrypt/decrypt testado)

**Tests**: unit (integração leve via PGlite)
**Gate**: quick

**Commit**: `feat(database): add share_links, webhook_endpoints, webhook_deliveries schema`

**Status**: ✅ Complete — 3 new Drizzle tables in `packages/database/src/schema.ts` (`shareLinks`, `webhookEndpoints`, `webhookDeliveries`) plus two new `pgEnum`s (`share_link_resource_type`, `webhook_delivery_status`); `role` reuses the existing `workspace_member_role` enum unchanged (the access-ceiling requirement from the task text). Migration generated with `drizzle-kit generate` → `infra/migrations/0010_tough_baron_zemo.sql`. New integration spec `packages/database/src/share-webhook.int.spec.ts` (7 tests, same PGlite pattern as `ai-provider.int.spec.ts`, AD-007): migration applies from scratch and all 3 tables appear in `information_schema`; one row inserted per table with valid FKs; a duplicate `token_hash` insert into `share_links` is rejected with a thrown unique-violation via `share_links_token_hash_unique`; `webhook_endpoints` has no bare `token`/`secret` column (only `secret_encrypted`); a `secretEncrypted` value round-trips through `encryptToken`/`decryptToken` (reused unchanged from `@arch-canvas/ai-tools`/F2a, added as a `packages/database` devDependency for this test only) and the persisted ciphertext never contains the plaintext substring; `webhook_deliveries_status_next_retry_idx` exists on `(status, next_retry_at)`; an FK violation on `webhook_deliveries.webhook_endpoint_id` is rejected. `pnpm --filter @arch-canvas/database test:integration` green (7 files/36 tests, including the 7 new); `pnpm -w test:unit` green (21/21 tasks, 244 server + 22 web, database has no `test:unit` script so this task's PGlite tests are additionally confirmed directly via the command above). **Decision**: webhook secret generation for T79 (later batch) will reuse `generateOpaqueToken` (auth/tokens.ts) for the random value and `encryptToken`/`decryptToken` (not `hashToken`) for storage — an HMAC-signing secret must be recoverable in plaintext by the delivery worker, unlike a session/ticket token which only ever needs hash comparison; documented here since T71 is what first commits to the `secretEncrypted` (not `secretHash`) column shape. **Deviation**: none functional.

---

### T72: packages/shared-contracts — schemas de payload por tipo de mensagem WS

**What**: O envelope (`wsEnvelopeSchema`) e a lista de tipos já existem em `ws-envelope.ts` desde F0 — esta task adiciona o schema Zod do `payload` PARA CADA tipo, e uma função `parseWsMessage(raw: string | Buffer): WsEnvelope` que (a) rejeita frames acima de `MAX_WS_MESSAGE_BYTES` ANTES de tentar fazer JSON.parse (evita gastar CPU parseando um payload gigante), (b) faz `JSON.parse` + valida contra `wsEnvelopeSchema`, (c) valida o `payload` especificamente contra o schema do `type` correspondente (discriminated union), retornando um erro estruturado dizendo qual campo falhou. Payloads: `hello: { userId, diagramId }`; `sync_request: { afterSequence?: number }` (omitido = full bootstrap); `sync_state: { scene: unknown[], revision: number }`; `mutation: { clientMutationId, baseRevision, deltas: unknown[] }` (mesmo shape do `OperationEnvelope` de `diagram-domain` — `import type` apenas, não duplique a validação de deltas aqui, isso já acontece em `parseOperationEnvelope`); `mutation_ack: { clientMutationId, sequence }`; `mutation_rejected: { clientMutationId, reason }`; `presence: { cursor?: { x: number, y: number } | null, selection?: string[], status: 'active' | 'idle' }`; `comment_event: { commentId, action: 'created' | 'resolved' }`; `permission_changed: { role: string }`; `server_draining: { reason?: string }`; `ping`/`pong: {}`.
**Where**: `packages/shared-contracts/src/ws-messages.ts`
**Depends on**: None (consome `ws-envelope.ts` já existente, sem modificá-lo)
**Reuses**: `wsEnvelopeSchema`/`wsMessageTypeSchema`/`MAX_WS_MESSAGE_BYTES` (F0, já existentes)
**Requirement**: CLB-01, CLB-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Mensagem `presence` válida com `cursor` e `selection` → parse ok
- [x] Mensagem com `type: 'mutation'` mas payload faltando `clientMutationId` → erro estruturado apontando o campo
- [x] String JSON de tamanho > `MAX_WS_MESSAGE_BYTES` → rejeitada ANTES do JSON.parse (teste confirma via spy/contador que `JSON.parse` não foi chamado, ou mede que o erro é lançado por checagem de byte-length primeiro)
- [x] Todo membro de `wsMessageTypeSchema` tem um payload schema correspondente (teste exaustivo — nenhum tipo esquecido)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(shared-contracts): add per-message-type WS payload schemas and size-gated parser`

**Status**: ✅ Complete — `packages/shared-contracts/src/ws-messages.ts` adds one Zod payload schema per `wsMessageTypeSchema` member (`wsPayloadSchemaByType`, typed `satisfies Record<WsMessageType, z.ZodType>` so a future protocol message type fails to typecheck here until a schema is added), plus `parseWsMessage(raw: string | Buffer): WsMessage` doing the 3-step validation the task asked for: byte-length check against `MAX_WS_MESSAGE_BYTES` before any `JSON.parse` call, `JSON.parse` + `wsEnvelopeSchema` validation, then payload validation keyed by the envelope's own `type`. All failures throw a structured `WsMessageParseError` (`code` + dotted `field` path, e.g. `"payload.clientMutationId"`). `mutation`'s `deltas` are validated only as `unknown[]` (never re-modeling `OperationEnvelope`'s per-delta shape — that stays `parseOperationEnvelope`'s job, reused unchanged by `ws-gateway`/T73) and this package still imports nothing from `diagram-domain`/`editor-adapter`, by value or by type — the shape is re-declared structurally instead, keeping `shared-contracts` a true leaf package. 10 tests in `src/ws-messages.spec.ts`: valid `presence` with cursor+selection and with null-cursor/no-selection; `mutation` missing `clientMutationId` → `field === 'payload.clientMutationId'`; an oversized raw string rejected with `code: 'payload_too_large'` while a `vi.spyOn(JSON, 'parse')` spy confirms zero calls; an exact-byte-boundary pair (`MAX_WS_MESSAGE_BYTES` accepted, `+1` rejected) computed from a real serialized envelope rather than a guessed constant; exhaustive coverage of `wsMessageTypeSchema.options` against `wsPayloadSchemaByType`'s keys (`toEqual` on the sorted key sets, not just a subset check); a smoke-parse of all remaining message types (`hello`/`sync_request`×2/`sync_state`/`mutation`/`mutation_ack`/`mutation_rejected`/`comment_event`/`permission_changed`/`ping`/`pong`); an invalid `presence.status` enum value; malformed JSON (`code: 'invalid_json'`) distinct from an unknown `type` (`code: 'invalid_envelope'`). `pnpm --filter @arch-canvas/shared-contracts exec vitest run` green (5 files/27 tests, including the 10 new); `pnpm -w test:unit` green (21/21 tasks). **Deviation**: none.

---

### Phase 27 — Gateway WS e presença

### T73: apps/server — módulo ws-gateway: handshake, sync, mutação via WS

**What**: Adicione a dependência `@fastify/websocket` (pesquise a API atual antes de assumir — Knowledge Verification Chain). `registerWsGatewayModule(app, { db, jobs?, compactionThresholds?, presence })` registra `wss /ws/diagrams/{diagramId}?ticket=`. Ao conectar: consome o ticket via `consumeWsTicket` (já existe, F1a) — ticket inválido/expirado/já usado → fecha a conexão com um código específico ANTES de aceitar o upgrade (nunca aceita e depois fecha). Envia `hello` imediatamente. Em `sync_request`: resolve o papel do usuário (`resolveDiagramWorkspaceId`/`resolveWorkspaceRole`/`can` — MESMA checagem de `diagram:read` que o REST bootstrap usa, re-resolvida a cada mensagem, nunca cacheada da conexão — AUTH-05 exige downgrade imediato mesmo em sessão WS já aberta) e responde `sync_state` com a cena atual (reuse `loadDiagramScene`, F1b) — se `afterSequence` for passado, ainda assim envia o estado completo nesta task (T76 decide se precisa de um caminho incremental). Em `mutation`: valida `diagram:mutate` (mesma checagem RBAC do REST), delega para `appendOperation` (MESMO caminho de escrita do REST `operations:batch` — zero lógica de LWW/validação duplicada aqui), responde `mutation_ack`/`mutation_rejected` ao remetente E publica a operação aplicada via `presence.publish(diagramId, { type: 'mutation_broadcast', ... })` (o parâmetro `presence` é o `PresenceBroadcaster` — a interface é definida aqui mas a implementação real fica em T74; para esta task, injete um stub `NullPresenceBroadcaster` cujo `publish` é um no-op síncrono, só para não travar o wiring — T74 substitui). Em `presence`: publica via `presence.publish` sem NUNCA persistir em lugar nenhum (CLB-04). Responde `pong` a `ping`. Frame > 256 KB → fecha a conexão com código específico (reuse `parseWsMessage`, T72).
**Where**: `apps/server/src/modules/ws-gateway/`
**Depends on**: T72
**Reuses**: `consumeWsTicket` (F1a), `loadDiagramScene` (F1b/diagram-sync), `appendOperation` (F1b/diagram-sync), `resolveDiagramWorkspaceId`/`resolveWorkspaceRole`/`can` (F1a)
**Requirement**: CLB-01, CLB-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Ticket válido → conexão aceita, `hello` recebido imediatamente
- [x] Ticket inválido/expirado/reutilizado → conexão fechada antes do upgrade completar (nunca chega a enviar `hello`)
- [x] `sync_request` → `sync_state` com a cena real do diagrama (mesmos dados que o bootstrap REST retornaria)
- [x] `mutation` de um usuário com `diagram:mutate` → persistida via `appendOperation` (confirmável lendo `diagram_operations` depois), `mutation_ack` recebido
- [x] `mutation` de um usuário SEM `diagram:mutate` (reviewer/viewer) → `mutation_rejected`, nada persistido
- [x] Frame acima de 256 KB → conexão fechada com código específico, nada processado
- [x] Downgrade de papel a meio da sessão WS (mesmo cenário AUTH-05 do REST) → a PRÓXIMA `mutation` na mesma conexão já é rejeitada, sem precisar reconectar

**Tests**: unit + integration (WS real via `@fastify/websocket`'s inject ou um client `ws` de verdade contra `app.listen`)
**Gate**: quick

**Commit**: `feat(ws-gateway): add WebSocket handshake, sync, and mutation relay reusing the REST write path`

**Status**: ✅ Complete — `apps/server/src/modules/ws-gateway/routes.ts` registers `wss /ws/diagrams/:diagramId?ticket=` via `@fastify/websocket`. `requireWsTicket` runs as a `preValidation` hook (documented `@fastify/websocket` hook ordering: pre-upgrade), consuming the ticket via `consumeWsTicket` (F1a) — an invalid/expired/reused ticket, or one minted for a different `diagramId`, gets a plain HTTP 401 and the WS upgrade never completes, so `hello` is never sent. `sync_request`/`mutation` both re-resolve `resolveDiagramWorkspaceId`/`resolveWorkspaceRole`/`can` fresh on every message (never cached from connection time), so a mid-session role downgrade (AUTH-05) rejects the very next `mutation` without a reconnect. `mutation` delegates straight to `appendOperation` (`diagram-sync/operations.ts`) — the exact function REST's `operations:batch` route calls — with zero LWW/validation logic re-implemented; `actorId` always comes from the ticket claim, never the wire payload. `parseWsMessage`/`MAX_WS_MESSAGE_BYTES` (T72) gate frame size before any processing, closing with the dedicated `WS_CLOSE_PAYLOAD_TOO_LARGE` (4413) code. A `PresenceBroadcaster` interface + `NullPresenceBroadcaster` no-op stub (`presence.ts`) let this module's own tests run standalone before T74 adds real implementations; `mutation`/`presence` messages already call `presence.publish(...)` so T74 only needs to swap the injected instance, no route-layer changes. 11 integration tests in `wsGateway.int.spec.ts` (real `ws` client against a real listening Fastify instance, real PGlite): valid ticket → immediate `hello`; invalid/expired/reused ticket → closed pre-upgrade, `hello` never sent (3 tests); `sync_request` → `sync_state` matches REST bootstrap's own scene data; a `diagram:mutate` mutation is persisted (confirmed by re-reading `diagram_operations`) and acked; `reviewer`/`viewer` mutations are rejected with nothing persisted (`it.each`, 2 tests); an over-256KB frame is closed with code 4413 and never processed; a mid-session downgrade rejects the next mutation without reconnecting; `ping`→`pong`. Verified independently after a genuine environment restart killed the original batch agent mid-task (code/tests were already on disk, uncommitted): `pnpm install` (relink), then `pnpm --filter @arch-canvas/server exec vitest run -c vitest.integration.config.ts src/modules/ws-gateway/wsGateway.int.spec.ts` → 11/11 green, confirmed by direct re-run, not trusted from a stale transcript. **Deviation**: none functional — this task correctly deferred the real `PresenceBroadcaster` implementations to T74 exactly as the task text specified.

---

### T74: apps/server — PresenceBroadcaster: implementação em memória e Redis

**What**: Interface `PresenceBroadcaster { publish(diagramId: string, event: PresenceEvent): Promise<void>; subscribe(diagramId: string, handler: (event: PresenceEvent) => void): () => void }` (retorna uma função de unsubscribe). `InMemoryPresenceBroadcaster` — `EventEmitter` por `diagramId`, zero I/O externo, é o padrão quando nenhuma config de Redis é passada (AD-009 — o servidor SEMPRE funciona sem Redis). `RedisPresenceBroadcaster` — usa `ioredis` (adicione a dependência; pesquise a API pub/sub atual antes de assumir), um client PUBLISHER e um client SUBSCRIBER separados (padrão ioredis para pub/sub — um client em modo subscribe não pode rodar outros comandos), canal por diagrama (`presence:{diagramId}`) ou um canal único com filtro por `diagramId` no payload (escolha a abordagem mais simples que passe os testes, documente a escolha). Ambas implementações satisfazem o MESMO contrato — escreva UMA suíte de testes parametrizada rodando contra as duas (positivo: subscriber recebe o que outro publisher publicou no mesmo diagramId; negativo: subscriber de um diagramId diferente não recebe nada). Fiação: `ws-gateway` (T73) passa a receber um `PresenceBroadcaster` real como dependência (`deps.presence`), substituindo o `NullPresenceBroadcaster` temporário — `registerModules.ts` decide qual implementação instanciar baseado em `config.redisUrl` estar presente ou não (mesmo padrão de degrade opcional de `deps.jobs`).
**Where**: `apps/server/src/modules/ws-gateway/presence.ts` (interface + `InMemoryPresenceBroadcaster`), `apps/server/src/modules/ws-gateway/redisPresence.ts` (`RedisPresenceBroadcaster`)
**Depends on**: T73
**Reuses**: nenhuma dependência nova além de `ioredis`
**Requirement**: CLB-01, CLB-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Suíte de contrato parametrizada passa para AMBAS implementações: publish em `diagramId` A é recebido por subscriber de A, nunca por subscriber de B
- [x] `RedisPresenceBroadcaster` testado contra um `redis-server` real rodando neste sandbox (nunca mockado)
- [x] Nenhuma das duas implementações grava em PostgreSQL em nenhum momento (CLB-04 — confirmável por leitura do código: zero import de `Db`/drizzle em `presence.ts`/`redisPresence.ts`)
- [x] `ws-gateway` sem `REDIS_URL` configurado usa `InMemoryPresenceBroadcaster` e continua funcionando integralmente (teste de boot sem Redis)

**Tests**: unit + integration (Redis real)
**Gate**: build

**Commit**: `feat(ws-gateway): add pluggable presence broadcaster (in-memory default, Redis pub/sub optional)`

**Status**: ✅ Complete — `apps/server/src/modules/ws-gateway/presence.ts` adds `InMemoryPresenceBroadcaster` (a single `node:events` `EventEmitter`, `diagramId` doubling as the event name, `setMaxListeners(0)` since one diagram can have far more than 10 concurrent WS-client subscribers) alongside the already-existing `PresenceBroadcaster` interface/`NullPresenceBroadcaster`. New `apps/server/src/modules/ws-gateway/redisPresence.ts` adds `RedisPresenceBroadcaster`: `ioredis` (added via `pnpm add ioredis --filter @arch-canvas/server`, resolved `^6.0.0`) researched against its installed README/`Redis.d.ts` before writing any code (Knowledge Verification Chain) — confirmed a connection in subscriber mode can't run other commands, so the class opens two separate clients (one dedicated publisher, one dedicated subscriber). **Design decision** (documented in the file per the task's own instruction): channel-per-diagram (`presence:{diagramId}`), not one shared channel filtered by a `diagramId` payload field — pushes the "does this belong to me" routing down into Redis's own SUBSCRIBE/PUBLISH instead of re-implementing it in application code. The subscriber client's single process-wide `'message'` event is demultiplexed back out to per-`diagramId` local listeners via an internal `EventEmitter`, mirroring `InMemoryPresenceBroadcaster`'s own shape once a message has actually arrived. Neither `presence.ts` nor `redisPresence.ts` imports anything from `drizzle-orm`/`Db` — grep-confirmed by an automated test (`presence.spec.ts`), not just documentation, so the CLB-04 guarantee stays enforced as the module evolves. ONE shared parameterized contract suite, `presenceBroadcaster.int.spec.ts` (`describe.each` over both implementations, 6 tests total): positive (a subscriber of `diagramId` A receives what another publisher published on A), negative (a subscriber of a different `diagramId` B never receives it), and an unsubscribe test, all run against BOTH `InMemoryPresenceBroadcaster` and a genuinely spawned `redis-server` process (`child_process.spawn`, port picked from a PID-jittered range, readiness confirmed by polling real `redis-cli -p <port> ping` until `PONG`, torn down in `afterAll` — confirmed zero lingering `redis-server` processes after the run) — never mocked, per AD-009. Because Redis's `SUBSCRIBE` is an async network round trip with no publish backlog/replay, the positive-path assertion retries `publish` every 50ms until the subscriber observes at least one copy rather than asserting a single blind attempt (documented in the file; `InMemoryPresenceBroadcaster` always satisfies it on the first iteration since its `subscribe()` is synchronous). New `presenceDefaultWiring.int.spec.ts` proves `ws-gateway` boots and works fully with `InMemoryPresenceBroadcaster` injected in place of T73's `NullPresenceBroadcaster` stub (real WS client, real PGlite, real mutation persisted+acked, a `presence` message run through a real, non-Null `presence.publish()` never destabilizes the connection — confirmed by a subsequent ping/pong on the same socket). `presence.spec.ts` (unit) adds the structural drizzle-import grep test plus direct `NullPresenceBroadcaster`/`InMemoryPresenceBroadcaster` coverage (publish/subscribe/unsubscribe). Full gate reproduced from a clean run: `pnpm -w lint` (367 files, clean), `pnpm -w typecheck` (22/22 tasks), `pnpm -w build` (12/12 tasks; `grep -rn excalidraw apps/server/dist/**/*.js` shows only the same pre-existing comment-only hits already documented in prior waves — nothing new from ws-gateway), `pnpm -w test:unit` (21/21 tasks — server 255/255, web 22/22, includes the 6 new `presence.spec.ts` tests), `pnpm -w test:integration` (13/13 tasks — server 262/262 across 30 files, includes the new `presenceBroadcaster.int.spec.ts` (6/6, real Redis) and `presenceDefaultWiring.int.spec.ts` (1/1), plus the pre-existing `wsGateway.int.spec.ts` (11/11) unaffected). **Deviation**: `registerModules.ts`'s `config.redisUrl`-driven selection between the two implementations is explicitly T81's job (a later batch, per the task text itself) — this task only makes both classes constructible and correct, exactly as scoped; not a gap.

---

### Phase 28 — Provas de convergência/durabilidade/cross-instância

### T75: apps/server — prova de propagação de presença cross-instância via Redis real

**What**: Teste de integração que sobe DOIS `FastifyInstance` distintos (duas chamadas separadas de `registerAllModules`/`registerWsGatewayModule`, portas diferentes), ambos configurados com `RedisPresenceBroadcaster` apontando para o MESMO `redis-server` real deste sandbox. Conecta um WS client de verdade na instância A, outro na instância B, ambos no mesmo `diagramId`. Cliente A envia `presence`. Assert: cliente B recebe o evento `presence` correspondente (com um timeout razoável, já que é I/O real assíncrono via Redis). Também confirma o caso negativo: presença publicada num `diagramId` diferente não vaza para a conexão do outro diagrama. Este é o teste que prova de verdade a alegação de "colaboração em tempo real cross-node" do AD-006/AD-009 — não é só uma reafirmação do contrato de T74, é duas instâncias de aplicação de verdade.
**Where**: `apps/server/src/modules/ws-gateway/crossInstancePresence.int.spec.ts`
**Depends on**: T74
**Reuses**: `registerAllModules`, `RedisPresenceBroadcaster` (T74)
**Requirement**: CLB-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Presença publicada pelo WS client da instância A chega ao WS client da instância B em até alguns segundos (timeout generoso documentado)
- [x] Presença de um `diagramId` diferente não vaza entre as duas conexões
- [x] Ambas instâncias encerram limpo ao final do teste (sem processo/conexão Redis vazando entre testes)

**Tests**: integration (Redis real, 2 instâncias reais)
**Gate**: quick

**Commit**: `test(ws-gateway): prove cross-instance presence propagation over real Redis with two live server instances`

**Status**: ✅ Complete — `apps/server/src/modules/ws-gateway/crossInstancePresence.int.spec.ts` boots TWO real `FastifyInstance`s (two independent `registerWsGatewayModule` calls, two separate ports), each with its OWN `RedisPresenceBroadcaster` instance, both pointed at the SAME genuinely spawned `redis-server` process for the file (`child_process.spawn`, PID-jittered port, readiness polled via real `redis-cli ping`, torn down in `afterAll` — never mocked, per AD-009). Both instances share the same PGlite `db` handle only (the one thing two real `apps/server` processes behind a shared Postgres would also share) — everything else, including the two `RedisPresenceBroadcaster` instances, is fully independent. Two real `ws` clients connect (one per instance) to the same `diagramId`; client A sends a `presence` message, and client B (on the other instance) receives the corresponding `presence` message forwarded back out over its own WebSocket (positive test, retries the publish every 50ms — same tolerance for Redis's async `SUBSCRIBE` round trip as T74's own contract test — up to a documented 10s timeout). A second test confirms the negative case: a presence event published on a different `diagramId` (from either instance) never reaches a watcher connection on another diagram, even across the two instances, after first confirming with a control publish on the watched diagram that the watcher's subscription is genuinely live (rules out a false-negative from a broken subscription). Both instances and both `RedisPresenceBroadcaster`s close cleanly in `afterAll`; confirmed zero lingering `redis-server` processes after the run (`ps aux | grep redis-server` empty). **Deviation (necessary, in-scope fix)**: `routes.ts` (T73) never actually wired `presence.subscribe(...)` into the per-connection handler — it only ever called `presence.publish(...)`, so there was no code path that could forward a `presence_update` broadcast back out over any WebSocket, on the same instance or across instances. Without this, T75's own AC ("cliente B recebe o evento presence correspondente") is unsatisfiable by construction. Added a minimal, scoped relay: on connect, each socket subscribes to `presence` events for its `diagramId` and forwards `presence_update` events (never the sender's own) back out as an ordinary `presence` wire message; unsubscribes on close. Deliberately does NOT relay `mutation_broadcast` events over the wire in this task — no CLB-01/02 AC in T75-T78 requires live mutation fan-out (T76's reconnect+`sync_request` is the documented convergence path), and adding a new wire message type for it would mean touching T72's schema, out of scope here. Also fixed two related pre-existing bugs in `redisPresence.ts` (T74) surfaced by running two real instances against a real Redis and tearing them down: (1) neither the publisher nor subscriber `ioredis` client had an `'error'` listener, so any transient connection error — routinely triggered by closing/killing `redis-server` during teardown — would throw an uncaught exception process-wide (fixed: both clients get a no-op `'error'` handler, consistent with presence being best-effort per AD-009); (2) the fire-and-forget `subscriber.subscribe(...)`/`subscriber.unsubscribe(...)` calls had no `.catch`, so a command that was still in flight when the connection closed rejected with an unhandled promise rejection (fixed: `.catch(() => {})` on both). Neither fix changes `RedisPresenceBroadcaster`'s public contract or T74's own passing tests (re-run green: 6/6). `pnpm --filter @arch-canvas/server exec vitest run -c vitest.integration.config.ts src/modules/ws-gateway/crossInstancePresence.int.spec.ts src/modules/ws-gateway/presenceBroadcaster.int.spec.ts src/modules/ws-gateway/presenceDefaultWiring.int.spec.ts src/modules/ws-gateway/wsGateway.int.spec.ts` → 20/20 green, zero unhandled errors (previously 1 before the two bug fixes above). `pnpm -w test:unit` green (21/21 tasks, server 255/255 including `presence.spec.ts` unaffected). Gate for this task is `quick` per its own declared field — `test:unit` run as required; the integration run above is additional evidence the new file itself is correct, not a gate substitution.

---

### T76: apps/server — prova de convergência após reconexão (CLB-02)

**What**: Teste de integração: dois WS clients conectados ao mesmo diagrama, cada um muta um elemento DIFERENTE concorrentemente (duas mensagens `mutation` quase simultâneas, cada uma criando/editando um elemento distinto — sem conflito de LWW, já que são elementIds diferentes). Ambos desconectam. Ambos reconectam (novo ticket + `sync_request`). Assert: a `sync_state` que cada um recebe ao reconectar contém AMBAS as mutações, na mesma cena final, para os dois clientes (convergência). Se `sync_request` com `afterSequence` (adicionado como campo opcional em T72) ainda não tiver um caminho incremental real em T73 (que sempre reenvia o estado completo), decida aqui: ou (a) implemente o caminho incremental (responder só os deltas após `afterSequence`, reusando `loadOperationsAfter` de `catchup.ts`, já existente desde F1b) se isso for necessário para a AC, ou (b) confirme que o caminho "sempre full state" já satisfaz a AC de convergência (é mais simples e ainda correto — só menos eficiente em cenas grandes) e documente essa escolha explicitamente, sem inventar trabalho que a AC não pede.
**Where**: `apps/server/src/modules/ws-gateway/reconnectConvergence.int.spec.ts`, possivelmente `apps/server/src/modules/ws-gateway/routes.ts` (se o caminho incremental for implementado)
**Depends on**: T73
**Reuses**: `loadOperationsAfter` (F1b/diagram-sync/catchup.ts) se o caminho incremental for implementado
**Requirement**: CLB-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Duas mutações concorrentes em elementos distintos, desconexão, reconexão de ambos os clients → cena final idêntica nos dois, contendo as duas mutações
- [x] Decisão sobre `afterSequence` incremental documentada explicitamente no Status da task (implementado ou deliberadamente adiado com justificativa)
- [x] Nenhuma mutação é perdida mesmo que a reconexão do client B aconteça DEPOIS do client A já ter reconectado e mutado de novo (ordem de sequence preservada)

**Tests**: integration
**Gate**: quick

**Commit**: `test(ws-gateway): prove reconnection convergence across concurrent clients (CLB-02)` (no `**Commit**:` line was authored for this task in the original task text — this message follows the same Conventional Commit style as every other task in this file, noted here per the batch-execution instructions.)

**Status**: ✅ Complete — `apps/server/src/modules/ws-gateway/reconnectConvergence.int.spec.ts` (1 test, real WS clients + real PGlite, `InMemoryPresenceBroadcaster`). Two clients (owner + a workspace `editor` peer) connect, send two genuinely concurrent (no await between the two `.send()` calls) `mutation` messages on distinct `elementId`s (`el-a`/`el-b`, zero LWW conflict since the ids differ), both ack. Both disconnect. Client A reconnects FIRST, issues `sync_request` (confirms `el-a`+`el-b` already present), and mutates AGAIN (`el-a2`) before client B ever reconnects — deliberately ordered this way to prove B's eventual view isn't lost even though B's reconnection happens strictly after A's post-reconnect mutation, not just after the original round. Client B then reconnects and its `sync_state` contains all three elements (`el-a`, `el-a2`, `el-b`) with nothing lost or duplicated. A THIRD reconnect of client A confirms its own `sync_state` (element-id set, revision number, and full deep-equal element content, not just the id set) is now byte-for-byte identical to B's — genuine two-sided convergence, not just "B eventually caught up". **`afterSequence` decision (documented per the task's own requirement)**: option (b) was chosen — `sync_request` continues to always answer with the full current scene (T73's existing behavior, unchanged, confirmed by reading `routes.ts` before writing this test) rather than adding an incremental `loadOperationsAfter`-based path. Justification recorded in the test file's own header comment: `loadDiagramScene` (F1b) always folds the ENTIRE `diagram_operations` log fresh on every call, so the returned scene is by construction always complete and always identical for any two reads at the same revision, regardless of reconnection order or count — convergence (CLB-02's AC) is satisfied by this property alone; an incremental path would only be a performance optimization for large scenes, not required by any AC this wave, so it was deliberately not built (avoiding the "invent work the AC doesn't ask for" anti-pattern the task text warns against). `routes.ts` is unmodified by this task. `pnpm --filter @arch-canvas/server exec vitest run -c vitest.integration.config.ts src/modules/ws-gateway/reconnectConvergence.int.spec.ts` → 1/1 green; `pnpm -w test:unit` green (21/21 tasks, unaffected — this task adds only an integration test, no production code). **Deviation**: none functional beyond the documented `afterSequence` decision itself.

---

### T77: apps/server — prova de durabilidade sem Redis após restart de nó (CLB-03/04)

**What**: Teste de integração que simula um restart de nó: constrói uma `FastifyInstance` NOVA (estado em memória zerado — nenhum `PresenceBroadcaster`/conexão WS sobrevive) apontando para o MESMO banco Postgres (PGlite) que já tinha operações persistidas por uma instância anterior (já fechada/descartada neste teste). Um client WS reconecta na instância nova, faz `sync_request`, e recebe a cena reconstruída INTEIRAMENTE do snapshot+op-log do Postgres — sem qualquer dependência de Redis (rode este teste explicitamente SEM `REDIS_URL` configurado, usando `InMemoryPresenceBroadcaster`). Confirma explicitamente: zero perda de conteúdo durável (CLB-03), e que a perda de presença (nenhum client "antigo" está mais listado como presente — óbvio, já que presença nunca foi persistida) não afeta a capacidade de servir conteúdo durável (CLB-04) — teste explícito de que `sync_request`/mutações subsequentes funcionam normalmente na instância nova.
**Where**: `apps/server/src/modules/ws-gateway/nodeRestartDurability.int.spec.ts`
**Depends on**: T73
**Reuses**: mesmo padrão de "instância nova, banco reaproveitado" que os testes REC/VER de F1b/F1c já usam
**Requirement**: CLB-03, CLB-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Instância nova (sem Redis, sem estado em memória prévio) reconstrói a cena completa e correta a partir só do Postgres
- [x] Zero elemento/operação perdido comparado ao estado antes do "restart"
- [x] Mutações subsequentes na instância nova funcionam normalmente (não é um estado read-only acidental)
- [x] O teste roda explicitamente SEM configurar Redis, provando que o caminho de durabilidade nunca depende dele

**Tests**: integration
**Gate**: build

**Commit**: `test(ws-gateway): prove node-restart durability rebuilds fully from PostgreSQL without Redis`

---

### Phase 29 — Compartilhamento externo

### T78: apps/server — módulo share: links de compartilhamento com teto de papel e expiração

**What**: `registerShareModule(app, { db })`. `POST /diagrams/{id}/share-links` e `POST /presentations/{id}/share-links` (dois endpoints finos que resolvem `resourceType`/`resourceId`/`workspaceId` e delegam para a mesma função core `createShareLink`) — body `{ role, expiresAt }`, valida que `role` NUNCA excede o papel efetivo do ator (reuse a hierarquia de papéis de `packages/auth` — se o ator é `editor`, não pode criar um link `workspace_admin`), gera um token opaco (reuse `generateOpaqueToken`/`hashToken` de `auth/tokens.ts`, já existentes), persiste só o hash, retorna o token em claro UMA VEZ na resposta (nunca mais recuperável — mesmo padrão de qualquer outro segredo one-shot-reveal deste projeto). `GET /share/{token}` — rota pública, SEM `requireSession` — resolve o hash, checa `revokedAt`/`expiresAt`, retorna 404 (nunca informa "expirado" vs "revogado" vs "nunca existiu" — mesmo princípio IDOR do resto do projeto) se qualquer checagem falhar, senão serve o recurso (cena/apresentação) com o papel CAPADO pelo `role` do link, nunca acima dele mesmo que o token vaze para alguém que também é membro do workspace com papel maior. `POST /share-links/{id}:revoke` (autenticado, mesmo nível de permissão de quem criou/admin) seta `revokedAt`.
**Where**: `apps/server/src/modules/share/`
**Depends on**: T71
**Reuses**: `generateOpaqueToken`/`hashToken` (auth/tokens.ts, F1a), hierarquia de papéis de `packages/auth`
**Requirement**: EXT-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Editor tentando criar um share link com `role: 'workspace_admin'` → rejeitado (teto de papel)
- [x] Token retornado na criação nunca é recuperável de novo por nenhuma rota subsequente (só o hash persiste)
- [x] `GET /share/{token}` com token expirado, revogado, ou inexistente → 404 em todos os três casos (indistinguíveis)
- [x] `GET /share/{token}` válido serve o recurso com o papel do link, mesmo que o token tenha vazado para um `workspace_admin` real do mesmo workspace (capado, nunca herda o papel maior)
- [x] `:revoke` torna o link imediatamente inválido para requisições subsequentes

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(share): add capped-role, expiring share links for diagrams and presentations`

---

### Phase 30 — Webhooks

### T79: apps/server — módulo webhook: CRUD de endpoints com segredo HMAC rotacionável

**What**: `registerWebhookModule(app, { db })`. `GET/POST/PATCH/DELETE /workspaces/{id}/webhooks` — admin-only (`workspace_admin`, mesma checagem de outras rotas admin-only já existentes, ex. `EXP-04`). `POST` gera um segredo aleatório, persiste cifrado (`secretEncrypted`, reuse a envelope encryption de T71/F2a), retorna o segredo em claro UMA VEZ (mesmo padrão one-shot de T78). `PATCH .../{id}:rotate-secret` gera um NOVO segredo, substitui o cifrado armazenado, retorna o novo segredo em claro uma vez — o segredo antigo para de validar assinaturas imediatamente (sem período de graça de dupla-assinatura, mais simples e ainda satisfaz "rotacionável" da AC). `eventsJson` é a lista de tipos de evento que o endpoint quer receber, validada contra o enum fixo dos 5 tipos documentados.
**Where**: `apps/server/src/modules/webhook/`
**Depends on**: T71
**Reuses**: envelope encryption (T71/F2a)
**Requirement**: EXT-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Não-admin tentando criar/editar webhook → 403
- [x] Segredo retornado na criação nunca é recuperável de novo (só cifrado persiste)
- [x] `:rotate-secret` gera segredo diferente do anterior; uma assinatura calculada com o segredo antigo não é mais válida para entregas subsequentes
- [x] `eventsJson` com um tipo de evento fora do enum → 400

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(webhook): add admin-only webhook endpoint CRUD with rotatable HMAC secrets`

---

### T80: apps/server — pipeline de entrega de webhook + fiação dos 5 eventos

**What**: Job pg-boss `deliverWebhook(deliveryId)` (mesmo padrão de `deps.jobs` opcional de compaction/bulkBundle) — carrega a `webhook_deliveries` row, calcula `X-ArchCanvas-Signature: sha256=<hmac>` sobre o `payloadJson` serializado usando o segredo ATUAL decifrado do endpoint, faz `POST` para `endpoint.url` com timeout razoável, em sucesso (2xx) marca `status: 'delivered'`, em falha (network error ou não-2xx) incrementa `attempts` e agenda `nextRetryAt` com backoff exponencial (ex. 1min/5min/30min/2h/12h, 5 tentativas), após esgotar as tentativas marca `status: 'dead_letter'`. Fiação dos 5 eventos nos pontos de código já existentes: `diagram.created`/`diagram.updated` (workspace/diagram-sync — criação de diagrama e cada `operations:batch` bem-sucedido, ou só em criação+um evento "updated" agregado por batch, decida e documente o nível de granularidade escolhido para não gerar um evento por operação individual), `diagram.published` (`presentation/publish.ts`, F3), `spec.generated` (`docgen/generate.ts`, F3), `comment.mentioned` (`comment/mentions.ts`, F3) — cada ponto, ao acontecer, busca os `webhook_endpoints` habilitados do workspace que assinam aquele tipo de evento e insere uma `webhook_deliveries` row + enfileira o job (só quando `deps.jobs` estiver presente — mesmo degrade opcional já estabelecido).
**Where**: `apps/server/src/modules/webhook/deliver.ts`, edições pontuais nos módulos de origem de cada evento
**Depends on**: T79
**Reuses**: padrão de job opcional (`deps.jobs`, compaction/bulkBundle, F1c), HMAC (Node `crypto`, mesmo padrão de `ai-provider`)
**Requirement**: EXT-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Entrega bem-sucedida (mock HTTP endpoint 200) → `status: 'delivered'`, assinatura no header verificável com o segredo correto
- [x] Entrega falha (endpoint retorna 500 ou não responde) → `attempts` incrementa, `nextRetryAt` agendado com backoff crescente
- [x] Após esgotar as tentativas → `status: 'dead_letter'`, nenhuma tentativa adicional agendada
- [x] Publicar uma apresentação (T66, F3) com um webhook habilitado para `diagram.published` no workspace → uma `webhook_deliveries` row é criada
- [x] Endpoint desabilitado (`enabled: false`) ou não assinando aquele tipo de evento → nenhuma delivery criada para ele

**Tests**: unit + integration
**Gate**: build

**Commit**: `feat(webhook): add signed delivery pipeline with exponential backoff and dead-letter, wire the 5 documented events`

---

### Phase 31 — Wiring final e gate real

### T81: wiring de produção + compose + smoke-test WS real + gate final da onda

**What**: Registra `ws-gateway`, `share`, `webhook` em `registerModules.ts` (L-008) — `ws-gateway` precisa do `PresenceBroadcaster` escolhido por `config.redisUrl` (instancia `RedisPresenceBroadcaster` se presente, `InMemoryPresenceBroadcaster` senão) e do `jobs` opcional para o worker de webhook. Adiciona `AppConfig.redisUrl` (opcional) e `webhook_deliveries` polling/worker registration ao lado de `registerCompactionJob`/`registerBulkBundleJob`. Adiciona serviço `redis` a `infra/compose/compose.yaml` (imagem `redis:7-alpine`, sem persistência obrigatória — presença nunca precisa sobreviver a um restart do próprio Redis, CLB-04 já cobre isso) + `REDIS_URL` na env do `server` + comentário claro de que é opcional/degradável, mesmo espírito do comentário já existente sobre `/health/ready` na F0. Roda `pnpm -w build`, sobe `node apps/server/dist/index.js` de verdade, `curl` sem sessão nas rotas REST novas (`POST /diagrams/{id}/share-links`, `GET/POST /workspaces/{id}/webhooks`) confirmando `401` nunca `404`, E abre uma conexão WebSocket real (`ws` client Node) contra `/ws/diagrams/{id}?ticket=<ticket-real-emitido-via-login-real>` confirmando que recebe `hello` (primeira vez que este projeto valida uma superfície WS sob boot real, não só Vitest). Atualiza `spec.md`'s Requirement Traceability: CLB-01..04, EXT-01..02 de "Pending" para "Implementing". Roda o gate `Build` completo.
**Where**: `apps/server/src/core/registerModules.ts`, `apps/server/src/core/config.ts`, `infra/compose/compose.yaml`
**Depends on**: T75, T76, T77, T78, T80
**Reuses**: `registerAllModules` (padrão já estabelecido desde F1b)
**Requirement**: (wiring — não amarrado a um único requirement ID)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Rotas REST novas respondem `401` (nunca `404`) via `curl` contra `node dist/index.js` real, sem sessão
- [x] Conexão WS real contra o servidor compilado recebe `hello` com um ticket real emitido por login real
- [x] `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` — tudo verde
- [x] `spec.md`'s Requirement Traceability: CLB-01..04, EXT-01..02 todas em "Implementing" com nota do commit
- [x] `grep -rn "excalidraw" apps/server/dist/**/*.js` (após build) sem import/require real novo além das exceções já allowlisted

**Tests**: unit + integration
**Gate**: build

**Commit**: `chore(server): wire F4 modules (ws-gateway/share/webhook) into production entrypoint and compose`

---

## Phase Execution Map

```
Phase 26: T71
Phase 26: T72
Phase 27: T72 -> T73
Phase 27: T73 -> T74
Phase 28: T74 -> T75
Phase 28: T73 -> T76
Phase 28: T73 -> T77
Phase 29: T71 -> T78
Phase 30: T71 -> T79
Phase 30: T79 -> T80
Phase 31: T75 -> T81
Phase 31: T76 -> T81
Phase 31: T77 -> T81
Phase 31: T78 -> T81
Phase 31: T80 -> T81
```

**Packing de batches (Execute):**

- **Batch 1** (T71-T74, 4 tasks): fundações — schema DB + payload schemas WS + gateway core + presence broadcaster. T71/T72 paralelizáveis; T73/T74 sequenciais depois.
- **Batch 2** (T75-T78, 4 tasks): as três provas adversariais de CLB (cross-instância, convergência, durabilidade) + share links. Depende do Batch 1 mergeado.
- **Batch 3** (T79-T81, 3 tasks): webhooks completos + wiring/compose/gate final. Depende dos Batches 1-2 mergeados (T81 depende de tudo).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T71: schema DB (3 tabelas) | 1 migration coesa | ✅ Granular |
| T72: payload schemas WS | 1 arquivo de schemas coeso | ✅ Granular |
| T73: ws-gateway core | 1 módulo/rota WS coeso | ✅ Granular |
| T74: presence broadcaster | 1 interface + 2 implementações coesas | ✅ Granular |
| T75: prova cross-instância | 1 teste de integração coeso | ✅ Granular |
| T76: prova de convergência | 1 teste de integração coeso | ✅ Granular |
| T77: prova de durabilidade | 1 teste de integração coeso | ✅ Granular |
| T78: módulo share | 1 módulo/rota coeso | ✅ Granular |
| T79: módulo webhook CRUD | 1 módulo/rota coeso | ✅ Granular |
| T80: pipeline de entrega + fiação | 1 pipeline coeso (fiação em múltiplos pontos é intrínseca à task, não escopo extra) | ✅ Granular |
| T81: wiring + gate | 1 arquivo de wiring + compose + smoke-test | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T71 | None | — | ✅ Match |
| T72 | None | — | ✅ Match |
| T73 | T72 | T72→T73 | ✅ Match |
| T74 | T73 | T73→T74 | ✅ Match |
| T75 | T74 | T74→T75 | ✅ Match |
| T76 | T73 | T73→T76 | ✅ Match |
| T77 | T73 | T73→T77 | ✅ Match |
| T78 | T71 | T71→T78 | ✅ Match |
| T79 | T71 | T71→T79 | ✅ Match |
| T80 | T79 | T79→T80 | ✅ Match |
| T81 | T75, T76, T77, T78, T80 | todas presentes | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T71 | Database (schema) | unit | unit | ✅ OK |
| T72 | Domínio/contratos (shared-contracts) | unit | unit | ✅ OK |
| T73 | Módulo de rota (ws-gateway) | unit + integration | unit + integration | ✅ OK |
| T74 | Módulo de rota (ws-gateway) | unit + integration | unit + integration | ✅ OK |
| T75 | Prova cross-instância | integration | integration | ✅ OK |
| T76 | Módulo de rota (ws-gateway) | unit + integration | integration | ✅ OK |
| T77 | Módulo de rota (ws-gateway) | unit + integration | integration | ✅ OK |
| T78 | Módulo de rota (share) | unit + integration | unit + integration | ✅ OK |
| T79 | Módulo de rota (webhook) | unit + integration | unit + integration | ✅ OK |
| T80 | Módulo de rota (webhook) | unit + integration | unit + integration | ✅ OK |
| T81 | Wiring de produção | boot real + curl/WS manual | unit + integration | ✅ OK (gate build cobre unit+integration; smoke-test manual documentado separadamente no Done-when) |
