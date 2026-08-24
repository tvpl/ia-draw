# Clareza de RBAC Specification

## Problem Statement

O RBAC existe e é aplicado no servidor, mas é invisível e parcialmente falso. Os cinco papéis de
`packages/auth/src/rbac.ts` colapsam em três conjuntos de permissão: `org_admin` e
`workspace_admin` têm grants idênticos, e `reviewer` e `viewer` também. `org_admin` não tem nenhum
poder além do workspace onde possui associação, o que torna o nome uma promessa que a API não
cumpre. Nada na interface informa qual é o papel de quem está usando, então um botão ausente é
indistinguível de um bug. O servidor não impede que o último administrador de um workspace seja
removido ou rebaixado — a proteção existe apenas no cliente, e o próprio comentário de
`WorkspaceMembersPage` admite isso. E o convite por e-mail depende de `GET /users:lookup`, um dos
prefixos não roteados, então adicionar alguém a um workspace falha sempre.

## Goals

- [ ] Os cinco papéis têm poderes distintos e verificáveis, ou deixam de existir
- [ ] A pessoa vê seu papel efetivo na superfície onde ele importa
- [ ] Um workspace nunca fica sem administrador por ação da API

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Permissões por recurso individual (por diagrama, por projeto) | O modelo é por workspace desde AUTH-02; mudar a granularidade é outro produto |
| Papéis customizáveis pelo cliente | Nenhum requisito pede; multiplica a superfície de teste por N |
| Convite por e-mail com envio de mensagem | Sem transporte de e-mail no projeto (mesma exclusão de `instance-bootstrap`) |
| Rotear `/users:lookup` | É `edge-routing` (R18); esta spec depende dele |
| Tela de administração de usuários da instância | Superfície nova; a queixa observável se resolve com papel visível e convite funcionando |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Semântica de `org_admin` | Passa a valer em todo workspace da organização, sem exigir linha em `workspace_members` | Decidido na discussão. É o que o nome já promete; hoje a API mente |  y |
| Semântica de `reviewer` | Ganha `comment:resolve`, que `viewer` deixa de ter | É a única distinção com significado real entre os dois: revisar é fechar discussão, ver não |  y |
| Onde a resolução de papel acontece | Uma única função de resolução no servidor, consumida por todas as rotas que hoje chamam `requireMembership` | Duas formas de resolver papel é como `org_admin` acabou sem efeito |  y |
| Guarda de último admin | No servidor, retornando `409` com motivo, e mantida também no cliente como aviso antecipado | A guarda do servidor é a autoridade; a do cliente evita que a pessoa descubra só ao clicar |  y |
| Quem conta como admin para a guarda | `workspace_admin` com associação no workspace, mais `org_admin` da organização dona | Se um `org_admin` da organização existe, o workspace nunca fica órfão |  y |
| Onde o papel aparece | Nas superfícies de workspace (lista, projetos, membros), junto ao nome do workspace | É onde o papel muda o que se pode fazer; repetir em toda tela vira ruído |  y |
| Migração de dados | Nenhuma: nenhum valor de papel muda, apenas os grants associados a eles | Evita migração destrutiva de enum, que era o custo da alternativa de reduzir para três papéis |  y |
| Auditoria | Toda mudança de papel e remoção de membro registra evento de auditoria | O módulo de auditoria já existe e já é usado por `workspace.created` |  y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Os papéis significam coisas diferentes ⭐ MVP

**User Story**: Como responsável por uma organização, quero que `org_admin` valha em todos os
workspaces dela e que `reviewer` possa fechar discussões que `viewer` não pode, para que os papéis
que a API oferece correspondam ao que fazem.

**Why P1**: Enquanto os grants forem idênticos, o RBAC anunciado é decorativo.

**Acceptance Criteria**:

1. WHERE o ator tem papel `org_admin` na organização dona do workspace, o sistema SHALL conceder as ações desse papel mesmo sem associação em `workspace_members`
2. WHEN um ator com papel `reviewer` solicita `comment:resolve` THEN o sistema SHALL permitir a ação
3. WHEN um ator com papel `viewer` solicita `comment:resolve` THEN o sistema SHALL recusar a ação
4. The papel `viewer` SHALL manter `comment:create`
5. The resolução do papel efetivo de um ator sobre um workspace SHALL acontecer em exatamente uma função no servidor
6. WHEN um ator sem associação e sem papel de organização acessa um workspace THEN o sistema SHALL responder `404`
7. The matriz de teste de RBAC SHALL cobrir os cinco papéis contra todas as ações, incluindo o caso de `org_admin` sem associação no workspace

**Independent Test**: um `org_admin` sem linha em `workspace_members` lê e escreve num workspace da
sua organização; um `reviewer` resolve um comentário que um `viewer` não consegue resolver.

---

### P1: Um workspace nunca fica sem administrador ⭐ MVP

**User Story**: Como responsável por um workspace, quero que o servidor recuse a remoção ou o
rebaixamento do último administrador, para não perder o controle do workspace por um clique.

**Why P1**: É uma perda de acesso irreversível pela API pública.

**Acceptance Criteria**:

1. IF a remoção de um membro deixaria o workspace sem nenhum administrador THEN o sistema SHALL responder `409` nomeando o motivo e SHALL não remover o membro
2. IF a mudança de papel de um membro deixaria o workspace sem nenhum administrador THEN o sistema SHALL responder `409` nomeando o motivo e SHALL não alterar o papel
3. WHERE existe ao menos um `org_admin` na organização dona, o sistema SHALL permitir a remoção do último `workspace_admin`
4. WHEN uma mudança de papel ou remoção de membro é concluída THEN o sistema SHALL registrar um evento de auditoria com ator, alvo e papel anterior
5. IF duas remoções concorrentes deixariam o workspace sem administrador THEN o sistema SHALL concluir no máximo uma

**Independent Test**: tentar remover o único administrador e receber `409` com o workspace intacto.

---

### P2: A pessoa vê o próprio papel

**User Story**: Como pessoa usando um workspace, quero ver qual é o meu papel, para entender por que
uma ação está indisponível.

**Why P2**: Não muda autorização; muda a diferença entre "não posso" e "está quebrado".

**Acceptance Criteria**:

1. WHEN uma superfície de workspace é renderizada THEN o sistema SHALL apresentar o papel efetivo da pessoa naquele workspace
2. WHILE uma ação está indisponível por falta de permissão o sistema SHALL apresentar o motivo junto do controle desabilitado
3. The rótulo de cada papel SHALL vir do i18n em `en` e `pt-BR`
4. WHEN o papel da pessoa muda e a superfície é recarregada THEN o sistema SHALL apresentar o papel novo

**Independent Test**: entrar como `viewer` e ver o papel exibido e o motivo em um controle desabilitado.

---

### P2: O convite volta a funcionar

**User Story**: Como administrador de workspace, quero adicionar alguém pelo e-mail e definir seu
papel, para que a gestão de acesso exista na prática.

**Why P2**: Depende de R18 estar pronto; o mecanismo em si já existe.

**Acceptance Criteria**:

1. WHEN um administrador informa o e-mail de uma conta existente THEN o sistema SHALL resolver a conta e adicioná-la ao workspace com o papel escolhido
2. IF o e-mail informado não corresponde a nenhuma conta THEN o sistema SHALL apresentar mensagem dizendo que a conta precisa existir, sem revelar outros dados
3. IF a pessoa já é membro do workspace THEN o sistema SHALL responder `409` e apresentar mensagem específica
4. WHEN um ator sem `workspace:manage_members` tenta adicionar um membro THEN o sistema SHALL responder `403`

**Independent Test**: adicionar um segundo usuário a um workspace pela interface e vê-lo na lista com
o papel escolhido.

---

## Edge Cases

- WHEN um ator tem papel de organização e associação de workspace com papéis diferentes THEN o sistema SHALL aplicar o mais permissivo dos dois
- IF a organização dona de um workspace não puder ser resolvida THEN o sistema SHALL recusar a ação, nunca conceder por omissão
- WHEN o último administrador tenta rebaixar a si mesmo e é o único da organização THEN o sistema SHALL responder `409`
- WHEN um membro é removido enquanto tem uma sessão ativa THEN o sistema SHALL recusar sua próxima requisição ao workspace com `404`
- IF o e-mail do convite diferir apenas por maiúsculas de uma conta existente THEN o sistema SHALL resolvê-la mesmo assim

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| RBAC-01 | P1: Os papéis significam coisas diferentes | Design | Pending |
| RBAC-02 | P1: Os papéis significam coisas diferentes | Design | Pending |
| RBAC-03 | P1: Os papéis significam coisas diferentes | Design | Pending |
| RBAC-04 | P1: Os papéis significam coisas diferentes | Design | Pending |
| RBAC-05 | P1: Os papéis significam coisas diferentes | Design | Pending |
| RBAC-06 | P1: Os papéis significam coisas diferentes | Design | Pending |
| RBAC-07 | P1: Os papéis significam coisas diferentes | Design | Pending |
| RBAC-08 | P1: Um workspace nunca fica sem administrador | Design | Pending |
| RBAC-09 | P1: Um workspace nunca fica sem administrador | Design | Pending |
| RBAC-10 | P1: Um workspace nunca fica sem administrador | Design | Pending |
| RBAC-11 | P1: Um workspace nunca fica sem administrador | Design | Pending |
| RBAC-12 | P1: Um workspace nunca fica sem administrador | Design | Pending |
| RBAC-13 | P2: A pessoa vê o próprio papel | Design | Pending |
| RBAC-14 | P2: A pessoa vê o próprio papel | Design | Pending |
| RBAC-15 | P2: A pessoa vê o próprio papel | Design | Pending |
| RBAC-16 | P2: A pessoa vê o próprio papel | Design | Pending |
| RBAC-17 | P2: O convite volta a funcionar | Design | Pending |
| RBAC-18 | P2: O convite volta a funcionar | Design | Pending |
| RBAC-19 | P2: O convite volta a funcionar | Design | Pending |
| RBAC-20 | P2: O convite volta a funcionar | Design | Pending |

**Coverage:** 20 total, 20 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] Um `org_admin` sem associação opera em todo workspace da sua organização
- [ ] `reviewer` e `viewer` deixam de ter conjuntos idênticos de permissão
- [ ] Nenhuma sequência de chamadas da API deixa um workspace sem administrador
- [ ] Convidar alguém para um workspace funciona ponta a ponta pela interface
