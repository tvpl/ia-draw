# Dock de IA — Especificação

Primeira fatia vertical do roadmap de produto (entrada R1 de `.specs/features/platform-maturity/ui-roadmap.md`). Entrega, dentro do editor, o fluxo que o backend já implementa e que hoje só é alcançável por chamada de API: pedido em linguagem natural, prévia do que vai mudar, aprovação explícita e undo real.

## Problem Statement

O `ai-engine` está implementado e verificado: `POST /diagrams/{id}/ai/runs` monta o contexto, chama o provider, valida as ferramentas, computa o patch e devolve uma prévia com o diff estrutural, tudo sem tocar no canvas; `POST /ai/runs/{runId}:approve` aplica o patch atomicamente depois de gravar um snapshot `pre_ai`; `POST /ai/runs/{runId}:cancel` descarta. Os requisitos AIG-01..07 e AIE-01..05 de `architecture-canvas` estão verificados por Verifier independente.

Nada disso tem interface. `apps/web/src` tem 5 componentes e nenhum deles menciona IA. O mapa de capacidades marca `Geração de diagramas por IA a partir de linguagem natural` e `Edição por IA com prévia, aprovação explícita e undo` como `backend-only`, e o inventário mostra as duas rotas do `ai-engine` na lista `pending-product`. O resultado é que o diferencial anunciado no herói da landing é, na prática, inacessível: só quem monta a requisição HTTP na mão chega nele.

Esta spec fecha essa distância para uma capacidade só, e serve de exemplar de formato para as outras quinze entradas do roadmap.

## Goals

- [ ] Um usuário com permissão de mutação descreve o que quer em português ou inglês e recebe uma proposta, sem sair do editor.
- [ ] Nenhuma operação proposta pela IA chega ao canvas sem um clique explícito de aprovação.
- [ ] O usuário desfaz a última aplicação e volta ao estado anterior, com o snapshot `pre_ai` que o servidor já grava.
- [ ] O dock inteiro é operável por teclado e anuncia mudança de estado para leitor de tela.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| ------- | ------ |
| Tela de configuração do provider de IA | É a entrada R15 do roadmap; enquanto ela não existe, o provider é configurado fora do produto e o dock apenas reporta a ausência |
| Histórico de conversa, múltiplos turnos, streaming de tokens | A rota é síncrona por construção: um `POST` cria, executa e devolve a prévia na mesma resposta; conversa multi-turno é produto novo, não fatia desta |
| Linha do tempo de snapshots, comparação de revisões e restore arbitrário | É a entrada R6 do roadmap; aqui o restore é usado só para o snapshot `pre_ai` do run recém-aprovado |
| Seletor de biblioteca de componentes e painel de metadados | É a entrada R5; a IA já resolve componentes pela biblioteca do lado do servidor |
| Mudança em qualquer rota, schema ou comportamento do `ai-engine` | O backend está verificado; esta fatia é frontend sobre contrato existente |
| Edição por IA a partir de outro cliente (MCP, CLI) | Onda F9, spec própria |

---

## Assumptions & Open Questions

Toda ambiguidade está resolvida ou registrada aqui — nada fica silenciosamente indefinido.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Onde o dock vive na tela? | Painel lateral direito dentro de `DiagramEditorPage`, recolhível, sem rota própria | O fluxo é sempre sobre um diagrama aberto; uma rota separada perderia o canvas, que é justamente onde a prévia precisa ser lida | y |
| O dock aplica sozinho quando `requiresExplicitApproval` for `false`? | Não. Toda aplicação passa por clique, sempre | O limiar do servidor decide o que é sensível; o produto decide que nada da IA entra no canvas sem consentimento. Duas travas independentes valem mais que uma | y |
| Os motivos do limiar (`removal`, `element_count`, `outside_selection`) aparecem na tela? | Não nesta fatia. A resposta de `POST /diagrams/{id}/ai/runs` devolve `requiresExplicitApproval` mas não devolve `reasons` | Expor os motivos é mudança no payload do servidor, que esta fatia não toca. O dock exibe o aviso de mudança sensível sem detalhá-lo, e a exposição dos motivos entra como escopo de R15 | y |
| Undo consome uma rota atribuída a outra entrada do roadmap? | Sim: `POST /diagrams/{id}/snapshots/{snapshotId}:restore`, que o índice atribui a R6 | A atribuição do roadmap é de dono primário, para a soma de rotas fechar, não de exclusividade. Sem essa chamada não existe undo real, e undo real é requisito desta fatia | y |
| O run sobrevive a recarregar a página? | Não. O patch pendente vive em `RunStore`, que é memória do processo; só a linha do run está em Postgres | É o comportamento real do servidor hoje. Fingir persistência produziria uma tela que promete aprovar algo que já não existe | y |
| Que idioma é enviado ao provider? | O locale ativo do i18n do shell (`pt-BR` ou `en`), no campo `language` | O shell já tem os dois locales e um seletor; reaproveitar evita uma segunda fonte de verdade de idioma | y |
| A seleção do canvas entra no pedido? | Sim, os ids selecionados vão em `selection`; sem seleção o campo é omitido | É o que liga a regra `outside_selection` do servidor ao que o usuário enxerga. Enviar array vazio desligaria a regra silenciosamente | y |
| O dock aparece para papel sem permissão de mutação? | Não é renderizado para quem não tem `diagram:mutate` | A rota devolveria 403; oferecer um campo que sempre falha é pior que não oferecer | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Pedir uma mudança em linguagem natural

**User Story**: Como pessoa desenhando uma arquitetura, quero descrever o que preciso em texto dentro do editor, para não montar à mão o que a IA monta melhor.

**Why P1**: É a entrada do fluxo. Sem ela, nada do que o `ai-engine` faz é alcançável pelo produto.

**Acceptance Criteria**:
1. WHEN o usuário abrir um diagrama com papel que concede `diagram:mutate` THEN o editor SHALL renderizar o dock de IA como painel lateral recolhível, com o campo de pedido presente no DOM e alcançável por teclado.
2. IF o papel do usuário não conceder `diagram:mutate` THEN o editor SHALL não renderizar o dock, nem em estado desabilitado.
3. WHEN o usuário enviar um pedido com pelo menos 1 caractere THEN o dock SHALL emitir `POST /diagrams/{id}/ai/runs` com `userRequest` igual ao texto digitado, `language` igual ao locale ativo do i18n, e `selection` igual aos ids selecionados no canvas — omitindo `selection` quando não houver nenhum elemento selecionado.
4. WHILE um run estiver em andamento, o dock SHALL manter o botão de envio desabilitado e exibir o status corrente do run, sem impedir a edição manual do canvas.
5. IF a resposta for HTTP 429 THEN o dock SHALL informar que o limite de 20 pedidos por minuto foi atingido, preservar o texto digitado e reabilitar o envio após 60 segundos.

**Independent Test**: Com uma seleção de 2 elementos no canvas, enviar um pedido e confirmar na requisição que `selection` traz exatamente esses 2 ids e `language` traz o locale ativo.

---

### P1: Ver o que vai mudar antes de qualquer coisa mudar

**User Story**: Como pessoa responsável pelo diagrama, quero ver exatamente o que a proposta altera, para decidir com base no que vai acontecer e não na descrição do que deveria acontecer.

**Why P1**: É o que separa "a IA mexeu no meu diagrama" de "eu aprovei uma mudança". Sem prévia legível, a aprovação vira um clique cego.

**Acceptance Criteria**:
1. WHEN a resposta 201 trouxer `preview` THEN o dock SHALL exibir as quatro listas do diff estrutural — `added`, `removed`, `moved`, `modified` — cada uma com a contagem de elementos, mais a lista `metadataChanged`.
2. The dock SHALL exibir a lista `removed` antes das outras três sempre que ela tiver ao menos 1 elemento.
3. The dock SHALL manter o canvas, a revisão do diagrama e a fila local de mutação inalterados enquanto o run estiver em `awaiting_approval`.
4. WHEN a resposta 201 vier sem o campo `preview`, o que indica run encerrado antes de `previewing`, THEN o dock SHALL exibir o `errorCode` do run e não oferecer a ação de aprovar.
5. IF o run terminar com status `failed` THEN o dock SHALL exibir o `errorCode` devolvido pelo servidor, sem traduzi-lo para uma mensagem genérica que perca o código.

**Independent Test**: Rodar um pedido que remove 1 elemento e cria 3, e confirmar que a tela mostra `removed: 1` antes de `added: 3` e que a revisão do diagrama não mudou.

---

### P1: Aprovar explicitamente, ou descartar

**User Story**: Como pessoa responsável pelo diagrama, quero que nada seja aplicado sem eu mandar, para que a IA nunca escreva no canvas por conta própria.

**Why P1**: É o invariante de produto declarado na landing e no README. Uma aplicação silenciosa quebra a promessa inteira.

**Acceptance Criteria**:
1. The dock SHALL oferecer exatamente duas ações terminais para um run em `awaiting_approval`: aprovar e descartar.
2. The dock SHALL exigir clique de aprovação em todo run, inclusive quando `requiresExplicitApproval` for `false`.
3. WHEN o usuário aprovar THEN o dock SHALL emitir `POST /ai/runs/{runId}:approve` e refletir a mudança no canvas somente depois da resposta HTTP 200.
4. WHEN o usuário descartar THEN o dock SHALL emitir `POST /ai/runs/{runId}:cancel` e o diagrama SHALL permanecer na revisão anterior ao run.
5. IF a aprovação responder HTTP 409, que é a revisão fonte desatualizada THEN o dock SHALL descartar a prévia, informar que o diagrama mudou desde o pedido e reoferecer o mesmo texto para um pedido novo, nunca aplicando o patch.
6. WHERE `requiresExplicitApproval` vier `true`, o dock SHALL marcar a proposta como mudança sensível junto ao botão de aprovar.

**Independent Test**: Alterar o diagrama por outra aba entre o pedido e a aprovação, aprovar, e confirmar que a resposta é 409 e que o canvas continua com o conteúdo da outra aba, sem nenhuma operação do patch.

---

### P1: Desfazer a última aplicação

**User Story**: Como pessoa que acabou de aprovar uma mudança grande, quero um desfazer que volte ao estado exato de antes, para aprovar sem medo.

**Why P1**: O `pre_ai` já é gravado a cada aprovação. Sem o botão, o snapshot existe e ninguém alcança.

**Acceptance Criteria**:
1. WHEN a aprovação responder HTTP 200 THEN o dock SHALL guardar o `snapshot.id` devolvido e exibir a ação Desfazer.
2. WHEN o usuário acionar Desfazer THEN o dock SHALL emitir `POST /diagrams/{id}/snapshots/{snapshotId}:restore` com o `snapshot.id` do run aprovado, e o canvas SHALL voltar ao conteúdo anterior à aplicação, como revisão nova.
3. IF o restore responder qualquer status diferente de 200 THEN o dock SHALL manter a ação Desfazer disponível e nunca reportar sucesso.
4. The dock SHALL oferecer Desfazer apenas para o run aplicado mais recentemente na sessão corrente do editor.

**Independent Test**: Aprovar um patch que altera 3 elementos, desfazer, e confirmar por `GET /diagrams/{id}/bootstrap` que os 3 elementos voltaram ao conteúdo anterior e que a revisão é maior que a da aplicação, e não menor.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero operar o dock inteiro sem mouse, para ter o mesmo acesso ao diferencial do produto.

**Why P2**: Não bloqueia o valor do fluxo, mas o repositório já tem A11Y-01 verificado no shell e regredir nisso seria contradição direta.

**Acceptance Criteria**:
1. The dock SHALL ser operável somente por teclado em todas as suas ações: abrir, focar o campo, enviar, aprovar, descartar e desfazer.
2. WHEN o status do run mudar THEN o dock SHALL anunciar o novo status em uma região `aria-live="polite"`.
3. The dock SHALL obter todo texto visível das chaves de i18n existentes, nos locales `pt-BR` e `en`, sem literal de texto no componente.

**Independent Test**: Percorrer o fluxo inteiro — pedir, ler a prévia, aprovar, desfazer — usando apenas Tab, Shift+Tab e Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF o dock montar com um run em `awaiting_approval` cujo patch não existe mais no servidor, o que acontece depois de reinício do processo THEN o dock SHALL tratar o run como expirado e pedir um pedido novo, nunca oferecer aprovar.
- IF nenhum provider de IA estiver configurado THEN o dock SHALL exibir que a configuração está ausente e que ela é feita fora do produto hoje, sem oferecer um caminho que não existe.
- WHEN a seleção do canvas mudar entre o pedido e a aprovação THEN a aprovação SHALL usar o patch computado no pedido, sem reavaliar a seleção.
- IF o usuário enviar um pedido com o campo vazio ou só espaços THEN o dock SHALL não emitir requisição nenhuma.
- IF a conexão cair durante o run THEN o dock SHALL exibir a falha de rede e manter o texto do pedido, sem deixar o botão de envio desabilitado para sempre.
- WHEN a prévia listar mais de 50 elementos tocados THEN o dock SHALL exibir a contagem total e limitar a lista visível a 50 itens, com o restante alcançável por rolagem.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| DOCK-01 | P1: Pedido em linguagem natural | F10 | Pending |
| DOCK-02 | P1: Pedido em linguagem natural | F10 | Pending |
| DOCK-03 | P1: Pedido em linguagem natural | F10 | Pending |
| DOCK-04 | P1: Pedido em linguagem natural | F10 | Pending |
| DOCK-05 | P1: Pedido em linguagem natural | F10 | Pending |
| DOCK-06 | P1: Prévia antes de aplicar | F10 | Pending |
| DOCK-07 | P1: Prévia antes de aplicar | F10 | Pending |
| DOCK-08 | P1: Prévia antes de aplicar | F10 | Pending |
| DOCK-09 | P1: Prévia antes de aplicar | F10 | Pending |
| DOCK-10 | P1: Prévia antes de aplicar | F10 | Pending |
| DOCK-11 | P1: Aprovação explícita | F10 | Pending |
| DOCK-12 | P1: Aprovação explícita | F10 | Pending |
| DOCK-13 | P1: Aprovação explícita | F10 | Pending |
| DOCK-14 | P1: Aprovação explícita | F10 | Pending |
| DOCK-15 | P1: Aprovação explícita | F10 | Pending |
| DOCK-16 | P1: Aprovação explícita | F10 | Pending |
| DOCK-17 | P1: Desfazer a última aplicação | F10 | Pending |
| DOCK-18 | P1: Desfazer a última aplicação | F10 | Pending |
| DOCK-19 | P1: Desfazer a última aplicação | F10 | Pending |
| DOCK-20 | P1: Desfazer a última aplicação | F10 | Pending |
| DOCK-21 | P2: Teclado e idioma | F10 | Pending |
| DOCK-22 | P2: Teclado e idioma | F10 | Pending |
| DOCK-23 | P2: Teclado e idioma | F10 | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `DOCK` não colide com nenhum já usado no repositório: A11Y, AAC, AIC, AIE, AIG, API, AUTH, CIQ, CLB, CMT, DOC, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, OBS, OIDC, OPS, PERF, PRS, REC, SEC, TRU, UIX, VER.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 23 requisitos, mapeados 1:1 às 23 acceptance criteria das cinco histórias. Nenhum mapeado a task ainda — o breakdown é a rodada de Tasks desta feature.

**Numeração por história:** DOCK-01..05 (pedido), DOCK-06..10 (prévia), DOCK-11..16 (aprovação), DOCK-17..20 (undo), DOCK-21..23 (teclado e idioma).

---

## Rotas consumidas

Todas já registradas e verificadas. Esta spec não altera nenhuma.

| Rota | Uso | Origem |
| ---- | --- | ------ |
| `POST /diagrams/{id}/ai/runs` | cria o run e devolve `run`, `patch`, `preview`, `requiresExplicitApproval`, `toolCallCount` | `apps/server/src/modules/ai-engine/routes.ts` |
| `POST /ai/runs/{runId}:approve` | aplica o patch e devolve `run`, `snapshot`, `batch` | `apps/server/src/modules/ai-engine/routes.ts` |
| `POST /ai/runs/{runId}:cancel` | descarta o run sem aplicar nada | `apps/server/src/modules/ai-engine/routes.ts` |
| `POST /diagrams/{id}/snapshots/{snapshotId}:restore` | undo do run aprovado, restaurando o snapshot `pre_ai` | `apps/server/src/modules/snapshot/routes.ts` |

As três primeiras estão em `pending-product` no inventário e são as duas rotas do `ai-engine` (`:approve` e `:cancel` compartilham o mesmo registro `POST /ai/runs/:runRef`). A quarta é atribuída a R6 no roadmap por dono primário; aqui ela é usada só para o snapshot do próprio run.

---

## Success Criteria

- [ ] Um usuário com papel de edição descreve uma mudança, lê a prévia e aprova sem sair do editor, e o canvas passa a refletir o patch.
- [ ] Nenhum caminho da interface aplica um patch de IA sem clique de aprovação, provado por teste que falha se a aplicação automática for reintroduzida.
- [ ] Desfazer devolve o diagrama ao conteúdo anterior à aplicação, verificado pelo bootstrap e não pela tela.
- [ ] `repo-tools audit` deixa de classificar as duas rotas do `ai-engine` como `pending-product`, e as duas capacidades de IA saem de `backend-only` no mapa de capacidades.
- [ ] O fluxo inteiro é percorrível só com teclado, nos dois locales.
