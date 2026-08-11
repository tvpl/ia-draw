# Architecture Canvas — Especificação de Produto e Engenharia (documento-fonte)

> **Proveniência:** documento escrito pelo product owner (Thiago) e entregue como base do planejamento em 2026-08-11.
> **Status:** referência detalhada de engenharia. As decisões abaixo **emendam** este documento e prevalecem em caso de conflito (ver `.specs/STATE.md`):
>
> - **AD-001** — Sincronização por **op-log LWW nativo do Excalidraw** (`version`/`versionNonce` + `reconcileElements`), não Yjs. As menções a Yjs nas §3.4, §5.1, §5.5 e no modelo de dados ficam substituídas pelo op-log de domínio; Yjs permanece como ADR futura.
> - **AD-002** — Roadmap **AI-first**: IA geradora antecipada para logo após a persistência; colaboração realtime multiplayer adiada para fase posterior (reordena §15).
> - **AD-003** — MVP como **monólito modular**: um processo Node (API + WebSocket + jobs) com fronteiras preservadas nos packages do monorepo; split em serviços é fase futura (emenda §5.1–§5.3 e §12).
> - **AD-004** — **IR declarativa `diagram-ir/v1`** como peça central da geração por IA e do architecture-as-code (fortalece §8.4 e §3.5).
> - **AD-005** — Renderização server-side via `exportToSvg` + rasterização (`resvg`/`sharp`), com fallback Chromium headless; spike obrigatório na Fase 0.
> - **AD-006** — MVP **sem Redis**: jobs via pg-boss sobre PostgreSQL; Redis entra apenas na fase de colaboração realtime multi-node (emenda §5.1 e §12).
> - Escopo adicional confirmado: **prototipagem** = kit de wireframes low-fi **+ protótipos navegáveis** (links clicáveis entre frames no modo apresentação), em fase própria.
>
> A spec normativa em EARS com IDs rastreáveis vive em `.specs/features/architecture-canvas/spec.md`.

---

**Status:** pronta para implementação por IA de coding
**Público-alvo:** engenharia, arquitetura, plataforma, segurança, produto e IA de coding
**Base visual:** `@excalidraw/excalidraw` como dependência npm, sem fork pesado
**Licença pretendida do produto:** a definir pela empresa; respeitar a licença MIT e avisos de terceiros do Excalidraw
**Idioma da interface:** português e inglês desde o MVP

---

## 1. Instrução principal para a IA de coding

Construa uma plataforma interna, self-hosted e server-first para criação e gestão de diagramas de arquitetura, baseada no componente npm `@excalidraw/excalidraw`. A plataforma deve ser executável integralmente por `docker compose`, não deve usar o navegador como fonte da verdade e não deve depender de nenhum serviço SaaS para suas funções essenciais.

Implemente em incrementos verticais verificáveis. Não substitua persistência real por `localStorage`, IndexedDB ou mocks. Não faça fork do repositório do Excalidraw. Não exponha tokens de IA ao frontend. Não considere uma alteração salva antes de receber confirmação durável do servidor. Toda função descrita como obrigatória deve ter teste automatizado e critério de aceite demonstrável.

Se uma escolha técnica desta spec se mostrar inviável, registre uma ADR, preserve os invariantes de produto e proponha a menor alternativa possível antes de alterar a arquitetura.

### 1.1 Invariantes inegociáveis

1. PostgreSQL e object storage são a fonte da verdade.
2. Fechar a aba, matar o browser, recarregar a página ou trocar de máquina não pode apagar alterações já confirmadas como salvas.
3. O estado local é somente cache e fila temporária de mutações ainda não confirmadas.
4. Toda mutação possui `clientMutationId`, ordem, autor, data, revisão base e confirmação idempotente.
5. O token do provedor de IA nunca chega ao browser, logs, traces ou eventos de analytics.
6. A IA nunca escreve diretamente no banco nem em JSON bruto do Excalidraw; usa ferramentas de domínio validadas e auditáveis.
7. Qualquer edição da IA é apresentada como preview/diff e aplicada em transação única, com Undo.
8. O Excalidraw é encapsulado por uma camada adaptadora e permanece atualizável como pacote upstream.
9. A aplicação funciona sem internet depois que as imagens Docker e dependências tiverem sido obtidas.
10. Backups devem possuir teste automatizado de restauração.

---

## 2. Visão do produto

O Architecture Canvas é uma plataforma corporativa de diagramas e documentação visual. Ela combina a rapidez de desenho do Excalidraw com gestão server-side, colaboração, bibliotecas de arquitetura, semântica, versionamento, apresentação e um agente de IA capaz de construir, revisar e documentar arquiteturas.

### 2.1 Objetivos

- Permitir que um time desenhe infraestrutura, software, produto e processos sem perder trabalho.
- Centralizar diagramas, anexos, bibliotecas, comentários, versões e permissões no servidor.
- Gerar e alterar diagramas por linguagem natural de forma segura, explicável e reversível.
- Oferecer modelos AWS, C4, microsserviços, web/mobile, BFF, gateways, eventos e fluxos de negócio.
- Produzir documentação técnica a partir do canvas, mantendo vínculos entre a spec e os elementos visuais.
- Manter custo operacional baixo e instalação local simples.

### 2.2 Fora de escopo do MVP

- Substituir ferramentas completas de UI design como Figma/Penpot.
- Edição nativa de arquivos Visio.
- Descoberta automática de cloud por credenciais AWS/Azure/GCP.
- Coedição offline por longos períodos com merge perfeito de todos os campos.
- Marketplace público de plugins.
- Aplicativos desktop ou mobile nativos.

### 2.3 Personas e papéis

- **Administrador da organização:** configura autenticação, IA, políticas, bibliotecas e backups.
- **Administrador de workspace:** gerencia membros, projetos, templates e permissões locais.
- **Editor/Arquiteto:** cria, edita, apresenta, comenta e usa IA.
- **Revisor:** comenta, compara versões e aprova, sem editar o canvas.
- **Visualizador:** consulta e apresenta versões autorizadas.

---

## 3. Escopo funcional

### 3.1 Organização, workspaces e projetos

- Organização única no MVP, preparada para multitenancy lógico futuro.
- Workspaces com nome, slug, descrição, avatar, política de acesso e membros.
- Projetos dentro de workspaces, com tags, responsáveis, status e classificação de dados.
- Diagramas dentro de projetos, com título, descrição, thumbnail, tags, proprietário e estado: `draft`, `in_review`, `approved`, `archived`.
- Busca por título, descrição, tags, texto do canvas, metadados semânticos e conteúdo da spec.
- Favoritos, recentes, arquivamento recuperável e lixeira com retenção configurável.
- Templates globais e por workspace.

### 3.2 Editor e persistência server-first

- Renderizar o componente `<Excalidraw>` dentro de um shell próprio.
- Ao abrir um diagrama, obter do servidor: snapshot atual, revisão, arquivos referenciados, permissões e configuração visual.
- Entrar em canal WebSocket autenticado por diagrama.
- Converter mudanças do Excalidraw em mutações incrementais de domínio.
- Persistir cada lote de mutações antes de enviar `saved/ack` ao autor e antes de tratá-lo como durável.
- Exibir estado explícito: `Salvo`, `Salvando…`, `Offline — N alterações pendentes`, `Conflito`, `Somente leitura`.
- Autosave por debounce de 500–1000 ms, flush em `visibilitychange`, `pagehide` e antes de navegação interna.
- A API deve aceitar reenvio idempotente do mesmo `clientMutationId`.
- Na reconexão, o cliente envia sua revisão conhecida e mutações pendentes; o servidor responde com atualizações ausentes, confirma duplicatas e rejeita mutações sem permissão.
- O cache local pode guardar apenas snapshot criptografável e fila pendente. Ele nunca pode sobrepor silenciosamente uma revisão mais nova do servidor.
- Imagens/anexos são enviados ao storage antes de o elemento que os referencia ser confirmado.
- Criar snapshot automático por tempo e volume, sem interromper edição.

### 3.3 Recuperação e resiliência

- Reabrir a URL restaura a última revisão confirmada no servidor.
- Se o browser fechar com mutações ainda não confirmadas, a fila local é reenviada após autenticação, com confirmação visual; nunca é mesclada cegamente.
- Manter heartbeat e detecção de sessão obsoleta.
- Em conflito estrutural, preservar ambas as variantes e oferecer comparação; nunca descartar dados automaticamente.
- Criar snapshots nomeáveis, automáticos e de publicação.
- Permitir visualizar, comparar e restaurar um snapshot como uma nova revisão, sem apagar o histórico posterior.
- Export de emergência em `.excalidraw`, SVG, PNG e PDF; import de `.excalidraw` com validação e preview.

### 3.4 Colaboração

- Coedição em tempo real, cursores, seleção, presença, nome/avatar e follow-user.
- Comentários em canvas e ancorados a elemento, com threads, menções e resolução.
- Papéis respeitados em WebSocket e REST; o frontend não é barreira de segurança.
- Edição concorrente em elementos diferentes deve convergir sem perda.
- Para o mesmo elemento, usar LWW por registro com versão lógica; alterações conflitantes devem ser detectáveis no histórico. *(emendado por AD-001)*
- Awareness/presença é efêmera; operações e comentários são duráveis em PostgreSQL.
- Links internos de compartilhamento com expiração e papel máximo; desativados por padrão para convidados externos.

### 3.5 Bibliotecas e arquitetura

- Biblioteca curada de componentes genéricos e AWS, com nome, categoria, aliases, descrição, tags, cor, ícone SVG, versão e metadados.
- Categorias iniciais: compute, containers, serverless, storage, database, networking, security, observability, messaging, integration, user/client e external system.
- Ícones devem possuir licença e atribuição registradas; não copiar pacotes sem licença compatível.
- Inserção via palette, busca, slash command e IA.
- Componentes compostos reutilizáveis: VPC/subnets, EKS, event-driven, three-tier web, mobile+BFF, API Gateway+Lambda, observability stack e C4 starter.
- Suporte a níveis C4: Context, Container, Component e Deployment, com validações suaves.
- Metadados semânticos por elemento: `semanticType`, `technology`, `provider`, `service`, `environment`, `owner`, `domain`, `repositoryUrl`, `documentationUrl`, `dataClassification`, `criticality`, `sla`, `protocols`, `ports`, `region`, `account`, `tags` e campos customizados.
- Conectores com semântica: sync/async, protocolo, cardinalidade, direção, tópico/fila, payload e confiança.
- Painel de propriedades semânticas separado do Excalidraw, sem modificar os tipos upstream; dados ficam no modelo próprio, vinculados por `elementId`.
- Architecture-as-code: importar/exportar Mermaid e Structurizr DSL inicialmente, via `diagram-ir` *(AD-004)*; PlantUML como fase posterior. Importações devem gerar layout editável e registrar limitações de round-trip.
- Exportar inventário CSV/JSON dos componentes e relações.

### 3.6 Geração de spec a partir do desenho

- Ação “Gerar documentação” produz Markdown estruturado com: resumo, contexto, objetivos, escopo, atores, componentes, responsabilidades, fluxos, integrações, dados, segurança, disponibilidade, observabilidade, riscos, decisões, perguntas abertas e inventário.
- A geração recebe uma representação semântica compacta, não uma captura de tela como única fonte.
- Elementos e relações da spec carregam referências estáveis ao `elementId`.
- A spec gerada é versionada independentemente e vinculada à revisão do diagrama usada como fonte.
- Permitir editar, regenerar uma seção, comparar versões e exportar Markdown/PDF.
- Não inventar decisões ausentes: marcar como “não especificado” ou “pergunta aberta”.

### 3.7 Modo apresentação

- Frames/slides ordenáveis, criados a partir de áreas do canvas.
- Modo presenter em tela cheia, zoom por frame, navegação teclado/controle, notas privadas e indicador de progresso.
- Link somente leitura para versão publicada, respeitando RBAC e expiração.
- Transições discretas e opção de apresentar o canvas livremente.
- **Protótipos navegáveis:** links clicáveis de elemento → frame simulando navegação entre telas (escopo confirmado na discussão).
- Exportar apresentação em PDF; talk track e gravação ficam fora do MVP.

### 3.8 Recursos adicionais de alto valor

- Command palette (`Cmd/Ctrl+K`) e slash commands.
- Minimap, outline semântico, breadcrumbs e “fit selection”.
- Deep link para elemento/frame/comentário.
- Revisão arquitetural automática: componentes órfãos, fluxos sem direção, trust boundaries ausentes, single points of failure, secrets desenhados como texto, ambientes misturados e conectores sem protocolo.
- Linter C4 e regras customizáveis por workspace, sempre como aviso no MVP.
- Comparação visual entre snapshots: adicionados, removidos, movidos e alterados.
- Catálogo de decisões/ADRs ligadas a elementos.
- Thumbnails assíncronos e capa escolhível.
- Atalhos documentados e acessibilidade por teclado.

---

## 4. UX/UI

### 4.1 Estrutura

1. **App shell:** navegação de workspaces/projetos, busca global, recentes, favoritos e administração.
2. **Editor shell:** breadcrumb e título no topo; canvas central; toolbar visual do Excalidraw; painel direito contextual; status de save e colaboração; dock inferior de comentários/versões/IA.
3. **AI Copilot:** painel lateral redimensionável com histórico por diagrama, presets e preview de mudanças.
4. **Focus mode:** esconde o shell e deixa canvas, colaboração e save status.
5. **Presentation mode:** interface mínima e somente leitura.

### 4.2 Polimento sem fork

- Usar tokens CSS próprios para cor, radius, spacing, sombra e tipografia.
- Configurar apenas APIs públicas do Excalidraw: props, children suportados, menus, `renderTopRightUI`, `UIOptions`, biblioteca e `excalidrawAPI`.
- Aplicar CSS externo somente em seletores documentados/estáveis e protegidos por testes visuais.
- Não copiar componentes internos do Excalidraw.
- Não patchar `node_modules`.
- Alterações desejáveis ao core devem ser propostas upstream; até serem aceitas, ficarão em wrappers ou feature flags próprias.
- Tema claro/escuro, densidade confortável, estados vazios e skeletons.

### 4.3 Fluxos principais

**Criar diagrama:** workspace → projeto → novo → blank/template/import → título → editor já conectado e salvo no servidor.

**Recuperar após crash:** abrir mesma URL → autenticar → carregar snapshot/revisões do servidor → reconciliar fila pendente → informar resultado → continuar.

**Restaurar versão:** histórico → selecionar snapshot → comparar → restaurar → servidor cria nova revisão apontando para o snapshot → todos recebem atualização.

**Editar com IA:** descrever intenção → agente esclarece apenas ambiguidade material → gera plano → executa ferramentas em sandbox lógico → mostra preview/diff → usuário aplica ou descarta → aplicação atômica e auditada.

---

## 5. Arquitetura técnica

### 5.1 Stack de referência

*(emendada por AD-003 e AD-006 — monólito modular sem Redis no MVP; a organização em packages preserva as fronteiras para split futuro)*

- Monorepo TypeScript com `pnpm` workspaces e Turborepo.
- `apps/web`: React, Vite, TypeScript, React Router, TanStack Query, Zustand somente para estado efêmero e `@excalidraw/excalidraw`.
- `apps/server`: Node.js LTS, Fastify, TypeScript, OpenAPI, Zod e PostgreSQL — um único processo com módulos REST, WebSocket e jobs (pg-boss). Split em `api`/`realtime`/`worker` é decisão de fase futura.
- PostgreSQL 16+ para dados relacionais, operações, snapshots, filas (pg-boss) e auditoria.
- Redis 7+ somente a partir da fase de colaboração realtime multi-node (presence/pub-sub); nunca fonte da verdade.
- MinIO/S3 para imagens, exports e backups.
- Reverse proxy Caddy ou Traefik no compose.
- OpenTelemetry, Prometheus e logs JSON; stack de dashboards opcional em profile `observability`.

Versões exatas devem ser fixadas no lockfile e imagens por tag imutável/digest. Não usar `latest`.

### 5.2 Componentes

```text
Browser
  ├── HTTPS/REST ───────> Server (módulo API) ─────> PostgreSQL
  ├── WSS ──────────────> Server (módulo realtime) > PostgreSQL (operation log/snapshots)
  └── signed upload ─────────────────────────────── > MinIO

Server (módulo jobs/pg-boss) ─> MinIO/PostgreSQL
Server ───────────────────────> OpenAI-compatible endpoint (optional, server-side only)
```

### 5.3 Organização do repositório

```text
apps/
  web/
  server/               # monólito modular: api + realtime + jobs (AD-003)
packages/
  editor-adapter/       # única fronteira com APIs do Excalidraw
  diagram-domain/       # elementos, operações, validação, layout
  diagram-ir/           # IR declarativa: schema, validação, compilador p/ cena (AD-004)
  ai-tools/             # schemas e executores de ferramentas
  auth/
  database/
  design-system/
  observability/
  shared-contracts/
  test-fixtures/
infra/
  compose/
  migrations/
  backup/
docs/
  adr/
  operations/
```

### 5.4 Adaptador do Excalidraw

O pacote `editor-adapter` deve:

- Traduzir `ExcalidrawElement[]`, `AppState` permitido e `BinaryFiles` para o domínio.
- Isolar callbacks `onChange`, `onPointerUpdate`, biblioteca, export e API imperativa.
- Calcular diffs por `elementId`, `version`, `versionNonce` e hash canônico.
- Ignorar campos efêmeros de `AppState` na persistência.
- Preservar campos desconhecidos no round-trip quando seguro.
- Manter testes de contrato usando fixtures de ao menos três versões suportadas.
- Expor capabilities próprias, sem importar internals do pacote.

O pacote npm do Excalidraw é uma integração do editor; colaboração e storage corporativos são responsabilidades desta plataforma. O app público oficial é local-first e salva no browser, comportamento que não deve ser replicado como garantia de persistência. Consulte a [documentação oficial](https://docs.excalidraw.com/) e o [repositório oficial](https://github.com/excalidraw/excalidraw) durante a implementação.

### 5.5 Modelo de colaboração e gravação

*(emendada por AD-001 — op-log LWW de domínio em vez de Yjs)*

- O documento canônico por `diagramId` é o par **snapshot + operation log** em PostgreSQL; cada operação carrega o conjunto de elementos afetados com `version`/`versionNonce`.
- Mutações do cliente chegam com revisão base e ID idempotente.
- O servidor valida sessão, permissão, tamanho, schema e limites.
- A operação e seu envelope são gravados em `diagram_operations` em transação; a reconciliação usa LWW por elemento (`reconcileElements`, semântica idêntica ao upstream).
- Somente após commit o servidor emite ACK e broadcast.
- Qualquer nó reconstrói o documento pelo snapshot + operation log do PostgreSQL; na fase realtime multi-node, Redis pub/sub faz apenas fan-out.
- Worker compacta operações em snapshot após 100 operações, 5 minutos ou 1 MB, o que ocorrer primeiro.
- Exclusão é tombstone até compactação segura.
- Undo local gera nova mutação; não apaga histórico.
- Snapshot publicado é imutável.

SLO de perda: **zero operações confirmadas pelo servidor**. Operações ainda não confirmadas podem ser recuperadas da fila local; a UI nunca as rotula como salvas.

---

## 6. Modelo de dados

Todas as tabelas possuem `id UUID`, `created_at`, `updated_at` quando aplicável. Use migrations, foreign keys, índices e exclusão lógica onde indicado.

| Entidade | Campos essenciais |
|---|---|
| `users` | email, display_name, avatar_url, status, auth_subject |
| `organizations` | name, slug, settings_json |
| `workspaces` | organization_id, name, slug, access_policy, deleted_at |
| `workspace_members` | workspace_id, user_id, role |
| `projects` | workspace_id, name, description, status, classification, owner_id |
| `diagrams` | project_id, title, description, status, current_revision, schema_version, owner_id, thumbnail_key, deleted_at |
| `diagram_operations` | diagram_id, sequence, client_mutation_id, actor_id, base_revision, elements_delta_json, operation_summary, created_at *(emendado por AD-001)* |
| `diagram_snapshots` | diagram_id, revision, kind, name, scene_json_key, checksum, created_by, immutable *(emendado por AD-001)* |
| `diagram_elements_meta` | diagram_id, element_id, semantic_type, metadata_json, revision |
| `assets` | diagram_id, storage_key, mime_type, bytes, sha256, status, created_by |
| `comments` | diagram_id, element_id, frame_id, parent_id, body, status, author_id |
| `libraries` | workspace_id nullable, name, version, license, manifest_json, enabled |
| `library_items` | library_id, stable_key, version, scene_json, metadata_json, icon_key |
| `presentations` | diagram_id, name, published_snapshot_id, settings_json |
| `presentation_frames` | presentation_id, element_id/frame_id, position, notes, nav_links_json |
| `spec_documents` | diagram_id, source_revision, version, markdown_key, status, generated_by |
| `ai_provider_configs` | scope, base_url, model, encrypted_token, capabilities_json, enabled |
| `ai_runs` | diagram_id, user_id, provider_config_id, source_revision, status, prompt_redacted, usage_json, error_code |
| `ai_tool_calls` | ai_run_id, tool_name, arguments_redacted, result_summary, approved, sequence |
| `audit_events` | actor_id, action, resource_type, resource_id, ip_hash, metadata_json, created_at |
| `share_links` | resource_type, resource_id, token_hash, role, expires_at, revoked_at |
| `adrs` | project_id, diagram_id, title, status, markdown, linked_element_ids |

Restrições: `client_mutation_id` é único por diagrama; `sequence` é monotônica; checksum de asset é indexado; token e share secret são somente hash/ciphertext; metadados pesquisáveis recebem índices GIN.

---

## 7. APIs e eventos

Todas as APIs usam `/api/v1`, JSON, IDs UUID, paginação cursor-based, erros RFC 9457/problem+json, OpenAPI gerado e `requestId`.

### 7.1 REST principal

```text
POST   /auth/login | /auth/logout | /auth/refresh
GET    /me
GET/POST/PATCH/DELETE /workspaces
GET/POST/PATCH/DELETE /workspaces/{id}/members
GET/POST/PATCH/DELETE /projects
GET/POST/PATCH/DELETE /diagrams
GET    /diagrams/{id}/bootstrap
POST   /diagrams/{id}/operations:batch
GET    /diagrams/{id}/operations?afterSequence=
GET/POST /diagrams/{id}/snapshots
POST   /diagrams/{id}/snapshots/{snapshotId}:restore
GET    /diagrams/{id}/diff?from=&to=
POST   /diagrams/{id}/assets:initiate
POST   /diagrams/{id}/assets/{assetId}:complete
GET/POST/PATCH /diagrams/{id}/comments
POST   /diagrams/{id}/exports
POST   /diagrams/{id}/bundle            # export local completo (.zip)
POST   /workspaces/{id}/bundles         # export em massa (job assíncrono)
POST   /diagrams/{id}/specs:generate
GET    /diagrams/{id}/specs
POST   /diagrams/{id}/ai/runs
POST   /ai/runs/{id}:approve
POST   /ai/runs/{id}:cancel
GET/POST/PATCH /libraries
GET/POST /presentations
GET/POST/PATCH /admin/ai-providers
POST   /admin/ai-providers/{id}:test
GET    /audit-events
GET    /health/live | /health/ready
```

### 7.2 WebSocket

Endpoint: `wss://host/ws/diagrams/{diagramId}` com ticket curto obtido via REST.

Mensagens: `hello`, `sync_request`, `sync_state`, `mutation`, `mutation_ack`, `mutation_rejected`, `presence`, `comment_event`, `permission_changed`, `server_draining`, `ping/pong`.

Cada mensagem possui `protocolVersion`, `diagramId`, `messageId`, `sentAt` e payload validado. Definir limites de 256 KB por mensagem, chunking para sync e compressão controlada. Assets nunca trafegam pelo WebSocket.

### 7.3 Webhooks opcionais

Eventos assinados: `diagram.created`, `diagram.updated`, `diagram.published`, `spec.generated`, `comment.mentioned`. Segredo rotacionável, HMAC, retry exponencial e dead-letter.

---

## 8. Agente de IA

### 8.1 Configuração OpenAI-compatible

O administrador configura por organização ou workspace:

- `baseUrl`, por exemplo `https://provedor.example/v1`;
- token secreto;
- modelo de chat/agent;
- modelo opcional de embeddings;
- timeout, limite de tokens, temperatura e concorrência;
- suporte detectado a tool calling, JSON schema, streaming e visão;
- headers adicionais com allowlist, nunca arbitrários por usuário comum.

O backend concatena paths de forma segura e suporta primariamente `POST /chat/completions` com tool calling. Um adapter opcional pode suportar Responses API. Nunca assumir compatibilidade além das capabilities testadas. O botão “Testar conexão” verifica autenticação, modelo e tool calling sem registrar o token. Segredos são cifrados com AES-256-GCM e master key fornecida por secret; em produção, permitir KMS/Vault.

### 8.2 Contexto entregue ao modelo

- Pedido do usuário e idioma.
- Tipo de diagrama e objetivo.
- Elementos selecionados ou cena semântica compacta.
- Componentes, relações, frames, grupos e metadados relevantes.
- Biblioteca permitida e regras arquiteturais do workspace.
- Viewport somente quando útil.
- Orçamento de mudanças e política de segurança.

Para diagramas grandes, usar seleção → vizinhança → resumo hierárquico → paginação por ferramenta. Não enviar automaticamente imagens/anexos ou comentários confidenciais.

### 8.3 IR declarativa e ferramentas do agente *(fortalecida por AD-004)*

**Geração de novo (criação):** o agente emite uma **IR declarativa** (`diagram-ir/v1`) — grafo tipado com nós, containers (VPC, zona, bounded context, swimlane), edges com semântica (sync/async, protocolo, direção) e hints de layout. O servidor valida a IR contra JSON Schema versionado, resolve componentes por `stable_key` da biblioteca autorizada e compila para cena Excalidraw via layout determinístico. A mesma IR alimenta import/export Mermaid/Structurizr e permite geração programática sem LLM.

**Edição incremental:** ferramentas JSON Schema versionadas e executadas pelo backend:

- `inspect_diagram`, `get_selection`, `search_elements`, `get_neighbors`;
- `search_library`, `get_library_component`;
- `create_element`, `create_component`, `create_group`, `create_frame`;
- `update_element`, `delete_elements`, `duplicate_elements`;
- `connect_elements`, `update_connector`, `set_semantic_metadata`;
- `align_elements`, `distribute_elements`, `auto_layout`, `resize_container`;
- `add_annotation`, `add_comment`, `create_presentation_frames`;
- `validate_architecture`, `summarize_diagram`, `generate_spec_draft`;
- `generate_ir`, `compile_ir`, `propose_patch`, `preview_patch`, `apply_patch`, `revert_ai_run`.

Não expor uma ferramenta de “executar código”, SQL, shell, URL arbitrária ou gravação genérica. Todo ID deve pertencer ao diagrama e toda biblioteca deve estar autorizada.

### 8.4 Pipeline de criação/edição

1. Classificar intenção: criar, editar, reorganizar, revisar, explicar ou documentar.
2. Construir contexto mínimo necessário.
3. Para criação: produzir IR completa; para edição: plano curto e patch abstrato.
4. Validar schemas, permissões, quantidade, bounds, links e assets.
5. Resolver componentes de biblioteca por chave estável.
6. Aplicar algoritmo de layout determinístico no servidor; o LLM não define cada pixel quando regras resolvem melhor.
7. Renderizar preview em camada fantasma e resumo: adicionados, removidos, movidos, conectados e metadados alterados.
8. Exigir aprovação para remoções, mais de 50 elementos, mudança de spec publicada ou alteração fora da seleção solicitada.
9. Aplicar patch atômico contra `sourceRevision`; se a revisão mudou, recalcular ou pedir nova confirmação.
10. Criar snapshot `pre-ai`, registrar auditoria e permitir Undo completo.

### 8.5 Layout inteligente

- Direcionado por grafo: ELK.js ou Dagre para fluxos; algoritmo próprio para grids e boundaries; layout de swimlanes para processos de negócio.
- Presets: C4, cloud zones, event-driven, sequência horizontal, fluxo de negócio, swimlane, mobile/web stack, wireframe e network topology.
- Espaçamento e roteamento determinísticos; evitar overlaps, cruzamentos e texto truncado.
- Containers para accounts, regions, VPCs, subnets, clusters, bounded contexts e trust boundaries.
- Diferenciar visualmente sync, async, data flow e dependency.
- Após layout, executar validações geométricas e no máximo três passes de correção.
- **Métricas geométricas determinísticas** (overlaps, crossings, labels truncados, balanceamento de whitespace) computadas em CI para todo output do pipeline.

### 8.6 Casos obrigatórios de avaliação

O conjunto de evals deve incluir prompts para:

1. AWS multi-AZ com CloudFront, WAF, ALB, ECS/EKS, RDS, Redis e observabilidade.
2. Microsserviços event-driven com gateway, BFF, Kafka/SNS/SQS, retries e DLQ.
3. App mobile + web → BFFs → gateway → serviços → dados.
4. C4 Context e Container de e-commerce.
5. Fluxo de aprovação de negócio com exceções (swimlanes).
6. Reorganizar diagrama desordenado sem mudar semântica.
7. Revisar riscos e marcar pontos únicos de falha.
8. Gerar spec fiel sem inventar protocolos ou SLAs.
9. Recusar prompt injection contido em texto de um elemento.
10. Alterar somente a seleção indicada.
11. Wireframe de app mobile com 4 telas e navegação. *(escopo prototipagem)*

Métricas: validade de schema, taxa de patch aplicável, elementos órfãos, overlaps, crossings, fidelidade semântica, violações de escopo, latência, custo e avaliação humana.

---

## 9. Autenticação, autorização e segurança

### 9.1 Autenticação

- MVP: contas locais com email/senha, Argon2id, verificação de email opcional e sessão em cookie `HttpOnly`, `Secure`, `SameSite=Lax`.
- Produção: OIDC genérico com PKCE; mapear grupos para workspaces/papéis.
- MFA via IdP; TOTP local como pós-MVP.
- Refresh token rotacionado e revogável; sem tokens em `localStorage`.

### 9.2 RBAC

Papéis: `org_admin`, `workspace_admin`, `editor`, `reviewer`, `viewer`. Permissões calculadas no backend por recurso. Projetos podem restringir herança. Viewer não abre socket de escrita; reviewer escreve apenas comentários; restauração, publicação, configuração de IA e gestão de membros exigem permissões específicas.

### 9.3 Controles

- TLS obrigatório fora de localhost; CSP restritiva, CSRF, CORS por allowlist e headers de segurança.
- Validação e sanitização de SVG (profile restritivo server-side, ex.: DOMPurify), Markdown e nomes de arquivo; bloquear scripts e external references.
- Upload por allowlist MIME, tamanho, checksum e antivírus opcional.
- Rate limiting por usuário/IP/ação, limites específicos para IA e export.
- SSRF: `baseUrl` de IA configurável apenas por admin, validação de esquema, bloqueio de link-local/metadata/private ranges por padrão e allowlist corporativa opcional.
- Prompt injection: conteúdo do diagrama é dado não confiável; não pode alterar instruções do agente nem habilitar ferramentas.
- Auditoria append-only para login, acesso administrativo, permissão, restore, publish, export, configuração de IA e patches de IA.
- Redação de PII e segredos em logs. Nunca logar Authorization, cookies, tokens, prompts completos por padrão ou cenas completas.
- SBOM, scan de dependências/imagens, assinatura de releases e secrets fora do Git.
- Política de retenção por workspace e exclusão com tombstone + purge auditado.

### 9.4 Threat model mínimo

Cobrir em ADR/testes: usuário acessando outro workspace, IDOR, ticket WebSocket reutilizado, mutation replay, SVG malicioso, zip bomb, SSRF do provedor de IA, exfiltração via prompt, vazamento em logs, escalada de papel, share link roubado, corrupção de snapshot, operação fora de ordem e consumo abusivo de IA.

---

## 10. Storage, backup e disaster recovery

- PostgreSQL guarda metadados, operation log, snapshots e auditoria.
- MinIO guarda assets, cenas canônicas grandes, thumbnails, exports, specs e bundles de backup.
- Bucket privado, URLs assinadas curtas, versioning e lifecycle configuráveis.
- Deduplicação de assets por SHA-256 dentro do tenant, sem revelar existência entre tenants.
- Backup completo diário e incremental/WAL quando disponível; retenção padrão 30 dias.
- Backup inclui banco, objetos e manifesto com versões/checksums.
- Criptografia em trânsito e em repouso; chaves fora do backup ou envelopadas.
- Comando documentado `backup:create`, `backup:verify` e `backup:restore`.
- Teste de restore mensal automatizado em ambiente isolado.
- Metas iniciais: RPO ≤ 15 min em produção, RTO ≤ 4 h; local compose pode usar backup diário.

---

## 11. Observabilidade e operação

- Logs JSON com `timestamp`, `level`, `service`, `requestId`, `userId` pseudonimizado, `workspaceId`, `diagramId`, `operation` e erro seguro.
- Métricas: latência/erro REST e WS, conexões, ACK latency, fila pendente, operações/s, snapshot time, Postgres/MinIO health, jobs, AI latency/tokens/errors/custo estimado e exports.
- Traces OpenTelemetry entre módulos, banco, storage e chamada de IA, sem payload sensível.
- Dashboards para experiência de edição, colaboração, persistência, IA e capacidade.
- Alertas: ACK p95 > 2 s, erro save > 1%, fila de jobs atrasada, snapshot falhando, storage indisponível, backup/restore inválido e aumento de auth failures.
- Endpoints liveness/readiness separados; graceful shutdown drena WebSockets e jobs.

SLO inicial: 99,9% disponibilidade mensal do save; p95 ACK < 1 s na LAN com lote normal; bootstrap p95 < 3 s para diagrama de 5 mil elementos; zero perda de operações confirmadas.

---

## 12. Docker Compose local

*(emendada por AD-003/AD-006)*

Entregar `compose.yaml`, `.env.example`, healthchecks, volumes nomeados, profiles e script/Make targets multiplataforma.

Serviços obrigatórios no MVP:

```yaml
services:
  proxy:       # porta única HTTP/HTTPS local
  server:      # monólito modular: REST + WebSocket + jobs (pg-boss)
  web:         # frontend estático (pode ser servido pelo proxy)
  postgres:    # dados duráveis + filas
  minio:       # assets/exports/backups
  minio-init:  # cria buckets/policies idempotentemente
  migrate:     # one-shot migrations
```

Profiles opcionais: `observability` com Prometheus/Grafana/OTel Collector; `oidc-dev` com Keycloak; `ai-local` documentando endpoint compatível externo ou container opcional, sem tornar GPU requisito; `realtime-scale` adiciona Redis quando a fase de colaboração multi-node chegar.

Comandos esperados:

```text
cp .env.example .env
docker compose up --build
docker compose run --rm migrate
docker compose --profile observability up
```

Após o primeiro comando, a aplicação deve estar acessível em uma única URL, criar admin inicial de forma segura, exibir health consolidado e não depender da internet. Volumes: `postgres-data`, `minio-data` e `backups`. O README deve explicar reset destrutivo separadamente, nunca como passo normal.

Configurações mínimas: public URL, secrets de sessão/encriptação, credenciais de banco/storage, limites, SMTP opcional, OIDC opcional, retenção e provider de IA. Fornecer valores de desenvolvimento claramente inseguros somente em `.env.example`; produção deve falhar ao iniciar com defaults conhecidos.

---

## 13. Requisitos não funcionais

- **Performance:** canvas de 5.000 elementos utilizável; pan/zoom sem bloqueios prolongados; operações em lote; thumbnails no worker.
- **Escalabilidade:** módulos stateless exceto stores; split de serviços e múltiplos realtime nodes via Redis quando necessário; particionamento futuro por `diagramId`.
- **Compatibilidade:** últimas duas versões estáveis de Chrome, Edge, Firefox e Safari; desktop-first, tablet read/review.
- **Acessibilidade:** WCAG 2.2 AA no shell próprio; foco visível, contraste, teclado, labels e reduced motion.
- **Internacionalização:** nenhuma string própria hardcoded; PT-BR e EN.
- **Portabilidade:** x86_64 e arm64; S3-compatible; OIDC genérico; sem cloud lock-in.
- **Manutenibilidade:** TypeScript strict, limites de dependência entre packages, ADRs, OpenAPI e migrations reversíveis quando seguro.
- **Privacidade:** telemetria externa desligada por padrão; nenhum asset ou prompt sai do ambiente exceto para o base URL de IA explicitamente configurado.
- **Busca:** PostgreSQL puro (FTS + `pg_trgm` + índices GIN); sem engine de busca dedicada.

---

## 14. Estratégia de atualização upstream do Excalidraw

1. Consumir somente `@excalidraw/excalidraw` do registry, versão exata no lockfile.
2. Toda integração passa por `packages/editor-adapter`.
3. Nunca importar caminhos internos como `@excalidraw/excalidraw/**/internal`.
4. Renovate/Dependabot abre PR mensal, nunca auto-merge para major/minor.
5. Pipeline do PR executa typecheck, contract tests, import/export round-trip, snapshots de cena, colaboração, keyboard smoke e regressão visual.
6. Manter corpus de diagramas: texto, bindings, arrows, images, frames, groups, libraries, custom fonts e cenas grandes.
7. Atualizar uma versão por vez; ler release notes e registrar breaking changes.
8. Feature flags desligam integrações próprias frágeis sem bloquear o editor.
9. CSS customizado recebe screenshot tests; preferência por design tokens no shell.
10. Patch emergencial deve viver no adapter, ter issue upstream e prazo de remoção. `patch-package` é proibido salvo exceção temporária aprovada por ADR.

O próprio projeto oficial diferencia o pacote integrável do app completo e documenta mudanças de integração nas releases; acompanhar [releases oficiais](https://github.com/excalidraw/excalidraw/releases) em cada atualização. A colaboração do pacote não deve ser presumida como serviço pronto: a plataforma implementará seu protocolo e persistência, em vez de acoplar a garantia de dados a um backend de demonstração.

---

## 15. Roadmap *(reordenado por AD-002 — AI-first)*

### Fase 0 — Fundação (1–2 semanas)

- Monorepo, CI, compose (monólito modular), migrations, health, design system, ADRs e threat model inicial.
- Spike do adapter Excalidraw e benchmark de cenas.
- **Spike de renderização server-side** (`exportToSvg` + resvg/sharp vs Chromium headless) — AD-005.

### Fase 1 — MVP server-first (4–6 semanas)

- Auth local, workspaces, projetos, RBAC.
- Editor encapsulado, assets em MinIO, autosave durável (op-log LWW), recovery e indicadores.
- Snapshots, restore, import/export `.excalidraw`/PNG/SVG/PDF e bundle `.zip` local.
- Testes de crash/reload e backup/restore.

### Fase 2 — IA geradora (4–6 semanas)

- Provider config, secret handling, `diagram-ir/v1`, compilador IR→cena, layout determinístico.
- Biblioteca base (genérica + AWS) e metadados semânticos essenciais (dependência da qualidade de geração).
- Tools de edição, preview/approval/undo, criação, edição e reorganização.
- Evals com métricas geométricas, budgets, rate limits e métricas.

### Fase 3 — Arquitetura, documentação e apresentação (3–4 semanas)

- Biblioteca completa, C4, templates, lint arquitetural e comentários assíncronos.
- Geração de spec a partir do canvas.
- Frames, modo apresentação, protótipos navegáveis, wireframe kit, links read-only e PDF.
- Mermaid/Structurizr export/import via IR.

### Fase 4 — Colaboração realtime (3–5 semanas)

- Realtime multi-usuário sobre o op-log, presença, reconexão, idempotência e multi-node (Redis entra aqui).
- Follow-user, diff ao vivo e revisão colaborativa.

### Fase 5 — Hardening (2–4 semanas)

- OIDC, performance, acessibilidade, segurança, observabilidade, DR, documentação operacional e piloto.

O MVP interno mínimo termina na Fase 2 (persistência + IA geradora); a visão completa termina na Fase 4. Não antecipar IA antes de a persistência, versionamento e undo estarem confiáveis.

---

## 16. Critérios de aceite end-to-end

### Persistência e recuperação

- Dado um usuário que cria 100 alterações e vê `Salvo`, quando o processo do browser é morto e o diagrama é aberto em outra máquina, então as 100 alterações reaparecem.
- Dado um ACK perdido, quando o cliente reenvia o mesmo `clientMutationId`, então há uma única operação durável.
- Dado PostgreSQL indisponível, a UI não mostra `Salvo`; ao recuperar, a fila é reenviada em ordem.
- Dado MinIO indisponível, um elemento de imagem não é confirmado com referência quebrada.
- Restaurar snapshot cria nova revisão; snapshots e revisões posteriores continuam consultáveis.

### Colaboração

- Dois usuários editando elementos diferentes convergem para a mesma cena após reconexão.
- Viewer não consegue mutar por REST nem WebSocket.
- Uma instância reiniciada reconstitui o documento a partir do PostgreSQL.
- Presença pode sumir sem afetar conteúdo durável.

### IA

- Base URL e token configurados no admin funcionam sem token aparecer no browser/log.
- “Crie arquitetura AWS multi-AZ…” produz componentes licenciados da biblioteca, relações semânticas e layout sem overlaps graves.
- A IA mostra preview, não altera o canvas antes da aprovação e permite Undo integral.
- Patch contra revisão antiga não sobrescreve mudanças recentes.
- “Gere uma spec” referencia a revisão e não inventa campos ausentes.
- Texto malicioso em um elemento não consegue acionar ferramenta proibida nem mudar configurações.

### Upstream e operação

- Atualizar o Excalidraw para uma versão de teste altera apenas lockfile/adapter quando necessário, e o corpus passa.
- `docker compose up --build` em máquina limpa sobe todos os serviços com healthchecks verdes.
- Backup restaurado em stack vazia mantém usuários, permissões, cenas, assets, versões e checksums.
- O sistema opera com saída de internet bloqueada, exceto quando o admin testa uma IA externa.

---

## 17. Estratégia de testes

- **Unitários:** domínio, diff, schemas, autorização, layout, redaction, idempotência e serializers.
- **Contrato:** OpenAPI, WebSocket protocol, adapter Excalidraw, S3 e providers OpenAI-compatible simulados.
- **Integração:** PostgreSQL/MinIO reais via containers; migrations e restore.
- **E2E:** Playwright com dois browsers, crash/reload, offline/reconnect, roles, snapshots, AI preview e presentation.
- **Property-based:** sequências aleatórias de create/update/delete/reorder e round-trip de cena e de IR.
- **Concorrência/chaos:** kill do server, latência, duplicação/reordenação de mensagens e failover de banco simulado.
- **Visual:** screenshots do shell/editor, temas e upgrades upstream.
- **Performance:** 1k/5k/10k elementos, 20 colaboradores, bootstrap, ACK, snapshot e export.
- **Segurança:** SAST, SCA, image scan, secret scan, IDOR matrix, malicious SVG/Markdown, CSRF, SSRF e WebSocket auth.
- **IA evals:** dataset versionado, provider mock determinístico, métricas geométricas em CI e execução periódica em modelo real opcional.

Gates de CI: lint, format, typecheck, unit, integration, contract, migration check, build de imagens, SBOM e testes E2E críticos. Nightly: browsers completos, performance, chaos, visual e AI evals.

---

## 18. Definition of Done

Uma história só está pronta quando:

- comportamento e erro estão implementados no backend e frontend;
- autorização é testada, não apenas escondida na UI;
- persistência sobrevive a reload/restart quando aplicável;
- há testes proporcionais ao risco e todos passam;
- observabilidade e mensagens ao usuário existem;
- schemas/OpenAPI/migrations e i18n foram atualizados;
- acessibilidade básica foi verificada;
- não há secret, token, payload sensível ou dependência SaaS acidental;
- documentação operacional e ADR foram atualizadas quando necessário;
- a função funciona no Docker Compose limpo;
- mudanças no adapter passam no corpus de compatibilidade upstream.

A release da visão completa só está pronta quando todos os critérios end-to-end da seção 16 passam, um restore real foi demonstrado, o threat model foi revisado, o piloto com ao menos dois times foi concluído e nenhuma operação confirmada foi perdida nos testes de falha.

---

## 19. Sequência recomendada de implementação para a IA

1. Criar ADRs: server-first, operation log LWW, storage, auth, AI tool boundary, IR, server-side rendering e upstream adapter.
2. Scaffold do monorepo e compose com healthchecks.
3. Implementar schema/migrations, auth e RBAC com matriz de testes.
4. Integrar Excalidraw exclusivamente pelo adapter e salvar snapshot inicial.
5. Implementar operation log, ACK durável, recovery e fila local.
6. Provar os cenários de crash antes de avançar.
7. Adicionar assets, snapshots, restore e backup/restore.
8. Implementar `diagram-ir`, biblioteca base, layout determinístico e IA pelas ferramentas de domínio.
9. Adicionar semântica completa, C4, spec generation e apresentação/protótipos.
10. Adicionar realtime, presença e comentários ao vivo.
11. Executar hardening, performance, acessibilidade, observabilidade e piloto.

Em cada passo, entregar código funcional, migration, testes, documentação curta e evidência do critério de aceite. Não criar dezenas de abstrações vazias antecipadamente.

---

## 20. Decisões que devem permanecer configuráveis

- Marca, nome final e licença da plataforma.
- IdP OIDC e mapeamento de grupos.
- Provider/modelo OpenAI-compatible.
- Retenção, RPO/RTO e políticas de classificação.
- Bibliotecas de ícones permitidas e suas licenças.
- Limites de IA, upload, diagrama, colaboradores e share links.
- S3/MinIO, SMTP, KMS/Vault e observabilidade corporativa.

Essas decisões não bloqueiam o scaffold: implementar interfaces, defaults locais seguros e validação de configuração.
