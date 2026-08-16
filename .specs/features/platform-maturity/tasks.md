# Platform Maturity — Tasks (Onda F9: MCP — diagramas como contexto para agentes)

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/platform-maturity/design.md` (F9 section — reverse compiler, MCP token auth, REST surface, `apps/mcp` architecture)
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling (`apps/server/src/modules/share/*.spec.ts` + `*.int.spec.ts` as the closest precedent — token-based, DB-backed, route-gated module) and `package.json` scripts. Guidelines: none as a standalone file — conventions inferred from the existing suite (`.spec.ts` = unit/pure logic, `.int.spec.ts` = PGlite-backed integration per ADR-0007, both required for any DB-touching module).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| `packages/diagram-ir` decompiler (pure, no DB) | unit | All branches; 1:1 to spec ACs (MCP-02); round-trip property covered | `packages/diagram-ir/src/*.spec.ts` | `pnpm --filter @arch-canvas/diagram-ir run test:unit` |
| `apps/server/src/modules/mcp` data-access (`mcpTokens.ts`, `componentLookup.ts`) | unit | All branches; 1:1 to spec ACs | `apps/server/src/modules/mcp/*.spec.ts` | `pnpm --filter @arch-canvas/server run test:unit` |
| `apps/server/src/modules/mcp` routes (auth + REST surface, DB-backed) | integration | Every route in scope: happy path + auth-denied (404, AUTH-04) + edge cases (expired/revoked token, stale revision) | `apps/server/src/modules/mcp/*.int.spec.ts` | `pnpm --filter @arch-canvas/server run test:integration` |
| `apps/server/src/core/registerModules.ts` (wiring) | integration | Confirms the new module's routes are reachable end-to-end once wired | `apps/server/src/core/registerModules.int.spec.ts` (extend, do not replace) | `pnpm --filter @arch-canvas/server run test:integration` |
| `apps/mcp/src/*` (HTTP client, resource/tool handlers) | unit | All branches; mocked HTTP responses (no real server needed — `apps/mcp` never touches DB directly, per design.md) | `apps/mcp/src/**/*.spec.ts` | `pnpm --filter @arch-canvas/mcp run test:unit` |
| `apps/mcp` package scaffold, `cli.ts` entrypoint | none | build gate only — entrypoint is a thin wire-up, verified manually by running it, not unit-tested | `apps/mcp/package.json`, `apps/mcp/src/cli.ts` | build gate only |
| `docs/capability-map.yaml` entry, `apps/mcp/README.md` | none | build gate only + `/audit` (repo-tools) confirms the capability-map entry is well-formed | `docs/capability-map.yaml`, `apps/mcp/README.md` | `pnpm --filter @arch-canvas/repo-tools run audit` |

**Coverage Expectation defaults applied**: the decompiler and the MCP auth/route logic are this wave's real domain logic — full branch coverage 1:1 to ACs, plus the round-trip property test that closes ADR-0004's long-standing debt. Route-level work gets integration tests (DB-backed, PGlite) matching this project's established convention for any module gated by `can()` — a unit test alone was never enough for this project's own routes, and this wave doesn't get a pass either.

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks touching only one package's unit tests | `pnpm --filter <pkg> run test:unit` |
| Full | After tasks touching cross-package behavior, module wiring, or routes | `make lint && make typecheck && make test-unit && make test-integration` |
| Build | Config/docs-only tasks | `make lint` |

`/gate` (`.claude/commands/gate.md`) wraps the Full level, including the documented sandbox fallback when `make ci` can't reach `pg_lsclusters`/`redis-server`.

---

## Execution Plan

Phases run in sequence; tasks within a phase run in order. Each task's `Depends on` is its immediate predecessor unless noted (Phase 4 starts a fresh dependency chain — `apps/mcp` only needs the REST routes from Phase 3 to exist as a contract, not the DB/auth internals of Phase 2).

### Phase 1: Compilador reverso (MCP-02)

```
T1
```

### Phase 2: Autenticação e persistência de token MCP (MCP-04, MCP-05)

```
T1 → T2 → T3 → T4
```

### Phase 3: Rotas REST de leitura (MCP-01, MCP-02, MCP-03)

```
T4 → T5 → T6 → T7 → T8
```

### Phase 4: Aplicação `apps/mcp` (MCP-01, MCP-02, MCP-03, MCP-06)

```
T8 → T9 → T10 → T11 → T12 → T13
```

### Phase 5: Escrita atrás de flag (MCP-07)

```
T13 → T14 → T15
```

### Phase 6: Distribuição e inventário (MCP-08)

```
T15 → T16 → T17
```

---

## Task Breakdown

### T1: `decompile()` — compilador reverso cena→IR

**What**: `decompile(scene: SceneElement[], metadata: ElementMetadataRow[]): IrDocument` em `packages/diagram-ir/src/decompile.ts` — nós/edges via `extractSceneSemantics` (`@arch-canvas/diagram-domain`, dependência nova do package), `componentKey`/`semantics` por nó a partir de `metadata` (mesmo shape de `diagram_elements_meta`), containers por inferência geométrica de bounding box (retângulo A contém retângulo B se o box de B está inteiramente dentro do box de A), `kind` sempre `'group'` quando inferido (não recuperável da geometria — ver `design.md`). Inclui o primeiro teste de round-trip do projeto (`compile(ir) → scene → decompile(scene) → ir'`), fechando o débito documentado em `docs/adr/0004-diagram-ir-v1.md`.
**Where**: `packages/diagram-ir/src/decompile.ts`
**Depends on**: None
**Reuses**: `extractSceneSemantics` (`packages/diagram-domain/src/sceneSemantics.ts`), `compile()` (`packages/diagram-ir/src/compile.ts`, pro teste de round-trip)
**Requirement**: MCP-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Nós e edges reconstruídos corretamente a partir de uma cena real (rótulo, `componentKey`, `semantics` quando presentes em `metadata`)
- [x] Containers inferidos por containment geométrico, aninhamento suportado, `kind` sempre `'group'`
- [x] Retângulo sem filho vira `IrNode`, nunca um container vazio
- [x] Teste de round-trip: `compile(ir)` seguido de `decompile(scene)` produz nós e edges idênticos aos de `ir` (por id) e containers com a mesma associação pai-filho (não o `kind`, sabidamente perdido no caminho geométrico — asserção documenta essa limitação, não a esconde)
- [x] `packages/diagram-ir/package.json` ganha a dependência `@arch-canvas/diagram-domain: workspace:*`
- [x] Gate check passes: `pnpm --filter @arch-canvas/diagram-ir run test:unit`
- [x] Test count: 8 novos testes (nós simples; edges por binding de arrow; componentKey/semantics de metadata; container de 1 nível; container aninhado; retângulo sem filho vira nó; cena vazia não quebra; round-trip completo)

**Tests**: unit
**Gate**: quick

---

### T2: tabela `mcp_tokens` + migration

**What**: Nova tabela `mcp_tokens` em `packages/database/src/schema.ts` — `id`, `workspaceId` (FK), `tokenHash`, `role` (`workspaceMemberRole`, mesmo enum de `shareLinks`), `label`, `createdBy` (FK `users.id`), `createdAt`, `expiresAt` (nullable), `revokedAt` (nullable), índice único em `tokenHash`. Mesmo padrão de `shareLinks` (`schema.ts:609-625`). Migration gerada via `db:generate`, não escrita à mão.
**Where**: `packages/database/src/schema.ts` (modify)
**Depends on**: T1
**Reuses**: `shareLinks` table como referência de shape (`schema.ts:609-625`)
**Requirement**: MCP-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Tabela `mcp_tokens` declarada, índice único em `token_hash`
- [x] `pnpm --filter @arch-canvas/database run db:generate` gera a migration nova em `infra/migrations/`
- [x] Migration aplica limpo contra PGlite (confirmado pelo gate de integração — reconfirmado por T4's `test:integration`, PGlite real)
- [x] Gate check passes: `make lint && make typecheck`

**Tests**: none
**Gate**: build

---

### T3: `requireMcpToken` middleware

**What**: `apps/server/src/modules/mcp/auth.ts` — lê `Authorization: Bearer <token>`, `hashToken()`, busca em `mcp_tokens` por hash, nega (mesmo formato 404/sem detalhe da AUTH-04) se não encontrado, revogado (`revokedAt` setado) ou expirado (`expiresAt` no passado), senão popula `request.mcpContext = { workspaceId, role }`. `mcpTokens.ts` (data access: `findMcpTokenByHash`, `createMcpToken`, `revokeMcpToken`) na mesma pasta, mesmo padrão de `shareLinks.ts`.
**Where**: `apps/server/src/modules/mcp/auth.ts`
**Depends on**: T2
**Reuses**: `hashToken`/`generateOpaqueToken` (`apps/server/src/modules/auth/tokens.ts`), padrão `shareLinks.ts`'s `isShareLinkActive`
**Requirement**: MCP-04, MCP-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Token válido popula `request.mcpContext` corretamente
- [x] Token ausente, inválido, revogado ou expirado nega de forma idêntica (mesmo código/formato de resposta — não distinguível)
- [x] `findMcpTokenByHash`/`createMcpToken`/`revokeMcpToken` testados isoladamente (unit, sem HTTP)
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:unit`
- [x] Test count: 6 novos testes unit (token válido resolve context; ausente nega; inválido nega; revogado nega; expirado nega; create/revoke roundtrip)

**Tests**: unit
**Gate**: quick

---

### T4: rotas de emissão/revogação de token MCP

**What**: `POST /workspaces/:id/mcp-tokens` (autenticado por sessão — `requireSession`, não pelo próprio token MCP —, exige `can({role},'workspace:manage_tokens'` ou ação equivalente já existente de admin, `workspace_admin`/`org_admin`), devolve o token em texto puro **uma única vez** na resposta de criação (nunca recuperável depois, mesmo padrão de `share/routes.ts`). `DELETE /mcp-tokens/:id` (mesma exigência de admin) seta `revokedAt`. Integrado a `apps/server/src/modules/mcp/routes.ts`.
**Where**: `apps/server/src/modules/mcp/routes.ts`
**Depends on**: T3
**Reuses**: `requireSession` (`auth/middleware.ts`), `resolveWorkspaceRole` + `can()`, padrão de emissão de `share/routes.ts`
**Requirement**: MCP-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `POST /workspaces/:id/mcp-tokens` cria o token, devolve o valor em texto puro só nesta resposta
- [x] Não-admin recebe 403 (ação de escrita, não de leitura — convênio AUTH-04 só se aplica a leitura)
- [x] `DELETE /mcp-tokens/:id` revoga; token revogado já não autentica (prova via `requireMcpToken`)
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration` (PGlite real, ADR-0007)
- [x] Test count: 5 novos testes integration (criação por admin; 403 por não-admin; token devolvido só na criação; revogação efetiva; token de outro workspace não autentica em rota de workspace diferente)

**Tests**: integration
**Gate**: full

---

### T5: `GET /diagrams/:id/ir`

**What**: Rota que carrega a cena (`loadDiagramScene`, `diagram-sync/scene.ts`) e o `diagram_elements_meta` da diagram (`listElementMetadata`, `library/metadata.ts`), chama `decompile()` (T1), devolve o `IrDocument` como JSON. Autorização: `requireMcpToken` (T3) + `can({role: mcpContext.role}, 'diagram:read', {workspaceId})`, mesmo convênio 404 (AUTH-04) que toda leitura já usa.
**Where**: `apps/server/src/modules/mcp/routes.ts` (modify)
**Depends on**: T4
**Reuses**: `loadDiagramScene`, `listElementMetadata`, `decompile()` (T1), `can()`
**Requirement**: MCP-01, MCP-02, MCP-04, MCP-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Token com permissão de leitura recebe o `IrDocument` correto do diagrama
- [x] Token sem permissão recebe 404 (nunca 403, nunca distingue "não existe" de "sem permissão")
- [x] Diagrama inexistente recebe o mesmo 404
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`
- [x] Test count: 6 novos testes integration (leitura com permissão; sem permissão 404; diagrama inexistente 404; sem token 404; resposta nunca é imagem renderizada, é o IR estruturado — MCP-02 literal; mais `GET /workspaces/:id/diagrams`'s 2 testes — SPEC_DEVIATION documentada em `routes.ts`, closing MCP-01's listing gap tasks.md never assigned a task to)

**Tests**: integration
**Gate**: full

---

### T6: `findElementsByComponentKey` + expansão de relações

**What**: `apps/server/src/modules/mcp/componentLookup.ts` — `findElementsByComponentKey(db, diagramId, stableKey)` varre `diagram_elements_meta` da diagram filtrando `metadataJson->>'componentKey' = stableKey`. `expandComponentRelations(scene, elementId)` — cópia server-side equivalente à lógica de `ai-tools`'s `get_neighbors` (`expandNeighborhood`/`collectEdges`), já que `apps/mcp` nunca importa `ai-tools` diretamente (design.md) — devolve `{ inbound: IrEdge[], outbound: IrEdge[] }`.
**Where**: `apps/server/src/modules/mcp/componentLookup.ts`
**Depends on**: T5
**Reuses**: lógica de `packages/ai-tools/src/tools/readTools.ts`'s `expandNeighborhood`/`collectEdges` como referência de implementação (não importada, reescrita local per design.md)
**Requirement**: MCP-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `findElementsByComponentKey` resolve o(s) elemento(s) certo(s) por `stableKey`, vazio quando não existe
- [ ] `expandComponentRelations` devolve edges de entrada e saída corretos pro elemento resolvido
- [ ] Gate check passes: `pnpm --filter @arch-canvas/server run test:unit`
- [ ] Test count: 5 novos testes unit (componente existe com relações; componente sem relações; `stableKey` não resolve nada; múltiplos elementos com o mesmo `componentKey` na mesma diagram; edge direction correta inbound vs outbound)

**Tests**: unit
**Gate**: quick

---

### T7: `GET /diagrams/:id/components/:stableKey`

**What**: Rota que usa `findElementsByComponentKey` + `expandComponentRelations` (T6), devolve `{ metadata, inbound, outbound }`. Mesma autorização de T5 (`requireMcpToken` + `can()`, convênio 404 AUTH-04).
**Where**: `apps/server/src/modules/mcp/routes.ts` (modify)
**Depends on**: T6
**Reuses**: `findElementsByComponentKey`/`expandComponentRelations` (T6), padrão de autorização de T5
**Requirement**: MCP-03, MCP-04, MCP-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Componente existente com permissão devolve metadados + relações corretos
- [ ] `stableKey` sem correspondência devolve 404
- [ ] Sem permissão devolve o mesmo 404 (não distingue)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`
- [ ] Test count: 4 novos testes integration (componente com relações; sem correspondência 404; sem permissão 404; múltiplos módulos MCP-01/02/03 juntos numa mesma diagram real)

**Tests**: integration
**Gate**: full

---

### T8: registrar o módulo MCP em `registerAllModules`

**What**: `apps/server/src/core/registerModules.ts` ganha `registerMcpModule(app, deps)` (T4/T5/T7's rotas) na lista de módulos registrados. Estende `registerModules.int.spec.ts` (não substitui) confirmando que as rotas MCP ficam alcançáveis end-to-end quando o servidor sobe de verdade — mesmo padrão que toda a wiring gate deste arquivo já prova pros outros módulos.
**Where**: `apps/server/src/core/registerModules.ts` (modify)
**Depends on**: T7
**Reuses**: padrão de registro dos outros ~20 módulos já wireados neste arquivo
**Requirement**: MCP-01, MCP-02, MCP-03, MCP-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Módulo MCP registrado, rotas alcançáveis num boot real do `FastifyInstance`
- [ ] `registerModules.int.spec.ts` estendido (não substituído) com uma asserção pro módulo novo
- [ ] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`
- [ ] Test count: 1 novo teste integration (boot real confirma rota MCP alcançável)

**Tests**: integration
**Gate**: full

---

### T9: scaffold do package `apps/mcp`

**What**: `apps/mcp/package.json` (`"name": "@arch-canvas/mcp"`, `"bin": { "arch-canvas-mcp": "./dist/cli.js" }`, mesmo padrão de `tools/repo-tools`), `apps/mcp/tsconfig.json` (estende `tsconfig.base.json`, mesmo padrão de `apps/server`/`apps/web`), dependência `@modelcontextprotocol/sdk@^1.30.0` (versão estável atual — a linha `2.0.0` no GitHub ainda não é o que `npm install` resolve, não usar).
**Where**: `apps/mcp/package.json` (novo)
**Depends on**: T8
**Reuses**: `tools/repo-tools/package.json` como referência de shape `bin`
**Requirement**: MCP-01 (fundação)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `pnpm install` resolve o package novo sem erro
- [ ] `pnpm-workspace.yaml` já cobre `apps/*` — nenhuma mudança de config de workspace necessária, confirmado
- [ ] Gate check passes: `make lint && make typecheck` (package vazio, só scaffold, ainda compila)

**Tests**: none
**Gate**: build

---

### T10: cliente HTTP de `apps/mcp`

**What**: `apps/mcp/src/client.ts` — wrapper fino sobre `fetch` nativo do Node, lê `ARCH_CANVAS_API_URL`/`ARCH_CANVAS_MCP_TOKEN` do ambiente, injeta `Authorization: Bearer` em toda chamada, expõe `listDiagrams(workspaceId)`, `getDiagramIr(diagramId)`, `getComponent(diagramId, stableKey)` — um método por rota REST criada nas Phases 2-3. Sem dependência nova (fetch nativo, sem lib de HTTP).
**Where**: `apps/mcp/src/client.ts`
**Depends on**: T9
**Reuses**: nenhum (primeira peça de `apps/mcp`)
**Requirement**: MCP-01, MCP-02, MCP-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Todo método injeta o bearer token corretamente
- [ ] Resposta não-2xx (404/403/401) vira um erro tipado, nunca um objeto parcial silencioso
- [ ] Gate check passes: `pnpm --filter @arch-canvas/mcp run test:unit` (HTTP mockado, sem servidor real)
- [ ] Test count: 6 novos testes (cada método feliz; erro 404 vira exceção tipada; header de auth presente em toda chamada)

**Tests**: unit
**Gate**: quick

---

### T11: resource MCP — listar diagramas

**What**: `apps/mcp/src/resources/listDiagrams.ts` — `server.registerResource('diagrams', new ResourceTemplate('diagrams://{workspaceId}', { list: undefined }), config, handler)` usando `client.listDiagrams` (T10). Aplica o wrapper de dado não-confiável (MCP-06) no texto de resposta.
**Where**: `apps/mcp/src/resources/listDiagrams.ts`
**Depends on**: T10
**Reuses**: `client.ts` (T10)
**Requirement**: MCP-01, MCP-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Resource registrado corretamente no `McpServer` (verificado por um servidor de teste em memória, sem stdio real)
- [ ] `content` textual abre com o aviso fixo de dado não-confiável antes de qualquer texto vindo do canvas
- [ ] Gate check passes: `pnpm --filter @arch-canvas/mcp run test:unit`
- [ ] Test count: 3 novos testes (resource lista corretamente; aviso de dado não-confiável presente; workspace sem diagramas devolve lista vazia, não erro)

**Tests**: unit
**Gate**: quick

---

### T12: resources MCP — ler diagrama (IR) e componente

**What**: `apps/mcp/src/resources/readDiagram.ts` (`diagram://{diagramId}` → `client.getDiagramIr`) e `apps/mcp/src/resources/readComponent.ts` (`component://{diagramId}/{stableKey}` → `client.getComponent`). Mesmo wrapper MCP-06 em ambos.
**Where**: `apps/mcp/src/resources/readDiagram.ts` (e `readComponent.ts` no mesmo commit — dois resources pequenos e cohesivos, mesmo padrão de wrapping, cohesão justifica um único commit per o critério "2-3 coisas relacionadas no mesmo conceito = OK")
**Depends on**: T11
**Reuses**: `client.ts` (T10), wrapper MCP-06 (T11)
**Requirement**: MCP-01, MCP-02, MCP-03, MCP-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `diagram://{id}` devolve o `IrDocument` estruturado em `structuredContent`, nunca uma imagem
- [ ] `component://{diagramId}/{stableKey}` devolve metadados + relações
- [ ] Ambos aplicam o aviso de dado não-confiável no `content` textual
- [ ] Gate check passes: `pnpm --filter @arch-canvas/mcp run test:unit`
- [ ] Test count: 5 novos testes (IR estruturado correto; componente com relações; componente inexistente vira erro tratado, não exceção não capturada; aviso presente nos dois; nenhum texto de rótulo do canvas aparece fora de `structuredContent`)

**Tests**: unit
**Gate**: quick

---

### T13: `cli.ts` — entrypoint stdio

**What**: `apps/mcp/src/cli.ts` — cria o `McpServer`, registra os 3 resources (T11, T12), conecta via `StdioServerTransport`. Shebang `#!/usr/bin/env node`, referenciado pelo `bin` de `package.json` (T9).
**Where**: `apps/mcp/src/cli.ts`
**Depends on**: T12
**Reuses**: `McpServer`/`StdioServerTransport` do SDK, resources de T11/T12
**Requirement**: MCP-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `pnpm --filter @arch-canvas/mcp run build && node dist/cli.js` sobe sem erro (verificado manualmente, com `ARCH_CANVAS_API_URL`/`ARCH_CANVAS_MCP_TOKEN` de teste — stdio não é algo que se automatize fácil num teste unitário, verificação manual documentada aqui em vez de fingida)
- [ ] `make lint && make typecheck` limpos
- [ ] Gate check passes: build

**Tests**: none
**Gate**: build

---

### T14: `POST /diagrams/:id/mcp-patch` (MCP-07, atrás de flag)

**What**: Rota que aceita um único op `setMetadata` (mesmo shape que `ai-tools`/`applyPatch.ts` já aplica), reusa **exatamente** `createSnapshot(db, storage, {kind:'pre_ai', ...})` + `appendOperation` + `applyMetadataOps` (o mesmo trio de `approveAiRun`, `ai-engine/applyPatch.ts:134-195`), com o mesmo cheque de staleness de revisão (409 se a revisão mudou). Só ativa quando `MCP_WRITE_ENABLED=true` no ambiente do servidor — com a flag desligada, a rota nem registra (404 genérico, não uma rota que existe e nega).
**Where**: `apps/server/src/modules/mcp/routes.ts` (modify)
**Depends on**: T13
**Reuses**: `createSnapshot`, `appendOperation`, `applyMetadataOps` (`ai-engine/applyPatch.ts`)
**Requirement**: MCP-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Com a flag ligada: escreve o metadado, cria snapshot `pre_ai`, aplica via op-log, cheque de staleness funciona (409 correto)
- [ ] Com a flag desligada: rota não existe (404 genérico, sem vazar que a feature existe)
- [ ] Autorização: `can({role},'diagram:mutate',{workspaceId})`, nunca checagem paralela
- [ ] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`
- [ ] Test count: 5 novos testes integration (escrita com sucesso + snapshot criado; staleness 409; sem permissão de escrita nega; flag desligada = rota ausente; snapshot `pre_ai` reconstituível como undo point)

**Tests**: integration
**Gate**: full

---

### T15: tool MCP `set_component_metadata` (atrás de flag)

**What**: `apps/mcp/src/tools/setComponentMetadata.ts` — `server.registerTool('set_component_metadata', {inputSchema, outputSchema}, handler)` chamando `client.setComponentMetadata` (novo método em `client.ts`, T10). Só registrado no `McpServer` (`cli.ts`, T13) quando `MCP_WRITE_ENABLED=true` no ambiente de `apps/mcp` — espelhando a flag do lado do servidor MCP em vez de deixar a UI do cliente MCP anunciar uma capacidade que o backend vai rejeitar.
**Where**: `apps/mcp/src/tools/setComponentMetadata.ts`
**Depends on**: T14
**Reuses**: `client.ts` (T10, ganha o método novo no mesmo commit), `cli.ts` (T13, modify pra registro condicional)
**Requirement**: MCP-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Com a flag ligada, a tool aparece na lista de capacidades do servidor e funciona
- [ ] Com a flag desligada, a tool nem é registrada — cliente nunca vê a capacidade
- [ ] Gate check passes: `pnpm --filter @arch-canvas/mcp run test:unit`
- [ ] Test count: 3 novos testes (tool registra só com flag ligada; chamada bem-sucedida; erro do servidor vira resposta de erro estruturada, não exceção)

**Tests**: unit
**Gate**: quick

---

### T16: `apps/mcp/README.md` — distribuição

**What**: Configuração pronta pro `claude_desktop_config.json` (Claude Code) e `mcp.json` (Cursor), apontando pra `npx @arch-canvas/mcp` com `ARCH_CANVAS_API_URL`/`ARCH_CANVAS_MCP_TOKEN`. Explica como emitir um token (via T4's rota, ou um passo futuro de UI que ainda não existe — disclosed, não inventado).
**Where**: `apps/mcp/README.md`
**Depends on**: T15
**Reuses**: nenhum
**Requirement**: MCP-08

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] JSON de config válido pros dois clientes, copiável sem edição além do token/URL
- [ ] `make lint` confirma o markdown bem formado

**Tests**: none
**Gate**: build

---

### T17: `docs/capability-map.yaml` — entrada MCP

**What**: Nova entrada no mapa de capacidades (F6, TRU-01/UIX-01) pra "Servidor MCP — diagramas como contexto", `backend_evidence` apontando pro módulo `apps/server/src/modules/mcp/` e `apps/mcp/`, `ui_surface: null`, `status: backend-only` (é consumido por agentes externos, não por `apps/web` — honesto sobre isso, não uma omissão).
**Where**: `docs/capability-map.yaml` (modify)
**Depends on**: T16
**Reuses**: entradas já existentes como referência de shape (checker já validado em F6/F8)
**Requirement**: MCP-08 (rastreabilidade), TRU-01/UIX-01 (F6, mantidas honestas)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Entrada nova passa no `checkCapabilityMap` sem violação
- [ ] `pnpm --filter @arch-canvas/repo-tools run audit` sai 0

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1:  T1
Phase 2:            T1 → T2 → T3 → T4
Phase 3:                            T4 → T5 → T6 → T7 → T8
Phase 4:                                                 T8 → T9 → T10 → T11 → T12 → T13
Phase 5:                                                                              T13 → T14 → T15
Phase 6:                                                                                          T15 → T16 → T17
```

**17 tasks across 6 phases** — acima do limite de um único lote (~8 tasks), então a oferta de sub-agentes é obrigatória (ver [sub-agents.md](../../../.claude/skills/tlc-spec-driven/references/sub-agents.md)). Empacotamento natural:

| Batch | Phases | Tasks | Count |
| ----- | ------ | ----- | ----- |
| 1 | Phase 1 + Phase 2 | T1–T4 | 4 |
| 2 | Phase 3 + Phase 4 (parcial: scaffold + cliente) | T5–T10 | 6 |
| 3 | Phase 4 (resources + cli) + Phase 5 | T11–T15 | 5 |
| 4 | Phase 6 | T16–T17 | 2 |

Execução é estritamente sequencial - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

**The orchestrating agent's role during Execute:**
1. Count total tasks and pack phases into ~7-task batches - offer batch sub-agents if that yields more than one batch and the user accepts
2. Dispatch the next batch (to a worker, or execute inline)
3. Receive the compact batch summary
4. Update tasks.md with results
5. If the batch summary shows all tasks complete: proceed to the next batch
6. If a task failed: decide fix/escalate before dispatching the next batch

---

## Task Granularity Check

| Task | Escopo | Status |
| ---- | ------ | ------ |
| T1 | 1 arquivo (decompiler completo + testes co-localizados) | ✅ Granular |
| T2 | 1 arquivo (schema.ts, + migration gerada por ferramenta, não escrita à mão) | ✅ Granular |
| T3 | 1 arquivo (`auth.ts`, inclui `mcpTokens.ts` data-access cohesiva) | ✅ Granular |
| T4, T5, T7, T14 | 1 arquivo (`routes.ts`, modificado incrementalmente por task) | ✅ Granular |
| T6 | 1 arquivo (`componentLookup.ts`) | ✅ Granular |
| T8 | 1 arquivo (`registerModules.ts`) | ✅ Granular |
| T9, T13, T16, T17 | 1 arquivo cada | ✅ Granular |
| T10, T11, T15 | 1 arquivo cada | ✅ Granular |
| T12 | 2 arquivos cohesivos (`readDiagram.ts` + `readComponent.ts`, mesmo padrão de wrapping, mesma revisão) | ⚠️ OK se cohesivo — justificado na própria task (regra "2-3 coisas relacionadas = OK") |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | — (início) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | T11 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | T13 | T13 → T14 | ✅ Match |
| T15 | T14 | T14 → T15 | ✅ Match |
| T16 | T15 | T15 → T16 | ✅ Match |
| T17 | T16 | T16 → T17 | ✅ Match |

Nenhuma task depende de uma fase posterior. Cadeia estritamente sequencial — mesma disciplina usada em F8 pra evitar drift entre o diagrama e os campos `Depends on`.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ----------------------------- | ----------------- | ----------- | ------ |
| T1 | `decompile()`, pure | unit | unit | ✅ OK |
| T2 | schema/migration | none | none | ✅ OK |
| T3 | `auth.ts`/`mcpTokens.ts`, pure logic | unit | unit | ✅ OK |
| T4, T5, T7, T14 | rotas DB-backed | integration | integration | ✅ OK |
| T6 | `componentLookup.ts`, pure (opera sobre scene/metadata já carregados) | unit | unit | ✅ OK |
| T8 | wiring, integration-tested por convenção do arquivo | integration | integration | ✅ OK |
| T9, T13, T16, T17 | scaffold/docs/config | none | none | ✅ OK |
| T10, T11, T12, T15 | `apps/mcp`, HTTP mockado (nunca DB direto) | unit | unit | ✅ OK |

Nenhuma violação.

---

## Tips

- **Phases are ordered** - Each phase completes before the next; tasks run in order within a phase
- **Reuses = Token saver** - Always reference existing code
- **T1 é a peça de maior risco técnico** - o compilador reverso não tem precedente no projeto; as outras 16 tasks são mecânicas em comparação
- **`apps/mcp` nunca importa pacotes de domínio** - só HTTP + token (design.md) - todo teste de `apps/mcp` mocka HTTP, nunca sobe um servidor real
- **Done when = Testable** - If you can't verify it, rewrite it
- **Requirement ID = Traceable** - Every task traces back to a spec requirement
- **One commit per task** - Plan the commit message format in advance
