# Membros e papéis do workspace — Especificação

Quarta fatia vertical do roadmap de produto (entrada R4 de
`.specs/features/platform-maturity/ui-roadmap.md`). Tela de membros do workspace: convidar por
e-mail, trocar papel, remover — a entrada que destrava comentário (R9), presença (R10),
compartilhamento (R11) e webhooks (R16), todos com regra de papel.

## Problem Statement

O backend de membros está implementado e verificado (`workspace.int.spec.ts`'s "member management
permissions", `rbac-matrix.int.spec.ts`'s matriz de papel × ação). Nada disso tem interface.

Uma lacuna real, descoberta na pesquisa desta spec, molda o desenho: `POST
/workspaces/:id/members` exige o `userId` exato (UUID) de quem já tem conta — não existe hoje
nenhuma rota de busca por e-mail. Decidido com o usuário antes do Specify: esta spec adiciona uma
rota pequena e aditiva, `GET /users:lookup?email=`, só para resolver e-mail → identidade antes de
adicionar.

Duas lacunas do servidor, sem decisão de mudança (documentadas, não resolvidas nesta fatia):
`PATCH`/`DELETE` de membro não têm proteção nenhuma contra o último admin trocar o próprio papel
para algo menor ou remover a si mesmo, deixando o workspace sem nenhum `org_admin`/`workspace_admin`.
Não existe guarda nenhuma no servidor para isso. Esta spec adiciona uma proteção só no cliente
(avisa e bloqueia o caso óbvio), documentada como defesa de UX, nunca como garantia — o servidor
continua sendo a autoridade final e pode, por outro caminho, chegar ao mesmo estado.

## Goals

- [ ] Um admin do workspace vê todos os membros e seus papéis.
- [ ] Um admin adiciona alguém digitando o e-mail, sem precisar saber um UUID.
- [ ] Um admin troca o papel de um membro, e o efeito é imediato (a próxima ação do membro já
      reflete o novo papel).
- [ ] Um admin remove um membro, com proteção client-side contra deixar o workspace sem nenhum
      admin.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Convite por e-mail com aceitação assíncrona (link, notificação) | O backend adiciona a membership imediatamente, sem estado pendente — implementar aceitação exigiria mudança de modelo de dados, fora do orçamento desta fatia |
| Criar conta para quem não tem uma | `GET /users:lookup` só resolve contas que já existem; sem conta, sem adicionar — criação de conta continua fora do produto (mesma decisão já registrada em `sso-sign-in`) |
| Proteção server-side contra zero admins | Decidido nesta spec como defesa só de cliente — mudar o servidor é uma decisão de autorização maior, fora desta fatia |
| Papéis customizados, hierarquia de papéis além dos 5 existentes | O enum é fixo no backend (`org_admin`/`workspace_admin`/`editor`/`reviewer`/`viewer`) — esta spec só expõe os 5 que já existem |
| Histórico/auditoria de mudança de papel na UI | O servidor já grava (`recordAuditEvent`), mas nenhuma tela desta fatia expõe esse histórico |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Como resolver e-mail → identidade pra convidar? | Nova rota `GET /users:lookup?email=` — `200 {user: {id, email, displayName}}` se existir conta com esse e-mail, `404` se não | Decidido com o usuário: pequena, aditiva, mesmo padrão de `GET /auth/oidc/status` (sso-sign-in) e `mutatePermissions` (ai-dock) | y |
| A busca por e-mail exige alguma permissão além de sessão válida? | Não — qualquer usuário autenticado pode resolver um e-mail (a decisão de ADICIONAR à membership continua gated por `workspace:manage_members`, aí sim só admin) | A busca em si não revela nada sensível além de "essa conta existe" — e isso já é observável indiretamente por qualquer fluxo de login que distingue e-mail cadastrado (mesmo assim, ver Edge Cases pro cuidado de não amplificar isso) | y |
| Onde a tela vive? | `/w/:workspaceId/members`, rota irmã de `/w/:workspaceId` (projetos) e `/w/:workspaceId/p/:projectId` (diagramas), dentro do mesmo `AppShell` | Segue a convenção de rota já estabelecida em `workspace-navigation`; um link "Membros" aparece em `ProjectListPage` ao lado do botão de arquivar workspace já existente | y |
| Reusar `resourceClient`/`resourceListStore` genéricos de `workspace-navigation`? | Não — cliente dedicado (`memberClient.ts`) | Pesquisa confirmou que `create`/`rename` do genérico assumem corpo de string única e resposta com item embrulhado numa chave — nem convite (`{userId, role}`, dois campos) nem troca de papel (`PATCH` devolve `{ok:true}`, sem item) encaixam sem gambiarra. Só a forma de lista (`{items:[...]}`) e `archive`-como-`remove` (`DELETE` → `204`) são copiadas; `resourceListStore` é reusado com um shim `id = userId` no limite da busca | y |
| Reusar `ConfirmArchiveDialog` pra confirmar remoção? | Sim, tal como está — é genérico em `itemName`/`onConfirm`/`onCancel`, sem lógica específica de recurso | Reuso real, nenhuma mudança necessária no componente | y |
| Proteção client-side contra zero admins — o que exatamente bloqueia? | Dois casos: (1) remover a si mesmo quando é o único `org_admin`/`workspace_admin` do workspace; (2) trocar o próprio papel pra algo abaixo de admin quando é o único admin. Ambos SHALL ser bloqueados na tela, com mensagem explicando por quê | Proteção só de UX (não autoritativa) que cobre o caso óbvio e mais perigoso (a pessoa se auto-trancando sem querer); um segundo admin removendo o primeiro continua permitido pelo servidor e não é bloqueado aqui — bloquear isso exigiria saber a intenção alheia, que não é o problema que esta proteção resolve | y |
| Papel padrão sugerido ao convidar | Nenhum pré-selecionado — a pessoa escolhe entre os 5 papéis explicitamente | Evita adicionar alguém com mais acesso do que pretendido por padrão descuidado | y |
| Trocar o papel de alguém que não é você exige confirmação? | Não — troca de papel é imediata, sem diálogo de confirmação (diferente de remover) | É reversível (trocar de novo desfaz) e não perde dado nenhum, ao contrário de arquivar; o padrão de confirmação desta frente é reservado pra ações sem volta | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Ver os membros do workspace

**User Story**: Como pessoa de qualquer papel no workspace, quero ver quem são os membros e seus
papéis, para entender quem pode fazer o quê.

**Why P1**: É a base de tudo o mais nesta spec — sem lista, não há convite/troca/remoção pra fazer.

**Acceptance Criteria**:
1. WHEN o usuário acessar `/w/:workspaceId/members` THEN a tela SHALL listar os membros devolvidos por `GET /workspaces/:id/members`, cada um com e-mail, nome de exibição e papel.
2. The link para a tela de membros SHALL aparecer em `ProjectListPage` pra qualquer papel (leitura é concedida a todos os 5 papéis).
3. IF `GET /workspaces/:id/members` responder `404` THEN a tela SHALL tratar como "não existe ou sem acesso", mesma convenção IDOR já usada em `workspace-navigation`.

**Independent Test**: Como papel `viewer`, acessar a tela de membros e confirmar que a lista aparece, mas nenhuma ação de convidar/trocar/remover está visível (ver histórias seguintes).

---

### P1: Convidar um membro por e-mail

**User Story**: Como admin do workspace, quero adicionar alguém digitando o e-mail, para não
precisar descobrir um UUID.

**Why P1**: É o único jeito de povoar um workspace além do criador original.

**Acceptance Criteria**:
1. The ação de convidar SHALL aparecer somente quando o papel efetivo do usuário conceder `workspace:manage_members`.
2. WHEN o usuário digitar um e-mail não vazio e um papel, e confirmar THEN a tela SHALL emitir `GET /users:lookup?email=` primeiro.
3. IF a busca responder `404` THEN a tela SHALL informar que nenhuma conta foi encontrada com esse e-mail, sem emitir `POST /workspaces/:id/members`.
4. IF a busca responder `200` THEN a tela SHALL emitir `POST /workspaces/:id/members` com `{userId: <id resolvido>, role: <papel escolhido>}`.
5. IF `POST /workspaces/:id/members` responder `409` (já é membro) THEN a tela SHALL informar o conflito, sem adicionar duplicata na lista.
6. WHEN `POST /workspaces/:id/members` responder `201` THEN a tela SHALL adicionar o novo membro à lista sem recarregar a página.

**Independent Test**: Convidar um e-mail sem conta associada, confirmar que a mensagem de "nenhuma conta encontrada" aparece e que nenhuma requisição de adicionar é emitida.

---

### P1: Trocar o papel de um membro

**User Story**: Como admin do workspace, quero trocar o papel de alguém, para ajustar o acesso sem
remover e readicionar.

**Why P1**: É o ajuste mais comum depois de adicionar alguém com o papel errado.

**Acceptance Criteria**:
1. The ação de trocar papel SHALL aparecer por membro somente quando o papel efetivo do usuário concede `workspace:manage_members`.
2. WHEN o usuário escolher um novo papel para outro membro THEN a tela SHALL emitir `PATCH /workspaces/:id/members/:userId` com `{role}` e refletir o novo papel assim que a resposta for `200`, nunca antes.
3. IF a troca for na própria linha do usuário logado E ele for o único `org_admin`/`workspace_admin` do workspace E o novo papel não for admin THEN a tela SHALL bloquear a troca antes de emitir a requisição, explicando que deixaria o workspace sem admin.
4. IF `PATCH` responder `403` ou `404` THEN a tela SHALL informar a falha e manter o papel anterior.

**Independent Test**: Como o único `workspace_admin`, tentar trocar o próprio papel para `viewer`, confirmar que a tela bloqueia antes de qualquer requisição.

---

### P1: Remover um membro

**User Story**: Como admin do workspace, quero remover alguém que não deveria mais ter acesso.

**Why P1**: É o fechamento do ciclo de gestão de acesso.

**Acceptance Criteria**:
1. The ação de remover SHALL aparecer por membro somente quando o papel efetivo do usuário concede `workspace:manage_members`.
2. WHEN o usuário acionar remover THEN a tela SHALL exigir confirmação via `ConfirmArchiveDialog` (reusado), citando o nome do membro.
3. IF o membro a remover for o próprio usuário logado E ele for o único `org_admin`/`workspace_admin` do workspace THEN a tela SHALL bloquear a remoção antes de abrir a confirmação, explicando que deixaria o workspace sem admin.
4. WHEN o usuário confirmar THEN a tela SHALL emitir `DELETE /workspaces/:id/members/:userId` e, após `204`, remover o membro da lista sem recarregar a página.
5. IF `DELETE` responder `403` ou `404` THEN a tela SHALL informar a falha e manter o membro na lista.

**Independent Test**: Como um segundo admin (não o único), remover o primeiro admin com sucesso — confirma que a proteção de "único admin" é escopada à própria linha do usuário logado, não a qualquer remoção de admin.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero gerenciar membros sem mouse.

**Why P2**: Mesmo padrão já estabelecido pelas três fatias anteriores desta frente.

**Acceptance Criteria**:
1. The toda ação desta spec (ver, convidar, trocar papel, remover, confirmar) SHALL ser alcançável só por teclado.
2. WHEN convidar, trocar papel ou remover completar (sucesso ou falha) THEN a tela SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível SHALL vir de chaves de i18n, nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Convidar, trocar o papel do convidado e removê-lo, usando só Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF a busca por e-mail (`GET /users:lookup`) for chamada repetidamente em sequência rápida (usuário digitando) THEN a tela SHALL só emitir a busca no submit do formulário, nunca a cada tecla — evita amplificar a checagem de existência de conta em um oráculo de digitação.
- IF o e-mail buscado já for de um membro atual do workspace THEN a tela SHALL informar isso antes mesmo de tentar `POST` (mensagem diferente de "não encontrado"), evitando um 409 desnecessário quando dá pra saber antes (a lista de membros já carregada na tela permite essa checagem client-side).
- IF o papel do usuário logado for revogado enquanto a tela de membros está aberta THEN uma ação subsequente que falhe com `403` SHALL ser tratada como qualquer outra falha, sem quebrar a tela.
- WHILE uma busca de e-mail ou uma adição estiver em andamento, um segundo submit do formulário de convite SHALL não emitir uma segunda requisição.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MEM-01 | P1: Ver membros | F10 | ✅ Verified |
| MEM-02 | P1: Ver membros | F10 | ✅ Verified |
| MEM-03 | P1: Ver membros | F10 | ✅ Verified |
| MEM-04 | P1: Convidar | F10 | ✅ Verified |
| MEM-05 | P1: Convidar | F10 | ✅ Verified |
| MEM-06 | P1: Convidar | F10 | ✅ Verified |
| MEM-07 | P1: Convidar | F10 | ✅ Verified |
| MEM-08 | P1: Convidar | F10 | ✅ Verified |
| MEM-09 | P1: Convidar | F10 | ✅ Verified |
| MEM-10 | P1: Trocar papel | F10 | ✅ Verified |
| MEM-11 | P1: Trocar papel | F10 | ✅ Verified |
| MEM-12 | P1: Trocar papel | F10 | ✅ Verified |
| MEM-13 | P1: Trocar papel | F10 | ✅ Verified |
| MEM-14 | P1: Remover | F10 | ✅ Verified |
| MEM-15 | P1: Remover | F10 | ✅ Verified |
| MEM-16 | P1: Remover | F10 | ✅ Verified |
| MEM-17 | P1: Remover | F10 | ✅ Verified |
| MEM-18 | P1: Remover | F10 | ✅ Verified |
| MEM-19 | P2: Teclado e idioma | F10 | ✅ Verified |
| MEM-20 | P2: Teclado e idioma | F10 | ✅ Verified |
| MEM-21 | P2: Teclado e idioma | F10 | ✅ Verified |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `MEM` não colide com nenhum já usado: A11Y, AAC, AIC, AIE, AIG, API, AUTH, CIQ, CLB, CMT,
DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, NAV, OBS, OIDC, OPS, PERF, PRS, REC, SEC,
SSO, TRU, UIX, VER.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 21 requisitos, mapeados 1:1 às 21 acceptance criteria das cinco histórias.

**Numeração por história:** MEM-01..03 (ver), MEM-04..09 (convidar), MEM-10..13 (trocar papel),
MEM-14..18 (remover), MEM-19..21 (teclado e idioma).

---

## Rotas consumidas

| Rota | Uso | Mudança nesta spec |
| --- | --- | --- |
| `GET /workspaces/:id/members` | lista de membros | Nenhuma |
| `POST /workspaces/:id/members` | adicionar membro | Nenhuma |
| `PATCH /workspaces/:id/members/:userId` | trocar papel | Nenhuma |
| `DELETE /workspaces/:id/members/:userId` | remover membro | Nenhuma |
| `GET /users:lookup?email=` | resolver e-mail → identidade | **Rota nova**, aditiva |

O roadmap original listava 4 rotas para R4; a rota de busca por e-mail é a quinta, decidida com o
usuário durante esta rodada de Specify — a entrada do roadmap será atualizada quando esta spec
fechar.

---

## Success Criteria

- [ ] Um admin adiciona alguém ao workspace só sabendo o e-mail, nunca um UUID.
- [ ] Uma troca de papel tem efeito imediato, provado pela próxima ação do membro afetado (não
      só pela tela mostrando o novo valor).
- [ ] Ninguém consegue, pela interface, se remover ou se rebaixar quando é o único admin do
      workspace — provado por teste que falha se a proteção for removida.
- [ ] `repo-tools audit` deixa de classificar as 4 rotas originais como `pending-product`, e
      `GET /users:lookup` aparece como rota nova, já consumida.
- [ ] O fluxo inteiro é percorrível só com teclado, nos dois locales.
