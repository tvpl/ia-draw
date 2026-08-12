# Architecture Canvas — Especificação da Plataforma

**Documento-fonte detalhado:** `docs/product-spec.md` (spec de produto/engenharia do product owner, emendada pelas decisões AD-001..AD-006 em `.specs/STATE.md`). Este arquivo é a spec normativa: requisitos rastreáveis em EARS, priorizados por fase de entrega.

## Problem Statement

Times de engenharia perdem trabalho e contexto ao desenhar arquiteturas em ferramentas local-first (o browser é a fonte da verdade) e gastam horas produzindo diagramas de qualidade manualmente. Precisamos de uma plataforma self-hosted onde diagramas técnicos e de negócio vivem no servidor com durabilidade garantida, e onde IA gera e edita diagramas de alta qualidade de forma segura, explicável e reversível — com export local sempre disponível quando o usuário quiser.

## Goals

- [ ] Zero perda de operações confirmadas pelo servidor: crash de browser, reload ou troca de máquina nunca apagam trabalho marcado como `Salvo`.
- [ ] IA gera diagramas técnicos (AWS, C4, microsserviços) e de negócio (fluxos, swimlanes) prontos para uso — sem overlaps, com semântica e componentes de biblioteca — a partir de linguagem natural, sempre com preview, aprovação e undo.
- [ ] Instalação completa por `docker compose up` em uma única URL, funcionando sem internet (exceto o endpoint de IA configurado).
- [ ] Export local com fidelidade total (`.excalidraw`, SVG, PNG, PDF e bundle `.zip` com assets e metadados).
- [ ] Backup com restore testado automaticamente.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| --- | --- |
| Substituir Figma/Penpot (UI design hi-fi) | Prototipagem limitada a wireframes low-fi + navegação entre frames |
| Edição nativa de arquivos Visio | Custo alto, valor baixo para o público-alvo |
| Descoberta automática de cloud (credenciais AWS/GCP/Azure) | Superfície de segurança e escopo desproporcionais ao MVP |
| Coedição offline prolongada com merge perfeito | Op-log LWW cobre reconexão curta; merge offline longo é problema distinto |
| Marketplace público de plugins | Plataforma interna; extensibilidade via bibliotecas curadas |
| Apps desktop/mobile nativos | Web desktop-first; tablet read/review |
| Yjs CRDT no MVP | AD-001: op-log LWW nativo; Yjs só se co-edição textual granular exigir (ADR futura) |
| Engine de busca dedicada (Elasticsearch etc.) | PostgreSQL FTS + pg_trgm cobre o caso; menos ops |
| Multitenancy físico | Organização única no MVP, preparada para multitenancy lógico |
| PlantUML import/export | Fase posterior a Mermaid/Structurizr |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Modelo de sincronização | Op-log LWW nativo do Excalidraw (`version`/`versionNonce` + `reconcileElements`); Yjs adiado | Auditável, validável por permissão, alinhado ao upstream; corta semanas de complexidade | y |
| Ordem do roadmap | IA geradora antes de colaboração realtime | O diferencial declarado é IA de qualidade; realtime é a infra mais cara e pode esperar | y |
| Topologia do MVP | Monólito modular (um processo Node: API+WS+jobs) com packages separados | Split futuro é trivial com fronteiras nos packages; compose com ~7 serviços em vez de 10 | y |
| Escopo de "prototipagem" | Wireframe kit low-fi + protótipos navegáveis (links elemento→frame no modo apresentação) | Escolha do usuário na discussão; entra como fase própria (Fase 3) | y |
| Renderização server-side (thumbnails/PNG/PDF/preview) | `exportToSvg` (pacote utils) em Node + rasterização resvg/sharp; fallback Chromium headless se fidelidade exigir | Evita Chromium no worker como requisito; spike obrigatório na Fase 0 valida a rota | n |
| Fila de jobs no MVP | pg-boss sobre PostgreSQL; Redis entra apenas na fase realtime multi-node | Um store a menos para operar; Redis nunca é fonte da verdade de qualquer forma | n |
| Busca | PostgreSQL FTS + `pg_trgm` + índices GIN | Cobre título/tags/texto/metadados sem engine dedicada | n |
| Autenticação MVP | Contas locais Argon2id + cookie HttpOnly/Secure/SameSite=Lax; OIDC PKCE na fase de hardening | Conforme documento-fonte §9.1 | y |
| Internacionalização | PT-BR + EN desde o MVP, zero strings hardcoded | Conforme documento-fonte; barato se feito desde o início | y |
| Ícones AWS | Asset pack oficial da AWS com atribuição registrada por item | Os termos do pack oficial permitem uso em diagramas de arquitetura; licença registrada por item conforme §3.5 | n |
| Stack de referência | Fastify + React/Vite + PostgreSQL 16 + MinIO + pnpm/Turborepo, versões pinadas | Conforme documento-fonte §5.1, emendado por AD-003/AD-006 | y |
| Licença/marca do produto | A definir pela empresa; MIT do Excalidraw respeitada com avisos | Documento-fonte §20 mantém configurável; não bloqueia scaffold | n |
| Limiar de aprovação de patch de IA | Remoções, >50 elementos ou mudanças fora da seleção exigem aprovação explícita | Conforme documento-fonte §8.4; valor inicial ajustável por workspace | n |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Instalação self-hosted com um comando ⭐ MVP

**User Story**: Como operador, quero subir a plataforma inteira com `docker compose up` para ter tudo rodando self-hosted sem depender de SaaS.

**Why P1**: Invariante do produto — sem instalação simples e offline, nada mais é demonstrável.

**Acceptance Criteria**:

1. WHEN an operator runs `cp .env.example .env && docker compose up --build` on a clean machine THEN the system SHALL become usable at a single public URL with all container healthchecks green.
2. The system SHALL operate with outbound internet blocked, except for calls to the explicitly configured AI base URL.
3. IF production mode starts with a known development default secret THEN the system SHALL refuse to boot with an explanatory error.
4. WHEN the stack starts for the first time THEN the system SHALL create the initial admin through a secure one-time bootstrap flow, never a fixed default password.
5. The system SHALL expose separate liveness and readiness endpoints and drain WebSocket connections and jobs on graceful shutdown.

**Independent Test**: `docker compose up --build` em VM limpa sem internet (exceto pull prévio) → login do admin bootstrap → health verde.

---

### P1: Contas, workspaces e RBAC ⭐ MVP

**User Story**: Como administrador, quero contas locais, workspaces, projetos e papéis para controlar quem vê e edita cada diagrama.

**Why P1**: Toda persistência e auditoria dependem de identidade e permissão calculadas no backend.

**Acceptance Criteria**:

1. WHEN a user authenticates with email and password THEN the system SHALL verify an Argon2id hash and establish the session via an HttpOnly, Secure, SameSite=Lax cookie.
2. The system SHALL compute permissions in the backend for the roles org_admin, workspace_admin, editor, reviewer and viewer on every REST and WebSocket operation.
3. IF a viewer or reviewer sends a canvas mutation via REST or WebSocket THEN the system SHALL reject it with HTTP 403 (or `mutation_rejected`) and record an audit event.
4. IF a user requests a resource in a workspace they do not belong to THEN the system SHALL respond 404 without revealing that the resource exists.
5. WHEN a workspace admin changes a member's role THEN the system SHALL enforce the new permission on already-open sessions within 10 seconds.

**Independent Test**: matriz de papéis × operações via API (IDOR matrix) passa; troca de papel derruba escrita de sessão aberta.

---

### P1: Edição server-first com persistência durável ⭐ MVP

**User Story**: Como editor, quero desenhar no Excalidraw com cada alteração confirmada no servidor para nunca depender do browser como fonte da verdade.

**Why P1**: É o invariante central da plataforma e o pré-requisito de todo o resto.

**Acceptance Criteria**:

1. WHEN a diagram is opened THEN the system SHALL bootstrap from the server the current snapshot, revision, referenced assets and permissions before enabling editing.
2. WHEN the user edits the canvas THEN the client SHALL batch changes into domain mutations carrying clientMutationId, base revision and author, debounced between 500 and 1000 ms, with flush on visibilitychange, pagehide and internal navigation.
3. The system SHALL mark a mutation as saved only after the server confirms a durable PostgreSQL commit (ack strictly after commit).
4. WHEN the same clientMutationId is submitted more than once THEN the system SHALL persist exactly one durable operation and re-acknowledge idempotently.
5. The system SHALL display the save state as exactly one of: Salvo, Salvando…, Offline — N alterações pendentes, Conflito, Somente leitura.
6. WHEN an image is added to the canvas THEN the system SHALL upload the asset to object storage and confirm it before acknowledging the referencing element.
7. The system SHALL integrate Excalidraw exclusively through the editor-adapter package, never importing internal upstream paths.

**Independent Test**: editar → matar API no meio do lote → UI nunca mostra `Salvo` sem commit; reenvio do mesmo `clientMutationId` gera uma única linha em `diagram_operations`.

---

### P1: Recuperação após crash e reconexão ⭐ MVP

**User Story**: Como editor, quero que fechar a aba, matar o browser ou trocar de máquina nunca perca alterações confirmadas, e que pendências sejam reconciliadas com transparência.

**Why P1**: SLO de perda zero é o motivo de existir da plataforma.

**Acceptance Criteria**:

1. WHEN the browser process is killed and the same diagram URL is reopened on any machine THEN the system SHALL restore every change previously confirmed as Salvo.
2. IF the browser closes holding unconfirmed pending mutations THEN the client SHALL resend the pending queue after authentication and report the reconciliation result, never merging silently over a newer server revision.
3. IF PostgreSQL is unavailable THEN the system SHALL keep the UI out of the Salvo state and resend the pending queue in order once the database recovers.
4. WHEN a client reconnects with a stale revision THEN the server SHALL send the missing operations, acknowledge duplicates and reject unauthorized mutations.
5. IF two users modify the same element concurrently THEN the system SHALL converge via per-element last-writer-wins (version/versionNonce) while keeping both variants detectable in the operation history.

**Independent Test**: E2E Playwright — 100 edições com `Salvo`, kill do browser, abrir em outro contexto → 100 edições presentes.

---

### P1: Snapshots, histórico, diff e restore ⭐ MVP

**User Story**: Como editor, quero versões nomeáveis e automáticas com comparação e restauração para nunca ficar refém de um estado ruim.

**Why P1**: Undo durável e restore são pré-requisito do pipeline de IA (snapshot `pre-ai`).

**Acceptance Criteria**:

1. WHEN 100 operations, 5 minutes or 1 MB of accumulated operations is reached (whichever first) THEN the system SHALL compact the operation log into a snapshot without interrupting editing.
2. WHEN a user restores a snapshot THEN the system SHALL create a new revision pointing to it while keeping all later revisions and snapshots queryable.
3. The system SHALL keep published snapshots immutable.
4. WHEN a user compares two snapshots THEN the system SHALL report added, removed, moved and modified elements.

**Independent Test**: gerar >100 operações → snapshot automático criado; restore cria revisão nova e histórico posterior permanece consultável.

---

### P1: Configuração segura de provider de IA ⭐ MVP

**User Story**: Como org admin, quero configurar um endpoint OpenAI-compatible (baseUrl, token, modelo) com segurança para habilitar IA sem vazar segredos.

**Why P1**: Porta de entrada de toda a capacidade de IA; segurança é invariante (token nunca no browser).

**Acceptance Criteria**:

1. WHEN an org admin saves an AI provider configuration THEN the system SHALL encrypt the token with AES-256-GCM and SHALL never include it in any API response, log, trace or frontend bundle.
2. WHEN the admin runs "Testar conexão" THEN the system SHALL verify authentication, model availability and tool-calling support without persisting or logging the token in the process.
3. IF the configured baseUrl resolves to link-local, metadata or private ranges without an explicit corporate allowlist THEN the system SHALL reject the configuration.
4. The system SHALL enforce per-user and per-workspace rate limits and token budgets on AI runs.

**Independent Test**: configurar provider mock → grep de token em respostas/logs/bundle retorna vazio; baseUrl `http://169.254.169.254` é rejeitada.

---

### P1: Geração de diagramas por IA via IR declarativa ⭐ MVP

**User Story**: Como arquiteto, quero descrever um sistema em linguagem natural e receber um diagrama técnico ou de negócio pronto — componentes de biblioteca, semântica e layout limpo — para ganhar horas por diagrama.

**Why P1**: É o diferencial declarado do produto (AD-002 antecipou para o MVP).

**Acceptance Criteria**:

1. WHEN a user requests diagram generation in natural language THEN the agent SHALL produce a typed intermediate representation (diagram-ir/v1: nodes, containers, semantic edges, swimlanes, layout hints) validated against a versioned JSON Schema before any canvas element is created.
2. WHEN a valid IR is produced THEN the server SHALL resolve components against the authorized library by stable key and compute positions with a deterministic layout engine (layered for flows, grid for cloud zones and C4, swimlanes for business processes).
3. The system SHALL produce generated scenes with zero overlapping nodes and zero truncated labels for scenes up to 200 elements.
4. WHEN generation completes THEN the system SHALL present the result as a preview layer without modifying the canvas.
5. WHEN the user approves a generation preview THEN the system SHALL apply the patch atomically against the source revision, creating a pre-ai snapshot as a full undo point.
6. IF the IR references a library component or element ID outside the authorized scope THEN the system SHALL reject the patch before preview.
7. The system SHALL compute deterministic geometric quality metrics (overlap count, edge crossings, truncated labels) for every generation in the eval suite, runnable in CI with a mock provider.

**Independent Test**: prompt "AWS multi-AZ com ALB, ECS, RDS e observabilidade" contra provider mock determinístico → IR válida, cena compilada com métricas geométricas zeradas, aplicada só após aprovação, undo restaura estado anterior.

---

### P1: Edição por IA com preview, aprovação e undo ⭐ MVP

**User Story**: Como editor, quero pedir alterações por linguagem natural com preview e reversão para confiar na IA sem medo de perder trabalho.

**Why P1**: Complementa a geração; mesmo pipeline seguro (tools de domínio, patch atômico).

**Acceptance Criteria**:

1. The agent SHALL act exclusively through versioned domain tools (inspect, create, update, connect, layout, metadata, patch), never writing raw scene JSON, SQL or arbitrary URLs.
2. IF a proposed patch removes elements, touches more than 50 elements or modifies content outside the requested selection THEN the system SHALL require explicit user approval before applying.
3. IF the base revision changed between preview and apply THEN the system SHALL recompute the patch or request re-confirmation, never overwriting newer changes.
4. IF text inside a diagram element contains instructions directed at the agent THEN the agent SHALL treat it as untrusted data, keeping tools, configuration and scope unchanged.
5. WHEN an AI run completes THEN the system SHALL record the run, its tool calls with redacted arguments and token usage in the append-only audit trail.

**Independent Test**: eval de prompt injection (texto malicioso em elemento) não aciona ferramenta proibida; patch contra revisão antiga não sobrescreve mudança recente.

---

### P1: Biblioteca de componentes e metadados semânticos ⭐ MVP

**User Story**: Como arquiteto, quero componentes curados (genéricos + AWS) com semântica estruturada para que diagramas manuais e gerados falem a mesma língua.

**Why P1**: A qualidade da geração por IA depende da biblioteca e da semântica (dependência direta de AIG).

**Acceptance Criteria**:

1. The system SHALL ship a curated component library (generic and AWS categories) where every icon records its license and attribution.
2. WHEN a user inserts a component via palette, search or slash command THEN the system SHALL attach semantic metadata to the element by elementId in the platform's own model, never modifying upstream Excalidraw types.
3. WHEN a user edits semantic metadata in the properties panel THEN the system SHALL persist it linked to the element and current revision.
4. WHEN an inventory export is requested THEN the system SHALL produce CSV and JSON of components and their semantic relations.

**Independent Test**: inserir componente AWS → metadados persistidos em `diagram_elements_meta`; export CSV/JSON confere com a cena.

---

### P1: Export e salvamento local ⭐ MVP

**User Story**: Como usuário, quero exportar qualquer diagrama para arquivos locais (`.excalidraw`, SVG, PNG, PDF e bundle completo) para ter cópia própria quando eu quiser.

**Why P1**: Requisito explícito do product owner: tudo no servidor, mas salvar local sempre possível.

**Acceptance Criteria**:

1. WHEN a user exports a diagram THEN the system SHALL produce .excalidraw, SVG, PNG and PDF files rendered server-side.
2. WHEN a user requests a local bundle THEN the system SHALL produce a .zip containing scene, assets, semantic metadata and generated specs with a checksum manifest.
3. WHEN a user imports a .excalidraw file THEN the system SHALL validate the schema and show a preview before creating the diagram.
4. WHERE workspace bulk export is requested by a workspace admin, the system SHALL produce bundles for all diagrams of the workspace as an asynchronous job.

**Independent Test**: export bundle → unzip local contém cena + assets + metadados com checksums válidos; import round-trip preserva a cena.

---

### P1: Backup com restore testado ⭐ MVP

**User Story**: Como operador, quero backups automáticos cuja restauração é testada por máquina para confiar no disaster recovery.

**Why P1**: Invariante 10 do documento-fonte; sem isso o server-first é promessa vazia.

**Acceptance Criteria**:

1. WHEN the scheduled backup runs THEN the system SHALL produce a bundle containing database, objects and a manifest with versions and checksums.
2. The system SHALL provide documented backup:create, backup:verify and backup:restore commands.
3. WHEN backup:restore runs against an empty stack THEN the system SHALL restore users, permissions, scenes, assets and versions with matching checksums.
4. The system SHALL run a scheduled automated restore test in an isolated environment that fails loudly when restore is broken.
5. The system SHALL emit structured JSON logs with requestId while redacting tokens, cookies and PII.

**Independent Test**: `backup:create` → derrubar stack → `backup:restore` em stack vazia → login, cenas e checksums intactos.

---

### P2: Geração de documentação a partir do canvas

**User Story**: Como arquiteto, quero gerar uma spec Markdown estruturada a partir do diagrama para manter documentação viva vinculada ao desenho.

**Why P2**: Alto valor, mas depende de semântica madura e do pipeline de IA já estável.

**Acceptance Criteria**:

1. WHEN the user triggers documentation generation THEN the system SHALL generate structured Markdown from the compact semantic representation of the scene, carrying stable elementId references.
2. The generated spec SHALL be versioned independently and linked to the diagram revision used as its source.
3. IF information is absent from the canvas and its metadata THEN the generator SHALL mark it as "não especificado" or "pergunta aberta", never inventing protocols, SLAs or decisions.
4. WHEN the user regenerates a single section THEN the system SHALL update only that section and record a new spec version.

**Independent Test**: eval "gerar spec fiel" — nenhum protocolo/SLA inventado; toda entidade da spec referencia `elementId` real.

---

### P2: Modo apresentação e protótipos navegáveis

**User Story**: Como apresentador, quero frames ordenados, modo presenter e links clicáveis entre telas para apresentar arquiteturas e simular navegação de protótipos.

**Why P2**: Escopo de prototipagem confirmado na discussão; depende de snapshots publicados (P1).

**Acceptance Criteria**:

1. WHEN a user creates presentation frames from canvas areas THEN the system SHALL support ordering, fullscreen presenter mode, keyboard navigation and private notes.
2. WHEN a presentation is published THEN the system SHALL bind it to an immutable snapshot and serve a read-only link respecting RBAC and expiration.
3. WHEN a user adds a navigation link from an element to another frame THEN the system SHALL make it clickable in presentation mode, simulating screen-to-screen navigation.
4. The system SHALL ship a low-fi wireframe kit (screens, buttons, inputs, lists) as a library insertable manually and through AI generation.
5. WHEN a presentation export is requested THEN the system SHALL produce a PDF rendered server-side.

**Independent Test**: wireframe de 4 telas com links → modo apresentação navega por clique; link publicado abre snapshot imutável somente leitura.

---

### P2: Lint arquitetural e C4

**User Story**: Como revisor, quero avisos automáticos sobre problemas estruturais (SPOFs, boundaries ausentes, conectores sem protocolo) para elevar a qualidade dos diagramas.

**Why P2**: Valor alto, zero risco (sempre aviso no MVP); depende da semântica P1.

**Acceptance Criteria**:

1. WHEN architectural review runs THEN the system SHALL flag orphan components, undirected flows, missing trust boundaries, single points of failure, secrets drawn as text, mixed environments and connectors without protocol — as warnings only.
2. WHERE C4 level metadata is present, the system SHALL apply soft per-level validations (Context, Container, Component, Deployment).
3. WHEN a workspace admin customizes lint rules THEN the system SHALL apply them per workspace as warnings.

**Independent Test**: fixture com SPOF e conector sem protocolo → lint reporta ambos como warning; canvas permanece editável.

---

### P2: Architecture-as-code (Mermaid/Structurizr)

**User Story**: Como arquiteto, quero importar e exportar Mermaid e Structurizr DSL para integrar o canvas ao fluxo documentação-como-código.

**Why P2**: Reuso direto do pipeline `diagram-ir` construído no P1.

**Acceptance Criteria**:

1. WHEN a user imports Mermaid or Structurizr DSL THEN the system SHALL generate an editable layout through the diagram-ir pipeline and report round-trip limitations explicitly.
2. WHEN a user exports to Mermaid or Structurizr DSL THEN the system SHALL derive the output from the IR and semantic metadata of the scene.

**Independent Test**: import de flowchart Mermaid → cena editável; export de volta registra limitações conhecidas.

---

### P2: Comentários e revisão assíncrona

**User Story**: Como revisor, quero comentar no canvas e em elementos, com threads e resolução, para revisar sem editar.

**Why P2**: Colaboração assíncrona chega antes do realtime; papel reviewer já existe no RBAC P1.

**Acceptance Criteria**:

1. WHEN a user comments on the canvas or anchored to an element THEN the system SHALL persist the thread with mentions and resolution state durably in PostgreSQL.
2. IF a reviewer posts a comment THEN the system SHALL accept it while continuing to reject canvas mutations from that role.

**Independent Test**: reviewer comenta com menção (aceito) e tenta mutar cena (403); thread sobrevive a restart.

---

### P3: Colaboração em tempo real

**User Story**: Como time, queremos coedição simultânea com cursores e presença para trabalhar juntos na mesma cena.

**Why P3**: AD-002 — infra mais cara (multi-node, Redis, presença) entregue depois do diferencial de IA.

**Acceptance Criteria**:

1. WHILE two or more editors have a diagram open, the system SHALL propagate cursors, selection and presence in real time without persisting presence data.
2. WHEN two users edit different elements concurrently THEN the system SHALL converge both sessions to the same scene after reconnection.
3. WHEN a server node restarts THEN the system SHALL rebuild the document from the PostgreSQL snapshot and operation log without depending on Redis.
4. IF presence data is lost THEN the system SHALL continue serving durable content unaffected.

**Independent Test**: dois browsers editando elementos distintos convergem após reconexão; kill do node não perde conteúdo durável.

---

### P3: Compartilhamento externo e webhooks

**User Story**: Como admin, quero share links com expiração e webhooks assinados para integrar a plataforma ao ecossistema interno.

**Why P3**: Valor incremental; superfícies de segurança que merecem chegar após hardening do núcleo.

**Acceptance Criteria**:

1. WHEN a share link is created THEN the system SHALL store only the token hash and enforce expiration and a maximum role.
2. WHERE webhooks are enabled, the system SHALL sign events with rotatable HMAC secrets and retry with exponential backoff and a dead-letter queue.

**Independent Test**: share link expirado retorna 404; webhook com secret rotacionado re-assina eventos seguintes.

---

## Edge Cases

- IF an uploaded SVG contains scripts or external references THEN the system SHALL sanitize or reject it before storage.
- IF an uploaded archive expands beyond the configured size ratio (zip bomb) THEN the system SHALL abort the import with a clear error. *(F1c Verifier flagged this as unaddressed for `.excalidraw` import — fixed: `MAX_REQUEST_BODY_BYTES` 10 MB Fastify `bodyLimit` in `apps/server/src/core/server.ts` + `MAX_IMPORT_ELEMENTS` 20,000 element-count ceiling in `apps/server/src/modules/export/import.ts`. No route currently decompresses a zip/archive upload — only `.excalidraw` JSON import exists; bundle export only compresses outbound, never decompresses inbound — so the literal "archive expand ratio" case has no code path yet. Re-verify this note when a bundle-import-back-in route is ever added.)*
- IF a WebSocket ticket is reused after its single use or expiry THEN the system SHALL reject the connection.
- IF operations arrive out of order after reconnection THEN the system SHALL order them by sequence before reconciliation.
- IF a mutation batch exceeds the 256 KB message limit THEN the system SHALL reject it with a specific error instructing the client to chunk.
- WHEN a scene reaches 5000 elements THEN the system SHALL keep pan/zoom usable and bootstrap p95 under 3 seconds.
- IF MinIO is unavailable during an image insert THEN the system SHALL not acknowledge the referencing element with a broken reference.
- IF an AI run exceeds its token budget or timeout THEN the system SHALL cancel it, record the error code and leave the canvas untouched.
- WHEN a workspace admin changes a member's role THEN REST enforcement is immediate by construction (each route resolves the actor's role fresh from `workspace_members` on every request, no per-request caching — T18); enforcement on an *already-open* WebSocket connection for that member is out of scope until the ws-gateway module exists (F1b) and is not claimed by this wave.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| FND-01 | P1: Instalação self-hosted | F0 | Implementing |
| FND-02 | P1: Instalação self-hosted | F0 | Implementing |
| FND-03 | P1: Instalação self-hosted | F0 | ✅ Verified |
| FND-04 | P1: Instalação self-hosted | F0 | In Tasks |
| FND-05 | P1: Instalação self-hosted | F0 | Implementing |
| AUTH-01 | P1: Contas, workspaces e RBAC | F1 | ✅ Verified |
| AUTH-02 | P1: Contas, workspaces e RBAC | F1 | Implementing |
| AUTH-03 | P1: Contas, workspaces e RBAC | F1 | Implementing |
| AUTH-04 | P1: Contas, workspaces e RBAC | F1 | ✅ Verified |
| AUTH-05 | P1: Contas, workspaces e RBAC | F1 | Implementing |
| EDT-01 | P1: Edição server-first | F1 | ✅ Verified |
| EDT-02 | P1: Edição server-first | F1 | ✅ Verified |
| EDT-03 | P1: Edição server-first | F1 | ✅ Verified |
| EDT-04 | P1: Edição server-first | F1 | ✅ Verified |
| EDT-05 | P1: Edição server-first | F1 | ✅ Verified |
| EDT-06 | P1: Edição server-first | F1 | ✅ Verified |
| EDT-07 | P1: Edição server-first | F1 | ✅ Verified |
| REC-01 | P1: Recuperação após crash | F1 | ✅ Verified |
| REC-02 | P1: Recuperação após crash | F1 | ✅ Verified |
| REC-03 | P1: Recuperação após crash | F1 | ✅ Verified |
| REC-04 | P1: Recuperação após crash | F1 | ✅ Verified |
| REC-05 | P1: Recuperação após crash | F1 | ✅ Verified |
| VER-01 | P1: Snapshots e restore | F1 | ✅ Verified |
| VER-02 | P1: Snapshots e restore | F1 | ✅ Verified |
| VER-03 | P1: Snapshots e restore | F1 | ✅ Verified |
| VER-04 | P1: Snapshots e restore | F1 | ✅ Verified |
| AIC-01 | P1: Configuração de provider IA | F2 | ✅ Verified |
| AIC-02 | P1: Configuração de provider IA | F2 | ✅ Verified |
| AIC-03 | P1: Configuração de provider IA | F2 | ✅ Verified |
| AIC-04 | P1: Configuração de provider IA | F2 | ⚠️ Partial |
| AIG-01 | P1: Geração por IA via IR | F2 | Pending |
| AIG-02 | P1: Geração por IA via IR | F2 | Pending |
| AIG-03 | P1: Geração por IA via IR | F2 | Pending |
| AIG-04 | P1: Geração por IA via IR | F2 | Pending |
| AIG-05 | P1: Geração por IA via IR | F2 | Pending |
| AIG-06 | P1: Geração por IA via IR | F2 | Pending |
| AIG-07 | P1: Geração por IA via IR | F2 | Pending |
| AIE-01 | P1: Edição por IA | F2 | Pending |
| AIE-02 | P1: Edição por IA | F2 | Pending |
| AIE-03 | P1: Edição por IA | F2 | Pending |
| AIE-04 | P1: Edição por IA | F2 | Pending |
| AIE-05 | P1: Edição por IA | F2 | Pending |
| LIB-01 | P1: Biblioteca e semântica | F2 | ✅ Verified |
| LIB-02 | P1: Biblioteca e semântica | F2 | ✅ Verified |
| LIB-03 | P1: Biblioteca e semântica | F2 | ✅ Verified |
| LIB-04 | P1: Biblioteca e semântica | F2 | ✅ Verified |
| EXP-01 | P1: Export e salvamento local | F1 | ✅ Verified |
| EXP-02 | P1: Export e salvamento local | F1 | ✅ Verified |
| EXP-03 | P1: Export e salvamento local | F1 | ✅ Verified |
| EXP-04 | P1: Export e salvamento local | F1 | ✅ Verified |
| OPS-01 | P1: Backup com restore testado | F1 | ✅ Verified |
| OPS-02 | P1: Backup com restore testado | F1 | ✅ Verified |
| OPS-03 | P1: Backup com restore testado | F1 | ✅ Verified |
| OPS-04 | P1: Backup com restore testado | F1 | ✅ Verified |
| OPS-05 | P1: Backup com restore testado | F1 | ✅ Verified |
| DOC-01 | P2: Geração de documentação | F3 | Pending |
| DOC-02 | P2: Geração de documentação | F3 | Pending |
| DOC-03 | P2: Geração de documentação | F3 | Pending |
| DOC-04 | P2: Geração de documentação | F3 | Pending |
| PRS-01 | P2: Apresentação e protótipos | F3 | Pending |
| PRS-02 | P2: Apresentação e protótipos | F3 | Pending |
| PRS-03 | P2: Apresentação e protótipos | F3 | Pending |
| PRS-04 | P2: Apresentação e protótipos | F3 | Pending |
| PRS-05 | P2: Apresentação e protótipos | F3 | Pending |
| LNT-01 | P2: Lint arquitetural e C4 | F3 | Pending |
| LNT-02 | P2: Lint arquitetural e C4 | F3 | Pending |
| LNT-03 | P2: Lint arquitetural e C4 | F3 | Pending |
| AAC-01 | P2: Architecture-as-code | F3 | Pending |
| AAC-02 | P2: Architecture-as-code | F3 | Pending |
| CMT-01 | P2: Comentários e revisão | F3 | Pending |
| CMT-02 | P2: Comentários e revisão | F3 | Pending |
| CLB-01 | P3: Colaboração em tempo real | F4 | Pending |
| CLB-02 | P3: Colaboração em tempo real | F4 | Pending |
| CLB-03 | P3: Colaboração em tempo real | F4 | Pending |
| CLB-04 | P3: Colaboração em tempo real | F4 | Pending |
| EXT-01 | P3: Compartilhamento e webhooks | F4 | Pending |
| EXT-02 | P3: Compartilhamento e webhooks | F4 | Pending |

**ID format:** `[CATEGORY]-[NUMBER]` — o número corresponde ao critério de aceite de mesma posição na história.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 77 total, 6 mapped to tasks (onda F0: FND-01..05, EDT-07; spikes T10/T11 de-riscam EXP-01/EDT-01), 71 unmapped — ondas F1+ pendentes ⚠️

---

## Fases de entrega (roadmap AI-first, AD-002)

| Fase | Conteúdo | Histórias |
| --- | --- | --- |
| F0 — Fundação (1–2 sem) | Monorepo, compose monólito modular, migrations, health, ADRs, spike adapter + spike renderização server-side | FND |
| F1 — Persistência server-first (4–6 sem) | Auth/RBAC, editor via adapter, op-log LWW, recovery, snapshots/restore, assets, export local, backup | AUTH, EDT, REC, VER, EXP, OPS |
| F2 — IA geradora (4–6 sem) | Provider config, diagram-ir/v1, layout determinístico, biblioteca + semântica, tools, preview/undo, evals | AIC, AIG, AIE, LIB |
| F3 — Arquitetura, docs e apresentação (3–4 sem) | Spec generation, lint/C4, Mermaid/Structurizr, apresentação + protótipos navegáveis, comentários | DOC, PRS, LNT, AAC, CMT |
| F4 — Colaboração realtime (3–5 sem) | Presença, multi-node (Redis), share links, webhooks | CLB, EXT |
| F5 — Hardening (2–4 sem) | OIDC, performance, acessibilidade, DR, observabilidade completa, piloto | — |

O MVP interno mínimo termina na **F2** (persistência confiável + IA geradora).

---

## Success Criteria

- [ ] E2E de crash: 100 alterações com `Salvo` sobrevivem a kill do browser e reabrem em outra máquina — zero perda.
- [ ] Eval AWS multi-AZ: geração produz componentes de biblioteca licenciados, relações semânticas e zero overlaps/labels truncados (métricas geométricas em CI).
- [ ] Prompt injection em texto de elemento nunca aciona ferramenta proibida (eval dedicado passa).
- [ ] `docker compose up --build` em máquina limpa → URL única utilizável com health verde, sem internet.
- [ ] `backup:restore` em stack vazia preserva usuários, cenas, assets e checksums.
- [ ] Token de IA ausente de qualquer resposta HTTP, log, trace e bundle frontend (verificação automatizada).
- [ ] Bundle `.zip` local reimportável com fidelidade total.
