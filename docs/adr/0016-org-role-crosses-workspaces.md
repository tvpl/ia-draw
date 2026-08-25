# ADR-0016: Papel de organização com efeito cross-workspace

## Status

Aceita

## Data

2026-08-24

## Contexto

Os cinco papéis colapsavam em três conjuntos idênticos: `org_admin` ≡ `workspace_admin` e
`reviewer` ≡ `viewer`. Pior, `org_admin` não tinha poder algum além do workspace onde possuía linha
em `workspace_members`, porque `resolveWorkspaceRole` lia essa tabela e nada mais. O nome prometia
alcance organizacional que a API não cumpria.

Não havia guarda no servidor contra remover o último administrador de um workspace: a proteção
existia só no cliente, e o próprio comentário de `WorkspaceMembersPage` admitia isso.

## Decisão

O papel efetivo sobre um workspace é resolvido por uma única função no servidor
(`resolveEffectiveRole`), que considera a associação direta **e** o papel na organização dona,
aplicando o mais permissivo dos dois. Ter `org_admin` em qualquer workspace de uma organização é o
que faz alguém administrador dela — a única leitura que o schema atual suporta, sem migração.

`reviewer` passa a conceder `comment:resolve` e `viewer` deixa de concedê-lo. A guarda que impede um
workspace de ficar sem administrador roda dentro da mesma transação da alteração, sob lock das linhas
de associação.

## Consequências

- Nenhum valor de papel muda no banco; apenas os grants associados a eles. Descartada a redução para
  três papéis, que exigiria migração destrutiva de enum e quebra de contrato da API.
- Toda consulta que descobria acesso por conta própria teve de ser corrigida:
  `getWorkspaceById` e `listWorkspacesForUser` faziam join próprio em `workspace_members` e anulavam
  a mudança silenciosamente. Nenhuma rota pode voltar a resolver papel por caminho próprio.
- **Consequência disclosed**: `createWorkspace` põe todo workspace na mesma organização padrão. Com
  esta decisão, um único `org_admin` mantém todos os workspaces de uma instância administrados, e a
  guarda de último administrador nunca dispara enquanto ele existir. É defensável — um administrador
  de organização de fato administra tudo — mas quem quiser organizações de verdade precisa de uma
  tabela `organization_members` e de uma tela que a alimente.
