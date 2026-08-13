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
