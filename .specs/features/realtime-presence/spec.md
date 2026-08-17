# Presença em tempo real no editor — Especificação

Décima fatia vertical do roadmap de produto (entrada R10 de
`.specs/features/platform-maturity/ui-roadmap.md`). Primeiro transporte em tempo real do
`apps/web`: conexão WebSocket a partir do editor, cursores e seleção remota, e reconexão com
catch-up pelo caminho REST que `syncClient.ts` já implementa.

## Problem Statement

O backend de colaboração em tempo real está implementado e verificado desde F4 (`ws-gateway`,
CLB-01..04): ticket de uso único (`POST /diagrams/:id/ws-ticket`), upgrade autenticado
(`GET /ws/diagrams/:diagramId?ticket=`), protocolo de mensagens completo
(`packages/shared-contracts/src/ws-envelope.ts` + `ws-messages.ts`) e um `PresenceBroadcaster`
injetável (AD-009). Nada disso tem consumidor: `docs/capability-map.yaml` marca a capacidade
"Colaboração em tempo real e presença" como `backend-only`, e não existe uma única linha de
`apps/web/src` que abra um WebSocket.

Uma lacuna real do backend, confirmada em código durante a pesquisa desta spec, torna a feature
literalmente inconstruível como está: `apps/server/src/modules/ws-gateway/routes.ts`'s
`handlePresenceEvent` recebe o evento interno de presença (que **já carrega** `senderId`) e o
retransmite para os outros clientes **removendo o `senderId` antes do `send()`** — repassa só
`{cursor, selection, status}`. Um cliente que recebe uma mensagem `presence` hoje não tem como
saber de quem é aquele cursor, então não consegue renderizar nome nem cor estável por pessoa.
Decidido com o usuário antes do Specify: esta spec estende o protocolo de wire para carregar a
identidade do remetente na retransmissão.

Uma segunda lacuna, também pré-existente e não relacionada a nenhuma onda anterior:
`apps/web/src/sync/syncClient.ts`'s `catchUp()` existe desde F4 e **não tem nenhum caller** em
`apps/web/src`. O resultado do seu `onReconcile` nunca chega ao canvas. Fechar esse laço faz
parte desta fatia — é exatamente o que "reconexão com catch-up" significa no roadmap.

## Goals

- [ ] Duas pessoas com o mesmo diagrama aberto veem o cursor e a seleção uma da outra, cada uma
      com nome e cor estável.
- [ ] O cliente que recebe uma mensagem `presence` sabe de quem ela é.
- [ ] Uma queda de conexão se recupera sozinha, e o canvas converge para o estado do servidor sem
      descartar a edição local ainda não sincronizada.
- [ ] O estado da conexão é visível e anunciado para leitor de tela.

## Out of Scope

Explicitamente excluído. Documentado para evitar scope creep.

| Feature | Reason |
| ------- | ------ |
| Difusão ao vivo de mudança de conteúdo da cena (coedição simultânea) | Decisão de produto AD-002 ("coedição simultânea chega meses depois; até lá, edição concorrente resolve por op-log + reconexão, sem cursores ao vivo" — esta fatia entrega os cursores, não a coedição). O servidor **já filtra** `mutation_broadcast` deliberadamente do relay (`routes.ts`'s `handlePresenceEvent` só repassa `presence_update`); nenhuma AC desta spec muda esse filtro |
| Lista/roster de "quem está aqui agora" | Não existe mensagem de protocolo que anuncie os já-conectados a quem chega depois; inventar uma vai muito além do conserto de `senderId` decidido com o usuário. Ver Edge Cases — a limitação é disclosed, não resolvida |
| Modo "seguir" (follow) o viewport de outra pessoa | Capacidade separada, não citada no escopo de R10 |
| Ponteiro laser (`pointer.tool: 'laser'`) | O protocolo do servidor não tem campo de ferramenta; todo cursor remoto é `'pointer'` |
| `comment_event` / `permission_changed` / `server_draining` | Tipos reservados no protocolo, **sem nenhum produtor no servidor** — construir tratamento de cliente para eles seria código morto |
| Avatar de imagem no cursor remoto | `users.avatar_url` existe mas não é exposto por nenhuma rota consumida aqui; nome + cor determinística bastam |
| Presença cruzando processos `apps/server` distintos | Já resolvido no servidor (AD-009, `RedisPresenceBroadcaster`) e inalterado por esta fatia |
| Persistir presença em qualquer lugar | Proibido por CLB-04 — presença nunca toca Postgres, e esta spec não muda isso |

---

## Assumptions & Open Questions

Toda ambiguidade está resolvida ou registrada aqui.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Como o cliente descobre de quem é um cursor remoto? | Estender o payload de wire de `presence`: a retransmissão do servidor passa a incluir `senderId` (o ator autenticado pelo ticket) | Decidido com o usuário antes do Specify. A alternativa (não mexer no protocolo) torna a feature inconstruível: hoje o `senderId` é removido antes do `send()` em `routes.ts:171-175` | y |
| E o nome de exibição — servidor manda, ou cliente resolve contra a lista de membros? | Servidor manda `displayName` junto, resolvido **uma vez por conexão** (na abertura do socket, a partir de `users.display_name`) e carimbado em todo evento publicado por aquela conexão | Uma query por conexão, zero por mensagem. A alternativa (cliente resolve contra `GET /workspaces/:id/members`) obrigaria o editor a conhecer o `workspaceId` do diagrama e a fazer uma chamada REST a mais só para nomear cursores, e falharia para qualquer identidade não presente naquela lista. Nenhum dado novo vaza: quem consegue abrir o socket já é membro do workspace e já pode ler a lista de membros | y |
| `senderId`/`displayName` viram campos obrigatórios de `presencePayloadSchema`? | Não — opcionais. O mesmo schema valida as duas direções (`wsPayloadSchemaByType` tem uma entrada por tipo, não uma por direção); o cliente manda sem eles e o servidor **sempre ignora** o que vier do cliente, usando só o ator do ticket | Torná-los obrigatórios quebraria a direção cliente→servidor. Confiar neles vindos do cliente seria falsificação de identidade trivial — o servidor já trata `actorId` assim para `mutation` (`routes.ts:250-255`), mesma disciplina | y |
| Estratégia de throttle do cursor local | Trailing throttle de 50 ms no cliente, por `setTimeout`/timestamp injetável (sem `requestAnimationFrame`) | Não existe throttle nenhum no servidor — sem isso, todo `mousemove` vira mensagem. 50 ms (≈20 Hz) é suficiente para cursor fluido. `requestAnimationFrame` não é injetável nos testes deste repo sem shim de jsdom e amarra a taxa ao refresh da tela, não ao custo de rede | y |
| Como testar WebSocket em `apps/web` (não existe infra nenhuma hoje) | Construtor injetável (`WebSocketImpl?: typeof WebSocket`) com um fake escrito à mão nos testes; **nenhuma dependência nova** | Espelha exatamente o `fetchImpl` de `DiagramSyncClient`/`AuthProvider`/`AiDock`, já a convenção do repo. `mock-socket`/`ws` adicionariam uma devDependency para simular uma superfície de 5 membros (`send`/`close`/`onmessage`/`onopen`/`onclose`) | y |
| Qual cena é aplicada no catch-up? | `catchUp()` é a sonda; quando ela reporta `appliedCount > 0`, o cliente chama `bootstrap()` e aplica `bootstrapResult.scene` via `applyRemoteScene` | Verificado em código: `catchUp()` devolve só `{sequence, clientMutationId}` por operação — não são elementos de cena, não dá para aplicar direto no canvas. `bootstrap()` já devolve a cena completa e já ressincroniza `baseRevision`/save-status. Quando `appliedCount === 0` nada mudou e nenhuma cena é buscada | y |
| Aplicar a cena remonta o `<EditorSurface/>`? | Nunca. Sempre pelo handle imperativo `applyRemoteScene` | AD-010 é explícita: remontar por `key` descarta silenciosamente edição local não sincronizada. `realtime-presence` é nomeada na própria AD-010 como o próximo caller desse handle | y |
| Cor do cursor remoto | Determinística a partir do `senderId` (hash → paleta fixa), calculada no cliente | Não existe campo de cor em lugar nenhum do servidor. Determinística garante que a mesma pessoa tem a mesma cor em todas as sessões e em todos os clientes, sem coordenação | y |
| Presença some quando a pessoa fecha a aba? | Duas defesas: (1) inatividade local de 60 s emite `status: 'idle'` uma vez, e um remoto `idle` é removido do mapa; (2) um remoto sem nenhuma mensagem há 90 s é removido (poda). Ambas usam só campos que o protocolo já tem | Uma aba fechada nunca emite `idle` — sem a poda, o cursor fantasma fica para sempre. Inventar uma mensagem de "saí" iria além do conserto de `senderId` decidido | y |
| Renderização do cursor remoto | `updateScene({collaborators})` nativo do Excalidraw, via uma extensão aditiva de `EditorSurface` | Confirmado nos tipos públicos do `@excalidraw/excalidraw@0.18.1` instalado (`SceneData.collaborators?: Map<SocketId, Collaborator>`, `Collaborator.pointer/username/color/selectedElementIds`). API pública, não subpath interno — não conflita com AD-008/EDT-07 | y |
| Dev proxy do Vite cobre `/ws`? | Não hoje — `apps/web/vite.config.ts` proxia `/health`,`/auth`,`/me`,`/workspaces`,`/projects`,`/diagrams` e nenhum deles casa com `/ws/diagrams/...`. Esta fatia adiciona `/ws` com `ws: true` | Sem isso a feature não funciona em `make web-dev`, só atrás do proxy de produção. É config, não comportamento | y |
| Presença exige permissão além de abrir o diagrama? | Não — o ticket é emitido só para quem tem membership no workspace do diagrama (`resolveDiagramMembership`), e o upgrade não é reautenticado depois disso | Já é o modelo de auth do servidor, inalterado por esta spec | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: A retransmissão de presença carrega a identidade de quem enviou

**User Story**: Como cliente conectado, quero saber de quem é cada atualização de presença que
recebo, para renderizar nome e cor por pessoa.

**Why P1**: Sem isso nenhuma das outras histórias é construível — é o pré-requisito de wire.

**Acceptance Criteria**:
1. WHEN o ws-gateway retransmite um evento de presença para outro cliente conectado ao mesmo diagrama THEN o payload `presence` enviado SHALL incluir `senderId` igual ao id do usuário autenticado pelo ticket do remetente.
2. WHEN o ws-gateway retransmite um evento de presença THEN o payload SHALL incluir `displayName` igual ao `users.display_name` do remetente, resolvido uma vez na abertura da conexão do remetente.
3. The ws-gateway SHALL nunca entregar a um cliente o eco da presença enviada por ele mesmo.
4. IF um cliente enviar `senderId` ou `displayName` no payload `presence` THEN o servidor SHALL ignorá-los e usar sempre o ator autenticado pelo ticket.
5. The `presencePayloadSchema` SHALL aceitar um payload sem `senderId` e sem `displayName` (direção cliente→servidor) sem erro de validação.

**Independent Test**: Dois sockets reais no mesmo diagrama; A envia `presence`; B recebe com `senderId` = id de A e `displayName` = nome de A; A nunca recebe nada.

---

### P1: O editor abre uma sessão de presença ao vivo

**User Story**: Como pessoa editando um diagrama, quero que o editor se conecte sozinho ao canal
em tempo real, para ver e ser vista sem apertar nada.

**Why P1**: É o transporte; nada mais funciona sem ele.

**Acceptance Criteria**:
1. WHEN o editor monta e o bootstrap do diagrama resolve THEN o cliente SHALL emitir `POST /diagrams/:id/ws-ticket` e abrir `GET /ws/diagrams/:diagramId` com o ticket recebido no parâmetro de query `ticket`.
2. IF `POST /diagrams/:id/ws-ticket` responder não-2xx ou falhar por rede THEN o cliente SHALL não abrir socket nenhum e SHALL passar ao estado `disconnected`.
3. WHEN o editor desmonta THEN o cliente SHALL fechar o socket e cancelar todos os seus temporizadores, sem reconectar depois disso.

**Independent Test**: Montar o editor com um `WebSocket` fake injetado e confirmar que a URL aberta contém `/ws/diagrams/<id>?ticket=<valor devolvido pela rota de ticket>`.

---

### P1: O editor transmite a própria presença

**User Story**: Como pessoa editando, quero que meu cursor e minha seleção cheguem a quem está
junto, sem inundar a rede.

**Why P1**: Metade do valor da feature é ser vista pelos outros.

**Acceptance Criteria**:
1. WHEN o ponteiro local se move sobre o canvas THEN o cliente SHALL enviar no máximo uma mensagem `presence` a cada 50 ms, e a mensagem enviada SHALL carregar a última posição observada no intervalo.
2. WHEN a seleção local muda THEN o cliente SHALL enviar uma mensagem `presence` cujo `selection` é a lista de ids selecionados.
3. IF o socket não estiver aberto THEN o cliente SHALL não enviar nenhuma mensagem `presence`.
4. WHILE o ponteiro local não se mover por 60 s o cliente SHALL enviar uma única mensagem `presence` com `status: 'idle'`, e voltar a `status: 'active'` no próximo movimento.

**Independent Test**: Disparar 10 movimentos de ponteiro em 30 ms com temporizador injetado e confirmar que exatamente uma mensagem foi enviada, com as coordenadas do último movimento.

---

### P1: O editor renderiza a presença remota

**User Story**: Como pessoa editando, quero ver o cursor e a seleção de quem está junto, com nome
e cor, para saber quem está mexendo onde.

**Why P1**: É a metade visível da feature.

**Acceptance Criteria**:
1. WHEN chega uma mensagem `presence` com `senderId` THEN o editor SHALL registrar aquele remetente no mapa de colaboradores do Excalidraw com `pointer` na posição recebida e `username` igual ao `displayName` recebido.
2. WHEN chega uma mensagem `presence` com `selection` THEN o colaborador correspondente SHALL ter `selectedElementIds` com exatamente aqueles ids.
3. The cor atribuída a um `senderId` SHALL ser sempre a mesma para o mesmo `senderId`, em qualquer sessão ou cliente.
4. IF chegar uma mensagem `presence` sem `senderId` THEN o editor SHALL ignorá-la, sem alterar o mapa de colaboradores.
5. The editor SHALL nunca incluir o próprio usuário logado no mapa de colaboradores.
6. WHEN chega uma mensagem `presence` com `status: 'idle'` THEN o remetente SHALL ser removido do mapa de colaboradores.

**Independent Test**: Entregar ao cliente uma mensagem `presence` de outro usuário e confirmar que `updateScene` recebeu um mapa `collaborators` com uma entrada nomeada e posicionada.

---

### P1: Reconexão com catch-up

**User Story**: Como pessoa editando, quero que uma queda de conexão se resolva sozinha e que o
canvas volte a refletir o servidor, sem perder o que eu ainda não sincronizei.

**Why P1**: É metade explícita do escopo de R10 no roadmap e fecha o laço morto de `catchUp()`.

**Acceptance Criteria**:
1. IF o socket fechar sem ter sido fechado pelo próprio editor THEN o cliente SHALL reconectar com backoff exponencial limitado, emitindo um ticket NOVO a cada tentativa.
2. WHEN uma reconexão abre um socket com sucesso THEN o cliente SHALL chamar `DiagramSyncClient.catchUp()`.
3. WHEN o catch-up reportar `appliedCount > 0` THEN o cliente SHALL buscar a cena atual via `bootstrap()` e aplicá-la por `EditorSurfaceHandle.applyRemoteScene`, nunca remontando o `<EditorSurface/>`.
4. WHEN o catch-up reportar `appliedCount === 0` THEN o cliente SHALL não buscar cena nenhuma e não tocar no canvas.
5. WHILE o cliente estiver desconectado o mapa de colaboradores SHALL estar vazio.

**Independent Test**: Fechar o socket fake, avançar o temporizador de backoff, confirmar que um segundo `POST /diagrams/:id/ws-ticket` foi emitido e que `catchUp` rodou depois que o novo socket abriu.

---

### P2: Estado da conexão visível, operável por teclado e nos dois idiomas

**User Story**: Como pessoa editando, quero saber se estou conectada ao canal em tempo real, para
não confiar em cursores que pararam de atualizar.

**Why P2**: A feature funciona sem o indicador; sem ele, ela só fica silenciosa e confusa quando cai.

**Acceptance Criteria**:
1. The editor SHALL renderizar um indicador de estado da conexão em tempo real com um texto distinto para cada um dos estados `connecting`, `connected` e `disconnected`.
2. WHEN o estado da conexão muda THEN o indicador SHALL anunciar o novo estado numa região `aria-live="polite"`.
3. The indicador SHALL não entrar na ordem de tabulação (não é um controle interativo) e SHALL não introduzir nenhuma violação séria ou crítica de acessibilidade.
4. The indicador SHALL renderizar tanto no locale `pt-BR` quanto no `en`.

**Independent Test**: Renderizar o editor, confirmar `aria-live="polite"` no indicador e o texto mudando de "Conectando" para "Conectado" quando o socket fake abre.

---

## Edge Cases

- IF alguém já estava conectado antes de eu entrar THEN o editor SHALL só passar a mostrar aquele cursor quando chegar a primeira mensagem `presence` daquela pessoa — não existe roster de quem já está lá, e a lacuna se resolve sozinha no primeiro movimento de ponteiro (limitação disclosed, ver Out of Scope).
- IF um colaborador remoto ficar 90 s sem enviar nenhuma mensagem `presence` THEN o editor SHALL removê-lo do mapa de colaboradores (cobre a aba fechada, que nunca chega a emitir `idle`).
- IF a mesma pessoa estiver com o diagrama aberto em duas abas THEN cada aba SHALL ignorar a presença da outra, porque o filtro é por `senderId` igual ao usuário logado (limitação aceita: o próprio usuário nunca vê o próprio cursor, em nenhuma aba).
- IF o socket for fechado pelo servidor com um código de política (`4403`/`4413`) THEN o cliente SHALL parar de tentar reconectar, porque uma nova tentativa reproduziria a mesma rejeição.
- IF chegar uma mensagem WebSocket malformada ou de um tipo sem tratamento no cliente THEN o cliente SHALL descartá-la em silêncio, sem derrubar a conexão.
- WHEN o `bootstrap()` do catch-up falhar THEN o cliente SHALL manter o canvas como está e permanecer conectado, sem propagar o erro para a árvore React.

---

## Mapeamento de ACs para IDs

A numeração de AC dentro de cada história é local; o ID de requisito é global.

| História | ACs | IDs |
| --- | --- | --- |
| P1: Identidade na retransmissão | 1..5 | LIVE-01..05 |
| P1: Sessão de presença | 1..3 | LIVE-06..08 |
| P1: Transmitir presença | 1..4 | LIVE-09..12 |
| P1: Renderizar presença remota | 1..6 | LIVE-13..18 |
| P1: Reconexão com catch-up | 1..5 | LIVE-19..23 |
| P2: Estado da conexão | 1..4 | LIVE-24..27 |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| LIVE-01 | P1: Identidade na retransmissão | F10 | Implementing |
| LIVE-02 | P1: Identidade na retransmissão | F10 | Implementing |
| LIVE-03 | P1: Identidade na retransmissão | F10 | Implementing |
| LIVE-04 | P1: Identidade na retransmissão | F10 | Implementing |
| LIVE-05 | P1: Identidade na retransmissão | F10 | Implementing |
| LIVE-06 | P1: Sessão de presença | F10 | Pending |
| LIVE-07 | P1: Sessão de presença | F10 | Pending |
| LIVE-08 | P1: Sessão de presença | F10 | Pending |
| LIVE-09 | P1: Transmitir presença | F10 | Pending |
| LIVE-10 | P1: Transmitir presença | F10 | Pending |
| LIVE-11 | P1: Transmitir presença | F10 | Pending |
| LIVE-12 | P1: Transmitir presença | F10 | Pending |
| LIVE-13 | P1: Renderizar presença remota | F10 | Pending |
| LIVE-14 | P1: Renderizar presença remota | F10 | Pending |
| LIVE-15 | P1: Renderizar presença remota | F10 | Implementing |
| LIVE-16 | P1: Renderizar presença remota | F10 | Pending |
| LIVE-17 | P1: Renderizar presença remota | F10 | Pending |
| LIVE-18 | P1: Renderizar presença remota | F10 | Pending |
| LIVE-19 | P1: Reconexão com catch-up | F10 | Pending |
| LIVE-20 | P1: Reconexão com catch-up | F10 | Pending |
| LIVE-21 | P1: Reconexão com catch-up | F10 | Pending |
| LIVE-22 | P1: Reconexão com catch-up | F10 | Pending |
| LIVE-23 | P1: Reconexão com catch-up | F10 | Pending |
| LIVE-24 | P2: Estado da conexão | F10 | Pending |
| LIVE-25 | P2: Estado da conexão | F10 | Pending |
| LIVE-26 | P2: Estado da conexão | F10 | Pending |
| LIVE-27 | P2: Estado da conexão | F10 | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `LIVE` não colide com nenhum já usado no repositório: A11Y, AAC, AGT, AIC, AIE, AIG,
API, AUTH, CIQ, CLB, CLIB, CMT, DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, MEM, NAV,
OBS, OIDC, OPS, PERF, PRS, REC, SEC, SNAP, SSO, TRU, UIX, VER, XPRT (verificado por varredura de
`.specs/` e `docs/`). `CLB` é o prefixo do backend de colaboração de F4 e continua sendo dele.

**Coverage:** 27 total.

---

## Rotas consumidas

| Rota | Uso nesta spec |
| --- | --- |
| `POST /diagrams/:id/ws-ticket` | Emitir o ticket de uso único antes de cada abertura de socket (inclusive a cada tentativa de reconexão) |
| `GET /ws/diagrams/:diagramId` | O canal de presença em si |
| `GET /diagrams/:id/bootstrap` | Já consumida pelo editor; reusada no catch-up para obter a cena atual |
| `GET /diagrams/:id/operations?afterSequence=` | Já implementada em `syncClient.catchUp()`; esta spec dá a ela seu primeiro caller |

---

## Success Criteria

- [ ] Dois clientes no mesmo diagrama veem cursor, nome e seleção um do outro, cada pessoa com cor estável.
- [ ] Uma mensagem `presence` recebida sempre identifica seu remetente, provado por teste de integração com dois sockets reais.
- [ ] Derrubar e restabelecer a conexão não perde nenhuma edição local pendente e converge o canvas para a revisão do servidor.
- [ ] `docs/capability-map.yaml` deixa de marcar "Colaboração em tempo real e presença" como `backend-only`.
