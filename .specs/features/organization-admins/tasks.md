# Administradores de organização Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: `.specs/features/organization-admins/design.md`
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Schema + migração de dados | integration | ORG-02: o backfill preserva exatamente o conjunto de administradores existentes, sem adicionar/remover ninguém, dedupe por `(organization_id, user_id)` | `packages/database/src/migrate.int.spec.ts` (estendido) ou arquivo próprio | `pnpm -w test:integration` |
| Os três call sites migrados | integration | ORG-03: `resolveEffectiveRole`, `hasOrgAdminMembership` (via `/ai-providers?scope=global`), `listWorkspacesForUser` (via `GET /workspaces`) todos refletem uma concessão feita SÓ por `organization_members`, sem linha `org_admin` em `workspace_members` | `apps/server/src/modules/workspace/rbac-matrix.int.spec.ts`, `apps/server/src/modules/ai-provider/*.int.spec.ts`, `apps/server/src/modules/workspace/workspace.int.spec.ts` | `pnpm -w test:integration` |
| Bootstrap aditivo | integration | ORG-04: first-run insere em `organization_members` além do já existente | `apps/server/src/modules/auth/firstRun.int.spec.ts` (estendido) | `pnpm -w test:integration` |
| `organizationAdmins.ts` (motor puro) | unit | ORG-05..09 e edge cases: conceder, revogar, idempotência, guarda de último administrador | `apps/server/src/modules/workspace/organizationAdmins.spec.ts` | `pnpm -w test:unit` |
| Rotas REST de administradores de organização | integration | ORG-05, ORG-06, ORG-07, ORG-09, ORG-10, ORG-11 e o edge case de duas revogações concorrentes | `apps/server/src/modules/workspace/organizationAdmins.int.spec.ts` | `pnpm -w test:integration` |
| Seção na tela de membros | unit | ORG-08 (visível só para `org_admin`), fluxo de conceder/revogar | `apps/web/src/nav/WorkspaceMembersPage.spec.tsx` | `pnpm -w test:unit` |
| Seletor de papel sem `org_admin` | unit | ORG-12, ORG-13, ORG-14 | `apps/web/src/nav/WorkspaceMembersPage.spec.tsx` | `pnpm -w test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois de cada task que toca `apps/server` ou migração, e antes do Verifier | `make ci` |

---

## Execution Plan

### Phase 1: Schema e migração

```
T1
T1 -> T2
```

### Phase 2: Fonte única (os três call sites) e bootstrap

```
T2 -> T3
T2 -> T4
T2 -> T5
T2 -> T6
```

### Phase 3: Módulo e rotas de administradores de organização

```
T3 -> T7
T7 -> T8
```

### Phase 4: Cliente e interface

```
T8 -> T9
T9 -> T10
T10 -> T11
```

### Phase 5: Documentação

```
T11 -> T12
T12 -> T13
```

---

## Task Breakdown

### T1: Tabela `organization_members`

**What**: Adiciona `organizationMembers` a `packages/database/src/schema.ts` (id, organizationId,
userId, createdAt; único por `(organizationId, userId)`, conforme design.md). Roda `drizzle-kit
generate` para produzir `infra/migrations/0012_*.sql`.
**Where**: `packages/database/src/schema.ts`
**Depends on**: None
**Reuses**: mesmo padrão de `workspaceMembers` (uuid PK, `references()`, `uniqueIndex`).
**Requirement**: ORG-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `organizationMembers` existe no schema, exportado
- [x] `infra/migrations/0012_*.sql` cria a tabela com a constraint única
- [x] `pnpm --filter @arch-canvas/database run db:generate` roda sem diffs pendentes depois do commit
- [x] Gate check passes: `make lint && make typecheck`

**Tests**: none
**Gate**: full

**Commit**: `feat(database): add the organization_members table`

---

### T2: Migração de dados (backfill) + teste de migração

**What**: `drizzle-kit generate --custom --name backfill_organization_admins` produz
`infra/migrations/0013_*.sql` vazia; escreve à mão o `INSERT ... SELECT DISTINCT ... FROM
workspace_members JOIN workspaces WHERE role = 'org_admin' ON CONFLICT DO NOTHING` (design.md).
Teste de migração: popula `workspace_members` com `org_admin` em 3 workspaces de 2 organizações
(um usuário repetido na mesma organização), roda as duas migrações, afirma o conjunto exato
resultante em `organization_members`.
**Where**: `infra/migrations/0013_*.sql`, `packages/database/src/organizationMembersBackfill.int.spec.ts`
**Depends on**: T1
**Reuses**: `MIGRATIONS_FOLDER`, `runMigrations` — mesmo padrão de `migrate.int.spec.ts`.
**Requirement**: ORG-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] O backfill preserva exatamente o conjunto de administradores existentes — nenhum a mais, nenhum a menos
- [x] Um usuário com `org_admin` em dois workspaces da MESMA organização gera uma única linha (dedupe)
- [x] Rodar a migração duas vezes seguidas não falha (idempotente via `ON CONFLICT DO NOTHING`)
- [x] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: integration
**Gate**: full

**Commit**: `feat(database): backfill organization_members from existing org_admin rows`

---

### T3: `resolveOrganizationRole` lê a tabela nova

**What**: Troca a consulta de `resolveOrganizationRole` (`effectiveRole.ts`) do join
`workspace_members × workspaces WHERE role='org_admin'` para `select 1 from organization_members
where organization_id = ? and user_id = ?` (design.md).
**Where**: `apps/server/src/modules/workspace/effectiveRole.ts`
**Depends on**: T2
**Reuses**: a mesma assinatura de função — nenhum chamador muda.
**Requirement**: ORG-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `resolveOrganizationRole` não lê mais `workspace_members.role='org_admin'`
- [x] Um usuário com linha só em `organization_members` (sem nenhum `org_admin` em `workspace_members`) resolve `org_admin` via `resolveEffectiveRole`
- [x] Os testes existentes de `rbac-matrix.int.spec.ts` que dependiam do comportamento antigo continuam verdes, adaptados para semear via `organization_members`
- [x] Gate check passes: `make ci`

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): resolve organisation-wide role from organization_members`

---

### T4: `hasOrgAdminMembership` lê a tabela nova

**What**: Troca a consulta em `ai-provider/routes.ts` de `workspace_members` para `select 1 from
organization_members where user_id = ?` (qualquer organização — mesma semântica "global" de hoje,
design.md).
**Where**: `apps/server/src/modules/ai-provider/routes.ts`
**Depends on**: T2
**Reuses**: mesma assinatura de `assertProviderAdmin`.
**Requirement**: ORG-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `hasOrgAdminMembership` não lê mais `workspace_members.role='org_admin'`
- [x] Um usuário com linha só em `organization_members` acessa `scope=global` sem nenhum `org_admin` em `workspace_members`
- [x] Gate check passes: `make ci`

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): authorize global AI provider admin from organization_members`

---

### T5: `listWorkspacesForUser` lê a tabela nova

**What**: Troca a consulta `administeredOrgs` em `workspaces.ts` de `workspace_members` para
`select organization_id from organization_members where user_id = ?` (design.md).
**Where**: `apps/server/src/modules/workspace/workspaces.ts`
**Depends on**: T2
**Reuses**: o restante da função, inalterado.
**Requirement**: ORG-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `administeredOrgs` não lê mais `workspace_members.role='org_admin'`
- [x] Um usuário com linha só em `organization_members` vê todos os workspaces da organização em `GET /workspaces`
- [x] Gate check passes: `make ci`

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): list org-administered workspaces from organization_members`

---

### T6: Bootstrap insere em `organization_members`

**What**: `bootstrapInstance` (`firstRun.ts`) insere, na mesma transação e depois do insert em
`workspace_members`, uma linha em `organization_members` para a conta recém-criada. Estritamente
aditivo — nenhuma asserção de BOOT-03 muda.
**Where**: `apps/server/src/modules/auth/firstRun.ts`
**Depends on**: T2
**Reuses**: a mesma transação já aberta.
**Requirement**: ORG-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O `first-run` insere uma linha em `organization_members` para o fundador
- [ ] Todos os testes existentes de `instance-bootstrap` continuam verdes sem alteração
- [ ] Gate check passes: `make ci`

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): grant the first-run founder organization_members admin`

---

### T7: `organizationAdmins.ts` — motor de dados

**What**: Novo arquivo com `listOrganizationAdmins`, `addOrganizationAdmin` (idempotente via `ON
CONFLICT DO NOTHING`), `withLastOrgAdminGuard` (mesmo padrão `select ... for update` de
`lastAdmin.ts`, agora sobre `organization_members`), `removeOrganizationAdmin`, `LastOrgAdminError`
(design.md).
**Where**: `apps/server/src/modules/workspace/organizationAdmins.ts`
**Depends on**: T3
**Reuses**: `lastAdmin.ts` como template estrutural direto.
**Requirement**: ORG-05, ORG-06, ORG-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `addOrganizationAdmin` não falha e não duplica quando o alvo já é administrador
- [ ] `withLastOrgAdminGuard` recusa uma revogação que zeraria os administradores, sob lock de linha
- [ ] O lock cobre a leitura e a escrita na mesma transação (não checa-depois-muta)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(server): add the organization-admin data layer with a last-admin guard`

---

### T8: Rotas REST + auditoria

**What**: `GET/POST/DELETE /workspaces/:id/organization-admins[/:userId]` em `routes.ts`
(design.md): `GET` para qualquer membro; `POST`/`DELETE` só quando o papel efetivo do ator É
`org_admin` (checagem direta, não uma `Action` nova em `rbac.ts` — ver design.md). `POST` resolve
o e-mail para `userId` (reusa o padrão de `/users:lookup`); `404`/erro nomeado se não existir.
Eventos de auditoria `organization.admin.added`/`removed`.
**Where**: `apps/server/src/modules/workspace/routes.ts`
**Depends on**: T7
**Reuses**: `requireMembership`, `recordAuditEvent`, o padrão de lookup por e-mail já usado pelo
convite de membro de workspace.
**Requirement**: ORG-05, ORG-06, ORG-07, ORG-09, ORG-10, ORG-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `GET` funciona para qualquer membro do workspace
- [ ] `POST`/`DELETE` respondem `403` para quem tem papel efetivo `workspace_admin` mas não `org_admin`
- [ ] `POST` com e-mail inexistente recusa sem criar nada
- [ ] `DELETE` que zeraria os administradores responde `409` nomeando o motivo, sem remover
- [ ] Cada concessão/revogação bem-sucedida grava um evento de auditoria com ator e alvo
- [ ] Duas revogações concorrentes (teste com `Promise.all` sobre PGlite, aceitando a limitação de
      concorrência real — a prova genuína fica fora do escopo desta feature, ver `concurrency-proof`)
      concluem no máximo uma sem erro não tratado
- [ ] Gate check passes: `make ci`

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): add REST routes for granting and revoking organization admins`

---

### T9: `organizationAdminClient.ts`

**What**: Cliente web — `list(workspaceId)`, `add(workspaceId, email)`, `remove(workspaceId,
userId)`, mesmo formato de `memberClient.ts`.
**Where**: `apps/web/src/nav/organizationAdminClient.ts`
**Depends on**: T8
**Reuses**: `memberClient.ts` como template direto (injeção de `fetchImpl`, tratamento de erro por
status).
**Requirement**: ORG-05, ORG-06, ORG-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `add`/`remove` retornam um resultado tipado por status (`ok`/`not_found`/`conflict`/`forbidden`), sem lançar em resposta HTTP não-2xx esperada
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add the organization-admin client`

---

### T10: Seção "Administradores da organização" em `WorkspaceMembersPage`

**What**: Nova seção, visível só quando `workspace.role === 'org_admin'` (mesmo padrão de
`WorkspaceListPage`'s link de providers globais): lista + formulário de e-mail + botão remover por
linha. Rótulos i18n `nav.orgAdmins.*` em `en` e `pt-BR`.
**Where**: `apps/web/src/nav/WorkspaceMembersPage.tsx`, `apps/web/src/i18n/locales/en/translation.json`,
`apps/web/src/i18n/locales/pt-BR/translation.json`
**Depends on**: T9
**Reuses**: `css.panel`, `css.listRow`, `css.errorBox`, `css.field` (AD-014).
**Requirement**: ORG-08, ORG-05, ORG-06, ORG-07, ORG-09, ORG-10, ORG-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A seção só aparece para quem tem `workspace.role === 'org_admin'`
- [ ] Conceder atualiza a lista sem recarregar a página
- [ ] Revogar mostra a mensagem de `409` quando aplicável, sem remover ninguém da lista visível
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add the organization-admins section to the members page`

---

### T11: Seletor de papel de workspace sem `org_admin`

**What**: `ROLE_VALUES` usado para montar as opções do convite e da troca de papel por linha em
`WorkspaceMembersPage.tsx` perde `'org_admin'` — vira `ASSIGNABLE_ROLE_VALUES` com 4 valores
(design.md). `ROLE_KEY`/rótulos de EXIBIÇÃO permanecem com os 5, para uma linha legada continuar
mostrando "Admin da organização" com fidelidade.
**Where**: `apps/web/src/nav/WorkspaceMembersPage.tsx`
**Depends on**: T10
**Reuses**: `ROLE_KEY` existente, sem mudança.
**Requirement**: ORG-12, ORG-13, ORG-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O seletor de convite oferece 4 opções, nunca `org_admin`
- [ ] O seletor de troca de papel por linha oferece as mesmas 4 opções
- [ ] Uma linha existente com `role === 'org_admin'` (legado) continua exibindo esse rótulo corretamente, mesmo sem poder ser reatribuída de volta a ele pelo seletor
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): stop offering org_admin as an assignable workspace role`

---

### T12: ADR-0017

**What**: Nova ADR registrando a decisão: `organization_members` como fonte única de alcance de
organização, os três call sites migrados, `org_admin` de workspace deixando de conferir alcance de
organização. Formato Status/Data/Contexto/Decisão/Consequências (`docs/adr/TEMPLATE.md`).
**Where**: `docs/adr/0017-organization-members-table.md`
**Depends on**: T11
**Reuses**: formato de `0013..0016`.
**Requirement**: ORG-01..14 (fechamento documental)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A ADR nomeia os três call sites migrados
- [ ] A ADR nomeia a decisão de remover `org_admin` das opções futuras do seletor de workspace
- [ ] `.specs/STATE.md` ganha uma entrada AD-017 correspondente
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(adr): record organization_members as the source of org-wide admin status`

---

### T13: Fechar a dívida no roadmap e no handoff

**What**: Atualiza `remediation-roadmap.md` e a subseção `platform-remediation` de `.specs/
STATE.md`, marcando R28 como fechada e a consequência de desenho de AD-016 como resolvida (com
referência à AD-017).
**Where**: `.specs/features/platform-maturity/remediation-roadmap.md`, `.specs/STATE.md`
**Depends on**: T12
**Reuses**: nenhum.
**Requirement**: ORG-01..14 (fechamento documental)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] R28 aparece fechada no roadmap
- [ ] A entrada AD-016 em `.specs/STATE.md` referencia a AD-017 como a consequência resolvida
- [ ] `.specs/STATE.md`'s "Aberto e sem dono" não lista mais a consequência de AD-016
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(specs): close R28 in the remediation handoff`
