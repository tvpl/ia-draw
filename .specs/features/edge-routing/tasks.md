# Contrato de roteamento de borda Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: `.specs/features/edge-routing/design.md`
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| `SERVER_ROUTE_PREFIXES` | unit | Lista não vazia, sem duplicata, todo item começa com `/` e não contém dois-pontos | `packages/shared-contracts/src/routePrefixes.spec.ts` | `pnpm -w test:unit` |
| Extração de prefixos das três origens | unit | Cada extrator devolve o conjunto esperado sobre uma fixture; falha explícita quando a origem não é interpretável | `tools/repo-tools/src/edgeParity.spec.ts` | `pnpm -w test:unit` |
| Paridade de borda (contrato) | unit | EDGE-09..12: os três conjuntos são iguais no repo real; prefixo em falta e regra morta reprovam nomeando o prefixo | `tools/repo-tools/src/edgeParity.spec.ts` | `pnpm -w test:unit` |
| Proxy de desenvolvimento | unit | O objeto de proxy gerado cobre todos os prefixos e mantém `ws: true` para `/ws` | `apps/web/vite.config.spec.ts` | `pnpm -w test:unit` |
| `Caddyfile` (arquivo de configuração) | none | Caddy não é executável em teste unitário e o compose não sobe neste ambiente. A cobertura vem por duas vias fora desta camada: o teste de paridade (linha acima) asserta o conteúdo do arquivo, e o job `compose-smoke` estendido em `green-gate` (R20) prova EDGE-01..05 com o stack de pé. `Tests: none` em T2 é deliberado e confirmado aqui. | `infra/compose/Caddyfile` | `pnpm -w test:unit` (via paridade) |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois da última task, antes do Verifier | `make lint && make typecheck && make test-unit && pnpm --filter @arch-canvas/repo-tools run audit` |

---

## Execution Plan

### Phase 1: Fonte de verdade

```
T1
```

### Phase 2: As duas bordas

```
T1 -> T2
T1 -> T3
```

### Phase 3: Paridade verificada

```
T1 -> T4
T2 -> T5
T3 -> T5
T4 -> T5
```

---

## Task Breakdown

### T1: `SERVER_ROUTE_PREFIXES` em `shared-contracts`

**What**: Declara a lista de prefixos de caminho que pertencem ao servidor e a exporta pelo índice
do pacote. Cada prefixo sai das rotas realmente registradas em `apps/server/src/modules/**` —
`/auth`, `/me`, `/users`, `/workspaces`, `/projects`, `/diagrams`, `/presentations`, `/libraries`,
`/share`, `/admin`, `/ai`, `/mcp-tokens`, `/health`, `/metrics` — mais `/ws` como constante
separada, porque é upgrade de WebSocket e não HTTP simples.
**Where**: `packages/shared-contracts/src/routePrefixes.ts`
**Depends on**: None
**Reuses**: a convenção de export por módulo já usada por `ids.ts` e `pagination.ts`.
**Requirement**: EDGE-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A lista é exportada pelo índice do pacote e consumível por `apps/web` e por `repo-tools`
- [x] Nenhum item duplicado, todo item começa com `/`, nenhum contém dois-pontos
- [x] `/users` cobre `/users:lookup` conforme a decisão registrada em `spec.md`
- [x] Changeset criado para `@arch-canvas/shared-contracts`
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `shared-contracts` 38/38 com cobertura 100% de linhas (o piso CIQ-04 nao foi tocado; a linha nova no barrel foi coberta de verdade, provando o proprio criterio de export deste `Done when`)

**Tests**: unit
**Gate**: full

**Commit**: `feat(shared-contracts): declare the server route prefix list`

---

### T2: `Caddyfile` roteia os prefixos reais

**What**: Substitui a regra `/api/*` — que nunca casou com nenhuma rota — por um `handle` para cada
prefixo da lista, encaminhando a `server:3000`, mantendo o `handle` de `/ws*` e o catch-all para
`web:80`. É esta task que faz `POST /auth/login` pela porta pública chegar ao servidor em vez de
receber 405 do nginx.
**Where**: `infra/compose/Caddyfile`
**Depends on**: T1
**Reuses**: a estrutura de `handle` já usada pelas regras de `/ws` e `/health`.
**Requirement**: EDGE-01, EDGE-02, EDGE-03, EDGE-04, EDGE-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Existe um `handle` para cada prefixo da lista, encaminhando ao serviço `server`
- [ ] O arquivo não contém nenhuma regra para `/api`
- [ ] O catch-all para `web:80` permanece como última regra
- [ ] `/ws*` continua com regra própria, antes do catch-all
- [ ] `docker compose --project-directory infra/compose -f infra/compose/compose.yaml config` continua válido
- [ ] `Tests: none` confirmado contra a Test Coverage Matrix: a cobertura desta task vem do teste de paridade em T5 e do job `compose-smoke` de R20
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: full

**Commit**: `fix(compose): route the real server prefixes instead of a dead /api rule`

---

### T3: Proxy de desenvolvimento consome a lista

**What**: `vite.config.ts` deixa de manter sua própria lista de seis prefixos e passa a derivar o
proxy de `SERVER_ROUTE_PREFIXES`, mantendo a entrada de `/ws` com `ws: true`. O comentário
`SPEC_DEVIATION` existente é substituído por uma referência à fonte única, porque a divergência que
ele descrevia deixa de existir.
**Where**: `apps/web/vite.config.ts`
**Depends on**: T1
**Reuses**: o próprio `Object.fromEntries` já usado no arquivo.
**Requirement**: EDGE-06, EDGE-07, EDGE-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O proxy cobre todos os prefixos da lista, incluindo os sete hoje ausentes
- [ ] A entrada de `/ws` mantém `ws: true`
- [ ] Nenhuma lista de prefixos literal permanece no arquivo
- [ ] Uma chamada a um prefixo antes ausente devolve a resposta do servidor, não `index.html`
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `fix(web): derive the dev proxy from the shared route prefix list`

---

### T4: Extratores de prefixo das três origens

**What**: Implementa a leitura dos três conjuntos: os prefixos derivados das rotas realmente
registradas em `apps/server`, os roteados pelo `Caddyfile` e os roteados pelo proxy de
desenvolvimento. Cada extrator falha explicitamente quando a origem não é interpretável, nunca
devolve conjunto vazio silenciosamente.
**Where**: `tools/repo-tools/src/edgeParity.ts`
**Depends on**: T1
**Reuses**: `serverRoutes.ts`, que já extrai as rotas registradas para o inventário.
**Requirement**: EDGE-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Os três extratores devolvem o conjunto esperado sobre fixtures controladas
- [ ] Um `Caddyfile` ilegível ou não interpretável produz erro, nunca conjunto vazio
- [ ] O extrator de rotas reusa `serverRoutes.ts` sem duplicar a varredura
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(repo-tools): extract edge route prefixes from routes, Caddy and vite`

---

### T5: Teste de paridade entre as três origens

**What**: Teste que exige igualdade dos três conjuntos no repositório real e falha nomeando cada
prefixo em falta e a borda que o omitiu, além de nomear regra de borda sem rota correspondente
(regra morta) e colisão com caminho do SPA.
**Where**: `tools/repo-tools/src/edgeParity.spec.ts`
**Depends on**: T2, T3, T4
**Reuses**: os extratores de T4 e o padrão de asserção de `openApiParity.spec.ts`.
**Requirement**: EDGE-10, EDGE-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O teste passa contra o repositório real depois de T2 e T3
- [ ] Removendo um `handle` do `Caddyfile` localmente, o teste reprova nomeando o prefixo — confirmado antes do commit
- [ ] Removendo um prefixo do proxy de desenvolvimento localmente, o teste reprova nomeando o prefixo — confirmado antes do commit
- [ ] Uma regra de borda sem rota correspondente reprova o teste
- [ ] Gate check passes: `make lint && make typecheck && make test-unit && pnpm --filter @arch-canvas/repo-tools run audit`

**Tests**: unit
**Gate**: build

**Commit**: `test(repo-tools): fail when the two edges diverge from the registered routes`
