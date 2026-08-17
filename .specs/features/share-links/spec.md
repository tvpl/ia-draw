# Compartilhamento externo por link — Especificação

Entrada R11 do roadmap de produto (`.specs/features/platform-maturity/ui-roadmap.md`). Criar link
com teto de papel e expiração, revogar, e a visão pública que o link abre. Depende de R4
(`workspace-members`, fechada).

É a **primeira rota do produto que funciona sem sessão nenhuma**. Todas as rotas de `apps/web` até
aqui vivem dentro de `AuthProvider` e atrás de `ProtectedRoute`; `/share/:token` não pode viver
atrás de nenhum dos dois.

## Problem Statement

O backend de share links está inteiro e verificado (`apps/server/src/modules/share/`): as 4 rotas
existem, o teto de papel é aplicado na criação e na resolução, o token é opaco de 256 bits com
apenas o hash persistido, e token inválido/expirado/revogado devolve o mesmo 404 indistinguível.
Nada disso tem interface — nenhum arquivo de `apps/web` chama qualquer uma das 4 rotas, e não
existe rota `/share/:token` no frontend.

Duas lacunas reais, descobertas na pesquisa desta spec e **decididas com o usuário antes do
Specify**, entram no escopo desta onda:

1. **`EditorSurface` não tem modo somente-leitura de verdade.** Hoje qualquer pessoa que monta o
   canvas pode desenhar, arrastar e apagar localmente. Nada disso persiste (o servidor rejeita a
   mutação no flush), mas a interação em si não é bloqueada no cliente. Para a visão pública isso
   seria um sinal de confiança péssimo; e a mesma lacuna já existe hoje para um `reviewer`/`viewer`
   autenticado em `DiagramEditorPage`, onde `canMutate` é calculado e usado para esconder painéis,
   mas nunca chega ao canvas. Esta spec fecha as duas pontas.

2. **O token de share aparece em texto claro no log estruturado de produção.** O token precisa
   estar no caminho da URL (`GET /share/:token`) para o link ser clicável, mas o serializer `req`
   de `apps/server/src/core/logging.ts:87` loga `request.url` cru, e o `redact` do Pino é baseado
   em campo — nunca casa uma substring dentro do valor de um campo. Resultado: com
   `nodeEnv !== 'test'`, todo acesso a um link válido grava o token em claro no log de acesso. A
   mesma classe de vazamento existe em `GET /ws/diagrams/:diagramId?ticket=<ticket>`
   (`apps/server/src/modules/ws-gateway/routes.ts:51,96,135`), encontrada na mesma varredura.

## Goals

- [ ] Quem pode mutar um diagrama cria um link público com papel e expiração explícitos, e vê a URL
      completa exatamente uma vez.
- [ ] Quem criou um link consegue revogá-lo, e o link deixa de funcionar imediatamente.
- [ ] Uma pessoa sem conta nenhuma abre a URL do link e vê o diagrama, sem login e sem redirect.
- [ ] A visão pública é somente leitura de verdade: o canvas não aceita edição local nenhuma.
- [ ] O token nunca aparece em texto claro no log estruturado do servidor.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Listar os share links já existentes de um diagrama | Não existe rota de listagem no servidor (`apps/server/src/modules/share/routes.ts` expõe criar, resolver e revogar — nunca listar). Inventar a rota é uma mudança de contrato maior do que esta fatia comporta; a tela lista apenas o que ela mesma criou nesta sessão (ver Assumptions) |
| Criar share link de apresentação pela interface | `POST /presentations/:id/share-links` funciona hoje, mas `apps/web` não tem nenhuma superfície de apresentação (R12 não foi construída) — não existe lugar de onde tirar um `presentationId`. Um método de cliente sem chamador é código morto; a criação fica com R12 |
| Visão pública navegável de apresentação (protótipo, frames, notas) | É exatamente o escopo declarado de R12 (`presentation-mode`), 2 ondas. R11 entrega apenas o estado de placeholder para o `resourceType: 'presentation'` que a mesma rota pública pode devolver (ver P2) |
| Edição por link (link com papel `editor` permitindo mutar) | A visão pública é somente leitura independentemente do papel do link. Habilitar mutação sem sessão exigiria um caminho de escrita autenticado por token que o servidor não expõe hoje (`GET /share/:token` é a única rota pública, e ela é read-only) |
| Renovar/estender a expiração de um link | Não existe rota de update — o servidor só cria e revoga. Estender = revogar e criar outro |
| Contagem de acessos, analytics ou auditoria de quem abriu o link | Nenhuma rota expõe isso e nada é persistido por acesso; adicionar seria mudança de modelo de dados |
| Alterar `expiresAt` para aceitar "nunca expira" | O contrato do servidor exige `expiresAt` (`z.coerce.date()`, sem `.nullable()`), diferente dos tokens MCP que aceitam nulo. Assimetria deliberada, preservada como está |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde `/share/:token` fica em relação a `AuthProvider`/`ProtectedRoute`? | Fora de `AuthProvider` inteiramente: `AppRoutes` ganha uma rota de layout sem path (`<Route element={<AuthLayout/>}>`) que monta `AuthProvider` para todo o resto, e `/share/:token` fica como irmã dessa rota de layout | Uma página pública não deve depender de máquina de sessão nenhuma. Dentro de `AuthProvider` a visita anônima dispara `GET /me` + `POST /auth/refresh` (dois 401 inúteis com cookies enviados) só para assentar em `anonymous`. A rota de layout sem path é padrão de React Router v6/v7 e mantém um único `<Routes>`, sem `<Routes>` aninhado | y |
| A visão pública de apresentação entra nesta onda? | Não — R11 entrega um estado explícito de "ainda não disponível" com o nome da apresentação e a contagem de frames; o visualizador real fica com R12 | `FrameRow` não tem título nenhum (`id`, `position`, `elementId`, `frameId`, `notes`, `navLinksJson`) — não há o que listar além de posições. Construir um visualizador agora seria construir R12 dentro de R11. Mas a rota pública é uma só e pode devolver `resourceType: 'presentation'` para um token criado por API, então a página precisa tratar esse ramo sem quebrar | y |
| Forma da prop de somente-leitura em `EditorSurface` | `viewModeEnabled?: boolean`, repassada direto para `<Excalidraw viewModeEnabled={...}/>` | O próprio Excalidraw 0.18.1 já expõe `viewModeEnabled?: boolean` em `ExcalidrawProps` (confirmado em `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts:436`). Repassar com o mesmo nome evita inventar um vocabulário paralelo (`readOnly`) que precisaria ser traduzido. Opcional e aditiva: ausente = comportamento atual, byte a byte | y |
| A tela de gestão lista links criados antes desta sessão? | Não — só os criados nesta montagem da tela, mantidos em estado local | Não existe rota de listagem (ver Out of Scope). A alternativa (persistir no `localStorage`) guardaria um `id` de link no navegador sem nenhum ganho real, já que o token em si nunca é recuperável de novo nem pelo servidor | y |
| Onde a gestão de links mora na tela | Dentro de `DiagramEditorPage`, na mesma coluna lateral que já hospeda `AiDock`, `LibraryPanel` e `MetadataPanel`, num `<details>` colapsado (mesma convenção dos dois painéis vizinhos) | Segue exatamente o layout já estabelecido por R1/R5; não introduz uma quarta região de layout na página | y |
| Como o teto de papel aparece na interface | Todos os 5 papéis aparecem no select; um pedido acima do próprio papel volta `403` do servidor e vira mensagem específica | Filtrar o select exigiria saber o papel efetivo do usuário no workspace, que `GET /diagrams/:id/bootstrap` não devolve (só `permissions`/`mutatePermissions`, decisões booleanas). Buscar o papel só para filtrar um select adicionaria uma chamada nova; o `403` do servidor já é a autoridade e a mensagem explica | y |
| Cliente HTTP dedicado ou reuso de `resourceClient`? | Dedicado — `apps/web/src/share/shareLinkClient.ts` | `resourceClient` assume corpo de string única e resposta com item embrulhado; criar link tem dois campos e devolve `{shareLink, token}` (forma de revelação única), e revogar usa o verbo de método customizado `:revoke`. Mesmo precedente de `memberClient.ts` (R4). Todas as chamadas usam `fetchImpl(...)` literal, para o extrator de `repo-tools audit` reconhecer as rotas | y |
| Forma da URL pública mostrada ao usuário | `${window.location.origin}/share/${token}` | O token vive no caminho porque é assim que a rota do servidor já funciona. Nunca duplicado em query string, nunca enviado a nenhum outro destino pelo cliente | y |
| Expiração no passado | Bloqueada no cliente antes de emitir a requisição | O servidor aceita qualquer data (`z.coerce.date()` sem limite inferior) e criaria um link nascido morto — `isShareLinkActive` reprovaria no primeiro acesso. Proteção de UX, não de autorização; o servidor continua sendo a autoridade | y |
| Forma da redação de token no log | Um serializer `url` próprio em `logging.ts` que substitui o segmento seguinte a `/share/` e o valor de `ticket=` por `[REDACTED]`, aplicado só ao valor logado | `redact` do Pino é por caminho de campo e não casa substring dentro de um valor. Mudar o valor logado nunca toca `request.url` real (roteamento, `instance` do problem+json e resposta seguem intactos) | y |
| A varredura achou outro caminho com token além de `/share/:token`? | Sim, um: `GET /ws/diagrams/:diagramId?ticket=<ticket>`. Entra no mesmo serializer | O usuário pediu explicitamente "e qualquer outro caminho com token, se você achar mais durante a checagem". Um ticket de WebSocket é credencial de uso único com o mesmo problema exato | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Criar um link de compartilhamento para o diagrama ⭐ MVP

**User Story**: Como pessoa que pode editar um diagrama, quero gerar um link público com papel e
prazo definidos, para mostrar o diagrama a alguém de fora sem dar conta no produto.

**Why P1**: É a razão de existir da fatia — sem criar link, não há o que revogar nem o que abrir.

**Acceptance Criteria**:
1. The ação de criar link SHALL aparecer no editor de diagrama somente quando `mutatePermissions.allowed` do bootstrap for verdadeiro.
2. IF o papel ou a data de expiração não estiverem preenchidos THEN a tela SHALL bloquear o envio, sem emitir `POST /diagrams/:id/share-links`.
3. IF a data de expiração escolhida for anterior ao momento do envio THEN a tela SHALL bloquear o envio com mensagem própria, sem emitir `POST /diagrams/:id/share-links`.
4. WHEN o usuário preencher papel e expiração futura e confirmar THEN a tela SHALL emitir `POST /diagrams/:id/share-links` com corpo `{role, expiresAt}`.
5. WHEN a resposta for `201` THEN a tela SHALL exibir a URL completa `${origin}/share/${token}` junto de um aviso de que ela não será exibida outra vez.
6. IF a resposta for `403` THEN a tela SHALL informar que o papel pedido excede o próprio papel do usuário, e SHALL não adicionar nenhum link à lista.
7. IF a resposta for qualquer outro status diferente de `201` THEN a tela SHALL informar falha genérica, e SHALL não adicionar nenhum link à lista.

**Independent Test**: Como `editor`, pedir um link com papel `workspace_admin` e confirmar que a
mensagem de teto de papel aparece e nenhum link entra na lista.

---

### P1: Revogar um link criado

**User Story**: Como pessoa que criou um link, quero revogá-lo, para cortar o acesso assim que ele
não for mais necessário.

**Why P1**: Um link sem revogação é um vazamento permanente até a data de expiração.

**Acceptance Criteria**:
8. The lista de links da tela SHALL conter apenas os links criados nesta montagem da tela, e SHALL declarar isso visivelmente (não existe rota de listagem no servidor).
9. WHEN o usuário acionar revogar em um link da lista THEN a tela SHALL emitir `POST /share-links/:id:revoke`.
10. WHEN a resposta de revogar for `200` THEN a tela SHALL marcar aquele link como revogado e SHALL deixar de exibir sua URL.
11. IF a resposta de revogar for `403` ou `404` THEN a tela SHALL informar a falha e SHALL manter o link exibido como ativo.

**Independent Test**: Criar um link, revogá-lo, e confirmar que a URL some da tela e o item aparece
como revogado.

---

### P1: Abrir a visão pública sem sessão nenhuma

**User Story**: Como pessoa de fora, sem conta no produto, quero abrir o link recebido e ver o
diagrama, sem tela de login no caminho.

**Why P1**: É a metade do valor da fatia que não existe hoje de forma nenhuma.

**Acceptance Criteria**:
12. WHEN um visitante sem sessão acessar `/share/:token` THEN a aplicação SHALL renderizar a visão pública, e SHALL nunca redirecionar para `/login`.
13. WHILE a visão pública estiver montada, a aplicação SHALL não emitir `GET /me` nem `POST /auth/refresh` (a rota fica fora de `AuthProvider`).
14. WHEN a visão pública montar THEN ela SHALL emitir `GET /share/:token` exatamente uma vez.
15. WHEN a resposta for `200` com `resourceType: 'diagram'` THEN a visão pública SHALL renderizar `scene` no canvas.
16. IF a resposta for `404` THEN a visão pública SHALL exibir uma única mensagem de "link inválido, expirado ou revogado", SHALL não distinguir as três causas e SHALL não renderizar canvas nenhum.
17. The chrome da visão pública SHALL não conter botão de logout, navegação de workspace, nem link para qualquer rota autenticada.

**Independent Test**: Montar a rota `/share/<token>` com `GET /share/:token` respondendo `404` e
confirmar que a mensagem única aparece, sem redirect e sem canvas.

---

### P1: A visão pública é somente leitura de verdade

**User Story**: Como dono do diagrama, quero que quem abre o link não consiga sequer arrastar um
elemento, para o "somente leitura" ser verdade na tela e não só no servidor.

**Why P1**: É a decisão explícita do usuário para esta onda e o principal sinal de confiança da
página pública.

**Acceptance Criteria**:
18. The `EditorSurface` SHALL aceitar uma prop opcional `viewModeEnabled?: boolean`, repassada para `<Excalidraw/>`, e SHALL preservar o comportamento atual quando ela estiver ausente.
19. WHILE a visão pública estiver montada, ela SHALL renderizar `EditorSurface` com `viewModeEnabled` igual a `true`.
20. WHERE o papel do link concede `diagram:mutate`, a visão pública SHALL continuar em `viewModeEnabled` igual a `true` (R11 não entrega edição por link).
21. The visão pública SHALL não montar `DiagramSyncClient` nem fila de mutação, e SHALL não emitir nenhuma requisição de mutação de diagrama.

**Independent Test**: Montar a visão pública com um link de papel `editor` e confirmar que o canvas
recebe `viewModeEnabled` verdadeiro mesmo assim.

---

### P1: O editor autenticado respeita papel de leitura

**User Story**: Como `reviewer`/`viewer` autenticado, quero que o canvas não me deixe editar algo
que nunca vai ser salvo, para não perder trabalho achando que salvou.

**Why P1**: É a mesma lacuna do item anterior na superfície que já existe hoje; o usuário colocou
explicitamente em escopo.

**Acceptance Criteria**:
22. WHILE `canMutate` for falso em `DiagramEditorPage`, o `EditorSurface` do editor autenticado SHALL receber `viewModeEnabled` igual a `true`; quando `canMutate` for verdadeiro, SHALL receber `false`.

**Independent Test**: Montar `DiagramEditorPage` com `mutatePermissions.allowed` falso no bootstrap
e confirmar que o canvas monta em modo de visualização.

---

### P1: O token nunca aparece em texto claro no log

**User Story**: Como responsável pela operação, quero que um token de share que passa pelo caminho
da URL não fique gravado em claro no log de acesso, para o log não virar uma lista de credenciais.

**Why P1**: É um vazamento real de credencial em produção hoje, decidido com o usuário como parte
desta onda.

**Acceptance Criteria**:
23. WHEN o servidor logar uma requisição para `/share/:token` THEN o campo `url` da linha de log SHALL ser `/share/[REDACTED]`.
24. WHEN o servidor logar uma requisição para `/share/:token` THEN a linha de log SHALL não conter o token em texto claro em nenhum campo.
25. WHEN o servidor logar uma requisição cuja query string contém `ticket=`, THEN o valor de `ticket` na URL logada SHALL ser `[REDACTED]`.
26. The redação SHALL agir apenas sobre o valor logado: o roteamento e o corpo da resposta SHALL continuar recebendo a URL original inalterada.

**Independent Test**: Capturar o stream do Pino num servidor com `NODE_ENV=development`, emitir
`GET /share/<token>` e confirmar que a saída não contém o token e contém `/share/[REDACTED]`.

---

### P2: A visão pública não quebra num link de apresentação

**User Story**: Como pessoa que recebeu um link de apresentação criado por API, quero uma tela
honesta dizendo que essa visualização ainda não existe, em vez de uma tela quebrada.

**Why P2**: Não é o caminho principal da fatia (a interface não cria esse tipo de link), mas a rota
pública é uma só e pode devolver esse formato.

**Acceptance Criteria**:
27. WHEN `GET /share/:token` responder `200` com `resourceType: 'presentation'` THEN a visão pública SHALL exibir o nome da apresentação e um estado explícito de "visualização de apresentação ainda não disponível", sem quebrar nem renderizar canvas.
28. The visão pública SHALL não renderizar o conteúdo de nenhum frame — nem `notes`, nem `navLinksJson`.

**Independent Test**: Responder `GET /share/:token` com `{resourceType:'presentation', role:'editor', presentation, frames}` incluindo `notes` preenchido e confirmar que nenhum texto de `notes` aparece na tela.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero criar, revogar e ler o link
compartilhado sem mouse.

**Why P2**: Mesmo padrão estabelecido por todas as fatias anteriores desta frente.

**Acceptance Criteria**:
29. The toda ação desta spec (criar link, copiar/ler a URL, revogar) SHALL ser alcançável só por teclado.
30. WHEN criar ou revogar completar, com sucesso ou falha, THEN a tela SHALL anunciar o resultado numa região `aria-live="polite"`.
31. The todo texto visível desta spec, na tela de gestão e na visão pública, SHALL vir de chaves de i18n nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Criar e revogar um link usando só Tab/Enter, com o locale trocado para `en`, e
abrir a visão pública no mesmo locale.

---

## Edge Cases

- IF `GET /share/:token` falhar por erro de rede THEN a visão pública SHALL exibir a mesma mensagem de falha genérica, sem expor detalhe de erro e sem loop de retry.
- WHILE uma criação de link estiver em andamento, um segundo envio do formulário SHALL não emitir uma segunda requisição.
- IF o mesmo link for revogado duas vezes THEN a segunda revogação SHALL ser tratada como sucesso (a rota é idempotente), sem duplicar item nem mensagem de erro.
- WHEN a visão pública renderizar uma cena vazia (`scene: []`) THEN ela SHALL renderizar o canvas vazio, nunca a mensagem de link inválido.
- IF a resposta de criação vier sem `token` THEN a tela SHALL tratar como falha genérica, sem exibir uma URL incompleta.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SHR-01 | P1: Criar link | F10 | Pending |
| SHR-02 | P1: Criar link | F10 | Pending |
| SHR-03 | P1: Criar link | F10 | Pending |
| SHR-04 | P1: Criar link | F10 | Implementing |
| SHR-05 | P1: Criar link | F10 | Implementing |
| SHR-06 | P1: Criar link | F10 | Implementing |
| SHR-07 | P1: Criar link | F10 | Implementing |
| SHR-08 | P1: Revogar link | F10 | Pending |
| SHR-09 | P1: Revogar link | F10 | Implementing |
| SHR-10 | P1: Revogar link | F10 | Implementing |
| SHR-11 | P1: Revogar link | F10 | Implementing |
| SHR-12 | P1: Visão pública sem sessão | F10 | Pending |
| SHR-13 | P1: Visão pública sem sessão | F10 | Pending |
| SHR-14 | P1: Visão pública sem sessão | F10 | Implementing |
| SHR-15 | P1: Visão pública sem sessão | F10 | Implementing |
| SHR-16 | P1: Visão pública sem sessão | F10 | Implementing |
| SHR-17 | P1: Visão pública sem sessão | F10 | Implementing |
| SHR-18 | P1: Somente leitura de verdade | F10 | Implementing |
| SHR-19 | P1: Somente leitura de verdade | F10 | Implementing |
| SHR-20 | P1: Somente leitura de verdade | F10 | Implementing |
| SHR-21 | P1: Somente leitura de verdade | F10 | Implementing |
| SHR-22 | P1: Editor autenticado respeita papel | F10 | Pending |
| SHR-23 | P1: Token fora do log | F10 | Implementing |
| SHR-24 | P1: Token fora do log | F10 | Implementing |
| SHR-25 | P1: Token fora do log | F10 | Implementing |
| SHR-26 | P1: Token fora do log | F10 | Implementing |
| SHR-27 | P2: Link de apresentação | F10 | Implementing |
| SHR-28 | P2: Link de apresentação | F10 | Implementing |
| SHR-29 | P2: Teclado e idioma | F10 | Implementing |
| SHR-30 | P2: Teclado e idioma | F10 | Pending |
| SHR-31 | P2: Teclado e idioma | F10 | Implementing |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `SHR` não colide com nenhum já usado no repositório: AAC, AGT, AIC, AIE, AIG, API, AUTH,
CIQ, CLB, CLIB, CMT, DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, MEM, NAV, OBS, OIDC,
OPS, PERF, PRS, REC, SEC, SNAP, SSO, TRU, UIX, VER, XPRT. Em particular, `EXT-01`
(`.specs/features/architecture-canvas/spec.md`) é o requisito de backend que criou as 4 rotas de
share link nesta base; esta spec é a superfície de produto sobre ele, com prefixo próprio.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 31 requisitos, mapeados 1:1 às 31 acceptance criteria das oito histórias.

**Numeração por história:** SHR-01..07 (criar), SHR-08..11 (revogar), SHR-12..17 (visão pública),
SHR-18..21 (somente leitura), SHR-22 (editor autenticado), SHR-23..26 (log), SHR-27..28
(apresentação), SHR-29..31 (teclado e idioma).

---

## Rotas consumidas

| Rota | Uso | Mudança nesta spec |
| --- | --- | --- |
| `POST /diagrams/:id/share-links` | criar link de diagrama | Nenhuma |
| `GET /share/:token` | resolver o link na visão pública (sem sessão) | Nenhuma no contrato; a URL logada passa a ser redigida |
| `POST /share-links/:id:revoke` | revogar link | Nenhuma |
| `POST /presentations/:id/share-links` | — | **Não consumida nesta onda** (ver Out of Scope): não existe superfície de apresentação em `apps/web` de onde tirar um `presentationId`. Fica com R12 |

O roadmap lista 4 rotas para R11; esta spec consome 3 e adia a quarta para R12, com a justificativa
acima. Nenhuma rota nova é criada.

---

## Success Criteria

- [ ] Uma pessoa sem sessão nenhuma abre `/share/<token>` e vê o diagrama, provado por teste que
      renderiza a rota sem `AuthProvider` e falha se `GET /me` for chamado.
- [ ] O canvas da visão pública recusa edição local, provado por asserção na prop repassada ao
      Excalidraw — não por inspeção visual.
- [ ] Um `reviewer`/`viewer` autenticado também recebe o canvas em modo de visualização, fechando a
      lacuna que existia antes desta onda.
- [ ] Um token real emitido em `GET /share/:token` não aparece em nenhuma linha do log capturado,
      provado por teste que falha se a redação for removida.
- [ ] `repo-tools audit` deixa de classificar `POST /diagrams/:id/share-links`, `GET /share/:token`
      e `POST /share-links/:id:revoke` como `pending-product`.
- [ ] Criar e revogar são percorríveis só com teclado, nos dois locales.
