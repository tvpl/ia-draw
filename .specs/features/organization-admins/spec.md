# Administradores de organização Specification

## Problem Statement

AD-016 resolveu que `org_admin` vale em toda a organização, mas documentou uma consequência
deliberada: "não há `organization_members` e isso deliberadamente não adiciona uma — a única
leitura que o schema atual suporta, sem migração." Na prática isso significa que a única forma de
tornar alguém administrador da organização inteira é dar a ele o papel `org_admin` num workspace
qualquer — um formulário de convite de workspace produzindo um efeito de organização inteira, sem
tela dedicada para conceder ou revogar isso diretamente, e sem persistir se aquele workspace
específico for arquivado ou se o papel da pessoa nele mudar por outro motivo. `.specs/STATE.md`
já nomeia o próximo passo: essa tabela e um formulário que a alimente.

Uma varredura do código antes desta spec achou que a leitura de "`org_admin` em qualquer
workspace" não vive só em `effectiveRole.ts` — outros dois lugares fazem a MESMA varredura bruta
por conta própria: `ai-provider/routes.ts` (`hasOrgAdminMembership`, decide quem administra
providers de IA globais) e `workspace/workspaces.ts` (`listWorkspacesForUser`, decide quais
workspaces aparecem para um administrador de organização). Isso é exatamente a classe de defeito
que AD-016 fechou da primeira vez — uma segunda (e aqui, terceira) via de autorização que pode
divergir da primeira. Resolver esta pendência de verdade tem que fechar as três, não só a mais
visível.

## Goals

- [ ] Existe uma tabela `organization_members` como fonte única de quem administra cada organização
- [ ] Uma migração de dados preserva exatamente o conjunto de administradores de hoje — ninguém
      ganha nem perde acesso pela migração em si
- [ ] Um formulário dedicado concede e revoga administrador de organização, sem precisar editar o
      papel de alguém num workspace específico
- [ ] Os TRÊS lugares que hoje leem "`org_admin` em qualquer workspace" (resolução de papel efetivo,
      autorização de providers de IA globais, listagem de workspaces administrados) passam a ler a
      mesma fonte única
- [ ] Uma organização nunca fica sem nenhum administrador pela ação desta tela — mesma garantia que
      RBAC-08/09 já dão por workspace, agora por organização

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Remover `org_admin` do enum `workspace_member_role` | Ainda é um valor legal e significa "papel completo NESTE workspace" — igual a `workspace_admin` em poder. Remover o valor do enum quebraria linhas existentes e a matriz de RBAC sem necessidade; só o SIGNIFICADO organizacional dele muda, não o enum |
| Papéis organizacionais além de administrador (ex. "membro da organização" sem ser admin) | Nada no produto hoje distingue isso; `organization_members` nasce como tabela de presença — uma linha significa "administra esta organização", sem coluna de papel. Inventar granularidade nova seria requisito não pedido |
| Convidar alguém que ainda não tem conta como admin de organização | O convite de workspace já resolve por e-mail de usuário existente (`/users:lookup`); esta tela reusa exatamente esse padrão, sem inventar um fluxo de convite por e-mail externo novo |
| Múltiplas organizações por instância na UI (seletor de organização) | Fora do escopo — o produto hoje resolve a organização a partir do workspace atual em toda rota; esta tela faz o mesmo |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Formato da tabela | `organization_members(id, organization_id, user_id, created_at)`, sem coluna de papel, único por `(organization_id, user_id)` | Hoje só existe um conceito de administrador de organização — presença na tabela já é o sinal completo; uma coluna de papel com um único valor possível seria cerimônia sem função | y |
| `workspace_members.role = 'org_admin'` deixa de conceder alcance de organização | Sim — passa a significar só "papel completo neste workspace" (idêntico a `workspace_admin` em poderes), igual a qualquer outro papel de workspace | É exatamente o que a nova tabela resolve: hoje escolher "Admin da organização" num convite de workspace tem um efeito que o rótulo do formulário de workspace nunca deveria carregar sozinho | y |
| Convite/troca de papel de workspace para de oferecer `org_admin` como opção nova | Sim — os dois seletores (convite e troca de papel por linha) removem `org_admin` das opções futuras; uma linha legada com esse valor continua exibida com verdade, só não pode ser reatribuída de volta | Sem isso, o formulário de workspace continuaria parecendo conceder alcance de organização sem realmente conceder — pior que a situação atual | y |
| Quem pode conceder/revogar administrador de organização | Só quem já é `org_admin` efetivo (não basta `workspace_admin`) | Do contrário um administrador de UM workspace poderia promover qualquer pessoa a administradora de toda a organização — escalação de privilégio | y |
| Onde a tela vive | Nova seção em `WorkspaceMembersPage`, visível só para quem tem papel efetivo `org_admin` no workspace atual | Reusa o contexto de organização que a página já resolve (mesmo badge "Admin da organização" de RBAC-13); evita uma rota nova e um novo item de navegação para um caso de uso raro | y |
| O fundador do first-run | Continua recebendo `workspace_admin`/`org_admin` no workspace inicial exatamente como `bootstrapInstance` já faz (BOOT-03, inalterado) — E adicionalmente ganha uma linha em `organization_members` na mesma transação | Preserva BOOT-03 exatamente como está verificado; a nova tabela é estritamente aditiva no first-run, nenhuma AC de `instance-bootstrap` muda | y |
| Guarda de último administrador | Simétrica à de workspace (RBAC-08/09/12): dentro da mesma transação, sob `select ... for update` nas linhas de `organization_members` da organização, recusa com `409` uma revogação que zeraria os administradores | Mesmo padrão já provado em `lastAdmin.ts`; a onda `concurrency-proof` (R27) prova a versão de workspace contra Postgres real — o mesmo padrão de prova se aplica aqui quando fizer sentido, mas não é reescopado nesta spec | y |

**Open questions:** none — resolvidas acima.

---

## User Stories

### P1: A organização tem uma fonte única de quem a administra ⭐ MVP

**User Story**: Como pessoa mantendo este projeto, quero uma tabela dedicada para administradores
de organização, para que conceder ou revogar esse acesso não dependa de editar o papel de alguém
num workspace específico.

**Why P1**: É a consequência de desenho que AD-016 declarou e nomeou como próximo passo.

**Acceptance Criteria**:

1. The sistema SHALL persistir administrador de organização numa tabela própria, distinta de
   `workspace_members`
2. WHEN a migração roda sobre um banco existente THEN o sistema SHALL preencher a tabela nova com
   exatamente o conjunto de usuários que hoje têm `org_admin` em algum workspace de cada
   organização, sem adicionar nem remover ninguém
3. The resolução de papel efetivo (`resolveEffectiveRole`), a autorização de providers de IA
   globais e a listagem de workspaces administrados SHALL ler a mesma tabela nova como única fonte
   de alcance de organização — nenhuma das três SHALL continuar varrendo `workspace_members` por
   `role = 'org_admin'` para essa finalidade
4. WHEN `POST /auth/first-run` cria a primeira conta THEN o sistema SHALL, na mesma transação,
   também inserir essa conta na tabela nova como administradora da organização recém-criada

**Independent Test**: rodar a migração sobre um banco com administradores de organização existentes
e ver a lista de workspaces que cada um alcança inalterada antes e depois.

---

### P1: Um formulário concede e revoga administrador de organização ⭐ MVP

**User Story**: Como administrador de organização, quero uma tela dedicada para tornar outra pessoa
administradora ou remover essa condição, sem precisar editar o papel dela num workspace específico.

**Why P1**: É o "formulário que a alimente" que a ADR já nomeou.

**Acceptance Criteria**:

1. WHEN um administrador de organização visualiza um workspace dela THEN o sistema SHALL apresentar
   a lista de administradores da organização
2. WHEN um administrador de organização informa o e-mail de um usuário existente e confirma THEN o
   sistema SHALL torná-lo administrador da organização e SHALL registrar um evento de auditoria com
   ator e alvo
3. IF o e-mail informado não corresponde a um usuário existente THEN o sistema SHALL recusar com
   mensagem clara, sem criar nada
4. WHEN um administrador de organização remove outro administrador THEN o sistema SHALL revogar o
   acesso dele e SHALL registrar um evento de auditoria com ator e alvo
5. IF a remoção deixaria a organização sem nenhum administrador THEN o sistema SHALL responder `409`
   nomeando o motivo e SHALL não remover ninguém
6. IF quem tenta conceder ou revogar não é, ele mesmo, administrador efetivo da organização THEN o
   sistema SHALL responder `403`
7. WHILE a pessoa autenticada não é administradora de organização o sistema SHALL não apresentar
   esta seção na tela de membros

**Independent Test**: como administrador de organização, tornar outra pessoa administradora,
verificar que ela passa a ver todos os workspaces da organização, e depois removê-la e ver o acesso
sumir.

---

### P2: O papel de workspace para de prometer alcance que não confere mais

**User Story**: Como pessoa convidando alguém para um workspace, quero que o seletor de papel não
ofereça "Admin da organização" como opção, para não escolher por engano algo que hoje só afeta o
próprio workspace.

**Why P2**: É a consequência direta de mover o alcance de organização para a tabela nova — sem
isso, o formulário de workspace continuaria prometendo um efeito que não tem mais.

**Acceptance Criteria**:

1. WHEN alguém convida um novo membro de workspace THEN o sistema SHALL oferecer só os papéis cujo
   alcance é o próprio workspace (`workspace_admin`, `editor`, `reviewer`, `viewer`)
2. WHEN alguém troca o papel de um membro existente THEN o sistema SHALL oferecer o mesmo conjunto
   reduzido de opções
3. IF uma linha existente de `workspace_members` já tem o papel `org_admin` (legado) THEN o sistema
   SHALL continuar exibindo esse papel com fidelidade, sem forçar uma migração de dados dessa coluna

**Independent Test**: abrir o seletor de papel de convite e de troca e ver quatro opções, nunca
cinco; abrir uma linha legada com `org_admin` e ver o rótulo correto exibido mesmo assim.

---

## Edge Cases

- IF duas revogações concorrentes de administrador de organização deixariam a organização sem
  nenhum THEN o sistema SHALL concluir no máximo uma — mesma garantia de RBAC-12, mesmo mecanismo
  (`select ... for update`, agora sobre `organization_members`)
- IF a pessoa que está sendo tornada administradora já é administradora da organização THEN o
  sistema SHALL responder de forma idempotente (sem criar linha duplicada, sem erro)
- WHEN o `first-run` cria a primeira conta THEN o sistema SHALL garantir que a organização nunca
  passe por um estado sem nenhum administrador, nem por um instante

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ORG-01 | P1: A organização tem uma fonte única de quem a administra | Tasks | Pending |
| ORG-02 | P1: A organização tem uma fonte única de quem a administra | Tasks | Pending |
| ORG-03 | P1: A organização tem uma fonte única de quem a administra | Tasks | Pending |
| ORG-04 | P1: A organização tem uma fonte única de quem a administra | Tasks | Pending |
| ORG-05 | P1: Um formulário concede e revoga administrador de organização | Tasks | Pending |
| ORG-06 | P1: Um formulário concede e revoga administrador de organização | Tasks | Pending |
| ORG-07 | P1: Um formulário concede e revoga administrador de organização | Tasks | Pending |
| ORG-08 | P1: Um formulário concede e revoga administrador de organização | Tasks | Pending |
| ORG-09 | P1: Um formulário concede e revoga administrador de organização | Tasks | Pending |
| ORG-10 | P1: Um formulário concede e revoga administrador de organização | Tasks | Pending |
| ORG-11 | P1: Um formulário concede e revoga administrador de organização | Tasks | Pending |
| ORG-12 | P2: O papel de workspace para de prometer alcance que não confere mais | Tasks | Pending |
| ORG-13 | P2: O papel de workspace para de prometer alcance que não confere mais | Tasks | Pending |
| ORG-14 | P2: O papel de workspace para de prometer alcance que não confere mais | Tasks | Pending |

**Coverage:** 14 total, 14 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] `organization_members` existe e a migração preserva o conjunto de administradores de hoje
- [ ] Os três call sites que liam `workspace_members.role='org_admin'` para alcance de organização
      leem a tabela nova
- [ ] Um formulário dedicado concede/revoga administrador de organização, com guarda de último
      administrador
- [ ] O seletor de papel de workspace não oferece mais `org_admin` como opção nova
- [ ] `make ci` passa; `AD-016` ganha uma nota de consequência resolvida em `.specs/STATE.md`
