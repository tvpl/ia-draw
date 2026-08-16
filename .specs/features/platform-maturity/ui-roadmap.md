# Roadmap de produto — decomposição do gap de UI (UIX-02)

Índice das capacidades que têm backend verificado e nenhuma superfície de produto, convertidas em entradas dimensionadas para um squad.

**Este documento não entrega UI e não é uma spec.** Cada entrada abaixo vira uma spec própria em `.specs/features/<slug>/`, escrita na sua própria rodada de Specify, com seus requisitos em EARS, seu design quando couber e suas tasks. Nada aqui autoriza implementação: a onda F6 entrega o inventário e este índice, e a decisão explícita registrada na spec de `platform-maturity` é que a implementação da UI são features seguintes, uma por vez.

## Fonte

Duas, e só duas:

- `docs/capability-map.yaml` — 26 capacidades, 22 marcadas `backend-only`. Toda entrada deste roadmap sai de uma dessas 22.
- `docs/route-inventory.md` — 82 rotas REST registradas, 4 consumidas pela UI, 78 `pending-product`. As rotas citadas em cada entrada saem dessa lista, sem exceção.

Os dois arquivos são regenerados e checados por `repo-tools audit`, que roda no CI. Se uma capacidade ganhar superfície, ela sai do mapa como `backend-only` e a entrada correspondente aqui perde a razão de existir.

## Critério de dimensionamento

Uma **onda** é uma spec de squad: uma rodada completa de Specify → Execute → Verifier, com ordem de 10 a 15 tasks. O tamanho de cada entrada é calculado, não estimado no olho:

| Entrada | Fórmula |
| ------- | ------- |
| Base | 1 onda |
| Mais de 10 rotas pendentes consumidas | +0,5 onda |
| Transporte novo no frontend (WebSocket) ou rota pública sem sessão | +0,5 onda |
| Mais de 3 superfícies novas em `apps/web/src` | +0,5 onda |

Nenhuma entrada passa de 2 ondas. As duas que chegariam lá — navegação de workspace e apresentação — foram partidas ou tiveram escopo cortado até caber.

## Ordem proposta

A ordem é de execução. Toda dependência aponta para uma entrada anterior; nenhuma aponta para frente.

| # | Entrada | Spec prevista | Capacidade(s) do mapa | Rotas | Depende de | Ondas |
| - | ------- | ------------- | --------------------- | ----- | ---------- | ----- |
| R1 | Dock de IA | `ai-dock` | Geração por IA; Edição por IA com prévia, aprovação e undo | 2 | — | 1 |
| R2 | Entrada no produto (login e SSO) | `sso-sign-in` | Autenticação de produção via OIDC | 5 | — | 1 |
| R3 | Navegação de workspace, projetos e diagramas | `workspace-navigation` | Workspaces, projetos e RBAC | 15 | R2 | 1,5 |
| R4 | Membros e papéis do workspace | `workspace-members` | Workspaces, projetos e RBAC | 4 | R3 | 1 |
| R5 | Biblioteca de componentes e metadados | `component-library` | Biblioteca de componentes e metadados semânticos | 4 | R3 | 1 |
| R6 | Histórico, snapshots e diff | `version-history` | Snapshots, histórico e restore de versão | 4 | R3 | 1 |
| R7 | Export, bundle e import | `export-panel` | Export de imagem e bundle, e salvamento local | 4 | R3 | 1 |
| R8 | Interop Mermaid e Structurizr | `interop-panel` | Import e export Mermaid e Structurizr | 2 | R7 | 1 |
| R9 | Comentários e revisão | `diagram-comments` | Comentários e revisão no diagrama | 3 | R4 | 1 |
| R10 | Colaboração em tempo real e presença | `realtime-presence` | Colaboração em tempo real e presença | 2 | R4 | 1,5 |
| R11 | Compartilhamento externo por link | `share-links` | Compartilhamento externo por link | 4 | R4 | 1,5 |
| R12 | Apresentação e protótipos navegáveis | `presentation-mode` | Apresentações navegáveis e protótipos | 11 | R11 | 2 |
| R13 | Documentação viva | `living-docs` | Documentação viva gerada a partir do canvas | 3 | R5 | 1 |
| R14 | Lint arquitetural e C4 | `architecture-lint` | Lint arquitetural e checagem C4 | 1 | R5 | 1 |
| R15 | Administração do provider de IA | `ai-provider-admin` | Configuração do provider de IA | 4 | R1, R4 | 1 |
| R16 | Webhooks do workspace | `workspace-webhooks` | Webhooks de eventos do workspace | 5 | R4 | 1 |

**Total: 16 entradas, 73 rotas, 18,5 ondas.**

---

## Entradas

### R1 — Dock de IA

**Capacidades**: Geração de diagramas por IA a partir de linguagem natural; Edição por IA com prévia, aprovação explícita e undo.
**Escopo**: painel lateral no editor que recebe um pedido em linguagem natural, mostra a proposta como diff antes de qualquer coisa tocar o canvas, exige aprovação explícita para aplicar e oferece undo que restaura o snapshot `pre_ai`. Sem histórico de conversa, sem streaming de tokens, sem configuração de modelo — isso é R15.
**Rotas consumidas**: `POST /diagrams/:id/ai/runs`, `POST /ai/runs/:runRef`.
**Depende de**: nada. O editor já tem sessão autenticada e a rota de mutação já é consumida por `syncClient.ts`.
**Tamanho**: 1 onda (2 rotas, 3 superfícies novas: dock, painel de diff, controle de undo).
**Por que primeiro**: é o diferencial declarado do produto e a única capacidade que a landing anuncia no herói. Também é a fatia vertical mais curta que atravessa pedido, prévia, aprovação e desfazer, o que faz dela o exemplar que as demais specs copiam.
**Spec**: `.specs/features/ai-dock/spec.md` (escrita em F6 como exemplar; a implementação continua sendo onda própria).

### R2 — Entrada no produto (login e SSO)

**Capacidade**: Autenticação de produção via OIDC.
**Escopo**: tela de login com credencial local, botão de SSO, tratamento de retorno do callback e renovação silenciosa de sessão. Hoje não existe tela nenhuma: a sessão do editor é obtida fora do produto.
**Rotas consumidas**: `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/oidc/login`, `GET /auth/oidc/callback`.
**Depende de**: nada.
**Tamanho**: 1 onda (5 rotas, 2 superfícies).

### R3 — Navegação de workspace, projetos e diagramas

**Capacidade**: Workspaces, projetos e RBAC (parte de navegação).
**Escopo**: preencher o `AppShell`, que hoje é um `<main />` vazio com o comentário `"nav/search/admin land here in F1+"`. Lista de workspaces, lista de projetos, lista de diagramas, criar/renomear/arquivar em cada nível, e a rota de editor alcançável a partir da navegação em vez de por URL decorada.
**Rotas consumidas**: `GET|POST /workspaces`, `GET|PATCH|DELETE /workspaces/:id`, `GET|POST /projects`, `GET|PATCH|DELETE /projects/:id`, `GET|POST /diagrams`, `GET|PATCH|DELETE /diagrams/:id`.
**Depende de**: R2 — sem tela de login não há de onde a navegação partir.
**Tamanho**: 1,5 onda (15 rotas, acima do limite de 10; 3 superfícies).
**Corte deliberado**: busca e admin ficam fora. Membros saíram para R4 justamente para esta entrada caber.

### R4 — Membros e papéis do workspace

**Capacidade**: Workspaces, projetos e RBAC (parte de permissão).
**Escopo**: tela de membros do workspace, convite, troca de papel e remoção, com o papel efetivo sempre vindo do servidor.
**Rotas consumidas**: `GET|POST /workspaces/:id/members`, `PATCH|DELETE /workspaces/:id/members/:userId`.
**Depende de**: R3.
**Tamanho**: 1 onda (4 rotas, 1 superfície).
**Por que separada**: é a entrada que destrava comentário, presença, compartilhamento e webhooks, todos com regra de papel. Entregá-la cedo e sozinha é mais barato que arrastá-la dentro de R3.

### R5 — Biblioteca de componentes e metadados

**Capacidade**: Biblioteca de componentes e metadados semânticos.
**Escopo**: seletor de biblioteca no editor (ícones AWS, C4, wireframe kit), painel de metadados do elemento selecionado e a visão de inventário do diagrama.
**Rotas consumidas**: `GET /libraries`, `GET|PATCH /diagrams/:id/elements/:elementId/metadata`, `GET /diagrams/:id/inventory`.
**Depende de**: R3 — biblioteca é por workspace.
**Tamanho**: 1 onda (4 rotas, 3 superfícies).

### R6 — Histórico, snapshots e diff

**Capacidade**: Snapshots, histórico e restore de versão.
**Escopo**: linha do tempo de snapshots, criar snapshot nomeado, comparar duas revisões e restaurar como revisão nova sem apagar o que veio depois.
**Rotas consumidas**: `GET|POST /diagrams/:id/snapshots`, `POST /diagrams/:id/snapshots/:snapshotId:restore`, `GET /diagrams/:id/diff`.
**Depende de**: R3.
**Tamanho**: 1 onda (4 rotas, 2 superfícies).

### R7 — Export, bundle e import

**Capacidade**: Export de imagem e bundle, e salvamento local.
**Escopo**: menu de export (`.excalidraw`, SVG, PNG, PDF), bundle `.zip` do projeto, bundle do workspace e import com prévia e limite de elementos.
**Rotas consumidas**: `POST /diagrams/:id/exports`, `POST /diagrams/:id/bundle`, `POST /projects/:id/import`, `POST /workspaces/:id/bundles`.
**Depende de**: R3.
**Tamanho**: 1 onda (4 rotas, 2 superfícies).

### R8 — Interop Mermaid e Structurizr

**Capacidade**: Import e export Mermaid e Structurizr.
**Escopo**: os dois formatos adicionais no mesmo menu entregue por R7, com prévia de import.
**Rotas consumidas**: `POST /projects/:id/import:format`, `POST /diagrams/:id/export:format`.
**Depende de**: R7 — reusa o painel, não cria um segundo.
**Tamanho**: 1 onda (2 rotas, 0 superfície nova).

### R9 — Comentários e revisão

**Capacidade**: Comentários e revisão no diagrama.
**Escopo**: comentário ancorado em elemento, lista lateral de comentários e resolução. O papel `revisor` comenta e nunca edita, e quem decide isso é o servidor.
**Rotas consumidas**: `GET|POST /diagrams/:id/comments`, `PATCH /diagrams/:id/comments/:commentId`.
**Depende de**: R4 — o papel `revisor` precisa ser atribuível por alguém.
**Tamanho**: 1 onda (3 rotas, 2 superfícies).

### R10 — Colaboração em tempo real e presença

**Capacidade**: Colaboração em tempo real e presença.
**Escopo**: conexão WebSocket a partir do editor, cursores e seleção remota, e reconexão com catch-up pelo caminho que `syncClient.ts` já implementa para REST.
**Rotas consumidas**: `POST /diagrams/:id/ws-ticket`, `GET /ws/diagrams/:diagramId`.
**Depende de**: R4.
**Tamanho**: 1,5 onda (2 rotas, mas transporte novo no frontend: ticket de uso único, ciclo de vida da conexão, reconciliação com a fila local existente).

### R11 — Compartilhamento externo por link

**Capacidade**: Compartilhamento externo por link.
**Escopo**: criar link com teto de papel e expiração, revogar, e a visão pública que o link abre.
**Rotas consumidas**: `POST /diagrams/:id/share-links`, `POST /presentations/:id/share-links`, `GET /share/:token`, `POST /share-links/:id:revoke`.
**Depende de**: R4.
**Tamanho**: 1,5 onda (4 rotas, mas inclui uma rota pública sem sessão, que é uma superfície de risco própria e uma segunda entrada de roteamento no `apps/web`).

### R12 — Apresentação e protótipos navegáveis

**Capacidade**: Apresentações navegáveis e protótipos.
**Escopo**: montar apresentação a partir de frames, reordenar, modo presenter em tela cheia, publicar link imutável, exportar PDF e links de navegação entre frames.
**Rotas consumidas**: `GET|POST /presentations`, `GET|PATCH /presentations/:id`, `POST|PATCH /presentations/:id/frames`, `PATCH|DELETE /presentations/:id/frames/:frameId`, `POST /presentations/:id:publish`, `GET /presentations/:id/published`, `POST /presentations/:id:export-pdf`.
**Depende de**: R11 — o link publicado é um link de compartilhamento.
**Tamanho**: 2 ondas (11 rotas e 4 superfícies: editor de apresentação, modo presenter, visão publicada, navegação de protótipo).

### R13 — Documentação viva

**Capacidade**: Documentação viva gerada a partir do canvas.
**Escopo**: gerar spec em Markdown a partir do diagrama, ver as versões geradas e regenerar uma seção, com cada seção linkada de volta ao elemento que a originou.
**Rotas consumidas**: `POST /diagrams/:id/specs:generate`, `GET /diagrams/:id/specs`, `POST /diagrams/:id/specs/:version:regenerate-section`.
**Depende de**: R5 — a qualidade do documento vem dos metadados semânticos, que só R5 deixa preencher.
**Tamanho**: 1 onda (3 rotas, 2 superfícies).

### R14 — Lint arquitetural e C4

**Capacidade**: Lint arquitetural e checagem C4.
**Escopo**: painel de avisos do lint no editor, sempre como aviso e nunca bloqueando o desenho, com salto para o elemento apontado.
**Rotas consumidas**: `GET /diagrams/:id/lint`.
**Depende de**: R5 — as regras dependem de metadado e de nível C4.
**Tamanho**: 1 onda (1 rota, 1 superfície).

### R15 — Administração do provider de IA

**Capacidade**: Configuração do provider de IA.
**Escopo**: tela de administração para cadastrar endpoint e chave do provider, testar a conexão e alternar qual está ativo. O segredo continua cifrado no servidor e nunca volta para a tela.
**Rotas consumidas**: `GET|POST /admin/ai-providers`, `PATCH /admin/ai-providers/:id`, `POST /admin/ai-providers/:id:test`.
**Depende de**: R1 e R4 — só faz sentido configurar provider depois que existe um dock que o usa, e a tela é de administrador.
**Tamanho**: 1 onda (4 rotas, 1 superfície).

### R16 — Webhooks do workspace

**Capacidade**: Webhooks de eventos do workspace.
**Escopo**: tela de webhooks do workspace: cadastrar, editar, remover e rotacionar segredo.
**Rotas consumidas**: `GET|POST /workspaces/:id/webhooks`, `PATCH|DELETE /workspaces/:id/webhooks/:webhookId`, `PATCH /workspaces/:id/webhooks/:webhookId:rotate-secret`.
**Depende de**: R4.
**Tamanho**: 1 onda (5 rotas, 1 superfície).

---

## Capacidades `backend-only` que não viram entrada de produto

Seis das 22 continuam `backend-only` por decisão, não por atraso: a superfície correta delas é operacional (compose, variável de ambiente, job, painel Grafana), não uma tela do produto. Ficam registradas aqui para que a soma feche e para que ninguém as confunda com trabalho esquecido.

| Capacidade | Superfície real | Rotas | Depende de | Ondas |
| ---------- | --------------- | ----- | ---------- | ----- |
| Instalação self-hosted com stack completo | `make up` e `infra/compose/compose.yaml` | — | — | 0 |
| Backup com restore testado automaticamente | CLI `infra/backup` e job recorrente | — | — | 0 |
| Disaster recovery com backup incremental | CLI `infra/backup` | — | — | 0 |
| Hardening de segurança HTTP e rate limiting | `apps/server/src/core/server.ts`, configuração de deploy | — | — | 0 |
| Métricas Prometheus e tracing OpenTelemetry | `GET /metrics` e o profile `observability` do compose | — | — | 0 |
| Desempenho de bootstrap sob carga documentada | suíte `bootstrap.perf.int.spec.ts` | — | — | 0 |

Se em algum momento uma delas ganhar tela — um painel de status de backup, por exemplo — ela vira entrada nova aqui, não uma linha reescrita nesta tabela.

## Cobertura

| Origem | Contagem | Onde |
| ------ | -------- | ---- |
| Capacidades `backend-only` no mapa | 22 | `docs/capability-map.yaml` |
| Cobertas por entrada de produto | 16 | R1–R16 |
| Registradas como superfície operacional | 6 | tabela acima |
| **Soma** | **22** | fecha |

R1 cobre duas capacidades (geração e edição por IA) porque as duas vivem no mesmo dock e a segunda não tem sentido sozinha. R3 e R4 partem uma capacidade em duas entradas para caber no orçamento de uma onda. Fora esses dois casos, é um para um.

Rotas: 73 das 78 `pending-product` estão atribuídas a uma entrada. As 5 restantes se dividem em dois casos, nenhum deles trabalho de produto. Dois são de asset — `POST /diagrams/:id/assets:initiate` e `POST /diagrams/:id/assets/:assetId:complete` — e pertencem a `Edição server-first do canvas`, que **já tem superfície** (`DiagramEditorPage.tsx`) e por isso não é `backend-only` e não gera entrada; o upload de imagem no canvas continua sem fio ligado e entra como escopo da spec de R5, que é onde o painel de elemento aparece. Os outros três — `GET /health/live`, `GET /health/ready` e `GET /metrics` — são endpoints operacionais registrados em `apps/server/src/core/server.ts`, consumidos por compose, CI e Prometheus; superfície deles é painel de operação, nunca tela de produto.

## Checagem de ordem

Toda dependência aponta para trás:

```
R1 ─────────────────────────────────► R15
R2 ──► R3 ──► R4 ──► R9, R10, R11, R15, R16
              R3 ──► R5 ──► R13, R14
              R3 ──► R6
              R3 ──► R7 ──► R8
                            R11 ──► R12
```

| Entrada | Depende de | Posição da dependência | OK? |
| ------- | ---------- | ---------------------- | --- |
| R1 | — | — | sim |
| R2 | — | — | sim |
| R3 | R2 | anterior | sim |
| R4 | R3 | anterior | sim |
| R5 | R3 | anterior | sim |
| R6 | R3 | anterior | sim |
| R7 | R3 | anterior | sim |
| R8 | R7 | anterior | sim |
| R9 | R4 | anterior | sim |
| R10 | R4 | anterior | sim |
| R11 | R4 | anterior | sim |
| R12 | R11 | anterior | sim |
| R13 | R5 | anterior | sim |
| R14 | R5 | anterior | sim |
| R15 | R1, R4 | anteriores | sim |
| R16 | R4 | anterior | sim |

Nenhuma entrada depende de outra posterior. R1 e R2 são raízes independentes, então duas frentes podem começar em paralelo se houver dois squads.
