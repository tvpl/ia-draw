# Navegação de workspace, projetos e diagramas — Especificação

Terceira fatia vertical do roadmap de produto (entrada R3 de
`.specs/features/platform-maturity/ui-roadmap.md`). Preenche o `AppShell`, que hoje é um `<main />`
vazio com o comentário `"nav/search/admin land here in F1+"`, com a navegação real: workspaces,
projetos, diagramas, criar/renomear/arquivar em cada nível, e o editor alcançável clicando, não por
URL decorada.

## Problem Statement

O backend de workspace/projeto/diagrama está implementado e verificado (`workspace.int.spec.ts`,
`project-diagram.int.spec.ts`, `rbac-matrix.int.spec.ts` — matriz completa de 5 papéis × 11
operações, mais o teste de IDOR "non-member gets 404, never 403"). Nada disso tem interface: o
único lugar em `apps/web` que existe hoje é `/w/:workspaceId/d/:diagramId`, e `workspaceId` nem é
lido pelo componente — a URL é decorativa. `AppShell` é literalmente `<header>` + `<main />`.

Duas lacunas reais, descobertas na pesquisa desta spec, moldam o desenho:

1. **Não existe rota de auto-serviço para entrar num workspace existente.** Um usuário local novo
   começa com zero workspaces; a única forma dele mesmo sair desse estado é `POST /workspaces`
   (que o torna automaticamente `workspace_admin` do que acabou de criar). Não há convite/join —
   isso é escopo de R4. Um usuário com zero workspaces é um estado real e alcançável, não um caso
   de borda raro.
2. **Arquivar workspace/projeto é irreversível pela API.** Só existe `DELETE` (soft-delete via
   `deletedAt`), sem rota de restore. Diagrama tem `status: 'archived'` como alternativa
   reversível, mas essa spec usa `DELETE` para os três níveis por decisão do usuário (ver
   Assumptions) — a UI nomeia a ação "Arquivar" e avisa que não há desfazer, em vez de fingir uma
   reversão que a API não oferece.

## Goals

- [ ] Uma pessoa autenticada vê a lista dos seus workspaces, entra em um, vê os projetos, entra em
      um, vê os diagramas, e abre o editor — tudo por clique, nunca por URL montada à mão.
- [ ] Uma pessoa cria workspace, projeto e diagrama sem sair da navegação.
- [ ] Uma pessoa renomeia qualquer um dos três níveis onde tem permissão de escrita, e nunca vê a
      ação onde não tem.
- [ ] Uma pessoa arquiva com um aviso claro de irreversibilidade, e o item some da lista
      imediatamente.
- [ ] Uma pessoa com zero workspaces (primeiro acesso) tem um caminho claro pra criar o primeiro.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| ------- | ------ |
| Busca | Cortada deliberadamente no roadmap (`ui-roadmap.md`'s "Corte deliberado") |
| Administração (config de provider de IA, webhooks) | R15/R16 |
| Membros do workspace, convite, papéis | R4 — depende desta spec existir primeiro |
| Restaurar workspace/projeto/diagrama arquivado | Não existe rota — arquivar é irreversível pela API nesta onda, documentado como tal na UI |
| Mudar a URL/rota do editor de diagrama (`/w/:workspaceId/d/:diagramId`) | Já existe e funciona; esta spec só a torna alcançável por clique, não muda seu formato |
| Paginação de listas | Nenhuma das rotas (`GET /workspaces`\|`/projects`\|`/diagrams`) pagina hoje — todas devolvem `{ items: [...] }` completo; adicionar paginação seria mudar contrato de servidor fora do escopo desta fatia de frontend |
| Descrição/classificação de projeto, status de diagrama (draft/in_review/approved) | Campos que os schemas aceitam mas que esta fatia não expõe na UI — só nome/título e arquivar; são campos de detalhe, não de navegação |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| O que "arquivar" significa nos três níveis? | `DELETE` (soft-delete via `deletedAt`) para workspace, projeto e diagrama — todos os três, sempre — rotulado "Arquivar" na UI com aviso de que não há desfazer pela interface hoje | Decidido com o usuário: uma semântica só para os três níveis, nomeada do jeito que o roadmap já descreve, sem fingir reversão que a API não tem | y |
| Estrutura de rotas | `/` → lista de workspaces; `/w/:workspaceId` → lista de projetos do workspace; `/w/:workspaceId/p/:projectId` → lista de diagramas do projeto; `/w/:workspaceId/d/:diagramId` → editor (inalterada). `AppShell` vira layout com `<Outlet/>` — primeira rota aninhada do app | Espelha a hierarquia real do backend (workspace → projeto → diagrama, sem atalho) e reusa a URL do editor que já existe | y |
| Usuário com zero workspaces | `/` mostra um estado vazio com CTA "criar workspace", não uma lista vazia sem saída | É o único caminho de auto-serviço que existe hoje (`POST /workspaces`); sem isso a pessoa fica numa tela em branco | y |
| Criar workspace exige algum papel? | Não — qualquer usuário autenticado pode, e vira `workspace_admin` do que criou (comportamento do servidor, `createWorkspace`) | Server-side já garante isso; a UI só expõe o botão sempre, sem checagem de papel prévia | y |
| Criar projeto/diagrama exige papel? | Sim — `project:write`/`diagram:write`, concedido a `org_admin`/`workspace_admin`/`editor`, negado a `reviewer`/`viewer`. A UI decide o que mostrar a partir do papel efetivo devolvido pelo servidor no item da lista (`workspace.role`, presente em `GET /workspaces`'s items — a confirmar contra o schema real na Design) | `reviewer`/`viewer` recebem `403` hoje ao tentar escrever; oferecer um botão que sempre falha é o mesmo erro de UX que `sso-sign-in` já evitou para o dock de SSO | y |
| Onde mora o papel do usuário em cada workspace, pro frontend decidir o que mostrar? | A confirmar na Design — se `GET /workspaces`'s `items[].role` já existe no schema, reusa; se não existe, é a única extensão de contrato de servidor que esta spec pode precisar (aditiva, mesmo padrão de `mutatePermissions` do ai-dock) | Sem essa informação a UI não consegue decidir proativamente show/hide de criar/renomear/arquivar sem tentar e falhar — mesmo argumento já usado duas vezes nesta frente | y |
| Renomear é inline ou modal? | Inline (campo de texto que vira editável no próprio item da lista/cabeçalho), sem modal | Menos uma superfície nova por nível; o padrão nativo-antes-de-widget-customizado já é a convenção do projeto | y |
| Confirmação antes de arquivar | Sim — um passo de confirmação explícito (não um `window.confirm` nativo, que não é testável/acessível do mesmo jeito; um diálogo simples do próprio app), citando o nome do item e avisando que não há desfazer | Ação destrutiva e irreversível pela API — pedir confirmação é o mínimo, consistente com a política geral de ações irreversíveis | y |
| Lista de diagramas mostra algo do `status` (draft/in_review/approved/archived)? | Não nesta fatia — só título. Status é Out of Scope | Manter a lista simples; status vira detalhe de uma fatia futura se for pedido | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Ver e navegar pelos meus workspaces, projetos e diagramas

**User Story**: Como pessoa autenticada, quero ver meus workspaces e entrar neles até achar o
diagrama que preciso, para nunca depender de decorar ou receber uma URL.

**Why P1**: É a entrada do fluxo — sem navegação, o produto só é alcançável por quem já tem uma URL
de diagrama específica.

**Acceptance Criteria**:
1. WHEN o usuário autenticado acessar `/` THEN a tela SHALL listar os workspaces devolvidos por `GET /workspaces`, cada um como um link para `/w/:workspaceId`.
2. WHEN o usuário acessar `/w/:workspaceId` THEN a tela SHALL listar os projetos devolvidos por `GET /projects?workspaceId=:workspaceId`, cada um como um link para `/w/:workspaceId/p/:projectId`, e SHALL exibir o nome do workspace corrente.
3. WHEN o usuário acessar `/w/:workspaceId/p/:projectId` THEN a tela SHALL listar os diagramas devolvidos por `GET /diagrams?projectId=:projectId`, cada um como um link para `/w/:workspaceId/d/:diagramId`, e SHALL exibir o nome do projeto corrente.
4. IF a resposta de `GET /workspaces/:id`, `GET /projects/:id` ou `GET /diagrams/:id` (usadas para resolver o nome do nível corrente) vier `404` THEN a tela SHALL exibir que o item não existe ou não é acessível, sem vazar se ele existe para outra conta.
5. The navegação SHALL oferecer, em toda tela abaixo de `/`, um caminho de volta ao nível anterior (workspace → lista de workspaces; projeto → lista de projetos do workspace).

**Independent Test**: Com um usuário membro de 2 workspaces, cada um com 1 projeto e 1 diagrama, navegar de `/` até o editor clicando em cada nível, e confirmar que a URL final é `/w/<id-real>/d/<id-real>`.

---

### P1: Criar workspace, projeto e diagrama

**User Story**: Como pessoa autenticada, quero criar um novo workspace, projeto ou diagrama a
partir da navegação, para não precisar montar a requisição na mão.

**Why P1**: É o único jeito de sair do estado "zero workspaces" e de povoar a hierarquia.

**Acceptance Criteria**:
1. The tela de lista de workspaces SHALL sempre oferecer a ação de criar workspace, para qualquer usuário autenticado.
2. WHEN o usuário criar um workspace com nome não vazio THEN a tela SHALL emitir `POST /workspaces` com `{name, slug}` — o `slug` gerado a partir do nome (normalizado, sem espaço) — e navegar para `/w/:workspaceId` do workspace recém-criado após `201`.
3. IF `POST /workspaces` responder `409` (slug duplicado) THEN a tela SHALL informar o conflito e permitir tentar de novo, sem perder o nome digitado.
4. The tela de lista de projetos SHALL oferecer a ação de criar projeto somente quando o papel efetivo do usuário no workspace conceder `project:write`.
5. WHEN o usuário criar um projeto com nome não vazio THEN a tela SHALL emitir `POST /projects` com `{workspaceId, name}` e, após `201`, exibir o projeto na lista sem recarregar a página.
6. The tela de lista de diagramas SHALL oferecer a ação de criar diagrama somente quando o papel efetivo do usuário no workspace conceder `diagram:write`.
7. WHEN o usuário criar um diagrama com título não vazio THEN a tela SHALL emitir `POST /diagrams` com `{projectId, title}` e, após `201`, navegar direto para o editor do diagrama recém-criado.

**Independent Test**: Como papel `viewer` num workspace, confirmar que a ação de criar projeto não aparece na tela de projetos desse workspace; como `editor`, confirmar que aparece e funciona.

---

### P1: Renomear workspace, projeto e diagrama

**User Story**: Como pessoa com permissão de escrita, quero renomear um item onde estou, sem sair
da navegação.

**Why P1**: Nome errado ou desatualizado é o ajuste mais comum depois de criar.

**Acceptance Criteria**:
1. The ação de renomear SHALL aparecer em cada nível (workspace, projeto, diagrama) somente quando o papel efetivo conceder a permissão de escrita correspondente (`workspace:write`, `project:write`, `diagram:write`).
2. WHEN o usuário confirmar um novo nome/título não vazio THEN a tela SHALL emitir o `PATCH` correspondente (`{name}` para workspace/projeto, `{title}` para diagrama) e refletir o novo valor assim que a resposta for `200`, nunca antes.
3. IF o `PATCH` de workspace responder `409` (slug duplicado, quando o nome também afeta o slug) THEN a tela SHALL informar o conflito e manter o valor anterior visível até nova tentativa.
4. IF qualquer `PATCH` responder `403` ou `404` THEN a tela SHALL informar a falha e manter o valor anterior, nunca mostrar o nome novo como se tivesse salvo.

**Independent Test**: Renomear um projeto, confirmar que a lista mostra o nome antigo até a resposta `200` chegar, e o novo nome depois.

---

### P1: Arquivar workspace, projeto e diagrama

**User Story**: Como pessoa com permissão de escrita, quero arquivar um item que não uso mais, e
entender claramente que não há desfazer.

**Why P1**: É o único jeito de limpar a lista — sem ele, tudo que é criado fica pra sempre.

**Acceptance Criteria**:
1. The ação de arquivar SHALL aparecer somente onde o papel efetivo concede a permissão de escrita do nível.
2. WHEN o usuário acionar arquivar THEN a tela SHALL exigir um passo de confirmação explícito, citando o nome do item e informando que a ação não pode ser desfeita pela interface.
3. WHEN o usuário confirmar THEN a tela SHALL emitir o `DELETE` correspondente e, após `204`, remover o item da lista sem recarregar a página.
4. IF o `DELETE` responder `403` ou `404` THEN a tela SHALL informar a falha e manter o item na lista.
5. WHERE o item arquivado é o workspace ou projeto que o usuário está vendo no momento THEN, após o `204`, a navegação SHALL subir um nível (projeto arquivado → volta pra lista de projetos do workspace; workspace arquivado, se possível de arquivar estando dentro dele → volta pra lista de workspaces).

**Independent Test**: Arquivar um diagrama a partir da lista, confirmar que ele some da lista imediatamente e que `GET /diagrams?projectId=...` (nova chamada) não o traz mais.

---

### P1: Primeiro acesso sem nenhum workspace

**User Story**: Como pessoa que acabou de entrar pela primeira vez, quero um caminho claro pra criar
meu primeiro workspace, para não ficar numa tela vazia sem saída.

**Why P1**: É um estado real e alcançável (nenhuma autoprovisão de workspace existe hoje), não um
caso de borda.

**Acceptance Criteria**:
1. IF `GET /workspaces` devolver `{items: []}` THEN a tela SHALL exibir um estado vazio dedicado, com a ação de criar o primeiro workspace em destaque — não a mesma lista vazia genérica que uma busca sem resultado mostraria.
2. WHEN o usuário criar o primeiro workspace a partir desse estado THEN o fluxo SHALL ser idêntico ao de criar um workspace adicional (mesma rota, mesmo resultado) — nenhum comportamento especial de "onboarding" na chamada em si.

**Independent Test**: Autenticar como um usuário local recém-criado sem nenhuma membership, acessar `/`, confirmar o estado vazio dedicado, criar um workspace, confirmar a navegação para `/w/:workspaceId` do que acabou de ser criado.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero navegar, criar, renomear e
arquivar sem mouse.

**Why P2**: Mesmo padrão já estabelecido por `ai-dock` e `sso-sign-in` nesta frente.

**Acceptance Criteria**:
1. The toda ação desta spec (navegar, criar, renomear, arquivar, confirmar) SHALL ser alcançável só por teclado.
2. WHEN uma criação, renomeação ou arquivamento completar (sucesso ou falha) THEN a tela SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível SHALL vir de chaves de i18n, nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Criar um projeto, renomeá-lo e arquivá-lo usando só Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF o usuário acessar diretamente `/w/:workspaceId` (ou `/p/:projectId`) de um workspace/projeto que não é membro THEN a tela SHALL tratar a resposta `404` da rota de detalhe como "não existe ou você não tem acesso", nunca revelando a distinção (mesma convenção AUTH-04/IDOR do servidor).
- IF o papel do usuário for revogado enquanto ele está numa tela com uma ação de escrita visível (ex. aba ficou aberta) THEN uma tentativa de `PATCH`/`DELETE`/`POST` que agora falha com `403` SHALL informar a falha sem quebrar a tela — a revalidação proativa do papel a cada navegação (não em tempo real dentro da mesma tela) já cobre o caso comum.
- IF `POST /projects` ou `POST /diagrams` for enviado com nome/título vazio ou só espaço THEN a tela SHALL não emitir requisição nenhuma.
- WHEN a lista de diagramas de um projeto estiver vazia (projeto novo, sem diagramas) THEN a tela SHALL exibir um estado vazio simples com a ação de criar, não um erro.
- IF o usuário arquivar o único workspace que tem THEN a navegação SHALL voltar ao estado de zero-workspaces (P1: Primeiro acesso), não a uma lista vazia sem CTA.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --------------- | ----- | ----- | ------ |
| NAV-01 | P1: Navegar | F10 | ✅ Verified |
| NAV-02 | P1: Navegar | F10 | ✅ Verified |
| NAV-03 | P1: Navegar | F10 | ✅ Verified |
| NAV-04 | P1: Navegar | F10 | ✅ Verified |
| NAV-05 | P1: Navegar | F10 | ✅ Verified |
| NAV-06 | P1: Criar | F10 | ✅ Verified |
| NAV-07 | P1: Criar | F10 | ✅ Verified |
| NAV-08 | P1: Criar | F10 | ✅ Verified |
| NAV-09 | P1: Criar | F10 | ✅ Verified |
| NAV-10 | P1: Criar | F10 | ✅ Verified |
| NAV-11 | P1: Criar | F10 | ✅ Verified |
| NAV-12 | P1: Criar | F10 | ✅ Verified |
| NAV-13 | P1: Renomear | F10 | ✅ Verified |
| NAV-14 | P1: Renomear | F10 | ✅ Verified |
| NAV-15 | P1: Renomear | F10 | ✅ Verified |
| NAV-16 | P1: Renomear | F10 | ✅ Verified |
| NAV-17 | P1: Arquivar | F10 | ✅ Verified |
| NAV-18 | P1: Arquivar | F10 | ✅ Verified |
| NAV-19 | P1: Arquivar | F10 | ✅ Verified |
| NAV-20 | P1: Arquivar | F10 | ✅ Verified |
| NAV-21 | P1: Arquivar | F10 | ✅ Verified |
| NAV-22 | P1: Primeiro acesso | F10 | ✅ Verified |
| NAV-23 | P1: Primeiro acesso | F10 | ✅ Verified |
| NAV-24 | P2: Teclado e idioma | F10 | ✅ Verified |
| NAV-25 | P2: Teclado e idioma | F10 | ✅ Verified |
| NAV-26 | P2: Teclado e idioma | F10 | ✅ Verified |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `NAV` não colide com nenhum já usado: A11Y, AAC, AIC, AIE, AIG, API, AUTH, CIQ, CLB, CMT,
DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, OBS, OIDC, OPS, PERF, PRS, REC, SEC, SSO,
TRU, UIX, VER.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 26 requisitos, mapeados 1:1 às 26 acceptance criteria das seis histórias. Nenhum
mapeado a task ainda.

**Numeração por história:** NAV-01..05 (navegar), NAV-06..12 (criar), NAV-13..16 (renomear),
NAV-17..21 (arquivar), NAV-22..23 (primeiro acesso), NAV-24..26 (teclado e idioma).

---

## Rotas consumidas

| Rota | Uso | Mudança nesta spec |
| ---- | --- | ------------------- |
| `GET /workspaces` | lista de workspaces do usuário | Possível extensão aditiva — a confirmar na Design se `items[].role` já existe |
| `POST /workspaces` | criar workspace | Nenhuma |
| `GET /workspaces/:id` | nome do workspace corrente | Nenhuma |
| `PATCH /workspaces/:id` | renomear workspace | Nenhuma |
| `DELETE /workspaces/:id` | arquivar workspace | Nenhuma |
| `GET /projects?workspaceId=` | lista de projetos do workspace | Nenhuma |
| `POST /projects` | criar projeto | Nenhuma |
| `GET /projects/:id` | nome do projeto corrente | Nenhuma |
| `PATCH /projects/:id` | renomear projeto | Nenhuma |
| `DELETE /projects/:id` | arquivar projeto | Nenhuma |
| `GET /diagrams?projectId=` | lista de diagramas do projeto | Nenhuma |
| `POST /diagrams` | criar diagrama | Nenhuma |
| `PATCH /diagrams/:id` | renomear (título) diagrama | Nenhuma |
| `DELETE /diagrams/:id` | arquivar diagrama | Nenhuma |

14 das 15 rotas do roadmap original (`GET /diagrams/:id` não é consumida por esta spec — o editor já
a resolve via `/bootstrap`, não via essa rota REST simples; a confirmar/documentar na Design se
sobra alguma lacuna de contagem).

---

## Success Criteria

- [ ] Uma pessoa nova, com zero workspaces, cria o primeiro e chega ao editor de um diagrama sem
      nenhuma URL fornecida de fora.
- [ ] Toda ação de escrita (criar/renomear/arquivar) só aparece pra quem o servidor realmente deixa
      fazer, provado por teste com um papel sem a permissão.
- [ ] Arquivar remove o item da lista imediatamente e de forma confirmada por uma nova consulta ao
      servidor, nunca só otimisticamente.
- [ ] `repo-tools audit` deixa de classificar as 14 rotas acima como `pending-product`.
- [ ] O fluxo inteiro — navegar, criar, renomear, arquivar — é percorrível só com teclado, nos dois
      locales.
