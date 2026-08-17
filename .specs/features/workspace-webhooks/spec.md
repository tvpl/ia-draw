# Webhooks do workspace — Especificação

Sexta fatia vertical do roadmap de produto (entrada R16 de
`.specs/features/platform-maturity/ui-roadmap.md`). Tela de webhooks do workspace: cadastrar,
editar, remover e rotacionar segredo. Depende de R4 (`workspace-members`), já entregue e
verificada — reusa o mesmo portão de papel (`workspace:manage_members`) e o mesmo lugar de entrada
(um link em `ProjectListPage`).

## Problem Statement

O backend de webhooks está implementado, testado e entregando de verdade: as 5 rotas existem em
`apps/server/src/modules/webhook/routes.ts`, o segredo é cifrado em repouso (AES-256-GCM, mesma
máquina de chave-mestra que a configuração de provider de IA usa) e a entrega assíncrona via
pg-boss já dispara de 5 pontos reais do produto (menção em comentário, geração de spec, batch de
operações do diagrama, publicação de apresentação, criação de diagrama em projeto). Nada disso tem
interface. Um admin que queira integrar o workspace a um sistema externo hoje precisa falar HTTP na
mão.

Esta fatia é a primeira do produto inteiro a mostrar um segredo em claro na tela. `POST
/workspaces/:id/webhooks` e `PATCH .../webhooks/:webhookId:rotate-secret` devolvem o segredo HMAC
em texto puro **exatamente uma vez** — nenhuma outra rota (`GET`, `PATCH` comum, `DELETE`) o
reexpõe, por desenho. Se a pessoa não copiar naquele momento, o único caminho é rotacionar de novo,
o que quebra a integração já configurada. Não existe nenhum padrão de UI para isso no repositório
(`navigator.clipboard` não aparece em lugar nenhum de `apps/web/src`), então o desenho da revelação
é decidido aqui, na tabela de Assumptions, e não copiado de uma tela irmã.

Uma lacuna real do backend, descoberta na pesquisa desta spec e **não resolvida aqui**: a tabela
`webhook_deliveries` grava `status`, `attempts` e `lastError`, mas nenhuma rota HTTP expõe isso.
Não há como uma tela mostrar se uma entrega falhou. Fica em Out of Scope, sem inventar rota nova —
o orçamento desta entrada do roadmap é de 5 rotas, todas já existentes.

## Goals

- [ ] Um admin do workspace vê todos os webhooks cadastrados, com URL, eventos assinados e se estão
      ativos.
- [ ] Um admin cadastra um webhook novo escolhendo a URL e quais dos 5 eventos assinar, e recebe o
      segredo HMAC numa revelação única impossível de não notar.
- [ ] Um admin edita URL, eventos e estado ativo/inativo de um webhook existente.
- [ ] Um admin rotaciona o segredo de um webhook, com aviso explícito de que o segredo antigo para
      de valer na hora, e recebe o novo segredo pela mesma revelação única.
- [ ] Um admin remove um webhook, com confirmação.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Visibilidade de entregas (status, tentativas, último erro, reenvio manual) | Lacuna real e conhecida do backend: `webhook_deliveries` guarda os três campos, mas **nenhuma rota HTTP os expõe**. Cobrir isso exigiria uma 6ª rota, além do orçamento de 5 rotas decidido para esta entrada do roadmap. Documentado, não resolvido |
| Mostrar "segredo rotacionado em X" | Não existe coluna `rotatedAt` no modelo: rotação só mexe em `updatedAt`, exatamente como qualquer outra edição. Uma data de rotação seria indistinguível de uma troca de URL. Não se inventa campo que não existe |
| Reexibir o segredo de um webhook já criado | Por desenho do backend: o segredo só sai em claro nas duas respostas de criação/rotação. `GET` devolve apenas a projeção pública (`toPublicWebhookEndpoint`), sem nada com forma de segredo. A tela não tem de onde tirar |
| Testar a entrega (botão "enviar evento de teste") | Não existe rota para isso; seria rota nova, fora do orçamento |
| Tipos de evento além dos 5 do backend | `WEBHOOK_EVENT_TYPES` é fechado no servidor (`diagram.created`, `diagram.updated`, `diagram.published`, `spec.generated`, `comment.mentioned`). A tela só expõe os 5 que existem |
| Qualquer mudança no servidor | O backend desta fatia está completo e verificado. Esta spec é só de cliente, exceto pelo que já existe |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde a tela vive? | `/w/:workspaceId/webhooks`, rota irmã de `/w/:workspaceId` (projetos), `/w/:workspaceId/members` e `/w/:workspaceId/p/:projectId`, dentro do mesmo `AppShell` | Segue exatamente a convenção de rota estabelecida em `workspace-navigation` e reusada em `workspace-members` — webhook é preocupação de workspace, não de projeto | y |
| O link para a tela é visível para quem? | Só para quem tem `workspace:manage_members` (`org_admin`/`workspace_admin`) | Diferente de membros (leitura universal): **todas** as 5 rotas de webhook, inclusive `GET`, exigem `workspace:manage_members` no servidor (`assertWorkspaceAdmin`). Um link visível para um `viewer` levaria a uma tela que só sabe dizer "sem acesso" | y |
| **Tech Decision — como revelar um segredo mostrado uma única vez?** Não existe padrão nenhum no repositório para isso | Um painel de revelação dedicado, renderizado no topo da tela após `201` (cadastro) e após `200` (rotação), fora da lista e do formulário: (1) o segredo em campo de texto somente-leitura, sempre selecionável; (2) botão de copiar; (3) aviso explícito de que esse é o único momento em que o valor aparece; (4) botão de dispensar. O painel **só** some por dispensa explícita | Um toast/alerta temporário é o desenho errado para um valor que não dá para recuperar: qualquer timer ou re-render que engula o painel custa uma rotação ao usuário. Manter o valor até dispensa explícita transfere a decisão de fechar para quem tem o dado. Fica visualmente distinto do resto da tela (lista e formulários) porque exige uma ação de fora do fluxo normal | y |
| O segredo pode ser alcançável só pelo botão de copiar? | Não — o texto do segredo está sempre visível e selecionável no painel; copiar é atalho, nunca o único caminho | `navigator.clipboard` não existe em contexto não seguro (HTTP puro) nem em todo navegador, e a escrita pode ser rejeitada por permissão. Se o botão fosse o único caminho, a falha dele custaria o segredo | y |
| O que acontece se a API de clipboard não existir ou falhar? | A tela informa que o valor precisa ser copiado manualmente e mantém o painel e o segredo na tela, sem tratar como erro fatal | Degrade explícito, mesma postura de AD-009 (Redis ausente degrada, não quebra) | y |
| Rotação exige confirmação? | Sim — confirmação explícita em dois passos, dentro da própria linha do webhook (o botão "Rotacionar" dá lugar a um par confirmar/cancelar), com o texto avisando que o segredo antigo para de valer imediatamente | Rotação é irreversível e quebra a integração externa até que o novo segredo seja instalado lá; o backend invalida na hora, sem período de graça. `workspace-members` reservou confirmação exatamente para ações sem volta. Dois passos na linha (e não um `<dialog>`) porque `ConfirmArchiveDialog` tem texto fixo de arquivamento (`nav.archiveConfirm.*`), errado para rotação, e mudar esse componente compartilhado por três telas para acomodar uma quarta mensagem é mudança maior que o problema | y |
| Reusar `ConfirmArchiveDialog` para confirmar remoção? | Sim, tal como está, com `itemName` = a URL do webhook | Reuso real, nenhuma mudança no componente — o texto "isso não pode ser desfeito" está correto para remoção. Mesma decisão de `workspace-members` | y |
| Reusar `resourceListStore` genérico? | Sim, sem shim | A projeção pública do servidor já tem `id: string`, que é exatamente a restrição do genérico — ao contrário de membro, que precisou do shim `id = userId` | y |
| Reusar `resourceClient` genérico? | Não — cliente dedicado `webhookClient.ts` | `create` do genérico assume corpo de string única; cadastro de webhook precisa de `{url, events[], enabled?}` (três campos, um deles array). `:rotate-secret` é um verbo a mais, com resposta `{webhookEndpoint, secret}` que o genérico não tem onde encaixar. Mesmo raciocínio que produziu `memberClient.ts` em R4 | y |
| Todo call site do cliente escreve `fetchImpl(...)` literal? | Sim — nunca um alias local tipo `doFetch` | O extrator de inventário de rotas do `repo-tools` só reconhece `fetch(`/`fetchImpl(` literais. Esse erro exato já custou correção reativa em duas ondas anteriores | y |
| Validação de formato de URL no cliente? | Não além de "não vazia depois de `trim`" | O servidor aceita `z.string().min(1)` — qualquer string não vazia. Uma regra mais estrita no cliente rejeitaria valores que a API aceita, inventando requisito que não existe | y |
| Como o usuário escolhe os eventos? | Cinco caixas de seleção, uma por tipo de `WEBHOOK_EVENT_TYPES`, agrupadas num `fieldset` com `legend` | O conjunto é fechado e pequeno; múltipla escolha com mínimo de 1 é exatamente o contrato do servidor (`z.array(z.enum(...)).min(1)`) | y |
| Zero eventos marcados — bloqueia no cliente ou deixa dar 400? | Bloqueia no cliente, sem emitir requisição, explicando que ao menos um evento é obrigatório | O servidor devolveria 400 genérico de validação; a tela já sabe a regra e pode dizer qual é. Mesma postura do "já é membro" em R4, que evita um 409 evitável | y |
| Falha de leitura da lista (403 de não-admin, 404 de não-membro) — distinguir? | Não: qualquer resposta não-2xx no `GET` da lista vira a mesma mensagem "não existe ou você não tem acesso" | Convenção IDOR já estabelecida em `workspace-navigation` e `workspace-members`; distinguir 403 de 404 confirmaria a existência do workspace para quem não é membro | y |
| Edição sem nenhum campo alterado emite `PATCH`? | Não — se nada mudou, nenhuma requisição é emitida | O servidor exige ao menos um dos três campos (`refine` no `updateBodySchema`) e responderia 400. Evita erro que a tela sabe prevenir | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Ver os webhooks do workspace ⭐ MVP

**User Story**: Como admin do workspace, quero ver os webhooks cadastrados com suas URLs, eventos e
estado, para saber o que está integrado.

**Why P1**: É a base de tudo o mais — sem lista, não há o que editar, remover ou rotacionar.

**Acceptance Criteria**:
1. WHEN o usuário acessar `/w/:workspaceId/webhooks` THEN a tela SHALL listar os webhooks devolvidos por `GET /workspaces/:id/webhooks`, cada um com URL, os tipos de evento assinados e o estado ativo/inativo.
2. The link para a tela de webhooks SHALL aparecer em `ProjectListPage` somente quando o papel efetivo do usuário conceder `workspace:manage_members`.
3. IF `GET /workspaces/:id/webhooks` responder qualquer status fora de 2xx THEN a tela SHALL mostrar a mensagem compartilhada de "não existe ou sem acesso", sem distinguir 403 de 404.
4. WHEN a lista carregar sem nenhum webhook THEN a tela SHALL mostrar um estado vazio explícito, nunca uma lista em branco sem explicação.

**Independent Test**: Renderizar a tela com uma lista de dois webhooks e confirmar URL, eventos e
estado de cada um; renderizar com `403` e confirmar a mensagem de sem acesso.

---

### P1: Cadastrar um webhook ⭐ MVP

**User Story**: Como admin do workspace, quero cadastrar um webhook escolhendo a URL e quais
eventos assinar, para receber notificações no meu sistema.

**Why P1**: É a única forma de povoar a tela; sem cadastro, a lista é sempre vazia.

**Acceptance Criteria**:
1. The formulário de cadastro SHALL oferecer exatamente os 5 tipos de evento de `WEBHOOK_EVENT_TYPES` (`diagram.created`, `diagram.updated`, `diagram.published`, `spec.generated`, `comment.mentioned`), como seleção múltipla.
2. IF a URL estiver vazia depois de `trim` THEN a tela SHALL bloquear o envio, sem emitir `POST`, informando que a URL é obrigatória.
3. IF nenhum tipo de evento estiver marcado THEN a tela SHALL bloquear o envio, sem emitir `POST`, informando que ao menos um evento é obrigatório.
4. WHEN o usuário enviar um cadastro com URL não vazia e ao menos um evento THEN a tela SHALL emitir `POST /workspaces/:id/webhooks` com `{url, events}`.
5. WHEN `POST /workspaces/:id/webhooks` responder `201` THEN a tela SHALL adicionar o webhook devolvido à lista sem recarregar a página e limpar o formulário.
6. IF `POST /workspaces/:id/webhooks` responder qualquer status diferente de `201` THEN a tela SHALL informar a falha e não SHALL adicionar nada à lista.

**Independent Test**: Submeter o formulário com URL preenchida e nenhum evento marcado, confirmar
que a mensagem aparece e que nenhuma requisição `POST` foi emitida.

---

### P1: Receber o segredo numa revelação única ⭐ MVP

**User Story**: Como admin que acabou de cadastrar ou rotacionar um webhook, quero ver o segredo
HMAC de um jeito que eu não perca por acidente, para conseguir instalá-lo no meu sistema.

**Why P1**: O segredo sai em claro uma única vez. Perdê-lo custa uma rotação e quebra a integração
que acabou de ser criada. É o requisito mais frágil desta fatia.

**Acceptance Criteria**:
1. WHEN `POST /workspaces/:id/webhooks` ou `PATCH /workspaces/:id/webhooks/:webhookId:rotate-secret` responder com um segredo THEN a tela SHALL exibir um painel de revelação contendo o segredo em texto selecionável.
2. The painel de revelação SHALL conter um aviso explícito de que aquele é o único momento em que o segredo aparece.
3. The segredo SHALL estar sempre visível como texto no painel, nunca alcançável apenas através do botão de copiar.
4. WHEN o usuário acionar o botão de copiar THEN a tela SHALL escrever o segredo no clipboard via `navigator.clipboard.writeText` e confirmar que a cópia aconteceu.
5. IF `navigator.clipboard` não existir ou a escrita for rejeitada THEN a tela SHALL informar que o valor precisa ser copiado manualmente e SHALL manter o painel e o segredo na tela.
6. WHILE o painel de revelação estiver aberto, ele SHALL permanecer na tela até uma dispensa explícita do usuário, sem sumir por tempo nem por outra interação.
7. WHEN o usuário dispensar o painel THEN a tela SHALL remover o segredo do documento e não SHALL oferecer nenhuma ação que o traga de volta.

**Independent Test**: Cadastrar um webhook com um `fetch` falso que devolve `201 {webhookEndpoint,
secret}`, confirmar que o segredo aparece como texto; dispensar e confirmar que sumiu e que nada na
tela o recupera.

---

### P1: Editar um webhook

**User Story**: Como admin do workspace, quero corrigir a URL, mudar os eventos assinados ou
desligar temporariamente um webhook, sem precisar remover e cadastrar de novo.

**Why P1**: Trocar de endpoint e pausar uma integração com problema são as duas operações mais
comuns depois de cadastrar.

**Acceptance Criteria**:
1. WHEN o usuário salvar uma edição com pelo menos um campo alterado THEN a tela SHALL emitir `PATCH /workspaces/:id/webhooks/:webhookId` com os campos `url`, `events` e `enabled` correntes.
2. IF nenhum campo tiver sido alterado THEN a tela SHALL não emitir requisição nenhuma, já que o servidor exige ao menos um campo.
3. WHEN `PATCH` responder `200` THEN a tela SHALL refletir os novos valores na lista, nunca antes da resposta.
4. IF `PATCH` responder qualquer status diferente de `200` THEN a tela SHALL informar a falha e SHALL manter os valores anteriores na lista.
5. WHEN o usuário alternar o estado ativo/inativo de um webhook THEN a tela SHALL emitir `PATCH /workspaces/:id/webhooks/:webhookId` com `{enabled}` e refletir o novo estado somente após `200`.

**Independent Test**: Abrir a edição de um webhook, trocar a URL, salvar com um `fetch` falso que
devolve `403`, e confirmar que a linha continua mostrando a URL antiga.

---

### P1: Rotacionar o segredo de um webhook

**User Story**: Como admin do workspace, quero trocar o segredo HMAC de um webhook, para responder
a um vazamento sem recriar a integração inteira.

**Why P1**: É a razão de a rota existir; sem interface, um vazamento só se resolve por HTTP na mão.

**Acceptance Criteria**:
1. WHEN o usuário acionar rotacionar THEN a tela SHALL exigir uma confirmação explícita antes de emitir qualquer requisição, avisando que o segredo antigo deixa de valer imediatamente, sem período de carência.
2. WHEN o usuário confirmar a rotação THEN a tela SHALL emitir `PATCH /workspaces/:id/webhooks/:webhookId:rotate-secret`.
3. WHEN a rotação responder `200` THEN a tela SHALL exibir o novo segredo no mesmo painel de revelação única usado no cadastro.
4. IF a rotação responder qualquer status diferente de `200` THEN a tela SHALL informar a falha e não SHALL abrir painel de revelação nenhum.
5. IF o usuário cancelar a confirmação THEN a tela SHALL não emitir requisição nenhuma e SHALL voltar a linha ao estado normal.

**Independent Test**: Acionar rotacionar, cancelar, e confirmar que nenhuma requisição foi emitida;
acionar de novo, confirmar, e ver o novo segredo no painel.

---

### P1: Remover um webhook

**User Story**: Como admin do workspace, quero remover um webhook que não uso mais.

**Why P1**: Fecha o ciclo de gestão; um webhook esquecido continua entregando dados do workspace
para fora.

**Acceptance Criteria**:
1. WHEN o usuário acionar remover THEN a tela SHALL exigir confirmação via `ConfirmArchiveDialog` reusado, citando a URL do webhook.
2. WHEN o usuário confirmar a remoção THEN a tela SHALL emitir `DELETE /workspaces/:id/webhooks/:webhookId` e, após `204`, remover o webhook da lista sem recarregar a página.
3. IF `DELETE` responder qualquer status diferente de `204` THEN a tela SHALL informar a falha e SHALL manter o webhook na lista.

**Independent Test**: Acionar remover num webhook, confirmar no diálogo com um `fetch` falso que
devolve `204`, e confirmar que a linha sumiu sem recarregar.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero gerenciar webhooks sem
mouse e no meu idioma.

**Why P2**: Mesmo padrão já estabelecido pelas cinco fatias anteriores desta frente.

**Acceptance Criteria**:
1. The toda ação desta spec (listar, cadastrar, copiar segredo, dispensar painel, editar, alternar estado, rotacionar, confirmar, remover) SHALL ser alcançável só por teclado.
2. WHEN cadastro, edição, rotação, cópia ou remoção completar, com sucesso ou falha, THEN a tela SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível SHALL vir de chaves de i18n presentes nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Percorrer cadastro, cópia do segredo, edição e remoção usando só
Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF o formulário de cadastro for enviado duas vezes em sequência rápida THEN a tela SHALL emitir apenas uma requisição `POST`, ignorando o segundo envio enquanto o primeiro estiver em voo.
- IF uma segunda revelação de segredo acontecer (rotação logo após cadastro) enquanto um painel já está aberto THEN a tela SHALL mostrar apenas o segredo mais recente, nunca dois painéis nem o valor antigo.
- IF o papel do usuário for revogado enquanto a tela está aberta THEN uma ação subsequente que falhe com `403` SHALL ser tratada como qualquer outra falha, sem quebrar a tela.
- WHEN o usuário desmarcar o último evento marcado durante uma edição THEN a tela SHALL bloquear o salvamento pela mesma regra do cadastro, sem emitir `PATCH`.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| WHK-01 | P1: Ver webhooks | F10 | Implementing |
| WHK-02 | P1: Ver webhooks | F10 | Pending |
| WHK-03 | P1: Ver webhooks | F10 | Implementing |
| WHK-04 | P1: Ver webhooks | F10 | Implementing |
| WHK-05 | P1: Cadastrar | F10 | Implementing |
| WHK-06 | P1: Cadastrar | F10 | Implementing |
| WHK-07 | P1: Cadastrar | F10 | Implementing |
| WHK-08 | P1: Cadastrar | F10 | Implementing |
| WHK-09 | P1: Cadastrar | F10 | Implementing |
| WHK-10 | P1: Cadastrar | F10 | Implementing |
| WHK-11 | P1: Revelação única | F10 | Implementing |
| WHK-12 | P1: Revelação única | F10 | Implementing |
| WHK-13 | P1: Revelação única | F10 | Implementing |
| WHK-14 | P1: Revelação única | F10 | Implementing |
| WHK-15 | P1: Revelação única | F10 | Implementing |
| WHK-16 | P1: Revelação única | F10 | Implementing |
| WHK-17 | P1: Revelação única | F10 | Implementing |
| WHK-18 | P1: Editar | F10 | Implementing |
| WHK-19 | P1: Editar | F10 | Implementing |
| WHK-20 | P1: Editar | F10 | Implementing |
| WHK-21 | P1: Editar | F10 | Implementing |
| WHK-22 | P1: Editar | F10 | Implementing |
| WHK-23 | P1: Rotacionar | F10 | Implementing |
| WHK-24 | P1: Rotacionar | F10 | Implementing |
| WHK-25 | P1: Rotacionar | F10 | Implementing |
| WHK-26 | P1: Rotacionar | F10 | Implementing |
| WHK-27 | P1: Rotacionar | F10 | Implementing |
| WHK-28 | P1: Remover | F10 | Implementing |
| WHK-29 | P1: Remover | F10 | Implementing |
| WHK-30 | P1: Remover | F10 | Implementing |
| WHK-31 | P2: Teclado e idioma | F10 | Implementing |
| WHK-32 | P2: Teclado e idioma | F10 | Implementing |
| WHK-33 | P2: Teclado e idioma | F10 | Implementing |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `WHK` não colide com nenhum já usado: A11Y, AAC, AGT, AIC, AIE, AIG, API, AUTH, CIQ, CLB,
CMT, DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, MEM, NAV, OBS, OIDC, OPS, PERF, PRS,
REC, SEC, SSO, TRU, UIX, VER.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 33 requisitos, mapeados 1:1 às 33 acceptance criteria das sete histórias.

**Numeração por história:** WHK-01..04 (ver), WHK-05..10 (cadastrar), WHK-11..17 (revelação única),
WHK-18..22 (editar), WHK-23..27 (rotacionar), WHK-28..30 (remover), WHK-31..33 (teclado e idioma).

---

## Rotas consumidas

| Rota | Uso | Mudança nesta spec |
| --- | --- | --- |
| `GET /workspaces/:id/webhooks` | lista de webhooks | Nenhuma |
| `POST /workspaces/:id/webhooks` | cadastrar (devolve o segredo uma única vez) | Nenhuma |
| `PATCH /workspaces/:id/webhooks/:webhookId` | editar URL, eventos, estado ativo | Nenhuma |
| `DELETE /workspaces/:id/webhooks/:webhookId` | remover | Nenhuma |
| `PATCH /workspaces/:id/webhooks/:webhookId:rotate-secret` | rotacionar segredo (devolve o novo uma única vez) | Nenhuma |

As 5 rotas do orçamento do roadmap, todas já implementadas e testadas no servidor. Esta spec não
adiciona, altera nem remove nenhuma rota — é trabalho exclusivamente de cliente.

---

## Success Criteria

- [ ] Um admin cadastra um webhook pela interface e sai da tela com o segredo em mãos, sem nunca
      tocar em `curl`.
- [ ] O segredo revelado sobrevive a qualquer re-render da tela até ser dispensado de propósito —
      provado por teste que falha se o painel passar a fechar sozinho.
- [ ] A tela continua utilizável quando `navigator.clipboard` não existe: o segredo permanece
      legível e copiável à mão.
- [ ] `repo-tools audit` deixa de classificar as 5 rotas de webhook como `pending-product`.
- [ ] O fluxo inteiro é percorrível só com teclado, nos dois locales.
