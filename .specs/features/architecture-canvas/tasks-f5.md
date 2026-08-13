# Architecture Canvas Tasks — Onda 6: F5 Hardening (Segurança, OIDC, DR, Observabilidade, Performance, Acessibilidade)

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow.

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** as 6 histórias novas de F5 — SEC-01..05 (hardening de segurança), OIDC-01..03 (autenticação de produção), DR-01..02 (disaster recovery reforçado), OBS-01..03 (observabilidade completa), PERF-01 (performance documentada), A11Y-01 (acessibilidade do shell). Fecha o roadmap inteiro. **Fora de escopo, deliberadamente**: piloto com times reais (atividade organizacional pós-deploy do usuário, não código). Esta onda reaproveita fortemente infraestrutura já existente — `InMemoryRateLimiter` (F2a, `ai-provider/rateLimit.ts`), `recordAuditEvent` (F1a, `packages/database/src/audit.ts`), redação de logs (F1b, `core/logging.ts`), `generateScene` (F0, `packages/test-fixtures`), o padrão de job opcional `deps.jobs` (F1c) — cada task abaixo aponta o ponto exato de reuso.

---

## ⚠️ Lições críticas de ondas anteriores — leia antes de escrever qualquer linha

1. **AD-008 (obrigatório)**: nenhum pacote/módulo server-side importa `@excalidraw/excalidraw`/`@arch-canvas/editor-adapter` por valor. Nenhuma task desta onda deveria tocar `SceneElement`, mas confirme ao final de cada batch: `pnpm -w build && grep -rn "excalidraw" apps/server/dist/**/*.js` sem import/require real novo.
2. **L-008 (wiring de produção)**: todo endpoint/rota novo registrado em `apps/server/src/core/registerModules.ts` (ou `core/server.ts` para plugins globais como CORS/helmet) na MESMA task que o cria.
3. **"Real por padrão" (AD-007/AD-009)**: `redis-server` já está disponível neste sandbox (F4). Para OIDC (T87/T88), use `oidc-provider` (pacote npm do Panva) para rodar um Identity Provider OIDC-conformante DE VERDADE em processo — mesma disciplina de "engine real, sem Docker" já aplicada a Postgres (PGlite) e Redis; nunca mocke o protocolo OIDC/PKCE.
4. **Honestidade de escopo, não teatro**: onde a spec pede algo que exige infraestrutura de produção real fora deste sandbox (Prometheus real fazendo scrape, alertas de verdade disparando, WAL archiving nativo do Postgres em produção), a task entrega a peça de código/config testável e correta E documenta explicitamente o que só se prova em produção real — mesmo padrão de PRS-01 (F3, "Verified (backend)") e AIC-04 (F2a, "Partial" disclosed).
5. **Gate de build só na última task de cada batch**: intermediárias `Quick`/`Full`; a última de cada batch `Build` completo (`pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`).
6. **Reuso antes de reescrever**: `apps/server/src/modules/ai-provider/rateLimit.ts`'s `InMemoryRateLimiter`/`createRateLimitPreHandler` já é um limitador de janela fixa genérico e testado — SEC-02 o generaliza/relocaliza, nunca escreve um novo do zero. `packages/database/src/audit.ts`'s `recordAuditEvent` já existe e já é chamado em 4 rotas — SEC-04 completa a cobertura, não recria o mecanismo.

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Core/infra (`apps/server/src/core`) | unit + integração | Headers, CORS, rate limit, fail-fast, métricas, tracing testados diretamente contra a app real | `apps/server/src/core/**/*.spec.ts` | `pnpm -w test:unit && pnpm -w test:integration` |
| Segurança/threat-model | integração | 1 teste por cenário do §9.4, cross-referenciado | `apps/server/src/security/*.int.spec.ts` | `pnpm -w test:integration` |
| OIDC | integração (IdP real em processo) | Fluxo PKCE completo, mapeamento de grupo, teto de papel | `apps/server/src/modules/auth/oidc*.int.spec.ts` | `pnpm -w test:integration` |
| Backup/DR | integração (Postgres real) | Incremental + restore automatizado, divergência detectada | `infra/backup/src/**/*.int.spec.ts` | `pnpm -w test:integration` |
| Performance | integração (benchmark, disclosed proxy) | Bootstrap/ACK dentro do alvo para 1k/5k/10k | `apps/server/src/**/*.perf.int.spec.ts` | `pnpm -w test:integration` |
| Acessibilidade (`apps/web`) | automatizado (axe-core) | Toda tela existente varrida, telas ausentes documentadas | `apps/web/src/**/*.a11y.spec.ts` | `pnpm -w test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Full | Tasks que tocam integração/DB/rede | `pnpm -w test:unit && pnpm -w test:integration` |
| Build | Última task de CADA batch | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` |

---

## Execution Plan

### Phase 32: Segurança — headers/CORS, rate limit, fail-fast, auditoria

```
T82
T83
T84
T85
```

### Phase 33: Threat-model + OIDC

```
T82 -> T86
T83 -> T86
T85 -> T86
T87 -> T88
```

### Phase 34: Disaster recovery

```
T89
T89 -> T90
```

### Phase 35: Observabilidade

```
T91
T92
T93
```

### Phase 36: Performance, acessibilidade e fechamento

```
T94
T95
T86 -> T96
T88 -> T96
T90 -> T96
T91 -> T96
T92 -> T96
T93 -> T96
T94 -> T96
T95 -> T96
```

---

## Task Breakdown

### Phase 32 — Segurança

### T82: apps/server — headers de segurança e CORS restritivo (SEC-01)

**What**: Adicione `@fastify/helmet` (CSP, `X-Content-Type-Options`, `X-Frame-Options`, HSTS quando `config.publicUrl` usa `https:`) e `@fastify/cors` (allowlist de origens explícita via novo `CORS_ALLOWED_ORIGINS` — CSV em `core/config.ts`, default vazio = nenhuma origem cross-site permitida) a `core/server.ts`. Pesquise a API atual de ambos os plugins antes de assumir shape de opções (Knowledge Verification Chain). CSP deve ser restritiva o bastante para não quebrar as rotas REST/WS existentes (sem `unsafe-inline` a menos que genuinamente necessário — documente se precisar).
**Where**: `apps/server/src/core/server.ts`, `apps/server/src/core/config.ts`
**Depends on**: None
**Reuses**: `AppConfig`/`loadConfig` (existente)
**Requirement**: SEC-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Qualquer resposta HTTP carrega CSP, `X-Content-Type-Options`, `X-Frame-Options`
- [x] `publicUrl` com `https:` → header HSTS presente; `http:` (dev) → ausente
- [x] Requisição de uma origem fora do allowlist → CORS rejeita (sem `Access-Control-Allow-Origin` correspondente); origem no allowlist → permitida
- [x] Rotas REST/WS existentes continuam funcionando sob a CSP nova (gate completo verde)

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(core): add security headers (CSP/HSTS/X-Frame-Options) and origin-allowlisted CORS`

**Status**: ✅ Complete — researched both plugins' current APIs before writing any option shape (Knowledge Verification Chain): `@fastify/helmet@13.1.0` and `@fastify/cors@11.3.0` are the versions documented as compatible with Fastify `^5.x` (their own READMEs' compatibility tables; `12.x`/`10.x` were the first `fv5`-compatible majors respectively), installed via `pnpm --filter @arch-canvas/server add`. `core/config.ts` gains `CORS_ALLOWED_ORIGINS` (CSV, default `''` → `corsAllowedOrigins: []`, parsed by a small `parseCorsAllowedOrigins` helper). `core/server.ts` registers `fastifyHelmet` with default CSP directives (no `unsafe-inline` anywhere — the default helmet CSP never adds it, and this server serves no HTML/inline scripts of its own to a browser, so no loosening was needed) and `hsts` conditionally on `config.publicUrl.startsWith('https:')` (`{ maxAge: 15552000, includeSubDomains: true }` vs `false`), then `fastifyCors` with `origin: config.corsAllowedOrigins` directly (empty array by default means no origin ever matches, so no `Access-Control-Allow-Origin` is ever reflected — functionally equivalent to disabling CORS but keeps the plugin's other options, e.g. `credentials`, available to a future task without re-registering it). 5 new tests in `core/server.spec.ts`: CSP/X-Content-Type-Options/X-Frame-Options present on `GET /health/live`; HSTS absent for the default `http://localhost:3000` `PUBLIC_URL`; HSTS present (`max-age=`) for an `https://` `PUBLIC_URL`; a disallowed origin gets no `Access-Control-Allow-Origin`; an origin explicitly in `CORS_ALLOWED_ORIGINS` gets it reflected back. `pnpm -w test:unit` green (21/21 tasks, server 281/281 including the 5 new — up from 276; web unaffected at 22/22), confirming every existing REST-route-touching unit test still passes unchanged under the new global helmet/cors registration (no route needed adjustment). **Deviation**: none functional — `app.register(fastifyHelmet/fastifyCors)` inside the still-synchronous `buildServer` follows the same non-awaited plugin-registration pattern Fastify/avvio already resolves before `.ready()`/`.inject()`/`.listen()`, identical in spirit to how other modules register plugins in this codebase.

---

### T83: apps/server — rate limiting geral por usuário/IP/ação (SEC-02, fecha AIC-04)

**What**: Relocalize `InMemoryRateLimiter`/`createRateLimitPreHandler` de `ai-provider/rateLimit.ts` para `apps/server/src/core/rateLimit.ts` (generalização — não é mais específico de IA), atualize os 2 call-sites existentes para importar do novo local. Registre um rate limit PADRÃO (`onRequest` hook em `core/server.ts`, chave = `userId ?? ip`) para toda rota autenticada, e limites mais estritos e configuráveis especificamente nas rotas de geração de IA (`POST /diagrams/:id/ai/runs`, `ai-engine/routes.ts`) e de export (`POST /diagrams/:id/exports`, `:bundle`, `export/routes.ts`) — reaproveitando o MESMO `InMemoryRateLimiter`, só com `limit`/`windowMs` diferentes por rota. A aplicação do limite nas rotas de IA fecha o gap disclosed em AIC-04 (F2a: "limites de workspace/budget deferidos") — documente essa ligação explicitamente no commit.
**Where**: `apps/server/src/core/rateLimit.ts` (movido), `apps/server/src/core/server.ts`, `apps/server/src/modules/ai-engine/routes.ts`, `apps/server/src/modules/export/routes.ts`, `apps/server/src/modules/ai-provider/index.ts` (atualiza import)
**Depends on**: None
**Reuses**: `InMemoryRateLimiter`/`createRateLimitPreHandler` (F2a, movido sem reescrever a lógica)
**Requirement**: SEC-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Estourar o limite padrão de uma rota comum → `429`
- [x] Estourar o limite (mais estrito) de `POST /diagrams/:id/ai/runs` com MENOS requisições que o limite padrão exigiria → `429` (prova que o limite de IA é de fato mais apertado)
- [x] Rate limit é por chave `userId` (dois usuários distintos não compartilham a mesma janela)
- [x] `ai-provider`'s próprios testes de rate limit (F2a, já existentes) continuam verdes após a relocalização

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(core): generalize rate limiting to all authenticated routes with stricter AI/export limits`

**Status**: ✅ Complete — `InMemoryRateLimiter`/`createRateLimitPreHandler`/`RateLimiterOptions`/`RateLimitCheck` moved unmodified (`git mv`) from `ai-provider/rateLimit.ts` to `core/rateLimit.ts` (test file moved alongside it, header comment updated to note the relocation); `ai-provider/index.ts` re-exports from the new location, `ai-provider/routes.ts` and `ai-provider/ai-provider.int.spec.ts` import from it directly — all 3 identified call sites updated, none of the class's own logic touched. **Structural finding, documented as a Deviation below**: the task text says "onRequest hook ... key = userId ?? ip", but Fastify's documented hook order runs any globally-registered `onRequest`/`preHandler` hook BEFORE a route's own `preHandler` array executes — so at the point such a global hook would run, `requireSession`'s preHandler (which populates `request.authContext`) has not run yet, and only `request.ip` would ever be observable, defeating "key = userId" for every authenticated route. Solved instead with Fastify's `onRoute` hook (fires once per route at registration time): it detects any route whose `preHandler` chain already contains `requireSession`'s preHandler (matched by its stable function name, `requireSessionPreHandler`) and appends the default rate-limit check immediately after it in that same chain, so it runs once `authContext` is populated — automatically covering every current and future `requireSession`-gated route with zero additional per-route wiring (L-008), which a literal `onRequest` hook could not structurally achieve. Default limit: 300 requests/60s per key (`userId ?? ip`), generous enough that none of this codebase's existing test suites (which reuse one session across many requests per file) needed adjustment — confirmed by a full green `pnpm -w test:integration` run below. Stricter, separately-configured, injectable `InMemoryRateLimiter`s added to `POST /diagrams/:id/ai/runs` (20/60s, `ai-engine/routes.ts`'s new `aiRunRateLimiter` dep) and to `POST /diagrams/:id/exports` + `POST /diagrams/:id/bundle` (30/60s, sharing ONE limiter via `export/routes.ts`'s new `exportRateLimiter` dep — both routes draw from the same budget). **This is the concrete closure of AIC-04's F2a-disclosed gap** ("limites de workspace/budget deferidos") — the AI-run route now has its own enforced, tighter-than-default rate limit, not merely the generic `testConnectionRateLimiter` on the admin "test connection" endpoint that already existed. New tests: `core/server.spec.ts` (+3, using an injectable `defaultRateLimiter` and a `fakeRequireSession` matching the real function's name) proves the 429 threshold, that a non-`requireSession` route like `/health/live` is never limited, and per-userId key isolation; new `ai-engine/aiRunRateLimit.int.spec.ts` (2 tests, real PGlite+Fastify) proves the AI-run limit trips at N=2 (far below the 300 default) and is keyed per-user; new `export/exportRateLimit.int.spec.ts` (3 tests) proves the same for exports plus the shared-budget-across-both-routes behavior. `pnpm -w test:unit` green (21/21 tasks, server 284/284 — up from 281 after T82, +3 new); `pnpm -w test:integration` green (13/13 tasks, server 299/299 across 39 files — up from 294, +5 new — including the pre-existing `ai-provider.int.spec.ts` (7/7) confirming F2a's own rate-limit test survived the relocation, and `registerModules.int.spec.ts`/every other route-touching integration test unaffected by the new global default hook). `pnpm -w lint` and `pnpm -w typecheck` (+`build`, transitively cached) both clean. AD-008 re-checked (`grep -rln excalidraw apps/server/dist/**/*.js`): same 9 pre-existing allowlisted files, zero new hits. **Deviation**: `onRoute`-based preHandler injection used in place of a literal `onRequest` hook, for the structural reason above — functionally equivalent to (and arguably stronger than) the literal instruction, since it actually satisfies "key = userId" instead of silently degrading to ip-only.

---

### T84: apps/server — confirmação/fechamento do fail-fast de segredo inseguro (SEC-03)

**What**: `core/config.ts`'s `loadConfig` JÁ lança em `NODE_ENV=production` com `SESSION_SECRET`/`ENCRYPTION_KEY` iguais a `INSECURE_DEV_SECRET` (implementado numa onda anterior, achado ao ler o código nesta autoria de tasks). Esta task NÃO reimplementa — confirma que `config.spec.ts` cobre exatamente essa asserção (mensagem de erro clara, nomeando a variável), adiciona qualquer caso faltante (ex.: `NODE_ENV=development`/`test` com o mesmo default NUNCA deve lançar — só produção), e documenta a descoberta no traceability do `spec.md` diretamente com o path exato do código que já satisfaz a AC.
**Where**: `apps/server/src/core/config.spec.ts`
**Depends on**: None
**Reuses**: `loadConfig`/`INSECURE_DEV_SECRET` (já implementados)
**Requirement**: SEC-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `NODE_ENV=production` + `SESSION_SECRET` default → lança com mensagem citando a variável exata
- [x] `NODE_ENV=production` + `ENCRYPTION_KEY` default → lança (caso independente do de `SESSION_SECRET`)
- [x] `NODE_ENV=development`/`test` com os mesmos defaults → NUNCA lança
- [x] `NODE_ENV=production` com ambos os segredos customizados → boot normal

**Tests**: unit
**Gate**: quick

**Commit**: `test(core): close SEC-03 coverage for production fail-fast on insecure default secrets`

**Status**: ✅ Complete — confirmed by direct code read (not reimplemented) that `apps/server/src/core/config.ts`'s `loadConfig` (lines 65-74, the `parsed.NODE_ENV === 'production'` loop over `SECRET_ENV_VARS = ['SESSION_SECRET', 'ENCRYPTION_KEY']`) already throws `Refusing to start in production: ${varName} is still set to the known development placeholder...` — built in an earlier wave (FND-03, F0, already `✅ Verified` in `spec.md`), not by this task. `config.spec.ts` already had both independent-secret throw cases and the "both customized boots fine" case (`FND-03`'s own tests); this task added the 2 genuinely missing cases: an explicit `NODE_ENV=development` test and a new `NODE_ENV=test` test, both asserting `.not.toThrow()` with BOTH secrets deliberately left at `INSECURE_DEV_SECRET` (the previous `development` test only asserted default *values*, never explicitly proved the non-production path never throws; `test` NODE_ENV had zero coverage of this behavior before). `pnpm -w test:unit` green (21/21 tasks, server 286/286 — up from 284 after T83, +2 new); config.spec.ts itself now 7/7 (up from 5). **`spec.md` traceability note (per this batch's operating constraint, NOT a status change)**: per the orchestrator's explicit instruction for this batch, `spec.md`'s SEC-03 row stays `Pending` — not flipped to `Implementing` even though the code satisfying its AC already exists and is now fully tested, since that promotion is reserved for T96/the independent Verifier. The finding is instead recorded here: SEC-03's AC is satisfied by `apps/server/src/core/config.ts` lines 65-74 (`loadConfig`), pre-existing since F0, with test coverage now complete in `apps/server/src/core/config.spec.ts`. **Deviation**: none — task text explicitly forbids reimplementing the fail-fast logic, and none was written.

---

### T85: apps/server — cobertura completa de auditoria (SEC-04)

**What**: `recordAuditEvent` (F1a, `packages/database/src/audit.ts`) já é chamado em `library`, `ai-provider`, e 2 rotas de `workspace` — esta task adiciona as chamadas faltantes nos pontos que a AC exige e que hoje NÃO auditam (confirmado por leitura direta do código antes de escrever): login (`auth/routes.ts`'s `POST /auth/login`, sucesso E falha), restore de snapshot (`snapshot/restore.ts`), publish de apresentação (`presentation/publish.ts`), export (`export/routes.ts`'s `POST /diagrams/:id/exports`/`:bundle`), aprovação de patch de IA (`ai-engine/applyPatch.ts`'s `approveAiRun`). Cada chamada segue o formato já estabelecido de `AuditEventInput` (actor, action, resource, outcome) — leia um call-site existente (ex. `workspace/routes.ts`) para o padrão exato antes de escrever os novos.
**Where**: `apps/server/src/modules/auth/routes.ts`, `apps/server/src/modules/snapshot/restore.ts`, `apps/server/src/modules/presentation/publish.ts`, `apps/server/src/modules/export/routes.ts`, `apps/server/src/modules/ai-engine/applyPatch.ts`
**Depends on**: None
**Reuses**: `recordAuditEvent` (F1a)
**Requirement**: SEC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Login bem-sucedido e login falho geram linhas distintas em `audit_events` (outcome diferente)
- [x] Restore de snapshot, publish de apresentação, geração de export, e aprovação de patch de IA cada um gera exatamente 1 linha de auditoria por operação
- [x] Todas as 8 ações do texto da AC (login, acesso admin, permissão, restore, publish, export, config de IA, patch de IA) têm pelo menos 1 call-site confirmado — tabela no corpo do commit listando ação → arquivo:linha

**Tests**: integration
**Gate**: quick

**Commit**: `feat(core): complete audit-event coverage for login, restore, publish, export, and AI patch approval`

**Status**: ✅ Complete — reading `packages/database/src/audit.ts`'s `recordAuditEvent`/`AuditEventInput` first confirmed the actual state was broader than the task text's own premise: `recordAuditEvent` was already called at MANY more than "library, ai-provider, and 2 workspace routes" (grep found 6 in `workspace/routes.ts`, 6 more in `workspace/project-diagram-routes.ts`, 3 in `ai-provider/routes.ts`, 1 in `library/routes.ts` — 16 pre-existing call sites total). Added the 5 genuinely missing ones the task names, each following `workspace/routes.ts`'s exact `AuditEventInput` convention read first: `auth/routes.ts`'s `POST /auth/login` (both outcomes — success uses `actorId`+the real `resourceId` (userId); failure has no real user to attribute to, so `actorId` is omitted and — since `audit_events.resource_id` is a NOT NULL `uuid` column with no valid entity to reference for an unresolved login — `resourceId` is a fresh non-referencing random uuid with the attempted email recorded in `metadataJson.attemptedEmail` instead, never in a column that could be confused with a real resource pointer); `snapshot/restore.ts`'s `restoreSnapshot`; `presentation/publish.ts`'s `publishPresentation`; `export/routes.ts`'s both `POST /diagrams/:id/exports` and `POST /diagrams/:id/bundle`; `ai-engine/applyPatch.ts`'s `approveAiRun`. `ipHash` (previously an unused field on `AuditEventInput` — grep confirmed zero prior call sites ever set it) is populated for the first time here, on both login outcomes, reusing `tokens.ts`'s existing `hashToken` (sha256) — the same "never store the raw identifying value in cleartext" discipline already applied to session/ticket tokens, applied to the requester's IP.

Full 8-action traceability table (action → file:line), all 4 admin-access/permission-change sites RE-CONFIRMED by direct read (not assumed from the task text), all 5 new sites confirmed by a passing integration test each:

| AC action | Status | File:line | Test |
| --- | --- | --- | --- |
| Login | New | `apps/server/src/modules/auth/routes.ts:70` (failed), `:92` (succeeded) | `auth/auth.int.spec.ts` — 3 new tests in `describe('auth module — login audit coverage (SEC-04, T85)')` |
| Admin access | Pre-existing (confirmed) | `apps/server/src/modules/ai-provider/routes.ts:139/175/212` (`ai_provider_config.created/updated/tested` — every route in this module requires `org_admin`/`workspace_admin`, `assertProviderAdmin`) | `ai-provider/ai-provider.int.spec.ts` (pre-existing, F2a) |
| Permission change | Pre-existing (confirmed) | `apps/server/src/modules/workspace/routes.ts:239` (`workspace.member.updated`, gated on `workspace:manage_members`); also `:210`/`:266` (`.added`/`.removed`) | `workspace/workspace.int.spec.ts` (pre-existing, F1a) |
| Restore | New | `apps/server/src/modules/snapshot/restore.ts:109` | `snapshot/restore.int.spec.ts` — assertion added to the existing happy-path restore test |
| Publish | New | `apps/server/src/modules/presentation/publish.ts:49` | `presentation/publish.int.spec.ts` — assertion added to the existing `:publish` test |
| Export | New | `apps/server/src/modules/export/routes.ts:141` (`diagram.export.generated`), `:179` (`diagram.export.bundle_generated`) | `export/export.int.spec.ts` — assertions added to the existing `/exports` and `/bundle` tests |
| AI provider config | Pre-existing (confirmed) | Same as "Admin access" row above — `ai_provider_config.created/updated/tested` IS the AI-provider-config audit trail | `ai-provider/ai-provider.int.spec.ts` (pre-existing, F2a) |
| AI patch approval | New | `apps/server/src/modules/ai-engine/applyPatch.ts:184` | `ai-engine/applyPatch.int.spec.ts` — assertion added to the existing happy-path approve test |

`pnpm -w test:unit` green (21/21 tasks, server 286/286 — unchanged from T84, this task added zero unit tests, integration only per its own declared `Tests: integration`); `pnpm -w test:integration` green (13/13 tasks, server 302/302 across 39 files — up from 299, +3 new `it()` blocks in `auth.int.spec.ts`'s new describe; the other 4 new-call-site assertions were added to existing passing tests rather than new ones, per this codebase's own convention of asserting audit coverage inline in the operation's own happy-path test — see `workspace.int.spec.ts`'s prior-art pattern). `pnpm -w lint`/`pnpm -w typecheck` clean. AD-008 re-checked: same 9 pre-existing allowlisted files, zero new hits. **Deviation**: none functional — the `resourceId`-is-a-NOT-NULL-uuid constraint on a failed login (no real user to reference) is a genuine schema fact discovered while implementing, not a design choice this task was free to avoid; documented above and in `auth/routes.ts`'s own inline comment.

---

### Phase 33 — Threat-model e OIDC

### T86: apps/server — suíte de regressão do threat model (SEC-05)

**What**: Novo módulo `apps/server/src/security/threatModel.spec.ts` — um manifesto tipado `THREAT_MODEL: { scenario: string; coveringTest: string }[]` com as 14 entradas literais do §9.4 do documento-fonte (workspace crossover, IDOR, ticket WS reutilizado, mutation replay, SVG malicioso, zip bomb, SSRF de provedor de IA, exfiltração via prompt, vazamento em log, escalada de papel, share link roubado, corrupção de snapshot, operação fora de ordem, consumo abusivo de IA), cada uma apontando o path exato do arquivo de teste que já cobre o cenário (identificados por leitura das ondas anteriores — a maioria já existe). Um teste unitário confirma que TODO `coveringTest` referenciado existe de fato no disco (`fs.existsSync`, pega drift se um arquivo for renomeado/removido). Para "consumo abusivo de IA" — o único cenário sem cobertura prévia real (AIC-04 estava disclosed partial) — aponte para o novo teste de rate limit de IA da T83, que agora fecha esse gap de verdade.
**Where**: `apps/server/src/security/threatModel.spec.ts`
**Depends on**: T82, T83, T85 (referencia testes/código dessas tasks)
**Reuses**: todos os testes de IDOR/SSRF/prompt-injection/zip-bomb/etc. já existentes nas ondas F0-F4
**Requirement**: SEC-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] 14 entradas no manifesto, uma por cenário do §9.4, nenhuma faltando
- [x] Todo `coveringTest` referenciado existe no disco (teste automatizado, não checagem manual)
- [x] "Consumo abusivo de IA" aponta para o teste de rate limit de IA da T83 (gap genuíno, agora fechado)
- [x] Nenhuma entrada aponta para um teste que não teste de fato o cenário nomeado (confirmado por leitura de cada teste referenciado, não só pela existência do arquivo)

**Tests**: unit
**Gate**: quick

**Commit**: `test(security): add threat-model regression manifest cross-referencing all 14 §9.4 scenarios`

**Status**: ✅ Complete — new `apps/server/src/security/threatModel.spec.ts` (a `*.spec.ts`, not `*.int.spec.ts`, matching `pnpm -w test:unit`/Gate: quick — the manifest + existence-check is pure logic over the filesystem, no DB/network). A module-local `THREAT_MODEL` array (14 entries, `{ scenario, coveringTest, provingAssertion, whyItCovers }`) covers all 14 literal §9.4 scenarios read directly from `docs/product-spec.md` line 496, in source order. Every `coveringTest` file was opened and read in full (not just grepped by filename) before being cited — the `provingAssertion` field names the exact `it`/`describe` block, and `whyItCovers` states the specific mechanism it proves, not just its topic. Final mapping: workspace crossover → `diagram-sync/bootstrap.int.spec.ts` ("a user outside the diagram workspace receives 404, never 403"); IDOR → `workspace/rbac-matrix.int.spec.ts`'s dedicated `describe("IDOR: non-member gets 404...")` block; WS ticket reuse → `ws-gateway/wsGateway.int.spec.ts` ("a reused ticket is rejected on the second connection attempt", full protocol-level proof; `auth/ws-ticket.int.spec.ts`'s unit-level "consumable exactly once" noted as complementary); mutation replay → `diagram-sync/operations-batch.int.spec.ts` (`clientMutationId` idempotent re-ack, EDT-04); malicious SVG → `asset/asset.int.spec.ts` (`<script>` tag stripped before ready); zip bomb → `core/server.spec.ts`'s 10MB `bodyLimit`/413 test (primary — HTTP-layer defense), with `export/import.spec.ts`'s `MAX_IMPORT_ELEMENTS` ceiling test noted as complementary post-decompression defense; AI-provider SSRF → `ai-provider/ai-provider.int.spec.ts`'s `describe("SSRF protection on the route")`; prompt-injection exfiltration → `ai-engine/prompt-injection.int.spec.ts`'s structural boundary assertion (malicious text never promoted out of `context.sceneData` into the instruction channel); log leakage → `core/logging.spec.ts` (Authorization/cookie/AI-token/nested-PII redaction); role escalation → `workspace/rbac-matrix.int.spec.ts`'s `describe("immediate role-downgrade enforcement (AUTH-05)")` (role resolved fresh per request, no caching to exploit); stolen share link → `share/share.int.spec.ts`'s literal leaked-token-to-`workspace_admin` scenario (F4/EXT-01); snapshot corruption → `infra/backup/src/create.int.spec.ts`'s tamper-detection test (F1c, 2 real Postgres instances, throws and applies nothing); out-of-order operation → `diagram-sync/catchup.int.spec.ts`'s strict-sequence-order catch-up test; abusive AI consumption → `ai-engine/aiRunRateLimit.int.spec.ts` (T83, the one genuine pre-existing gap — AIC-04 disclosed as deferred in F2a — now closed for real). A companion unit test (`it.each` over all 14 entries) asserts every `coveringTest` path exists via `fs.existsSync` resolved against the repo root (`node:path`/`node:url`, not a hardcoded string), catching drift if any referenced file is renamed or removed; a second test confirms exactly 14 entries with no duplicate scenario names; a third pins the AI-consumption entry to T83's specific file so that assertion can't silently rot. `pnpm --filter @arch-canvas/server exec vitest run src/security/threatModel.spec.ts` → 16/16 green. `pnpm -w test:unit` green (21/21 tasks, server 302/302 — up from 286 after T85, +16 new). `pnpm -w lint`/`pnpm -w typecheck` clean (biome's `noExportsInTest` rule required keeping `THREAT_MODEL` module-local/non-exported, since it lives in a `.spec.ts` file — no external consumer needs it, the test file itself is the only reader). AD-008 unaffected (test-only file, not part of any server dist output). **Deviation**: none functional. One naming note: biome's `noExportsInTest` forbids `export const THREAT_MODEL`, so the manifest constant is module-private (fine — nothing outside this test file needs to import it; T96/the independent Verifier can re-derive the same 14-scenario cross-check by reading this file directly, same as any other test).

---

### T87: apps/server — login OIDC com PKCE e mapeamento de grupo→papel (OIDC-01/02/03)

**What**: Novo submódulo `apps/server/src/modules/auth/oidc.ts` usando `openid-client` (pesquise a API atual — v6+ mudou para uma API baseada em funções, não classes, antes de assumir; Knowledge Verification Chain). `GET /auth/oidc/login` inicia o Authorization Code + PKCE flow (`code_verifier`/`code_challenge`) contra um provider configurável (`OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`, todos opcionais em `core/config.ts` — servidor sobe normalmente sem eles, rota OIDC responde 404/503 se não configurado). `GET /auth/oidc/callback` troca o code, valida o ID token, extrai o claim de grupos configurável (`OIDC_GROUP_CLAIM`, default `groups`), mapeia para papel de workspace via `OIDC_GROUP_ROLE_MAP` (JSON `{ "grupo-x": "editor" }`) — NUNCA concede papel acima do teto explícito do mapeamento — e cria uma sessão usando o MESMO mecanismo de sessão/refresh-token já existente (`auth/tokens.ts`, F1a — reuse, não duplique), nunca um esquema de sessão paralelo. Local auth (email/senha) continua funcionando inalterada quando OIDC não está configurado.
**Where**: `apps/server/src/modules/auth/oidc.ts`, `apps/server/src/modules/auth/routes.ts` (rotas novas), `apps/server/src/core/config.ts`
**Depends on**: None
**Reuses**: mecanismo de sessão/refresh existente (F1a, `auth/tokens.ts`), `resolveWorkspaceRole`-adjacent RBAC de `packages/auth`
**Requirement**: OIDC-01, OIDC-02, OIDC-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Sem `OIDC_ISSUER_URL` configurado → `GET /auth/oidc/login` responde de forma clara (404/503, nunca crasha o boot), local auth funciona normalmente
- [x] Claim de grupo mapeado para `editor` → sessão criada com papel `editor`, nunca acima do que o mapeamento define, mesmo se o ID token contiver claims adicionais não mapeados
- [x] Sessão criada via OIDC usa o MESMO mecanismo de refresh/revogação de sessão local (mesma tabela, mesmo endpoint de refresh/logout)
- [x] Nenhum token (ID token, access token, refresh token) é colocado em local acessível a script client-side

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(auth): add OIDC-with-PKCE login route, group-to-role mapping, and config` (T87's task text in this file has no explicit `**Commit**:` line of its own — per the orchestrator's instruction, this task's commit message is authored here in the same Conventional Commit style as its siblings, since T87/T88's joint commit message only appears on T88's own line and T87 is committed separately/incrementally per this batch's operating discipline).

**Status**: ✅ Complete — researched `openid-client` v6.8.5's CURRENT API directly from the installed package's `build/index.d.ts` before writing any code (Knowledge Verification Chain — confirmed the v5→v6 migration from `Issuer`/`Client` classes to plain functions over a `Configuration` value: `discovery()`, `buildAuthorizationUrl()`, `authorizationCodeGrant()`, `randomPKCECodeVerifier()`/`calculatePKCECodeChallenge()`/`randomState()`/`randomNonce()`, `allowInsecureRequests()` for non-TLS issuers). New `apps/server/src/modules/auth/oidc.ts`: `getOidcClientConfiguration` (discovery, cached per issuer+client key, `resetOidcClientConfigurationCache` exported for T88's per-test-provider isolation), `resolveOidcRole` (pure function — the ONLY place a role is ever derived from an ID token; reads exclusively the configured `groupClaim` array, ignores every other claim including any top-level `role`/`admin`-looking field, returns `null` — never a fallback — when no group matches the map, and picks the HIGHEST-privilege mapped role when multiple groups match; 7 unit tests in `oidc.spec.ts` including the explicit adversarial case of an unmapped but suggestively-named group never elevating the result), `resolveOrCreateOidcUser` (looks up by `users.authSubject` — a column that ALREADY existed in the schema since F1a, `"<issuerUrl>#<sub>"`, deliberately never by email, so a same-looking email can never silently take over an existing account), `syncOidcWorkspaceRole` (upserts `workspace_members` via `onConflictDoUpdate`, same pattern as `library/metadata.ts`'s `upsertElementMetadata`). `core/config.ts` gains `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`/`OIDC_GROUP_CLAIM` (default `groups`)/`OIDC_GROUP_ROLE_MAP` (JSON, default `{}`, validated against the 5 known `Role`s at load time, only when OIDC's 3 core fields are actually set — a stray malformed leftover env var never blocks boot for a deployment not using OIDC), plus `AppConfig.oidc` populated only when issuer/clientId/clientSecret are ALL present. `auth/routes.ts` gains `GET /auth/oidc/login` (builds the PKCE authorization URL, stores `{codeVerifier, state, nonce}` in a short-lived — 300s — `httpOnly`/`SameSite=Lax`/path-scoped `oidc_pkce` cookie, redirects to the IdP) and `GET /auth/oidc/callback` (reads+clears that cookie, calls `authorizationCodeGrant` with the real PKCE verifier, extracts claims, resolves the role via `resolveOidcRole`, resolves/creates the local user, syncs the workspace role if `OIDC_DEFAULT_WORKSPACE_ID` is set, then calls the EXACT SAME `createSession`/`sessionCookieOptions` F1a already uses for local login — never a parallel session mechanism — and redirects the browser to `config.publicUrl`; both outcomes recorded via `recordAuditEvent`, `auth.oidc_login.succeeded`/`.failed`, mirroring T85's local-login audit symmetry). Both routes respond `503` (not a boot failure, not a bare route-not-found `404`) when `config.oidc` is unset. No IdP token (ID/access/refresh) is ever set as a cookie or otherwise forwarded to the client — only our own opaque session token, exactly as local auth already does.

**Deviation 1 (config field, documented inline in `config.ts` too)**: the task's own config-field list has no field naming which workspace an OIDC-mapped role applies to, but `workspace_members.role` is stored per-workspace only (no org-wide/global role column exists anywhere in the schema) — a target workspace is structurally required for group→role mapping to mean anything. Added one more optional field, `OIDC_DEFAULT_WORKSPACE_ID`: when unset, OIDC login still fully authenticates and creates a session (local auth is never weakened either way), it just never provisions/updates any workspace membership — a reasonable least-privilege default for an incompletely configured deployment, and the narrowest change that makes OIDC-02's "maps IdP groups to workspace roles" AC achievable at all given the existing per-workspace-only role model.

**Deviation 2 (redirect target after callback)**: this server is a pure REST+WS API (no static/SPA hosting — confirmed by grep, no `fastify-static`/`sendFile` anywhere in `core/server.ts`/`index.ts`), so there is no in-process "return to the app" page to redirect to. `docs/product-spec.md` §12 documents a single reverse-proxy in front of both the web app and this API in real deployments, so redirecting the browser to `config.publicUrl` (the proxy's own origin) after setting the session cookie is the reasonable choice — the proxy then routes the follow-up navigation to the SPA, which calls `/me` with its now-set cookie exactly like a page load after local login would.

`pnpm --filter @arch-canvas/server exec tsc --noEmit` clean. `pnpm exec biome check .` clean. Unit: `oidc.spec.ts` (7/7) + `config.spec.ts`'s new `describe('OIDC config ...')` block (8/8) green; `pnpm -w test:unit` green (21/21 tasks, server 317/317 — up from 302 after T86, +15 new). Integration (run ahead of its own `Gate: quick` as a sanity check, since T88 immediately after is `Gate: build` and will re-run all of it anyway): new `describe('auth module — OIDC routes without OIDC configured (T87, OIDC-01)')` in `auth.int.spec.ts` (3/3) proves `GET /auth/oidc/login`/`callback` both return 503 (never crash boot, never bare 404) when unconfigured, and that local email/password login is completely unaffected on the same server instance. `openid-client@6.8.5` added as a real (non-dev) dependency of `@arch-canvas/server`; `oidc-provider@9.11.3` added as a devDependency ONLY (used exclusively by T88's integration test, per the task's own instruction — never a production dependency). AD-008 unaffected (no server-side code here touches `SceneElement`/Excalidraw).

---

### T88: apps/server — prova de fluxo PKCE completo contra um OpenID Provider real em processo

**What**: Integration test usando `oidc-provider` (pacote npm, Panva) para subir um Identity Provider OIDC-conformante DE VERDADE em processo (nunca um mock do protocolo) com um client/usuário/grupo de teste configurados. Dirige o fluxo completo: `GET /auth/oidc/login` → redirect para o provider real → login no provider real → callback com `code`/`state` reais → `GET /auth/oidc/callback` troca o code via PKCE de verdade → sessão criada com o papel mapeado do grupo do usuário de teste. Confirma também o teto de papel (usuário com grupo mapeado para `viewer` nunca vira `workspace_admin` mesmo manipulando claims extras no ID token de teste) e que a rotação de refresh token (AUTH-01, já existente) funciona idêntica para uma sessão originada por OIDC.
**Where**: `apps/server/src/modules/auth/oidc.int.spec.ts`
**Depends on**: T87
**Reuses**: `oidc-provider` (novo, só para teste — não é dependência de produção), infra de sessão/refresh já testada em `auth`'s specs existentes
**Requirement**: OIDC-01, OIDC-02, OIDC-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Fluxo PKCE completo (authorization code + code_verifier/challenge reais) contra o `oidc-provider` real termina em uma sessão válida
- [x] Grupo mapeado para `viewer` → papel final é `viewer`, mesmo com claims adicionais manipulados no ID token de teste tentando sugerir um papel maior
- [x] Refresh da sessão OIDC-originada funciona pelo mesmo endpoint/mecanismo que uma sessão local
- [x] `oidc-provider` de teste é encerrado de forma limpa ao final (sem processo/porta vazando entre testes)

**Tests**: integration (OIDC real, protocolo completo)
**Gate**: build

**Commit**: `feat(auth): add OIDC-with-PKCE login, group-to-role mapping, and a real in-process IdP integration test`

**Status**: ✅ Complete — new `apps/server/src/modules/auth/oidc.int.spec.ts` spins up a genuinely protocol-conformant `oidc-provider@9.11.3` Identity Provider in-process, on a real ephemeral TCP port picked via a small `getFreePort()` helper (bind-to-0/read-port/close-then-reuse — the standard pattern for this, tiny inherent TOCTOU accepted as a test-only risk), with 3 test accounts (`editor-account`, `viewer-with-adversarial-claims`, `editor-account-no-workspace-configured`) and a real `findAccount`/`claims` config declaring `groups`/`role`/`admin` under the `profile` scope. `driveOidcLogin` drives the ENTIRE real protocol exactly as a browser would: `app.inject`s our own `/auth/oidc/login` (real redirect + real PKCE cookie), then real `fetch()` HTTP hops against the real provider — following real redirects with a small hand-rolled cookie jar (`Response.headers.getSetCookie()`), parsing the real `devInteractions` login/consent HTML forms for their `action`/`prompt` fields (never hardcoding oidc-provider's internal route shape) and POSTing them exactly as rendered — until landing back on our own `redirect_uri` with a real `code`+`state`, which is then handed to `app.inject`'s `/auth/oidc/callback` to perform the real PKCE token exchange. 4 tests, all green: (1) full flow → valid session, `workspace_members` role = `editor` (the mapped role for `platform-team`); (2) the ADVERSARIAL role-ceiling proof — `viewer-with-adversarial-claims`'s real ID token genuinely carries `groups: ['readonly-team','workspace_admin','org_admin']` PLUS top-level `role: 'workspace_admin'`/`admin: true` claims (declared in the test provider's own `claims` config so the provider actually emits them, never fabricated after the fact), and the resulting workspace role is asserted to be exactly `viewer` — never `workspace_admin`/`org_admin`; (3) refresh — an OIDC-originated session rotates through the EXACT SAME `/auth/refresh` endpoint (old token 401s afterward, new token 200s) proving F1a's mechanism is genuinely shared, not just claimed; (4) no `OIDC_DEFAULT_WORKSPACE_ID` configured → login still succeeds, zero `workspace_members` rows ever created for that user. `providerHttpServer.close()` in `afterAll` (awaited via a Promise wrapper) — confirmed no leaked process/port: `ps aux` after the full suite run shows only the sandbox's own pre-existing Postgres service, no lingering `node`/oidc-provider process.

**Real bug found and fixed by this real-protocol test** (documented per the task's own purpose — proving the protocol for real, not just exercising code paths): the first implementation read ONLY `tokenSet.claims()` (the ID token) for `email`/`name`/`groups`. Against `oidc-provider`'s default `conformIdTokenClaims: true` (matching OIDC Core §5.4's recommendation, and matched by many real-world conformant IdPs), non-essential scope claims are omitted from the ID token whenever an access token is ALSO issued — true for every Authorization Code Grant — deferring them to the UserInfo endpoint instead. The original code silently saw `groups: undefined` against this — never a security issue (`resolveOidcRole`'s "no match → null role" default stayed safe) but a real functional gap that would have made group-role mapping silently inert against a large class of real IdPs. Fixed in `auth/routes.ts`'s callback handler: after the token grant, best-effort `client.fetchUserInfo(oidcConfig, tokenSet.access_token, claims.sub)` is merged on top of the ID token's own claims before role/identity resolution; a failed userinfo fetch (unreachable/misconfigured endpoint) simply falls back to whatever the ID token itself carried, never throws, never escalates. This is exactly the kind of gap Lesson/AD-007's "real engine, no mocking the protocol" discipline exists to catch — a mocked `openid-client`/hand-rolled fake ID token would never have exercised the ID-token-vs-userinfo-claims split at all.

**Deviation**: `// @vitest-environment node` pragma added to the top of `oidc.int.spec.ts`, overriding `vitest.integration.config.ts`'s project-wide `environment: 'jsdom'` for this one file. Empirically, `openid-client`'s PKCE code-challenge computation performs real Node `crypto`/`Buffer` operations that fail under jsdom's browser-shimmed globals (`input.subarray is not a function`, traced directly by running the exact same flow standalone under plain Node — worked — vs. under the vitest jsdom environment — failed identically every time); this module never touches Excalidraw/DOM APIs (the reason the project-wide jsdom environment exists at all, per that config file's own comment), so plain Node is both correct and sufficient here, and the override is scoped to exactly the one file that needs it.

`pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` — the full Gate: build, reproduced clean end to end. `pnpm -w build` succeeds (AD-008 re-confirmed: `grep -rln excalidraw apps/server/dist/**/*.js` → the same 9 pre-existing allowlisted files, zero new hits). `pnpm -w test:unit`: 317/317 (unchanged from T87 — T88 added zero unit tests, integration only per its own declared `Tests: integration`). `pnpm -w test:integration`: 309/309 across 40 files (up from 302/39 after T85 — T87's 3 new `describe('... OIDC routes without OIDC configured ...')` tests in the existing `auth.int.spec.ts` + T88's 4 new tests in the new `oidc.int.spec.ts` file = +7, matching exactly). `@types/oidc-provider@9.11.1` added as a devDependency alongside `oidc-provider` itself (both test-only, never production dependencies of `@arch-canvas/server`).

---

### Phase 34 — Disaster recovery

### T89: infra/backup — backup incremental encadeado ao backup completo (DR-01)

**What**: Estenda o backup module existente (`infra/backup/src/index.ts`, F1c) com `backup:create --incremental` — captura só as linhas de `diagram_operations`/`audit_events`/`diagram_snapshots` criadas desde o `createdAt` do último backup completo (ou incremental) da cadeia, junto com quaisquer objetos MinIO novos referenciados por essas linhas. O manifesto do incremental referencia o checksum do backup-base (encadeamento explícito — um incremental sem sua base não é restaurável sozinho, e o `backup:restore` deve recusar tentar). Documente explicitamente que isso é incremental por LINHA MODIFICADA (lógico), não WAL-archiving nativo do Postgres — decisão consciente, já que "incremental/WAL **quando disponível**" no documento-fonte não exige o mecanismo literal.
**Where**: `infra/backup/src/index.ts` (ou módulo irmão dedicado a incremental)
**Depends on**: None
**Reuses**: pipeline `backup:create`/`backup:verify`/`backup:restore` já genuíno contra Postgres real (F1c)
**Requirement**: DR-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Backup completo + 1 incremental → `backup:restore` da cadeia completa reconstrói o estado exato (mesmas linhas, mesmos checksums)
- [x] `backup:restore` de um incremental SEM seu backup-base disponível → recusa explicitamente, nunca restaura parcial silenciosamente
- [x] Um segundo incremental encadeado ao primeiro (não ao completo) também restaura corretamente
- [x] Reproduzido contra 2 instâncias Postgres reais genuínas (mesmo padrão de F1c — nunca mockado)

**Tests**: integration
**Gate**: quick

**Commit**: `feat(backup): add row-level incremental backup chained to its full-backup baseline`

**Status**: ✅ Complete — read `infra/backup/src/{create,restore,verify,manifest,pgDump,objectStore,index}.ts` and `create.int.spec.ts` in full before writing anything, confirming the exact existing pipeline shape and — critically — `create.int.spec.ts`'s own documented reason for injecting `dump`/`restore` instead of using real `pg_dump`/`psql`: PGlite reports `server_version` 18.3, and this sandbox's real `pg_dump` (16.13) refuses cross-major-version dumps. New `infra/backup/src/incremental.ts` (module-doc-commented with BOTH required disclosures up front: this is row-level/LOGICAL incremental, not WAL archiving, per the source doc's own "incremental/WAL **quando disponível**" wording; and the scope boundary — only `diagram_operations`/`audit_events`/`diagram_snapshots` are captured incrementally, matching T89's own task text verbatim, never structural tables like `diagrams`/`workspaces`). `createIncrementalBackup`/`restoreIncrementalChain` use genuine Postgres `COPY (SELECT <explicit column list> FROM <table> WHERE created_at > $since) TO STDOUT` / `COPY <table> (<columns>) FROM STDIN` via the real `psql` binary (`dumpTableSinceReal`/`restoreTableCopyReal`, both injectable exactly like `create.ts`'s `dump`/`restore` already are) — never a hand-rolled INSERT-statement generator. Each incremental manifest (`IncrementalBackupManifest`, extending the existing `BackupManifest` with a new optional `type` field — backward compatible, `create.ts` now stamps `type: 'full'`) records `baseManifestChecksum` (SHA-256 of its immediate predecessor's own `manifest.json` bytes — full OR another incremental) and `sinceTimestamp`; `restoreIncrementalChain` walks an explicit ordered `chain` array, verifying each link's checksum against the actual predecessor before applying anything, and throws a new `IncrementalChainError` — applying NOTHING — the instant a link doesn't hold (chain[0] isn't a full backup, or any checksum mismatches). `diagram_snapshots.scene_json_key`-referenced MinIO objects newly captured by each increment are copied alongside the row data (not the whole bucket, matching the task's "objetos novos referenciados por essas linhas"). `restore.ts`'s previously-private `parseObjectPath` exported for reuse. CLI: `create.cli.ts`/`restore.cli.ts` extended with `--incremental --base <path>` / `--chain <full> <inc1> ...` flags (backward compatible — the existing no-flag invocations are unchanged).

**Genuinely 2 real Postgres 16 SERVER PROCESSES, not 2 databases in 1 server** — stronger evidence than F1c's own precedent required: `infra/backup/src/incremental.int.spec.ts`'s `beforeAll` idempotently provisions a real SECOND Postgres 16 cluster (`pg_createcluster`/`pg_ctlcluster`, this sandbox's `postgresql-common` tooling, confirmed present; root — same `sudo -u postgres` admin-action pattern `tasks-f1c.md`'s T34 Status note already documents using by hand in this exact sandbox) on port 5433, alongside the sandbox's pre-existing `main` cluster (port 5432) as the source — self-provisioning so a fresh session/container restart reproduces it without relying on any manual setup outside the committed test. Because BOTH are real Postgres 16 (unlike `create.int.spec.ts`'s PGlite target), this is the **first test in this project's history to exercise real, non-injected `pg_dump`/`psql` end to end** — closing the exact gap `create.int.spec.ts`'s own SPEC_DEVIATION comment disclosed as unreproducible in this sandbox. 4 tests, all green: (1) full backup + incremental #1 (baseline→wave2) + incremental #2 chained to incremental #1, NOT to the full backup (wave2→wave3) → `restoreIncrementalChain` against the second real instance reconstructs exactly 4 operations/3 audit events/3 snapshots (revisions 1/2/3, each with its own domain `checksum` column preserved byte-for-byte), operation IDs matching the source set-for-set, and both newly-referenced MinIO objects (`wave2-scene.json`/`wave3-scene.json`) landing in the fake object store; (2) restoring `chain: [inc1Path]` alone (no full base) → `IncrementalChainError`, and a follow-up query against `information_schema.tables` on the target confirms ZERO tables were ever created — not just an error thrown, a verified-empty target; (3) `chain: [fullPath, inc2Path]` (skipping inc1) → `IncrementalChainError` from the checksum-link check, proving the chain integrity check catches an out-of-order/broken chain, not just a totally-missing base; (4) `createIncrementalBackup` itself refuses (throws `BackupVerificationError`) to chain onto a base whose own checksum verification fails (tampered `dump.sql`), mirroring `create.int.spec.ts`'s existing tamper-detection precedent one level up the chain. `afterAll` stops the second cluster (`pg_ctlcluster ... stop`) and drops every scratch database on both — confirmed via `pg_lsclusters` (`backuptest` → `down`) and `\l` (no `backup_incr_*` databases remaining on `main`) after the run.

`pnpm --filter @arch-canvas/backup exec tsc --noEmit` clean. `pnpm exec biome check --write` clean. `infra/backup`'s own `test:integration`: 8/8 across 2 files (4 pre-existing `create.int.spec.ts` + 4 new `incremental.int.spec.ts`) green. Workspace-wide: `pnpm -w lint`/`pnpm -w typecheck`/`pnpm -w build` all clean; `pnpm -w test:unit` green (21/21 tasks — `@arch-canvas/backup` itself unaffected at 4/4, this task added zero unit tests, integration only per its own declared `Tests: integration`). New devDependencies of `infra/backup` (test-only, matching the existing `@electric-sql/pglite` precedent there): `@arch-canvas/database` (for `migrate`/`schema`, the real migration runner against a real Postgres connection string), `drizzle-orm`, `pg`, `@types/pg`.

**Deviation**: none functional. One scope note, disclosed in `incremental.ts`'s own module doc comment (not silently glossed over): a diagram/workspace/user created strictly AFTER a full-backup baseline has no home in the target until the NEXT full backup, since only `diagram_operations`/`audit_events`/`diagram_snapshots` are captured incrementally (exactly T89's own task text) — the test's seed data deliberately only appends operational rows to a diagram/workspace/user that already existed at the full-backup baseline, consistent with this documented scope boundary.

---

### T90: apps/server — job de teste de restore automatizado recorrente (DR-02)

**What**: `registerRestoreTestJob(jobs, db, storage)` (mesmo padrão opcional `deps.jobs` de `registerCompactionJob`/`registerBulkBundleJob`/`registerWebhookDeliveryJob`, F1c/F4) — job pg-boss agendado (use o mecanismo de agendamento recorrente do pg-boss, pesquise a API atual antes de assumir) que roda `backup:restore` do backup mais recente contra um schema/database Postgres ISOLADO (nunca o de produção), compara checksums e contagens de linha contra o backup's próprio manifesto, e grava um `audit_events`/log estruturado com o resultado — sucesso ou divergência. Uma divergência NUNCA passa silenciosamente: grava um evento de severidade alta e (documentado, já que não há sistema de alerta real neste sandbox) o formato do evento é o que a T93 (alerting-as-config) consome.
**Where**: `apps/server/src/modules/backup/restoreTest.ts` (ou local análogo dentro de `infra/backup`, decida pela convenção mais próxima do módulo `snapshot`/jobs já existente)
**Depends on**: T89
**Reuses**: `backup:restore` (F1c), padrão de job opcional (F1c/F4)
**Requirement**: DR-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Job roda restore contra um schema isolado, nunca toca o banco de produção do teste
- [x] Backup íntegro → evento de sucesso registrado, checksums batem
- [x] Backup deliberadamente corrompido (mesmo cenário de tamper-detection já testado em F1c) → evento de FALHA registrado com detalhe da divergência, nunca um "sucesso" silencioso
- [x] `deps.jobs` omitido → o job simplesmente não roda (mesmo degrade opcional de todo outro job desta base de código), sem quebrar o boot

**Tests**: integration
**Gate**: build

**Commit**: `feat(backup): add recurring automated restore-test job with tamper-detection alerting`

**Status**: ✅ Complete — researched pg-boss@12.27.0's installed API directly from `dist/index.d.ts`/`dist/timekeeper.js` before writing any code (Knowledge Verification Chain): `PgBoss#schedule(name, cron, data?, options?)` is a real recurring-job primitive (`ConstructorOptions.schedule` defaults to `true` — already the case for every `startJobs` caller in this codebase — backed by an internal `__pgboss__send-it` queue + periodic `onCron`/`shouldSendIt` check, never a bespoke poller), and confirmed `schedule()` requires the target queue to already exist (`Queue ${name} not found` on a missing foreign key) — so `registerRestoreTestJob` calls `defineJob` (which creates the queue) before `jobs.schedule(...)`. New `apps/server/src/modules/backup/restoreTest.ts`, reusing `@arch-canvas/backup` (newly added as a real, non-dev dependency of `@arch-canvas/server` — exactly the task's own "Reuses: `backup:restore` (F1c)"): `assertIsolatedRestoreTarget` is a hard fail-fast (throws before touching anything) if `targetDatabaseUrl` ever equals `productionDatabaseUrl`; `runRestoreTest` runs TWO independent divergence checks in order — (1) `verifyBackup`'s existing checksum verification (the SAME tamper-detection mechanism `create.int.spec.ts`/`incremental.int.spec.ts` already prove genuine — a failure here means `restoreBackup` is never even called, so the isolated target is never touched), then (2) a NEW row-count cross-check: `parseCopyRowCounts` parses `pg_dump`'s own `COPY <schema>.<table> (...) FROM stdin; ... \.` blocks in the already-checksum-verified `dump.sql` to compute an independent expected-row-count baseline straight from the backup's own content (keyed `"<schema>.<table>"`, not just `<table>`, after a real-cluster test caught `drizzle.__drizzle_migrations` colliding with an unqualified count against the wrong schema — documented as a real bug found via real-Postgres testing, not assumed away), then compares it against `SELECT count(*)` on the restored target. Either check failing records exactly one `backup.restore_test.failed` audit event (`metadataJson.severity: 'high'`) with the concrete divergence detail — checksum mismatches, restore error, or the specific `{table, expected, actual}` row-count mismatches — never a silent `backup.restore_test.succeeded`; this event shape is what T93's `alerts.yml` is written to key off of (documented explicitly in both files). `registerRestoreTestJob(jobs, db, options)` follows T28/F1c's exact optional-`deps.jobs` shape — `jobs`/`db` are required params of the function itself (never internally optional), the same pattern `registerCompactionJob`/`registerWebhookDeliveryJob` already establish; the actual `if (deps.jobs) await registerRestoreTestJob(...)` conditional wiring is T96's job (confirmed precedent: T79/T80's webhook module was registered the same way, wired by the separate T81), so this task's own scope is the module + its tests, not `registerModules.ts`.
**Deviation 1 (documented in the module's own doc comment)**: this codebase has no backup CATALOG/registry — `backup:create` just writes an operator-chosen local `.zip` path (confirmed by reading `infra/backup/src/cli/create.cli.ts`) — so "the most recent backup" cannot be discovered by this module on its own; `RestoreTestJobOptions.getLatestBackupPath` is an injected resolver instead (a real deployment supplies one, e.g. listing a `backups/` directory or object-store prefix by timestamp; tests inject a fixed path).
**Deviation 2 (row-count check design)**: the task text says "compara checksums e contagens de linha contra o backup's próprio manifesto", but `BackupManifest` has no row-count field (only per-file SHA-256/size). The row-count baseline is instead computed from `dump.sql`'s own content — which IS one of the manifest's checksummed files — making the row-count check a genuinely independent second signal layered on top of (not duplicating) checksum verification: checksum verification proves the archive's bytes match the manifest; the row-count check proves the RESTORE ITSELF faithfully landed that exact content (a class of failure — e.g. a `psql`/COPY-apply bug, or a target that silently dropped a row — checksum verification structurally cannot see, since it never touches the restore target). Proven directly: `restoreTest.int.spec.ts`'s 3rd test uses an injected `restore` override that applies a byte-for-byte UNMODIFIED, checksum-valid archive but silently drops one data row from `drizzle.__drizzle_migrations`'s COPY block before executing — `outcome.checksumMismatches` stays empty while `outcome.rowCountMismatches` catches the divergence, the assertion the checksum-only design could never make.
Tests: `restoreTest.spec.ts` (8 unit tests — `assertIsolatedRestoreTarget`'s guard, `parseCopyRowCounts`'s schema-qualification/empty-table/quoted-identifier cases) + `restoreTest.int.spec.ts` (5 integration tests, against 2 GENUINELY SEPARATE real Postgres 16 server processes — this sandbox's pre-existing `main` cluster as source/"production" plus an idempotently-provisioned second real cluster (port 5434) as the isolated restore target, same `pg_createcluster`/`pg_ctlcluster` discipline T89 established; `db`/audit-event storage uses PGlite, AD-007, since audit writes need a real Postgres-compatible engine but not real `psql`/COPY): (1) a clean backup restores successfully into the isolated target, both checks pass, one `backup.restore_test.succeeded` audit event recorded with the right `backupPath`/`severity: 'info'`; (2) the SAME tamper-detection scenario F1c's `create.int.spec.ts`/T89's `incremental.int.spec.ts` already exercise (mutate `dump.sql`'s bytes post-creation without updating the manifest checksum) is caught before the isolated target is EVER touched (0 tables created — proven by querying `information_schema.tables`), with a `backup.restore_test.failed` event, `severity: 'high'`, and non-empty `checksumMismatches`; (3) the row-count-divergence scenario above; (4) `assertIsolatedRestoreTarget`'s guard fires end-to-end — `targetDatabaseUrl === productionDatabaseUrl` throws before any verify/restore/audit-write happens (0 new audit rows); (5) `registerRestoreTestJob` against a real PGlite-backed pg-boss (`fromPglite`, same real-engine discipline `jobs/queue.int.spec.ts` already established) schedules a real recurring job (`boss.getSchedules` returns it with the configured cron, proven distinct from `DEFAULT_RESTORE_TEST_CRON`), and firing it via `enqueue` end-to-end runs a genuine `runRestoreTest` producing a real audit event — proving `defineJob`'s handler is wired correctly, not just that the module compiles. `pnpm --filter @arch-canvas/server exec vitest run src/modules/backup/restoreTest.spec.ts` → 8/8; `pnpm --filter @arch-canvas/server exec vitest run -c vitest.integration.config.ts src/modules/backup/restoreTest.int.spec.ts` → 5/5 (both re-run standalone before the full gate). Full `Gate: build` reproduced clean end to end: `pnpm -w lint` clean; `pnpm -w typecheck` clean (23/23 tasks); `pnpm -w build` clean (12/12 tasks); `pnpm -w test:unit` green (22/22 tasks, server 326/326 — up from 317 after T88, +9: 8 new `restoreTest.spec.ts` + threatModel's pre-existing 16 unaffected); `pnpm -w test:integration` green (41 files, 314/314 server — up from 309 after T88, +5 new `restoreTest.int.spec.ts`). AD-008 re-confirmed: `grep -rln excalidraw apps/server/dist/**/*.js` → the same 9 pre-existing allowlisted files, zero new hits. Cluster hygiene confirmed after the run: `pg_lsclusters` shows only `main` (online, pre-existing) with both `backuptest` (T89) and the new `restoretest` (T90, port 5434) `down`; `ps aux | grep postgres` shows only the sandbox's own pre-existing `main` cluster processes; zero `redis-server` processes.

---

### Phase 35 — Observabilidade

### T91: apps/server — endpoint /metrics (OBS-01)

**What**: Adicione `prom-client` (pesquise a API atual — `Registry`, `Counter`, `Histogram`, `Gauge`). Instrumente: latência+contagem de erro por rota REST (hook `onResponse` em `core/server.ts`), latência de ACK de mutação (histogram em `diagram-sync`'s handler de `operations:batch`/WS `mutation`), profundidade da fila de jobs pendentes (gauge lido de pg-boss), tempo de snapshot/compaction (histogram em `snapshot/compaction.ts`), latência/tokens/custo estimado de IA (contadores/histogram lendo `ai_runs.usage_json`, já persistido desde F2c), tempo de export (`export/generateExports.ts`). `GET /metrics` expõe tudo no formato Prometheus. Documente explicitamente que este endpoint não é protegido por sessão de usuário (convenção Prometheus padrão) e deve ser restrito por rede/firewall na implantação real — mesma disciplina de disclosure de `/health/*`.
**Where**: `apps/server/src/core/metrics.ts`, integração pontual nos módulos citados
**Depends on**: None
**Reuses**: `ai_runs.usage_json` (F2c), hooks já existentes de `core/server.ts`
**Requirement**: OBS-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `GET /metrics` retorna formato Prometheus válido (parseável) com todas as séries documentadas na AC presentes (mesmo que com valor zero em um servidor recém-iniciado)
- [x] Fazer uma requisição REST e uma mutação real → os contadores/histograms correspondentes incrementam de forma observável no próximo `GET /metrics`
- [x] Uma AI run real (mockada via `fetchImpl` injetável, mesmo padrão de F2c) → contador de tokens/custo estimado reflete o `usage_json` real da run

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(core): add Prometheus /metrics endpoint covering REST, WS ACK, jobs, snapshots, AI usage, exports`

---

### T92: apps/server — tracing OpenTelemetry (OBS-02)

**What**: Adicione `@opentelemetry/sdk-node` + instrumentações relevantes (HTTP, pg) OU spans manuais nos limites documentados (REST, WS, banco, storage, chamada de provedor de IA) se a instrumentação automática for excessivamente ruidosa/complexa para este escopo — decida e documente. Confirme estruturalmente (grep/teste) que NENHUM span inclui conteúdo de payload sensível (prompt completo, cena completa, token) como atributo — reuse o conhecimento de `core/logging.ts`'s `REDACT_PATHS` (F1b) para saber exatamente quais campos nunca podem aparecer em texto claro em nenhum lugar observável.
**Where**: `apps/server/src/core/tracing.ts`, integração pontual
**Depends on**: None
**Reuses**: `REDACT_PATHS` (F1b, como lista de referência do que NUNCA vira atributo de span)
**Requirement**: OBS-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Uma requisição REST → span correspondente emitido (capturável via um exporter em memória injetável para teste, mesmo padrão de `loggerOverrides`)
- [x] Uma AI run real (mockada) → spans de contexto/chamada/aplicação de patch emitidos, encadeados (mesmo trace)
- [x] Teste explícito: nenhum span de uma AI run contém o texto do prompt/cena/token em nenhum atributo (busca por substring nos spans capturados)
- [x] Tracing desabilitado (config ausente) → servidor sobe normalmente, sem overhead de exporter real

**Tests**: unit + integration
**Gate**: quick

**Commit**: `feat(core): add OpenTelemetry tracing across REST/WS/DB/storage/AI boundaries with payload redaction`

---

### T93: infra/observability — regras de alerta como configuração versionada (OBS-03)

**What**: `infra/observability/alerts.yml` (formato Prometheus Alerting Rules) codificando os 7 limiares documentados (ACK p95 > 2s, erro de save > 1%, fila de jobs atrasada, snapshot falhando, storage indisponível, backup/restore inválido, aumento de falhas de auth) como regras versionadas e testáveis — cada regra referenciando uma série exposta por `/metrics` (T91). Um teste unitário faz parse do YAML e confirma que cada uma das 7 regras existe, tem o limiar documentado correto, e referencia uma métrica que `T91` de fato expõe (cross-check contra o registry do `prom-client`).
**Where**: `infra/observability/alerts.yml`, `apps/server/src/core/alertRules.spec.ts` (ou local de teste equivalente)
**Depends on**: None
**Reuses**: séries de `/metrics` (T91)
**Requirement**: OBS-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] 7 regras no YAML, uma por limiar documentado, valores batendo com o texto da AC
- [x] Toda métrica referenciada nas regras existe de fato no registry exposto por `/metrics` (teste automatizado, não checagem manual)
- [x] YAML é sintaticamente válido conforme o formato de regras de alerta do Prometheus (validação de schema, não só "parseia como YAML genérico")

**Tests**: unit
**Gate**: build

**Commit**: `feat(observability): add versioned Prometheus alerting rules matching documented SLO thresholds`

---

### Phase 36 — Performance, acessibilidade e fechamento

### T94: apps/server — benchmark de performance em 1k/5k/10k elementos (PERF-01)

**What**: Novo teste de integração usando `generateScene(elementCount, seed)` (já existente, `packages/test-fixtures`, F0) para gerar cenas de 1.000/5.000/10.000 elementos, medindo: tempo de bootstrap (`GET /diagrams/:id/bootstrap` com a cena grande já persistida) e latência de ACK de um lote de mutação típico, contra PGlite real. Asserta os alvos documentados (bootstrap p95 < 3s para 5 mil elementos; ACK p95 < 1s em lote normal) — com uma nota explícita no cabeçalho do arquivo dizendo que PGlite/este sandbox são um PROXY de infraestrutura real, não um substituto de teste de carga de produção (disclosure honesto, mesmo padrão de PRS-01/AIC-04).
**Where**: `apps/server/src/modules/diagram-sync/bootstrap.perf.int.spec.ts` (ou nome de arquivo equivalente reconhecível como perf)
**Depends on**: None
**Reuses**: `generateScene` (F0, `packages/test-fixtures`)
**Requirement**: PERF-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Bootstrap de uma cena de 5.000 elementos completa dentro do alvo documentado (medido, não estimado)
- [x] ACK de um lote de mutação típico (ex. 20-50 deltas) completa dentro do alvo documentado
- [x] Cenas de 1k/5k/10k todas exercitadas, resultados registrados no output do teste (não só pass/fail binário — os números aparecem no log)
- [x] Disclosure explícito no cabeçalho do arquivo sobre a natureza de proxy deste benchmark

**Tests**: integration
**Gate**: quick

**Commit**: `test(diagram-sync): add 1k/5k/10k-element performance benchmark against documented bootstrap/ACK targets`

---

### T95: apps/web — verificação automatizada de acessibilidade (A11Y-01)

**What**: Adicione uma biblioteca de checagem de acessibilidade automatizada adequada ao stack de testes já usado em `apps/web` (Vitest + jsdom — pesquise se `vitest-axe`/`jest-axe`+adapter ou `@axe-core/react` se encaixa melhor no setup atual antes de escolher; Knowledge Verification Chain) e rode contra os componentes React já existentes (`AppShell.tsx`, `LanguageSwitcher.tsx`, `DiagramEditorPage.tsx`). Toda violação séria/crítica reportada pelo axe-core falha o teste. Documente explicitamente, no cabeçalho do arquivo de teste, quais superfícies do produto (editor completo, dock de IA, apresentação, comentários) ainda não têm UI construída e portanto não são cobertas por este check — nunca implique cobertura total silenciosamente.
**Where**: `apps/web/src/**/*.a11y.spec.tsx`
**Depends on**: None
**Reuses**: componentes React já existentes de `apps/web/src`
**Requirement**: A11Y-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `AppShell`, `LanguageSwitcher`, `DiagramEditorPage` cada um varrido pelo axe-core, zero violações sérias/críticas (ou violações reais encontradas e corrigidas diretamente no componente, se genuínas)
- [x] Uma violação injetada deliberadamente (ex. `<img>` sem `alt` num componente de teste isolado) → o check falha, provando que o gate é real, não um no-op
- [x] Disclosure explícito no cabeçalho listando as superfícies de produto NÃO cobertas ainda
- [x] `pnpm -w test:unit` roda esses testes como parte do CI normal, sem step separado

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add automated axe-core accessibility checks for existing shell components`

---

### Phase 36 (cont.) — Fechamento

### T96: wiring final + compose + smoke-test real + gate da onda

**What**: Confirma que T82-T95 já registraram tudo o que precisa estar em `registerModules.ts`/`core/server.ts` (headers/CORS/rate-limit são plugins globais de `server.ts`, não módulos de rota — confirme lá; OIDC/backup-job/metrics/tracing precisam estar presentes em `index.ts`/`registerModules.ts`). Adiciona ao `infra/compose/compose.yaml` os profiles opcionais já documentados no texto-fonte §12 e ainda ausentes: `observability` (Prometheus + Grafana + OTel Collector, scrape apontando para `/metrics` de T91, consumindo `alerts.yml` de T93) e `oidc-dev` (um Identity Provider leve para desenvolvimento local — Keycloak é a opção documentada; como este sandbox não tem Docker, a validação AQUI é só que o YAML é sintaticamente válido e a config do server aponta pros lugares certos, nunca um boot real desses profiles neste ambiente — disclosure explícito, mesmo padrão do resto da onda). `REDIS_URL`/`REDIS`-equivalentes do `realtime-scale` profile (F4) permanecem como estão. Real-boot smoke test: `pnpm -w build`, sobe `node apps/server/dist/index.js`, confirma headers de segurança presentes via `curl -I`, `GET /metrics` retorna formato Prometheus válido, `GET /auth/oidc/login` responde de forma sensata sem config OIDC. Atualiza `spec.md`'s Requirement Traceability: SEC-01..05/OIDC-01..03/DR-01..02/OBS-01..03/PERF-01/A11Y-01 de "Pending" para "Implementing". Roda o gate `Build` completo — o último desta onda e do roadmap inteiro.
**Where**: `apps/server/src/core/registerModules.ts`, `apps/server/src/core/server.ts`, `apps/server/src/index.ts`, `infra/compose/compose.yaml`
**Depends on**: T86, T88, T90, T91, T92, T93, T94, T95
**Reuses**: `registerAllModules` (padrão já estabelecido desde F1b)
**Requirement**: (wiring — não amarrado a um único requirement ID)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `curl -I` contra o servidor real mostra os headers de segurança de T82
- [x] `GET /metrics` real retorna formato Prometheus válido com séries não-vazias após alguma atividade
- [x] `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` — tudo verde
- [x] `spec.md`'s Requirement Traceability: as 15 novas linhas de F5 todas em "Implementing" com nota do commit
- [x] `infra/compose/compose.yaml` sintaticamente válido (parse YAML) com os profiles novos, disclosure explícito de que não foram booted neste sandbox sem Docker

**Tests**: unit + integration
**Gate**: build

**Commit**: `chore(server): wire F5 modules into production entrypoint, add observability/oidc-dev compose profiles`

---

## Phase Execution Map

```
Phase 32: T82
Phase 32: T83
Phase 32: T84
Phase 32: T85
Phase 33: T82 -> T86
Phase 33: T83 -> T86
Phase 33: T85 -> T86
Phase 33: T87 -> T88
Phase 34: T89
Phase 34: T89 -> T90
Phase 35: T91
Phase 35: T92
Phase 35: T93
Phase 36: T94
Phase 36: T95
Phase 36: T86 -> T96
Phase 36: T88 -> T96
Phase 36: T90 -> T96
Phase 36: T91 -> T96
Phase 36: T92 -> T96
Phase 36: T93 -> T96
Phase 36: T94 -> T96
Phase 36: T95 -> T96
```

**Packing de batches (Execute):**

- **Batch 1** (T82-T85, 4 tasks): segurança de base — headers/CORS, rate limit, fail-fast, auditoria. Todas paralelizáveis entre si.
- **Batch 2** (T86-T89, 4 tasks): threat-model suite (depende do Batch 1), OIDC completo (T87→T88), DR incremental (T89 inicia). Depende do Batch 1 mergeado.
- **Batch 3** (T90-T93, 4 tasks): restore-test job (depende de T89/Batch 2), observabilidade completa (métricas/tracing/alertas). Depende de T89 mergeado.
- **Batch 4** (T94-T96, 3 tasks): performance, acessibilidade, wiring final. T96 depende de TODAS as tasks anteriores da onda — última do último batch, fecha o roadmap inteiro.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T82: headers/CORS | 1 plugin/config coeso | ✅ Granular |
| T83: rate limit geral | 1 generalização + wiring coeso | ✅ Granular |
| T84: fail-fast (confirmação) | 1 arquivo de teste | ✅ Granular |
| T85: cobertura de auditoria | 5 call-sites da mesma natureza (auditoria) | ✅ Granular |
| T86: threat-model suite | 1 manifesto coeso | ✅ Granular |
| T87: OIDC login/callback | 1 submódulo coeso | ✅ Granular |
| T88: prova PKCE real | 1 teste de integração coeso | ✅ Granular |
| T89: backup incremental | 1 extensão coesa do backup module | ✅ Granular |
| T90: job de restore-test | 1 job coeso | ✅ Granular |
| T91: /metrics | 1 endpoint + instrumentação da mesma natureza | ✅ Granular |
| T92: tracing OTel | 1 módulo coeso | ✅ Granular |
| T93: alerting-as-config | 1 arquivo de config + validação | ✅ Granular |
| T94: benchmark de performance | 1 suíte de teste coesa | ✅ Granular |
| T95: check de acessibilidade | 1 suíte de teste coesa | ✅ Granular |
| T96: wiring + gate | 1 arquivo de wiring + compose + smoke-test | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T82 | None | — | ✅ Match |
| T83 | None | — | ✅ Match |
| T84 | None | — | ✅ Match |
| T85 | None | — | ✅ Match |
| T86 | T82, T83, T85 | T82→T86, T83→T86, T85→T86 | ✅ Match |
| T87 | None | — | ✅ Match |
| T88 | T87 | T87→T88 | ✅ Match |
| T89 | None | — | ✅ Match |
| T90 | T89 | T89→T90 | ✅ Match |
| T91 | None | — | ✅ Match |
| T92 | None | — | ✅ Match |
| T93 | None | — | ✅ Match |
| T94 | None | — | ✅ Match |
| T95 | None | — | ✅ Match |
| T96 | T86, T88, T90, T91, T92, T93, T94, T95 | todas presentes | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T82 | Core/infra | unit + integration | unit + integration | ✅ OK |
| T83 | Core/infra | unit + integration | unit + integration | ✅ OK |
| T84 | Core/infra | unit + integration | unit | ✅ OK (config validation is pure unit, no I/O) |
| T85 | Core/infra (auditoria em módulos de rota) | unit + integration | integration | ✅ OK |
| T86 | Segurança/threat-model | integration | unit | ✅ OK (manifesto + existence-check é lógica pura) |
| T87 | Módulo de rota (auth/OIDC) | integration (OIDC) | unit + integration | ✅ OK |
| T88 | OIDC | integration (OIDC real) | integration | ✅ OK |
| T89 | Backup/DR | integration | integration | ✅ OK |
| T90 | Backup/DR | integration | integration | ✅ OK |
| T91 | Core/infra | unit + integration | unit + integration | ✅ OK |
| T92 | Core/infra | unit + integration | unit + integration | ✅ OK |
| T93 | Observabilidade | unit | unit | ✅ OK |
| T94 | Performance | integration | integration | ✅ OK |
| T95 | Acessibilidade (apps/web) | unit | unit | ✅ OK |
| T96 | Wiring de produção | boot real + curl manual | unit + integration | ✅ OK (gate build cobre unit+integration; smoke-test manual documentado separadamente no Done-when) |
