# Architecture Canvas Tasks — Onda 3a: F2 Biblioteca de Componentes e Configuração de IA

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow.

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** primeira sub-onda de **F2 (IA geradora)** — as duas fundações independentes e pré-requisito de tudo que segue: a biblioteca de componentes com metadados semânticos (história "P1: Biblioteca de componentes e metadados semânticos", LIB-01..04) e a configuração segura de provider de IA (história "P1: Configuração segura de provider de IA", AIC-01..04). **Não cobre** ainda a IR declarativa/layout (onda F2b) nem o agente de IA propriamente dito (onda F2c) — ambas dependem do que esta onda entrega (biblioteca resolvível por `stable_key`, provider configurado e testável).

Depende de `apps/server/src/modules/workspace` (RBAC, onda F1a) e `packages/database` (onda F0/F1a) já existirem. Não depende de F1b/F1c (persistência de canvas/export) — pode ser executada em paralelo a elas.

---

## Test Coverage Matrix

> Reaproveitada das ondas anteriores.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domínio (`packages/*`) | unit | Todos os branches; 1:1 com ACs; edge cases cobertos | `packages/*/src/**/*.spec.ts` | `pnpm -w test:unit` |
| Módulos/rotas do server (`apps/server/src/modules/*`) | unit + integration (PGlite) | Toda rota: happy + edge + error; authz contra store real | `apps/server/src/**/*.spec.ts`, `apps/server/**/*.int.spec.ts` | `pnpm -w test:unit` / `pnpm -w test:integration` |
| Ícones/manifesto de biblioteca (dados estáticos) | unit (validação de schema/licença) | Todo item tem licença+atribuição validadas por schema | `packages/library-content/**/*.spec.ts` | `pnpm -w test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Full | Tasks com testes integration | `pnpm -w test:unit && pnpm -w test:integration` |
| Build | Última task da onda — inclui lint/typecheck/build | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` |

---

## Execution Plan

### Phase 16: Biblioteca de componentes

```
T37 -> T38 -> T39
```

### Phase 17: Configuração segura de provider de IA

```
T40
T41
T40 -> T42
T41 -> T42
```

---

## Task Breakdown

### Phase 16 — Biblioteca de componentes

### T37: packages/library-content — manifesto de componentes genéricos + AWS com licença

**What**: Pacote de dados (`packages/library-content/`) com um manifesto JSON/TS de componentes curados cobrindo as categorias do documento-fonte (compute, containers, serverless, storage, database, networking, security, observability, messaging, integration, user/client, external system) e um subconjunto real de ícones AWS (comece com um conjunto pequeno mas genuíno — ex.: EC2, S3, RDS, Lambda, API Gateway, VPC, CloudFront — priorize licença correta sobre quantidade). Cada item: `stableKey`, `name`, `category`, `aliases`, `description`, `tags`, `color`, `iconSvg` (ou referência a um arquivo SVG), `version`, `license`, `attribution`. Schema Zod valida que **todo item tem `license` e `attribution` não vazios** — isso é a garantia central desta task (§3.5 do documento-fonte: "ícones devem possuir licença e atribuição registradas"). Para os ícones AWS, use o AWS Architecture Icons oficial (verifique os termos de uso atuais da AWS antes de incluir qualquer arquivo — Knowledge Verification Chain: documentação oficial da AWS primeiro; se não for possível confirmar a licença de um ícone específico neste ambiente, não o inclua e documente a limitação em vez de assumir).
**Where**: `packages/library-content/`
**Depends on**: None
**Reuses**: convenções de pacote já estabelecidas (tsconfig/vitest)
**Requirement**: LIB-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Manifesto valida contra o schema Zod; nenhum item passa sem `license`/`attribution`
- [ ] Cobertura das 12 categorias com pelo menos 1 componente genérico cada
- [ ] Pelo menos 5 componentes AWS reais com licença verificada e documentada na fonte do dado
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(library-content): add licensed generic and aws component manifest`

---

### T38: packages/database — diagram_elements_meta e libraries/library_items

**What**: Migration + schema para `diagram_elements_meta` (`diagram_id`, `element_id`, `semantic_type`, `metadata_json`, `revision` — chave composta `(diagram_id, element_id)`), `libraries` (`workspace_id` nullable, `name`, `version`, `license`, `manifest_json`, `enabled`) e `library_items` (`library_id`, `stable_key`, `version`, `scene_json`, `metadata_json`, `icon_key`). Seed inicial: registra o manifesto de T37 como a `library` global (`workspace_id IS NULL`) com seus `library_items`.
**Where**: `packages/database/`
**Depends on**: T37
**Reuses**: padrão de migration já estabelecido; consome o manifesto de T37 para o seed
**Requirement**: LIB-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Migration aplica limpa sobre as anteriores
- [ ] Seed insere todos os itens do manifesto de T37 como `library_items` da library global
- [ ] `diagram_elements_meta` tem chave primária composta `(diagram_id, element_id)` — upsert idempotente por elemento
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(database): add semantic metadata and library schema with seed`

---

### T39: apps/server — rotas de biblioteca, metadados semânticos e inventário

**What**: Em `apps/server/src/modules/library/`: `GET /libraries` (lista libraries autorizadas — global + do workspace), `GET/PATCH /diagrams/{id}/elements/{elementId}/metadata` (lê/atualiza `diagram_elements_meta`, **nunca** toca nos tipos/campos upstream do Excalidraw — os dados ficam inteiramente no modelo próprio, vinculados só por `elementId`), `GET /diagrams/{id}/inventory` (exporta CSV e JSON — `?format=csv|json` — dos componentes e relações semânticas do diagrama, juntando `diagram_elements_meta` com os elementos correntes da cena). RBAC: leitura exige `diagram:read`; escrita de metadados exige `diagram:write` (não `diagram:mutate` — editar um campo de metadado não é mutar geometria do canvas, mas ainda assim `reviewer` não deve poder, conforme F1a).
**Where**: `apps/server/src/modules/library/`
**Depends on**: T38
**Reuses**: RBAC de `packages/auth` (F1a), padrão de rotas de `apps/server/src/modules/workspace`
**Requirement**: LIB-03, LIB-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Metadados persistidos são lidos de volta corretamente, vinculados a `elementId` e à revisão corrente
- [ ] Export de inventário em CSV e em JSON confere com os dados persistidos (mesmo conteúdo, formatos diferentes)
- [ ] `reviewer` recebe 403 ao tentar `PATCH` de metadados
- [ ] Gate check passes (última task da fase 16 — inclui lint/typecheck/build): `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): add library listing, semantic metadata and inventory export routes`

---

### Phase 17 — Configuração segura de provider de IA

### T40: packages/database — ai_provider_configs e ai_runs/ai_tool_calls (schema)

**What**: Migration + schema para `ai_provider_configs` (`scope`, `base_url`, `model`, `encrypted_token` — bytea/text cifrado, nunca texto plano — `capabilities_json`, `enabled`), `ai_runs` (`diagram_id`, `user_id`, `provider_config_id`, `source_revision`, `status`, `prompt_redacted`, `usage_json`, `error_code`) e `ai_tool_calls` (`ai_run_id`, `tool_name`, `arguments_redacted`, `result_summary`, `approved`, `sequence`). Nenhuma coluna armazena o token em texto plano — só `encrypted_token`.
**Where**: `packages/database/`
**Depends on**: None
**Reuses**: padrão de migration já estabelecido
**Requirement**: AIC-01 (schema pré-requisito)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Migration aplica limpa sobre as anteriores
- [ ] Nenhuma coluna de `ai_provider_configs` chama-se algo como `token`/`secret` em texto plano — só `encrypted_token`
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(database): add ai provider config and run/tool-call audit schema`

---

### T41: packages/ai-tools — cifra AES-256-GCM e validação SSRF de baseUrl

**What**: Em `packages/ai-tools/` (ou um novo `packages/crypto/` se preferir separar — sua escolha, documente): `encryptToken(plaintext, masterKey): string` / `decryptToken(ciphertext, masterKey): string` via AES-256-GCM (Node `crypto` nativo, sem dependência externa). `validateProviderBaseUrl(url, allowlist?: string[]): Result` — resolve o hostname e rejeita ranges link-local (169.254.0.0/16), loopback, metadata (169.254.169.254 explicitamente), e ranges privados (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) **a menos que** o host esteja em um `allowlist` explícito fornecido pelo admin. `masterKey` vem de config (env/secret), nunca hardcoded.
**Where**: `packages/ai-tools/`
**Depends on**: None
**Reuses**: `crypto` nativo do Node
**Requirement**: AIC-01, AIC-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `encryptToken`/`decryptToken` fazem round-trip correto; ciphertext nunca contém o plaintext como substring
- [ ] `http://169.254.169.254/...` é rejeitado sem allowlist
- [ ] `http://10.0.0.5/...` e `http://192.168.1.1/...` são rejeitados sem allowlist, aceitos com allowlist explícito contendo o host
- [ ] Um `baseUrl` público comum (ex. `https://api.openai.com`) é aceito
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(ai-tools): add aes-256-gcm token crypto and ssrf-safe baseurl validation`

---

### T42: apps/server — rotas de admin de provider de IA + "Testar conexão"

**What**: Em `apps/server/src/modules/ai-provider/`: `GET/POST/PATCH /admin/ai-providers` (só `org_admin`/`workspace_admin`; grava `encrypted_token` via T41, **a resposta da API nunca inclui o token, nem cifrado nem em claro** — campo omitido inteiramente do payload de resposta), `POST /admin/ai-providers/{id}:test` — chama o endpoint configurado (`POST {baseUrl}/chat/completions` mínimo, com timeout curto) para verificar autenticação/modelo/tool-calling, **sem persistir nem logar o token em nenhum momento do processo** (use um mock de provider HTTP nos testes — não faça chamadas de rede reais em teste). Rate limiting básico por usuário/workspace nas rotas de `ai/runs` fica preparado aqui como um middleware reutilizável (contador simples em Postgres ou em memória por processo — a fila/orquestração real de runs é onda F2c; este task só entrega o middleware de limite, testável isoladamente).
**Where**: `apps/server/src/modules/ai-provider/`
**Depends on**: T40, T41
**Reuses**: `encryptToken`/`validateProviderBaseUrl` (T41), RBAC (F1a)
**Requirement**: AIC-01, AIC-02, AIC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `POST /admin/ai-providers` com um `baseUrl` SSRF-inseguro é rejeitado (T41 aplicado na rota)
- [ ] Nenhuma resposta de `GET/POST/PATCH /admin/ai-providers` contém o token em nenhum formato (teste faz `JSON.stringify(response.body)` e verifica que o token de teste não aparece como substring)
- [ ] `POST .../{id}:test` contra um provider mock determinístico confirma tool-calling e não deixa o token em nenhum log capturado pelo teste
- [ ] Middleware de rate limit rejeita a N+1-ésima chamada dentro da janela configurada
- [ ] Actor sem papel de admin recebe 403 em toda rota deste módulo
- [ ] Gate check passes (última task da onda — inclui lint/typecheck/build): `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): add ai provider admin routes with token-safe test-connection`

---

## Phase Execution Map

```
Phase 16: T37 -> T38 -> T39
Phase 17: T40
Phase 17: T41
Phase 17: T40 -> T42
Phase 17: T41 -> T42
```

Phase 17 não depende de Phase 16 (biblioteca e provider de IA são independentes); ambas alimentam a onda F2c (agente).

**Packing de batches (Execute):** 6 tasks (T37-T42) → 1 batch (dentro do orçamento ~7 tasks/worker).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T37: manifesto de biblioteca | 1 pacote de dados coeso | ✅ Granular |
| T38: schema biblioteca+metadados | 1 migration + seed | ✅ Granular |
| T39: rotas de biblioteca/metadados/inventário | 1 módulo coeso | ✅ Granular |
| T40: schema provider/runs | 1 migration | ✅ Granular |
| T41: cripto + SSRF | 1 pacote coeso | ✅ Granular |
| T42: rotas admin de provider | 1 módulo coeso | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T37 | None | — | ✅ Match |
| T38 | T37 | T37→T38 | ✅ Match |
| T39 | T38 | T38→T39 | ✅ Match |
| T40 | None | — | ✅ Match |
| T41 | None | — | ✅ Match |
| T42 | T40, T41 | T40→T42 (via T41→T42 chain), depend both | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T37 | Dados de biblioteca (packages) | unit | unit | ✅ OK |
| T38 | Database (migration+seed) | integration | integration | ✅ OK |
| T39 | Módulo server (library) | integration | integration | ✅ OK |
| T40 | Database (migration) | integration | integration | ✅ OK |
| T41 | Domínio (ai-tools) | unit | unit | ✅ OK |
| T42 | Módulo server (ai-provider) | integration | integration | ✅ OK |
