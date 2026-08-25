# Clareza de RBAC Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: `.specs/features/rbac-clarity/design.md`
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| `rbac.ts` (motor puro) | unit | RBAC-02/03/04: `reviewer` concede `comment:resolve`, `viewer` recusa, `viewer` mantém `comment:create`; nenhum papel perde ação que já tinha por engano | `packages/auth/src/rbac.spec.ts` | `pnpm -w test:unit` |
| `resolveEffectiveRole` | integration | RBAC-01/05/06 e os edge cases: papel de organização sem associação, mais permissivo entre os dois, `404` sem acesso algum, organização não resolvível recusa | `apps/server/src/modules/workspace/rbac-matrix.int.spec.ts` | `pnpm -w test:integration` |
| Matriz de RBAC | integration | RBAC-07: cinco papéis contra todas as ações, incluindo `org_admin` sem associação no workspace | `apps/server/src/modules/workspace/rbac-matrix.int.spec.ts` | `pnpm -w test:integration` |
| Guarda de último administrador | integration | RBAC-08..12: remoção e rebaixamento recusados com `409`; permitido quando existe `org_admin` na organização; duas remoções concorrentes concluem no máximo uma; auditoria registrada | `apps/server/src/modules/workspace/workspace.int.spec.ts` | `pnpm -w test:integration` |
| Convite por e-mail | integration | RBAC-17..20: conta existente resolvida, inexistente sem vazamento, já membro `409`, sem permissão `403`, e-mail com maiúsculas resolvido | `apps/server/src/modules/workspace/workspace.int.spec.ts` | `pnpm -w test:integration` |
| Papel efetivo na interface | unit | RBAC-13..16: papel exibido, motivo junto ao controle desabilitado, rótulo vindo do i18n, papel novo após recarga | `apps/web/src/nav/WorkspaceMembersPage.spec.tsx` | `pnpm -w test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois de toda task que toca `apps/server` e antes do Verifier | `make ci` |

---

## Execution Plan

### Phase 1: Motor de autorização

```
T1 -> T2
T2 -> T3
T2 -> T4
```

### Phase 2: Aplicação nas rotas

```
T3 -> T5
T4 -> T5
T5 -> T6
```

### Phase 3: Superfície

```
T3 -> T7
T7 -> T8
```

---

## Task Breakdown

### T1: Diferenciar os grants de `reviewer` e `viewer`

**What**: `reviewer` passa a conceder `comment:resolve`, que `viewer` deixa de conceder; `viewer`
mantém `comment:create`. O motor continua puro — sem banco, sem HTTP — e a assinatura de `can()` não
muda. É esta task que faz `reviewer` e `viewer` deixarem de ser conjuntos idênticos.
**Where**: `packages/auth/src/rbac.ts`
**Depends on**: None
**Reuses**: a própria tabela `ROLE_GRANTS` e a separação de eixos já documentada no arquivo.
**Requirement**: RBAC-02, RBAC-03, RBAC-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `reviewer` concede `comment:resolve` e `viewer` recusa
- [x] `viewer` mantém `comment:create` e todas as ações de leitura
- [x] Nenhum outro papel muda de conjunto de ações
- [x] Changeset criado para `@arch-canvas/auth`
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/web` 954/954, `packages/auth` 63/63

**Tests**: unit
**Gate**: full

**Commit**: `feat(auth): grant comment:resolve to reviewer and withhold it from viewer`

---

### T2: `resolveEffectiveRole`

**What**: Função única que devolve o papel de maior privilégio de um ator sobre um workspace,
considerando a associação direta em `workspace_members` e o papel na organização dona. Devolve
ausência de acesso quando nenhum dos dois existe. É o que dá efeito real ao papel `org_admin`, hoje
indistinguível de `workspace_admin` porque o papel de organização nunca é consultado.
**Where**: `apps/server/src/modules/workspace/effectiveRole.ts`
**Depends on**: T1
**Reuses**: as consultas que `requireMembership` já faz e a tabela de organizações do módulo.
**Requirement**: RBAC-01, RBAC-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Um `org_admin` sem linha em `workspace_members` recebe o papel `org_admin` sobre workspaces da sua organização
- [x] Um ator com papéis diferentes nos dois níveis recebe o mais permissivo
- [x] Um ator sem nenhum dos dois recebe ausência de acesso
- [x] Uma organização não resolvível resulta em recusa, nunca em concessão por omissão
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/server` workspace integration 94/94

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): resolve the effective workspace role from membership and org role`

---

### T3: Rotas passam a usar a resolução única

**What**: `requireMembership` passa a delegar a `resolveEffectiveRole`, de modo que toda rota que já
o usa herde a semântica nova sem mudar de forma. Nenhuma rota mantém consulta própria de papel — é
a duplicação de caminho que fez `org_admin` nascer sem efeito.
**Where**: `apps/server/src/modules/workspace/rbac.ts`
**Depends on**: T2
**Reuses**: o próprio `requireMembership`, cuja assinatura permanece.
**Requirement**: RBAC-05, RBAC-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Nenhuma rota do servidor resolve papel por caminho próprio
- [x] Um ator sem acesso continua recebendo `404`, não `403`
- [x] Nenhum contrato HTTP existente muda de forma
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/server` workspace integration 94/94

**Tests**: integration
**Gate**: build

**Commit**: `refactor(server): route every role check through resolveEffectiveRole`

---

### T4: Guarda de último administrador

**What**: Implementa a verificação, dentro da mesma transação da alteração, de que a mudança não
deixa o workspace sem administrador — contando `workspace_admin` com associação e `org_admin` da
organização dona. Lança conflito nomeando o motivo. A guarda tem de ser transacional: duas remoções
concorrentes passariam por uma verificação feita antes da alteração.
**Where**: `apps/server/src/modules/workspace/lastAdmin.ts`
**Depends on**: T2
**Reuses**: o helper de erro `conflict()` já usado pelo módulo.
**Requirement**: RBAC-08, RBAC-09, RBAC-10, RBAC-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Remover o último administrador devolve `409` e não remove
- [x] Rebaixar o último administrador devolve `409` e não altera
- [x] Remover o último `workspace_admin` é permitido quando existe `org_admin` na organização
- [x] Duas remoções concorrentes que deixariam o workspace sem administrador concluem no máximo uma
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/server` workspace integration 94/94

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): refuse changes that would leave a workspace without an admin`

---

### T5: Aplicar a guarda e a auditoria nas rotas de membro

**What**: As rotas de mudança de papel e de remoção de membro passam pela guarda e registram evento
de auditoria com ator, alvo e papel anterior.
**Where**: `apps/server/src/modules/workspace/members.ts`
**Depends on**: T3, T4
**Reuses**: `recordAuditEvent`, já usado por `workspace.created`.
**Requirement**: RBAC-11, RBAC-20

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Toda mudança de papel e remoção passa pela guarda antes de alterar
- [x] Cada operação concluída registra evento de auditoria com ator, alvo e papel anterior
- [x] Um ator sem `workspace:manage_members` continua recebendo `403`
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/server` workspace integration 94/94

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): guard and audit workspace membership changes`

---

### T6: Matriz de RBAC cobrindo os cinco papéis

**What**: Estende a matriz existente para cobrir os cinco papéis contra todas as ações, acrescentando
a dimensão que hoje não existe: ator com papel de organização e sem associação no workspace. Cobre
também o convite por e-mail, incluindo conta inexistente, já membro e e-mail com maiúsculas.
**Where**: `apps/server/src/modules/workspace/rbac-matrix.int.spec.ts`
**Depends on**: T5
**Reuses**: a matriz já existente no arquivo, que hoje cobre apenas atores com associação.
**Requirement**: RBAC-07, RBAC-17, RBAC-18, RBAC-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Cada um dos cinco papéis é exercitado contra todas as ações
- [x] O caso de `org_admin` sem associação está coberto para leitura e escrita
- [x] Convite com conta inexistente não revela nada além de que a conta precisa existir
- [x] Convite de quem já é membro devolve `409`
- [x] E-mail com maiúsculas resolve a conta existente
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/server` workspace integration 94/94

**Tests**: integration
**Gate**: build

**Commit**: `test(server): cover all five roles and the org-level dimension in the RBAC matrix`

---

### T7: Papel efetivo exposto pela interface

**What**: A página de membros passa a exibir o papel efetivo de quem está usando, com rótulo vindo
do i18n, e a apresentar o motivo junto de cada controle desabilitado por falta de permissão — hoje
um botão ausente é indistinguível de um defeito.
**Where**: `apps/web/src/nav/WorkspaceMembersPage.tsx`
**Depends on**: T3
**Reuses**: `can()` de `@arch-canvas/auth`, que a página já importa e usa.
**Requirement**: RBAC-13, RBAC-14, RBAC-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] O papel efetivo de quem está usando é exibido na página
- [x] Cada controle desabilitado por permissão apresenta o motivo
- [x] Todo rótulo de papel vem do i18n, com chaves em `en` e `pt-BR`
- [x] Sem violação `jest-axe`
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/web` 954/954, `packages/auth` 63/63

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): show the effective role and why an action is unavailable`

---

### T8: Papel efetivo nas demais superfícies de workspace

**What**: Estende a exibição do papel efetivo às listas de workspace e de projetos, junto ao nome do
workspace, e garante que o papel exibido acompanhe uma recarga após mudança.
**Where**: `apps/web/src/nav/ProjectListPage.tsx`
**Depends on**: T7
**Reuses**: a mesma apresentação de papel definida em T7.
**Requirement**: RBAC-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] O papel efetivo aparece junto ao nome do workspace
- [x] Após mudança de papel e recarga, o papel exibido é o novo
- [x] Nenhuma chamada nova a `/me` é introduzida — a identidade continua vindo de `useAuth()` (AD-011)
- [x] Gate check passes: `make lint` (0 erros), `make typecheck` (25/25), `apps/web` 954/954, `packages/auth` 63/63

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): surface the effective role on workspace surfaces`
