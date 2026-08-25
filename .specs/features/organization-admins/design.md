# Administradores de organização Design

## Arquitetura

```
organizations ──< organization_members >── users
      │
      └──< workspaces ──< workspace_members >── users
```

`organization_members` é uma tabela nova, irmã de `workspace_members`, não uma extensão dela.
Presença de uma linha `(organization_id, user_id)` é o sinal inteiro — sem coluna de papel (ver
spec.md Assumptions).

## Fonte única: os três call sites

Varredura do código antes desta spec achou três lugares lendo `workspace_members.role='org_admin'`
como proxy de "administra a organização inteira". Os três migram para `organization_members`:

| Arquivo | Função | Antes | Depois |
| --- | --- | --- | --- |
| `apps/server/src/modules/workspace/effectiveRole.ts` | `resolveOrganizationRole` | `join workspace_members × workspaces where role='org_admin'` | `select 1 from organization_members where organization_id = ? and user_id = ?` |
| `apps/server/src/modules/ai-provider/routes.ts` | `hasOrgAdminMembership` | `select from workspace_members where role='org_admin'` (qualquer workspace) | `select 1 from organization_members where user_id = ?` (qualquer organização — mesma semântica "global" de hoje) |
| `apps/server/src/modules/workspace/workspaces.ts` | `listWorkspacesForUser`'s `administeredOrgs` | `selectDistinct workspaces.organization_id from workspace_members join workspaces where role='org_admin'` | `select organization_id from organization_members where user_id = ?` |

Nenhum dos três ganha um segundo caminho novo — cada um troca sua ÚNICA consulta hoje existente
pela consulta equivalente contra a tabela nova. `resolveEffectiveRole` continua sendo o único
lugar que COMBINA papel direto + papel de organização (RBAC-05, inalterado).

## Schema

```typescript
// packages/database/src/schema.ts
export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('organization_members_org_user_unique').on(table.organizationId, table.userId),
  ],
);
```

Duas migrações, na ordem:

1. `infra/migrations/0012_*.sql` — gerada por `drizzle-kit generate` a partir do schema acima
   (`CREATE TABLE organization_members ...`).
2. `infra/migrations/0013_backfill_organization_admins.sql` — gerada como migração `--custom`
   (vazia) e escrita à mão com o backfill de dados:

```sql
insert into organization_members (organization_id, user_id)
select distinct w.organization_id, wm.user_id
from workspace_members wm
join workspaces w on w.id = wm.workspace_id
where wm.role = 'org_admin'
on conflict do nothing;
```

`ON CONFLICT DO NOTHING` cobre o caso de alguém já ter `org_admin` em mais de um workspace da mesma
organização — a linha em `organization_members` é única por `(organization_id, user_id)`, então a
segunda ocorrência é um no-op, não um erro.

## Módulo do servidor

Novo arquivo `apps/server/src/modules/workspace/organizationAdmins.ts` — funções puras de acesso a
dados, mesmo formato de `members.ts`:

- `listOrganizationAdmins(db, organizationId): Promise<{userId, email, displayName}[]>`
- `addOrganizationAdmin(db, organizationId, userId): Promise<void>` — `INSERT ... ON CONFLICT DO
  NOTHING` (ORG edge case: idempotente, sem erro se já é admin)
- `withLastOrgAdminGuard(db, organizationId, targetUserId, change)` — mesmo padrão de
  `lastAdmin.ts`: `select id from organization_members where organization_id = ? for update`,
  conta as linhas restantes menos o alvo, recusa com `LastOrgAdminError` se chegaria a zero
- `removeOrganizationAdmin` — usa a guarda acima

Rotas em `apps/server/src/modules/workspace/routes.ts` (mesmo módulo, mesmo prefixo `/workspaces`,
sem prefixo novo — AD-013 satisfeita por construção):

```
GET    /workspaces/:id/organization-admins        — qualquer membro do workspace (leitura universal)
POST   /workspaces/:id/organization-admins         — só quem tem papel efetivo 'org_admin' NESTE workspace
DELETE /workspaces/:id/organization-admins/:userId — idem
```

A checagem "é org_admin efetivo, não só workspace_admin" é um `if (role !== 'org_admin') forbidden()`
direto no handler — não é uma `Action` nova em `packages/auth/rbac.ts`, porque `workspace_admin` e
`org_admin` têm o MESMO conjunto de grants ali (R22); a distinção que importa aqui é identidade de
papel, não uma permissão que o `can()` já modela. Resolvida via `requireMembership` (que já delega
a `resolveEffectiveRole`), reaproveitada sem mudança.

`POST` reusa o padrão de lookup por e-mail que `memberClient`/`/users:lookup` já estabelecem —
resolve o e-mail para um `userId` antes de inserir; `404`/erro nomeado se o e-mail não corresponde
a ninguém (spec.md AC3 da segunda história).

## Bootstrap (first-run)

`bootstrapInstance` (`firstRun.ts`) ganha uma linha a mais na mesma transação, depois do insert em
`workspace_members`:

```typescript
await tx.insert(organizationMembers).values({ organizationId: org.id, userId: user.id });
```

Estritamente aditivo — nenhuma linha, asserção ou AC de `instance-bootstrap` muda (ver spec.md
Assumptions: BOOT-03 continua intocado).

## Seletor de papel de workspace

`WorkspaceMembersPage.tsx`'s `ROLE_VALUES` (usado para montar as opções do convite e da troca de
papel por linha) perde `'org_admin'`:

```typescript
// Antes: ['org_admin', 'workspace_admin', 'editor', 'reviewer', 'viewer']
// Depois:
const ASSIGNABLE_ROLE_VALUES: readonly Role[] = ['workspace_admin', 'editor', 'reviewer', 'viewer'];
```

O rótulo de uma linha EXISTENTE continua vindo de `ROLE_KEY`/`nav.members.roleOptions.*` sem
mudança — `ROLE_KEY` mantém a entrada `org_admin` para exibição, só o array de OPÇÕES do `<select>`
encolhe. Uma linha legada com `role === 'org_admin'` mostra "Admin da organização" no texto, mas o
`<select>` de troca de papel dela não reoferece esse valor como destino — reflete a Assumption da
spec ("continua exibindo esse papel com fidelidade, sem forçar migração de dados").

Servidor: `roleSchema` em `routes.ts` permanece `z.enum(ROLE_VALUES)` com os 5 valores (uma linha
legada em `PATCH` para OUTRO papel ainda precisa que o schema aceite ler o valor atual, e nada
impede tecnicamente um cliente antigo/bypassado de enviar `org_admin` de novo) — mas a validação
NÃO precisa rejeitar `org_admin` explicitamente: como esse papel não confere mais alcance de
organização (só a tabela nova confere), aceitá-lo no body não é mais um risco de escalação — na
pior hipótese, alguém fica com um papel de workspace idêntico a `workspace_admin` em poderes. A
mudança de comportamento fica inteiramente no cliente (a opção some do formulário); o servidor não
precisa de uma regra de validação nova para ficar seguro.

## Cliente web

Novo arquivo `apps/web/src/nav/organizationAdminClient.ts` — mesmo formato de `memberClient.ts`:
`list(workspaceId)`, `add(workspaceId, email)` (faz o lookup por e-mail e o POST em sequência, ou
delega o lookup ao servidor — decidido em Tasks pela forma mais simples de testar), `remove(workspaceId, userId)`.

Nova seção dentro de `WorkspaceMembersPage.tsx`, renderizada só quando `workspace.role ===
'org_admin'` — mesmo padrão já usado por `WorkspaceListPage`'s link "Providers de IA (global)"
(`canAdministerGlobalProviders = items.some(item => item.role === 'org_admin')`). Lista de
administradores + formulário de e-mail + botão remover por linha, reaproveitando `css.panel`,
`css.listRow`, `css.errorBox` etc. (AD-014).

## i18n

Novo namespace `nav.orgAdmins` em `en` e `pt-BR`: `title`, `add`, `remove`, `emailLabel`,
`notFound` (e-mail não corresponde a ninguém), `lastAdmin` (409), `empty`.

## Auditoria

`recordAuditEvent` com `action: 'organization.admin.added'` / `'organization.admin.removed'`,
`resourceType: 'organization'`, mesmo formato que `workspace.member.added/removed` já usa.

## Testes

- Unit: `organizationAdmins.ts` (list/add idempotente/remove/guarda de último admin) —
  `packages/database`-style, PGlite (ADR-0007, sem exceção — esta suíte não depende de
  concorrência genuína, só do resultado final).
- Integration (`*.int.spec.ts`, PGlite): rotas REST, os três call sites migrados (prova que
  `resolveEffectiveRole`, `hasOrgAdminMembership` via `/ai-providers?scope=global`, e
  `listWorkspacesForUser` via `GET /workspaces` todos refletem uma concessão feita só pela tabela
  nova, sem nenhuma linha `org_admin` em `workspace_members`).
- Migração: teste dedicado (mesmo padrão de `migrate.int.spec.ts`) — popula `workspace_members`
  com `org_admin` em 3 workspaces de 2 organizações diferentes (um usuário repetido em duas linhas
  da mesma organização), roda as duas migrações, afirma o conjunto exato de linhas resultantes em
  `organization_members`.
- Web: `WorkspaceMembersPage.spec.tsx` — seção visível só para `org_admin`; adicionar/remover;
  seletor de papel sem `org_admin` como opção nova; linha legada exibindo `org_admin` com fidelidade.
