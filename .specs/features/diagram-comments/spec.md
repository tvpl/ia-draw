# Comentários e revisão no diagrama — Especificação

Quinta fatia vertical do roadmap de produto (entrada R9 de
`.specs/features/platform-maturity/ui-roadmap.md`). Painel de comentários dentro do editor:
comentar ancorado no elemento selecionado, ler as threads existentes, resolver e reabrir. É a
superfície que torna o papel `reviewer` utilizável: ele comenta e nunca edita, e quem decide isso
é o servidor.

## Problem Statement

O backend de comentários está implementado e verificado desde a onda F3
(`apps/server/src/modules/comment/routes.ts`, `comment.int.spec.ts`, `mentions.spec.ts`). As três
rotas continuam `pending-product` no `docs/route-inventory.md`: nenhuma tela do produto as chama.

O resultado prático é que o papel `reviewer` — desenhado justamente para "comenta e nunca edita",
com `comment:create`/`comment:resolve` concedidos e `diagram:mutate` negado — não tem hoje nenhuma
ação possível no produto. Ele entra no editor, vê um canvas somente-leitura, e não tem por onde
comentar. Esta fatia entrega essa superfície.

Duas restrições do modelo de dados moldam o desenho e estão documentadas, não "resolvidas", aqui:
`elementId`/`frameId` são colunas anuláveis simples, **não** foreign keys — um comentário
sobrevive ao elemento que ancorava, sem cascade e sem validação contra a cena no momento da
escrita. E não existe rota de delete: comentário é criar + alterar, nunca apagar.

## Goals

- [ ] Qualquer papel, inclusive `reviewer` e `viewer`, comenta num diagrama sem tocar no canvas.
- [ ] Um comentário nasce ancorado no elemento selecionado, quando há exatamente um selecionado.
- [ ] As threads existentes ficam legíveis no editor, com resolver e reabrir.
- [ ] O painel de comentários e o dock de IA convivem sem brigar pela largura do canvas.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Editar o corpo de um comentário já criado | `PATCH` aceita `body` (só para o próprio autor), mas editar comentário não é o que destrava o papel `reviewer`; entra numa fatia futura se houver demanda real |
| Apagar comentário | Não existe rota de delete no servidor — implementar exigiria mudança de contrato, fora desta fatia |
| Comentário ancorado em frame (`frameId`) | O editor ainda não expõe seleção de frame; `onSelectionChange` devolve ids de elemento. `frameId` continua sempre ausente nos `POST` desta fatia |
| Atualização em tempo real de comentários (WebSocket) | Esta fatia é REST puro. Transporte WebSocket é R10 (`realtime-presence`), onda própria e paralela; comentário sobre WS não está no escopo de nenhuma das duas entradas do roadmap |
| Renderizar menção (`@`) como chip, autocompletar menção | O servidor resolve `@userId`/`@email` e devolve `mentions`, mas o corpo é persistido verbatim; esta fatia exibe o corpo verbatim e ignora o array `mentions` |
| Marcador de comentário desenhado sobre o canvas (pin) | Exige API nova no `EditorSurface` (posicionar overlay por elemento); a lista lateral entrega a capacidade sem tocar no adapter |
| Selecionar o elemento no canvas ao clicar num comentário ancorado | Mesmo motivo: exigiria API imperativa nova no `EditorSurface`; a âncora é exibida como texto |
| Notificação de menção na UI | O servidor já dispara o webhook `comment.mentioned` (EXT-02); notificação in-app é outra capacidade |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Como o painel de comentários convive com o `AiDock`, já docado como irmão da coluna do canvas? | Uma única coluna lateral com `role="tablist"` e duas abas ("IA" e "Comentários"); só um painel visível por vez, o inativo fica com o atributo `hidden`. Componente novo `EditorSidePanel`, slot-based (recebe os dois painéis prontos como props) | Dois painéis docados simultâneos comem largura demais do canvas, que é o objeto do produto. Abas resolvem isso sem esconder nenhuma das duas capacidades. Manter os dois painéis **montados** (e apenas `hidden`) é deliberado: desmontar o `AiDock` ao trocar de aba jogaria fora um run em `awaiting_approval`, que é estado efêmero e não recuperável. `hidden` também tira o painel inativo da árvore de acessibilidade, então nenhuma query por papel encontra dois botões de enviar | y |
| Qual aba abre por padrão? | `IA` quando o bootstrap reporta `mutatePermissions.allowed: true`; `Comentários` quando reporta `false` (e nesse caso a aba "IA" nem existe) | Preserva o comportamento atual para quem edita, e dá ao `reviewer`/`viewer` a única aba que ele pode usar, já aberta. É a prova de produto do "revisor comenta e nunca edita" | y |
| Reusar `resourceClient`/`resourceListStore` genéricos? | Não — cliente dedicado `commentClient.ts`, no molde de `memberClient.ts` | Comentário não tem `rename` nem `archive`/`delete`, e as respostas são `{comment, mentions}` e `{comments:[...]}`, não a forma genérica de item embrulhado numa chave. Só o estilo (injeção de `fetchImpl`, uma união de status por método, chamada literal `fetchImpl(...)`) é copiado — literal porque o extrator de inventário de `repo-tools` (`webConsumers.ts`) só reconhece `fetch(`/`fetchImpl(` escritos assim; um wrapper local com outro nome sumiria do inventário | y |
| Como o painel monta as threads, se `GET` devolve lista flat com `parentId`? | Módulo puro `commentThreads.ts`: cada comentário com `parentId: null` vira raiz; todo comentário cuja cadeia de `parentId` chega a uma raiz é agrupado nela, preservando a ordem do `GET` (o servidor devolve mais antigo primeiro) | Reconstrução de árvore é lógica pura e testável sem DOM, e mantém o componente concentrado em render. Agrupar (em vez de aninhar em profundidade arbitrária) evita render recursivo sem limite para uma cadeia de `parentId` que o servidor não limita | y |
| Responder: em que comentário a resposta ancora? | Sempre na **raiz** da thread — `parentId` é o id da raiz, nunca o id de uma resposta | O servidor não limita profundidade; ancorar sempre na raiz mantém toda thread com exatamente dois níveis, previsível de exibir e de testar. Uma thread mais profunda criada por outro cliente continua sendo exibida por inteiro (o agrupamento sobe a cadeia até a raiz) | y |
| Seleção do canvas → âncora: e quando há 0 ou vários elementos selecionados? | 0 selecionados: comentário geral, `POST` sem `elementId`. Exatamente 1: âncora naquele id. Mais de 1: `POST` sem `elementId` e um aviso explícito de que não será ancorado | `elementId` é uma coluna escalar: ancorar "no primeiro" de uma multi-seleção seria arbitrário, porque a ordem de `onSelectionChange` não carrega intenção nenhuma. Ancorar errado em silêncio é pior que não ancorar avisando | y |
| O que acontece com um comentário cuja âncora não existe mais na cena? | É exibido assim mesmo, marcado como âncora removida, nunca escondido nem filtrado | As colunas de âncora não são FK e não têm cascade: comentário órfão é um estado normal, não corrupção. Esconder perderia conteúdo de revisão | y |
| Qual conjunto de ids conta como "cena atual" para essa checagem? | Os ids da cena que o `bootstrap` desta sessão de editor carregou (`initialElements`), repassados ao painel | É o único conjunto que `DiagramEditorPage` já tem em mão sem plumbing novo com o `EditorSurface`. Consequência aceita e documentada: um elemento apagado nesta sessão só passa a contar como "âncora removida" no próximo carregamento | y |
| Comentário resolvido continua na lista? | Threads com raiz `resolved` ficam ocultas por padrão; um controle "mostrar resolvidas" exibe todas | Sem filtro, a lista só cresce e vira ruído. O padrão oculto favorece o caso comum (o que ainda precisa de atenção) sem apagar nada | y |
| O filtro olha o status de qual comentário da thread? | Só o da raiz | `status` é por comentário, mas a unidade de revisão é a thread. Uma regra derivada ("oculta quando todos estão resolvidos") seria mais difícil de explicar e de prever | y |
| Como outro usuário vê um comentário novo? | Só depois de recarregar o editor ou acionar o controle "atualizar" do painel, que reemite o `GET` | Limitação aceita, não lacuna a corrigir em silêncio: esta fatia é REST puro e comentário sobre WebSocket não está no escopo nem de R9 nem de R10. O botão de atualizar é o que torna a limitação vivível | y |
| Onde vive o código novo? | `apps/web/src/comments/` (cliente, agrupamento de threads, painel), no molde de `apps/web/src/ai-dock/`; `EditorSidePanel` fica em `apps/web/src/diagram/` porque é chrome do editor, não do domínio de comentário | Segue a convenção de pasta por capacidade já usada por `ai-dock` e `nav` | y |
| Chave de i18n | Novo bloco de topo `comments` em `en` e `pt-BR` | `aiDock` já é bloco de topo por capacidade; `nav` agrupa só as telas de navegação. Comentário é capacidade própria | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Ler os comentários do diagrama ⭐ MVP

**User Story**: Como pessoa com acesso a um diagrama, quero ver os comentários já feitos nele, para
entender o que está em revisão antes de agir.

**Why P1**: Sem leitura não há revisão, e é a base sobre a qual comentar, responder e resolver
operam.

**Acceptance Criteria**:

1. The coluna lateral do editor SHALL exibir exatamente um painel por vez, escolhido por um `role="tablist"` com as abas "IA" e "Comentários".
2. WHERE o bootstrap reportar `mutatePermissions.allowed: false`, o tablist SHALL omitir a aba "IA".
3. WHERE o bootstrap reportar `mutatePermissions.allowed: false`, o painel de comentários SHALL ser o painel ativo inicial.
4. WHERE o bootstrap reportar `mutatePermissions.allowed: true`, a aba "IA" SHALL ser a aba ativa inicial.
5. WHEN o painel de comentários montar THEN ele SHALL emitir `GET /diagrams/:id/comments` uma única vez e exibir as threads devolvidas.
6. The painel SHALL agrupar os comentários em threads: todo comentário com `parentId` nulo é raiz, e todo comentário cuja cadeia de `parentId` alcança essa raiz SHALL ser exibido dentro dela, na ordem em que o `GET` os devolveu.
7. WHILE o `GET` inicial estiver em andamento, o painel SHALL exibir a mensagem de carregando.
8. IF o `GET /diagrams/:id/comments` responder qualquer status diferente de `200` THEN o painel SHALL exibir a mensagem de erro genérica e manter a lista vazia.
9. WHERE um comentário tem `elementId` presente entre os ids da cena carregada, o painel SHALL exibir esse `elementId` como âncora da thread.
10. IF um comentário tem `elementId` que não corresponde a nenhum id da cena carregada THEN o painel SHALL exibi-lo assim mesmo, marcado como âncora removida, nunca ocultando o comentário.

**Independent Test**: Abrir o editor como `viewer` (bootstrap com `mutatePermissions.allowed:
false`), confirmar que a aba "IA" não existe, que a aba "Comentários" está ativa e que as threads
do `GET` aparecem agrupadas.

---

### P1: Comentar ancorando na seleção ⭐ MVP

**User Story**: Como revisor, quero comentar apontando para o elemento que estou olhando, para que
a observação não fique solta no diagrama inteiro.

**Why P1**: É a ação que destrava o papel `reviewer` — hoje ele não tem nenhuma ação possível no
editor.

**Acceptance Criteria**:

1. The campo de novo comentário SHALL estar disponível para qualquer papel, inclusive quando o bootstrap reportar `mutatePermissions.allowed: false`.
2. IF o corpo do novo comentário estiver vazio ou contiver só espaços THEN o controle de enviar SHALL ficar desabilitado.
3. WHEN exatamente um elemento estiver selecionado no canvas e o usuário enviar THEN o painel SHALL emitir `POST /diagrams/:id/comments` com `elementId` igual ao id selecionado.
4. IF nenhum elemento estiver selecionado THEN o `POST` SHALL ser emitido sem o campo `elementId`.
5. IF mais de um elemento estiver selecionado THEN o `POST` SHALL ser emitido sem o campo `elementId` e o painel SHALL exibir o aviso de que o comentário não será ancorado.
6. WHEN o `POST` responder `201` THEN o painel SHALL acrescentar à lista o comentário devolvido na resposta, limpar o campo e não emitir nenhum `GET` adicional.
7. IF o `POST` responder `404` THEN o painel SHALL exibir a mensagem de "não existe ou sem acesso" (mesma convenção IDOR de `workspace-navigation`) e não acrescentar nada à lista.
8. IF o `POST` responder qualquer outro status de falha THEN o painel SHALL exibir a mensagem de erro genérica e não acrescentar nada à lista.
9. WHILE um envio estiver em andamento, um segundo envio SHALL não emitir uma segunda requisição.

**Independent Test**: Com um elemento selecionado, enviar um comentário e confirmar que o corpo do
`POST` carrega esse `elementId`; repetir sem seleção e confirmar que a chave `elementId` está
ausente do corpo.

---

### P1: Resolver e reabrir uma thread ⭐ MVP

**User Story**: Como pessoa de qualquer papel no workspace, quero marcar uma thread como resolvida
(e voltar atrás), para separar o que já foi tratado do que ainda precisa de atenção.

**Why P1**: Sem resolver, a lista de revisão nunca fecha. `comment:resolve` é concedido aos 5
papéis, então é ação universal.

**Acceptance Criteria**:

1. The ação de resolver SHALL aparecer em toda thread aberta, para qualquer papel.
2. WHEN o usuário resolver uma thread THEN o painel SHALL emitir `PATCH /diagrams/:id/comments/:commentId` no comentário raiz com `{status: 'resolved'}` e refletir o novo status somente após a resposta `200`, nunca antes.
3. WHILE a raiz de uma thread estiver `resolved`, o painel SHALL oferecer reabrir, emitindo o mesmo `PATCH` com `{status: 'open'}`.
4. IF o `PATCH` responder qualquer status diferente de `200` THEN o painel SHALL informar a falha e manter o status anterior da thread.

**Independent Test**: Resolver uma thread com o servidor respondendo `403` e confirmar que ela
continua aberta na lista, com a falha informada.

---

### P2: Responder dentro da thread

**User Story**: Como autor do diagrama, quero responder a um comentário, para que a conversa de
revisão fique junto do ponto comentado.

**Why P2**: Revisão funciona sem resposta (comentar e resolver já fecham o ciclo), mas responder é
o que a torna conversa em vez de mural.

**Acceptance Criteria**:

1. The ação de responder SHALL aparecer em toda thread exibida.
2. WHEN o usuário enviar uma resposta THEN o painel SHALL emitir `POST /diagrams/:id/comments` com `parentId` igual ao id da raiz da thread, nunca o id de uma resposta.
3. WHEN o `POST` da resposta responder `201` THEN a resposta SHALL aparecer dentro da própria thread, depois dos comentários já exibidos nela.

**Independent Test**: Responder a uma thread que já tem uma resposta e confirmar que o `parentId`
enviado é o id da raiz, não o da resposta existente.

---

### P2: Filtrar resolvidas e atualizar a lista

**User Story**: Como revisor, quero focar no que ainda está aberto e puxar o que mudou, para não
trabalhar sobre uma lista velha nem sobre ruído já resolvido.

**Why P2**: É o que torna a ausência de tempo real vivível e a lista utilizável depois de algumas
semanas de uso.

**Acceptance Criteria**:

1. The painel SHALL ocultar por padrão as threads cuja raiz está `resolved`.
2. WHEN o usuário acionar "mostrar resolvidas" THEN o painel SHALL exibir todas as threads, resolvidas inclusive.
3. WHEN o usuário acionar "atualizar" THEN o painel SHALL reemitir `GET /diagrams/:id/comments` e substituir a lista pelo conteúdo da resposta.

**Independent Test**: Com uma thread aberta e uma resolvida no `GET`, confirmar que só a aberta
aparece; acionar "mostrar resolvidas" e confirmar que as duas aparecem.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero comentar e resolver sem
mouse.

**Why P2**: Mesmo padrão já estabelecido pelas quatro fatias anteriores desta frente.

**Acceptance Criteria**:

1. The toda ação desta spec (trocar de aba, comentar, responder, resolver, reabrir, filtrar, atualizar) SHALL ser alcançável só por teclado.
2. WHEN criar, responder, resolver ou reabrir terminar, com sucesso ou falha, THEN o painel SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível SHALL vir de chaves de i18n presentes nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Percorrer aba → campo de comentário → enviar → resolver usando só
Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF o `GET` devolver um comentário cujo `parentId` aponta para um comentário ausente da resposta THEN o painel SHALL tratá-lo como raiz de thread própria, nunca descartá-lo.
- IF a seleção do canvas mudar enquanto o campo de novo comentário já tem texto THEN o texto SHALL ser preservado e apenas a âncora pendente SHALL mudar.
- IF o corpo do comentário contiver uma menção `@` que o servidor não resolve THEN o painel SHALL exibir o corpo verbatim, sem sinalizar erro (o servidor persiste o corpo verbatim e devolve `mentions` sem aquele token).
- WHEN o diagrama não tiver nenhum comentário THEN o painel SHALL exibir o estado vazio, não uma lista em branco sem explicação.
- WHILE o painel de comentários estiver inativo (outra aba selecionada), ele SHALL permanecer montado e fora da árvore de acessibilidade, preservando o texto já digitado no campo.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CMT2-01 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-02 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-03 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-04 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-05 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-06 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-07 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-08 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-09 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-10 | P1: Ler comentários | R9 | ✅ Verified |
| CMT2-11 | P1: Comentar | R9 | ✅ Verified |
| CMT2-12 | P1: Comentar | R9 | ✅ Verified |
| CMT2-13 | P1: Comentar | R9 | ✅ Verified |
| CMT2-14 | P1: Comentar | R9 | ✅ Verified |
| CMT2-15 | P1: Comentar | R9 | ✅ Verified |
| CMT2-16 | P1: Comentar | R9 | ✅ Verified |
| CMT2-17 | P1: Comentar | R9 | ✅ Verified |
| CMT2-18 | P1: Comentar | R9 | ✅ Verified |
| CMT2-19 | P1: Comentar | R9 | ✅ Verified |
| CMT2-20 | P1: Resolver e reabrir | R9 | ✅ Verified |
| CMT2-21 | P1: Resolver e reabrir | R9 | ✅ Verified |
| CMT2-22 | P1: Resolver e reabrir | R9 | ✅ Verified |
| CMT2-23 | P1: Resolver e reabrir | R9 | ✅ Verified |
| CMT2-24 | P2: Responder | R9 | ✅ Verified |
| CMT2-25 | P2: Responder | R9 | ✅ Verified |
| CMT2-26 | P2: Responder | R9 | ✅ Verified |
| CMT2-27 | P2: Filtrar e atualizar | R9 | ✅ Verified |
| CMT2-28 | P2: Filtrar e atualizar | R9 | ✅ Verified |
| CMT2-29 | P2: Filtrar e atualizar | R9 | ✅ Verified |
| CMT2-30 | P2: Teclado e idioma | R9 | ✅ Verified |
| CMT2-31 | P2: Teclado e idioma | R9 | ✅ Verified |
| CMT2-32 | P2: Teclado e idioma | R9 | ✅ Verified |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo é `CMT2` porque `CMT` já está tomado: `CMT-01`/`CMT-02` são os requisitos de **backend**
de comentário, em `.specs/features/architecture-canvas/spec.md`, verificados na onda F3. Esta spec
é a superfície de produto sobre aquele backend, e precisa de um prefixo próprio para não colidir
na rastreabilidade. Prefixos já em uso no repo: A11Y, AAC, AGT, AIC, AIE, AIG, API, AUTH, CIQ, CLB,
CMT, DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, MEM, NAV, OBS, OIDC, OPS, PERF, PRS,
REC, SEC, SSO, TRU, UIX, VER.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

Todas as 8 tasks estão fechadas. O Verifier independente (autor ≠ verificador) rodou em 2026-08-17 e
virou os 32 requisitos para `Verified`: 32/32 acceptance criteria com evidência `file:line`, gate
`make lint && make typecheck && make test-unit` verde, e 6/6 mutações do sensor de discriminação
mortas. Relatório completo em `.specs/features/diagram-comments/validation.md`.

**Coverage:** 32 requisitos, mapeados 1:1 às 32 acceptance criteria das seis histórias.

**Numeração por história:** CMT2-01..10 (ler), CMT2-11..19 (comentar), CMT2-20..23 (resolver e
reabrir), CMT2-24..26 (responder), CMT2-27..29 (filtrar e atualizar), CMT2-30..32 (teclado e
idioma).

---

## Rotas consumidas

| Rota | Uso | Mudança nesta spec |
| --- | --- | --- |
| `GET /diagrams/:id/comments` | listar as threads do diagrama | Nenhuma |
| `POST /diagrams/:id/comments` | criar comentário e resposta | Nenhuma |
| `PATCH /diagrams/:id/comments/:commentId` | resolver e reabrir (`{status}`) | Nenhuma |

As três rotas são exatamente as que o roadmap listou para R9. Nenhuma mudança de servidor é
necessária nesta fatia: o backend está completo e verificado desde F3. `PATCH` também aceita
`body` (edição pelo próprio autor), campo que esta spec deliberadamente não usa (ver Out of Scope).

---

## Success Criteria

- [ ] Um `reviewer` (bootstrap com `mutatePermissions.allowed: false`) abre o editor e comenta,
      sem que nenhuma ação de mutação de canvas fique disponível para ele.
- [ ] Um comentário criado com exatamente um elemento selecionado chega ao servidor com aquele
      `elementId` — provado por asserção sobre o corpo do `POST`, não pela tela.
- [ ] Um comentário cuja âncora não existe mais continua visível e identificável — provado por
      teste que falha se a âncora órfã for filtrada.
- [ ] `repo-tools audit` passa a classificar as 3 rotas de comentário como `consumed`.
- [ ] O fluxo inteiro (trocar de aba, comentar, responder, resolver) é percorrível só com teclado,
      nos dois locales, com zero violações sérias/críticas no axe.
