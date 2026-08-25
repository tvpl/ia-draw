# ADR-0017: Tabela `organization_members` como fonte única de alcance de organização

## Status

Aceita

## Data

2026-08-25

## Contexto

AD-016 resolveu o papel efetivo de workspace, mas documentou uma consequência de desenho
deliberada: ser `org_admin` em *qualquer* workspace de uma organização é o que faz alguém
administrador dela inteira, porque o schema não tinha `organization_members` — a única leitura
possível sem migração. Na prática, conceder ou revogar alcance de organização dependia de editar o
papel de alguém num workspace específico, sem tela dedicada, e sem persistir se aquele workspace
fosse arquivado.

Uma varredura do código antes desta spec achou que essa leitura não vivia só em
`resolveEffectiveRole`: dois outros lugares faziam a MESMA varredura bruta por conta própria —
`ai-provider/routes.ts`'s `hasOrgAdminMembership` (autorização de providers de IA globais) e
`workspace/workspaces.ts`'s `listWorkspacesForUser` (quais workspaces um administrador de
organização enxerga). Era exatamente a classe de defeito que AD-016 fechou da primeira vez — um
segundo (aqui, terceiro) caminho de autorização capaz de divergir do primeiro.

## Decisão

`organization_members(id, organization_id, user_id, created_at)` passa a ser a fonte única de quem
administra cada organização — uma tabela de presença, sem coluna de papel, única por
`(organization_id, user_id)`. Uma migração de backfill preenche exatamente o conjunto de usuários
que hoje têm `org_admin` em algum workspace de cada organização, sem adicionar nem remover ninguém.

Os três call sites que liam `workspace_members.role='org_admin'` como proxy de alcance de
organização migram para a tabela nova, cada um trocando sua única consulta hoje existente pela
consulta equivalente contra `organization_members`:

- `apps/server/src/modules/workspace/effectiveRole.ts`'s `resolveOrganizationRole`
- `apps/server/src/modules/ai-provider/routes.ts`'s `hasOrgAdminMembership`
- `apps/server/src/modules/workspace/workspaces.ts`'s `listWorkspacesForUser`

Um módulo novo, `apps/server/src/modules/workspace/organizationAdmins.ts`, concentra list/add/remove
e a guarda transacional de último administrador (`withLastOrgAdminGuard`, mesmo padrão de
`lastAdmin.ts`, agora sob lock de linha em `organization_members`). Rotas REST
(`GET/POST/DELETE /workspaces/:id/organization-admins[/:userId]`) e uma seção dedicada em
`WorkspaceMembersPage` concedem e revogam sem precisar editar papel de workspace.

`workspace_members.role = 'org_admin'` deixa de conceder alcance de organização — passa a
significar só "papel completo NESTE workspace", idêntico a `workspace_admin` em poderes. O enum
`workspace_member_role` não muda: `org_admin` continua um valor válido (uma linha legada continua
existindo e exibindo esse rótulo com fidelidade), mas os dois seletores de papel de workspace
(convite e troca por linha) param de oferecê-lo como opção nova — `ASSIGNABLE_ROLE_VALUES` cai para
quatro valores (`workspace_admin`, `editor`, `reviewer`, `viewer`).

## Consequências

- `resolveEffectiveRole` continua sendo o único lugar que COMBINA papel direto de workspace com
  papel de organização; nenhum dos três call sites ganha um segundo caminho de leitura — cada um
  troca sua consulta antiga pela nova, ponto a ponto.
- O `first-run` (`bootstrapInstance`) ganha um insert adicional em `organization_members`, na mesma
  transação, estritamente aditivo — nenhuma asserção de `instance-bootstrap`/BOOT-03 muda.
- O enum `workspace_member_role` mantém os cinco valores: removê-lo quebraria linhas existentes e a
  matriz de RBAC sem necessidade, já que o significado organizacional muda, não a validade do valor.
- Escopo afetado: `packages/database/src/schema.ts`, `apps/server/src/modules/workspace/*`,
  `apps/server/src/modules/ai-provider/routes.ts`, `apps/server/src/modules/auth/firstRun.ts`,
  `apps/web/src/nav/{organizationAdminClient.ts,WorkspaceMembersPage.tsx}`.
- Resolve a consequência de desenho que AD-016 tinha deixado aberta e sem dono — nenhuma ADR futura
  precisa reabrir esse ponto a menos que o produto ganhe papéis de organização além de administrador
  (fora de escopo aqui; ver spec.md's Out of Scope).
