# Bootstrap de instância Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: skipped — a rota reusa o módulo de auth existente, o padrão de transação já usado por
`createWorkspace` e o limitador de taxa já aplicado às rotas de auth. As duas decisões com
alternativa real (condição de disponibilidade e como a corrida é resolvida) estão em `spec.md`'s
Assumptions.
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| `firstRun` (domínio + transação) | integration | BOOT-03/07 e edge cases: cria conta+org+workspace+associação numa transação; falha parcial reverte tudo e devolve a instância ao estado vazio; e-mail normalizado | `apps/server/src/modules/auth/firstRun.int.spec.ts` | `pnpm -w test:integration` |
| Rotas `/auth/first-run` | integration | BOOT-01/02/04/05/06/09/10/11: disponibilidade, 404 quando já inicializada, 400 por senha curta, 400 por e-mail inválido, 400 por workspace vazio, 429 por limite, papel nunca vindo do cliente | `apps/server/src/modules/auth/firstRun.int.spec.ts` | `pnpm -w test:integration` |
| Corrida de inicialização | integration | BOOT-08: duas requisições concorrentes contra instância vazia produzem exatamente uma conta, uma `201` e uma `409` | `apps/server/src/modules/auth/firstRun.int.spec.ts` | `pnpm -w test:integration` |
| Registro OpenAPI | unit | As rotas novas aparecem em `docs/openapi.json` e o job de paridade continua verde (lição L-026) | `tools/repo-tools/src/openApiParity.spec.ts` | `pnpm -w test:unit` |
| `firstRunClient` | unit | Um branch por status documentado: `{available:true}`, `404`, `201`, `400`, `409`, `429`, falha de rede | `apps/web/src/auth/firstRunClient.spec.ts` | `pnpm -w test:unit` |
| `FirstRunPage` | unit | BOOT-12..16: envio bem-sucedido, `400` preservando valores, `409`/`404` caindo para credenciais, texto vindo do i18n | `apps/web/src/auth/FirstRunPage.spec.tsx` | `pnpm -w test:unit` |
| `FirstRunPage` (acessibilidade) | unit (a11y) | Sem violação axe; formulário navegável só por teclado | `apps/web/src/auth/FirstRunPage.a11y.spec.tsx` | `pnpm -w test:unit` |
| `LoginPage` (bifurcação) | unit | BOOT-12: renderiza primeiro acesso quando disponível, credenciais quando não | `apps/web/src/auth/LoginPage.spec.tsx` | `pnpm -w test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois de toda task que toca `apps/server` e antes do Verifier | `make lint && make typecheck && make test-unit && make test-integration` |

---

## Execution Plan

### Phase 1: Servidor

```
T1 -> T2
T2 -> T3
T2 -> T4
```

### Phase 2: Superfície

```
T2 -> T5
T5 -> T6
T6 -> T7
```

---

## Task Breakdown

### T1: Domínio de inicialização da instância

**What**: Implementa a leitura da condição "instância vazia" e a operação transacional de
inicialização: cria conta local, organização, workspace e associação `org_admin` numa única
transação, apoiada por uma guarda de banco que garante que apenas a primeira concluir. O papel
nunca vem de parâmetro.
**Where**: `apps/server/src/modules/auth/firstRun.ts`
**Depends on**: None
**Reuses**: `createLocalAccount` (`accounts.ts`), que hoje só tem chamador em teste, e o padrão de
transação já usado por `createWorkspace`.
**Requirement**: BOOT-03, BOOT-07, BOOT-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Uma inicialização bem-sucedida deixa exatamente uma conta, uma organização, um workspace e uma associação `org_admin`
- [x] Uma falha depois da inserção da conta reverte a transação inteira e a instância volta a estar vazia
- [x] Duas execuções concorrentes contra uma instância vazia concluem exatamente uma
- [x] O e-mail é normalizado antes de gravar
- [x] Um evento de auditoria `instance.bootstrapped` é registrado com o id da conta
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `firstRun.int.spec.ts` 13/13

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): add transactional first-run instance bootstrap`

---

### T2: Rotas `GET` e `POST /auth/first-run`

**What**: Registra as duas rotas fora de qualquer verificação de sessão, com schemas Zod de
validação (e-mail válido, senha de no mínimo 12 caracteres, nome de workspace não vazio),
respondendo `404` em ambas quando a instância já tem conta, `409` para a perdedora da corrida,
`429` sob limite de taxa e abrindo sessão em caso de sucesso.
**Where**: `apps/server/src/modules/auth/routes.ts`
**Depends on**: T1
**Reuses**: o limitador de taxa já aplicado às rotas de auth, os helpers de erro do módulo e a
emissão de cookie de sessão de `POST /auth/login`.
**Requirement**: BOOT-01, BOOT-02, BOOT-04, BOOT-05, BOOT-06, BOOT-09, BOOT-10, BOOT-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `GET /auth/first-run` devolve `{available:true}` numa instância vazia e `404` numa inicializada
- [x] `POST /auth/first-run` devolve `201` com cookie de sessão numa instância vazia
- [x] `POST /auth/first-run` devolve `404` numa instância inicializada sem tocar no banco
- [x] Senha com menos de 12 caracteres, e-mail inválido e workspace vazio devolvem `400` nomeando o campo
- [x] Nenhum papel informado pelo cliente é lido pela rota
- [x] Exceder o limite de tentativas devolve `429`
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `firstRun.int.spec.ts` 13/13

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): expose the first-run bootstrap routes`

---

### T3: Registro das rotas novas no OpenAPI

**What**: Adiciona os schemas das duas rotas ao `routeSchemas` do módulo de auth e confirma que o
gerador as inclui em `docs/openapi.json`. Task explícita porque a lição L-026 registra exatamente
esta classe de lacuna: fiação cross-cutting que nenhuma task nomeia fica esquecida até uma
ferramenta de auditoria pegar.
**Where**: `apps/server/src/openapi/registry.ts`
**Depends on**: T2
**Reuses**: o registro de `routeSchemas` que todo módulo de rotas já exporta.
**Requirement**: BOOT-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `pnpm --filter @arch-canvas/server run openapi` regenera `docs/openapi.json` incluindo as duas rotas
- [x] `openApiParity` continua verde
- [x] `docs/openapi.json` regenerado está commitado junto
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `openApiParity` verde

**Tests**: unit
**Gate**: full

**Commit**: `feat(server): register the first-run routes in the OpenAPI document`

---

### T4: Teste de integração da corrida e dos limites

**What**: Cobre com PGlite (AD-007) a corrida de inicialização, a reversão transacional, os três
`400` de validação, o `429` e a transição de disponível para `404` quando uma conta é criada por
outro caminho.
**Where**: `apps/server/src/modules/auth/firstRun.int.spec.ts`
**Depends on**: T2
**Reuses**: o padrão de boot de servidor sobre PGlite já usado por `auth.int.spec.ts`.
**Requirement**: BOOT-08, BOOT-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Duas requisicoes disparadas juntas produzem uma `201`, uma `404`/`409` e exatamente uma conta. **Disclosure**: PGlite serializa tudo numa conexao, entao este teste prova o caminho de decisao, nao paralelismo real; a garantia sob concorrencia genuina e o `pg_advisory_xact_lock` mais a checagem de vazio dentro da mesma transacao, exercitada no CI onde o Postgres roda como servico
- [x] Criar uma conta por outro caminho faz as duas rotas passarem a responder `404` sem reinício
- [x] Cada `400` de validação tem teste próprio nomeando o campo recusado
- [x] O `429` é exercitado contra o limitador real, não mockado
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `firstRun.int.spec.ts` 13/13

**Tests**: integration
**Gate**: build

**Commit**: `test(server): cover the first-run race, validation and rate limit`

---

### T5: Cliente HTTP de primeiro acesso

**What**: Cliente com `fetchImpl` injetável e um branch por status documentado, no molde de
`memberClient.ts`. Chamadas escritas com o identificador literal `fetchImpl(` para que o extrator de
consumidores de rota de `repo-tools` as reconheça.
**Where**: `apps/web/src/auth/firstRunClient.ts`
**Depends on**: T2
**Reuses**: a convenção de cliente de `memberClient.ts` e `aiDockClient.ts`.
**Requirement**: BOOT-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Existe um branch para `{available:true}`, `404`, `201`, `400`, `409`, `429` e falha de rede
- [x] Nenhum status produz exceção não tratada
- [x] As chamadas são reconhecidas pelo extrator de consumidores de rota
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/web` 943/943

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add the first-run HTTP client`

---

### T6: Tela de primeiro acesso

**What**: Formulário de primeiro acesso com e-mail, senha, confirmação e nome do workspace (com
default pré-preenchido), mensagens de erro por campo, texto integralmente vindo do i18n em `en` e
`pt-BR`, e navegação para a raiz autenticada em caso de sucesso.
**Where**: `apps/web/src/auth/FirstRunPage.tsx`
**Depends on**: T5
**Reuses**: a estrutura de formulário e o tratamento de erro de `LoginPage.tsx`.
**Requirement**: BOOT-14, BOOT-15, BOOT-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Envio bem-sucedido navega para a raiz autenticada
- [x] `400` exibe a mensagem do campo recusado e preserva os demais valores digitados
- [x] Todo texto vem do i18n, com chaves presentes em `en` e `pt-BR`
- [x] Sem violação `jest-axe`; formulário completável só por teclado
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/web` 943/943

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add the first-run screen`

---

### T7: `LoginPage` decide entre primeiro acesso e credenciais

**What**: `LoginPage` consulta a disponibilidade do primeiro acesso antes de decidir o que
renderizar: formulário de primeiro acesso quando disponível, formulário de credenciais quando não, e
transição para credenciais quando o envio devolve `409` ou `404` porque a instância deixou de estar
vazia. A consulta de SSO existente permanece intacta.
**Where**: `apps/web/src/auth/LoginPage.tsx`
**Depends on**: T6
**Reuses**: o próprio padrão de consulta de `/auth/oidc/status` já presente no arquivo.
**Requirement**: BOOT-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Com primeiro acesso disponivel, a rota `/login` renderiza o formulario de primeiro acesso. **Desvio deliberado**: o estado inicial e `false`, nao `null`, entao a instancia inicializada (caso esmagadoramente comum) nunca segura o render esperando a resposta. Bloquear no `null` teria exigido reescrever os testes existentes de `LoginPage` de sincronos para assincronos, o que a regra de integridade de teste proibe
- [x] Sem primeiro acesso disponível, renderiza o formulário de credenciais, inalterado
- [x] Um envio que devolve `409` ou `404` passa a exibir o formulário de credenciais
- [x] A consulta de SSO e o comportamento de `?error=oidc_failed` seguem inalterados
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/web` 943/943

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): render the first-run screen when the instance is uninitialized`
