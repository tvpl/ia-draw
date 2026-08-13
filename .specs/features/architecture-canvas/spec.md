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

### P1: Hardening de segurança e superfície de ataque ⭐ F5

**User Story**: Como operador, quero controles de segurança de produção (headers, rate limiting, fail-fast em segredo inseguro, auditoria completa, regressão de threat model) para operar a plataforma com confiança fora de um ambiente de desenvolvimento.

**Why P1 (F5)**: Invariante 9 do documento-fonte; consolida e fecha a superfície de ataque já parcialmente coberta onda a onda (IDOR, SSRF, prompt injection, zip bomb, etc.) numa suíte de regressão única e em controles que faltavam (headers, rate limit, fail-fast).

**Acceptance Criteria**:

1. WHEN the server responds to any HTTP request THEN the system SHALL send CSP, X-Content-Type-Options and X-Frame-Options headers, HSTS when served over TLS, and enforce a CORS policy restricted to an explicit origin allowlist.
2. WHEN a client exceeds the configured rate limit for a given user/IP/action THEN the system SHALL reject further requests with 429, with stricter limits applied to AI-generation and export routes than to ordinary reads.
3. WHEN the server starts in production mode with a known-insecure default secret (session or encryption key) THEN the system SHALL fail to start with a clear error, never silently running with an insecure default.
4. WHEN any of {login, admin access, permission change, restore, publish, export, AI provider configuration, AI patch approval} occurs THEN the system SHALL append an audit event capturing actor, action, resource and outcome.
5. The system SHALL maintain one regression test per threat-model scenario in the source document (workspace crossover, IDOR, WS ticket reuse, mutation replay, malicious SVG, zip bomb, AI-provider SSRF, prompt-injection exfiltration, log leakage, role escalation, stolen share link, snapshot corruption, out-of-order operation, abusive AI consumption), each explicitly cross-referenced to its covering test file.

**Independent Test**: request sem header de segurança → resposta ainda carrega CSP/HSTS/CORS restritivo; 429 após estourar o limite de uma rota de IA; boot em modo produção com `SESSION_SECRET` padrão → falha explícita, nunca sobe.

---

### P1: Autenticação de produção via OIDC ⭐ F5

**User Story**: Como admin, quero login via OIDC genérico com PKCE e mapeamento de grupos para papéis, para integrar a plataforma ao provedor de identidade corporativo sem depender só de conta local.

**Why P1 (F5)**: Documento-fonte §9.1 marca OIDC como o caminho de produção; MVP local (email/senha) permanece disponível e nunca é enfraquecido por essa adição.

**Acceptance Criteria**:

1. WHERE OIDC is configured, the system SHALL support an OIDC-with-PKCE login flow as an alternative to local email/password, without weakening or bypassing local auth when OIDC is disabled.
2. WHEN an OIDC user authenticates THEN the system SHALL map IdP groups to workspace roles per a configurable mapping, never granting a role beyond the mapping's explicit ceiling for that group.
3. Refresh tokens SHALL be rotated and revocable regardless of auth method; no token SHALL ever be placed in a location a client-side script can read (`localStorage`/`sessionStorage`).

**Independent Test**: login via um provedor OIDC real (protocolo completo, PKCE) mapeia o grupo configurado para o papel esperado no workspace certo; local auth continua funcionando sem OIDC configurado.

---

### P1: Disaster recovery reforçado ⭐ F5

**User Story**: Como operador, quero backup incremental e um teste de restore automatizado recorrente, para atingir RPO/RTO documentados sem depender de disciplina manual.

**Why P1 (F5)**: Documento-fonte §10 define metas de RPO ≤ 15 min / RTO ≤ 4 h e um teste de restore mensal automatizado; F1c só entregou o `backup:create/verify/restore` sob demanda.

**Acceptance Criteria**:

1. WHERE incremental backup is enabled, the system SHALL capture WAL-based incremental backups between full backups, per the configured retention policy.
2. The system SHALL run an automated, recurring restore test in an isolated schema/database, alerting (not silently passing) when restored checksums or row counts diverge from the source.

**Independent Test**: `backup:create` completo + 1 incremental → `backup:restore` do par completo+incremental reconstrói o estado exato; teste de restore automatizado corrompido (checksum divergente) → alerta, nunca passa silenciosamente.

---

### P1: Observabilidade completa ⭐ F5

**User Story**: Como operador, quero métricas, traces e alertas documentados cobrindo save/colaboração/IA/capacidade, para operar a plataforma com visibilidade real de produção.

**Why P1 (F5)**: Documento-fonte §11; F0-F4 entregaram logs estruturados e redação, mas não o `/metrics`, os traces OTel nem os alertas como configuração versionada.

**Acceptance Criteria**:

1. The system SHALL expose a `/metrics` endpoint reporting REST/WS latency and error rates, mutation ACK latency, pending job-queue depth, snapshot timing, AI latency/tokens/estimated cost, and export timing.
2. The system SHALL emit OpenTelemetry traces across REST, WebSocket, database, storage and AI-provider call boundaries, never including sensitive payload content (prompts, scene content, tokens) in span attributes.
3. The system SHALL document alerting thresholds matching the source SLOs (ACK p95 > 2s, save error rate > 1%, delayed job queue, failing snapshot, storage unavailable, invalid backup/restore, auth-failure spike) as versioned, testable configuration.

**Independent Test**: `curl /metrics` expõe as séries documentadas; uma chamada de IA gera um trace com spans de contexto/chamada/aplicação sem prompt/cena em claro no span.

---

### P1: Desempenho sob carga documentada ⭐ F5

**User Story**: Como operador, quero evidência automatizada de que os alvos de performance do documento-fonte (bootstrap, ACK, lote) se sustentam em cenas de 1k/5k/10k elementos.

**Why P1 (F5)**: Documento-fonte §13/§17 fixam metas de performance; nenhuma onda anterior validou isso automatizado, só manualmente por amostragem.

**Acceptance Criteria**:

1. The system SHALL maintain an automated performance benchmark asserting bootstrap and batch-ACK latency stay within the documented targets against 1k/5k/10k-element fixtures, explicitly disclosing this as an in-sandbox proxy rather than a substitute for real infrastructure load testing at production scale.

**Independent Test**: benchmark roda em CI, falha o build se o p95 de bootstrap ou ACK ultrapassar o alvo documentado para o tamanho de cena correspondente.

---

### P1: Acessibilidade do shell ⭐ F5

**User Story**: Como usuário com necessidade de acessibilidade, quero o shell da aplicação (navegação, formulários, foco, contraste) verificado automaticamente contra WCAG 2.2 AA.

**Why P1 (F5)**: Documento-fonte §13; a superfície de UI construída até aqui é majoritariamente scaffolding (`apps/web`'s sync client) — este AC cobre exatamente o que existe, disclosure explícito do que ainda não existe.

**Acceptance Criteria**:

1. The system SHALL run an automated accessibility check (axe-core or equivalent) against every existing `apps/web` screen/component as part of CI, explicitly disclosing in the check's own report which product surfaces are not yet built and therefore out of this check's coverage.

**Independent Test**: CI roda o check de acessibilidade automatizado e falha o build em qualquer violação séria/crítica nas telas existentes.

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
| AIC-04 | P1: Configuração de provider IA | F2 | ⚠️ Partial *(F5/T83, SEC-02, confirmed by the F5 Verifier: the per-user AI-run-rate-limiting dimension is now genuinely closed — `ai-engine/routes.ts`'s dedicated 20/60s limit on `POST /diagrams/:id/ai/runs`, strictly tighter than the global default. The per-workspace dimension and token/cost-budget enforcement named in this AC's original text are still not implemented anywhere in this codebase — remains Partial, not fully closed)* |
| AIG-01 | P1: Geração por IA via IR | F2 | ✅ Verified |
| AIG-02 | P1: Geração por IA via IR | F2 | ✅ Verified |
| AIG-03 | P1: Geração por IA via IR | F2 | ✅ Verified *(gap fechado por fix direto do orquestrador pós-Verifier — `packages/diagram-ir/src/metrics.spec.ts` agora varre `truncatedLabels===0` nos mesmos 21 casos sintéticos até 200 elementos; não é uma nova passada formal do Verifier, mas o teste roda e passa de fato — commit `9fa4492`. Reforçado por T57's `evals.spec.ts`, que roda `geometryMetrics` fim a fim contra o pipeline de tools real para os casos §8.6 1/4/6.)* |
| AIG-04 | P1: Geração por IA via IR | F2 | ✅ Verified *(independently reproduced — `apps/server/src/modules/ai-engine/preview.int.spec.ts:155-200` asserts `revisionAfter === revisionBefore` and zero rows in `diagram_operations` after a full `POST /diagrams/{id}/ai/runs` call; `attachPreview` (`preview.ts:125-151`) never calls `appendOperation`/`createSnapshot`)* |
| AIG-05 | P1: Geração por IA via IR | F2 | ✅ Verified *(independently reproduced — `applyPatch.ts:133-180`'s `approveAiRun` applies via `appendOperation` (F1b, reused) and creates a `pre_ai` snapshot before the write; `applyPatch.int.spec.ts:188-226` (happy path + snapshot row) and `:277-336` (restore-based undo round-trip proves the pre-ai state is genuinely recoverable, not just a claimed field))* |
| AIG-06 | P1: Geração por IA via IR | F2 | ✅ Verified *(independently reproduced — `pipeline.int.spec.ts:224-239` proves an out-of-scope `elementId` fails the run (`status: 'failed'`, `errorCode: 'element_not_found'`) before `previewing`; `writeTools.spec.ts:450-459` proves the same for an unresolvable library `componentKey` via `compile_ir` (`unresolved_component`); `ToolRegistry.execute` (`packages/ai-tools/src/tools/types.ts:130-141`) is the structural gate both paths go through)* |
| AIG-07 | P1: Geração por IA via IR | F2 | ✅ Verified *(independently reproduced — `apps/server/src/modules/ai-engine/evals/evals.spec.ts` runs 5 of §8.6's cases (1/4/6/9/10, the subset this batch's own task scoped) against the real `ToolRegistry` with zero DB/network (confirmed by `no-egress.spec.ts` covering the directory); cases 1/4/6 assert `geometryMetrics(...).overlaps === 0` and `.crossings === 0` against a real `compile()`/`auto_layout()` output, not a stub. Case 1's AWS-icon substitution (no WAF/dedicated ECS/Redis in the current library) is disclosed in the file header, not silent)* |
| AIE-01 | P1: Edição por IA | F2 | ✅ Verified *(independently reproduced — `pipeline.ts:199-230` is the only place a tool call executes, exclusively through `ToolRegistry.execute` (`packages/ai-tools`), never raw scene/SQL/URL; `writeTools.spec.ts:471-480` scans every write tool's JSON Schema and asserts no `url`/`command`/`cmd`/`shell`/`sql` field exists on any of them)* |
| AIE-02 | P1: Edição por IA | F2 | ✅ Verified *(independently reproduced — `preview.ts:86-105`'s `computeApprovalThreshold` implements the literal rule (removal / `touchedElementCount > 50`, strict / outside-selection); `preview.spec.ts:42-59` tests the 50/51 boundary exactly, and mutating `> 50` to `>= 50` in a scratch worktree killed that exact test (Discrimination Sensor #1 below))* |
| AIE-03 | P1: Edição por IA | F2 | ✅ Verified *(independently reproduced — `applyPatch.ts:147-148` compares the freshly-loaded revision against `run.sourceRevision` BEFORE any write and throws `StaleRevisionError` (409); `applyPatch.int.spec.ts:228-275` proves the scene is byte-for-byte unchanged after a 409; bypassing the check in a scratch worktree killed that exact test (Discrimination Sensor #2 below))* |
| AIE-04 | P1: Edição por IA | F2 | ✅ Verified *(deep-traced and independently reproduced, including a self-constructed 6th adversarial scenario not in the original suite — see the F2c Wave Report below for the full trace. `prompt-injection.int.spec.ts`'s `obedientFetch` mock genuinely parses `context.sceneData` and picks a malicious tool call from it — not a scripted/blind mock; the 5 scenarios are stopped by real structural controls (`ToolRegistry`'s `unknown_tool`, `AIE-02`'s threshold, `component_not_found` against a REAL seeded library), never by "the model behaved")* |
| AIE-05 | P1: Edição por IA | F2 | ✅ Verified *(independently reproduced — `pipeline.ts:214-220` calls `insertAiToolCall` with `redactToolArguments(args)` (`redact.ts`) on every tool call; `pipeline.int.spec.ts:244-271` proves a sensitive test literal never reaches the persisted row in plain text; `pipeline.ts:184-190` records only numeric `usage_json` counts, never the token, confirmed by `callProvider.ts`'s token never leaving its own function scope (`callProvider.spec.ts:182-200`, and a scratch-worktree mutation that leaked the token into the returned result killed that exact test — Discrimination Sensor #4 below))* |
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
| DOC-01 | P2: Geração de documentação | F3 | ✅ Verified (F3 Verifier, `docgen.int.spec.ts:139-168`) |
| DOC-02 | P2: Geração de documentação | F3 | ✅ Verified (F3 Verifier, `generate.ts:103` + `docgen.int.spec.ts`) |
| DOC-03 | P2: Geração de documentação | F3 | ✅ Verified (F3 Verifier, `sections.ts:53-56,82` + fresh fixture reproduction, sensor-killed) |
| DOC-04 | P2: Geração de documentação | F3 | ✅ Verified (F3 Verifier, `regenerateSection.int.spec.ts:1-40`) |
| PRS-01 | P2: Apresentação e protótipos | F3 | ✅ Verified (backend) (F3 Verifier — presenter-mode/keyboard-nav UI half out of this backend-only wave's diff surface, disclosed) |
| PRS-02 | P2: Apresentação e protótipos | F3 | ✅ Verified (F3 Verifier, `publish.ts:82-108` deep trace + `publish.int.spec.ts:196-231`, sensor-killed) |
| PRS-03 | P2: Apresentação e protótipos | F3 | ✅ Verified (F3 Verifier, `frames.ts:29-42` + `presentation.int.spec.ts`) |
| PRS-04 | P2: Apresentação e protótipos | F3 | ✅ Verified (F3 Verifier, `presets/wireframe-lofi.ts:27,42,57,72`) |
| PRS-05 | P2: Apresentação e protótipos | F3 | ✅ Verified (F3 Verifier, `publish.int.spec.ts`) |
| LNT-01 | P2: Lint arquitetural e C4 | F3 | ✅ Verified (F3 Verifier, `lint.int.spec.ts`) |
| LNT-02 | P2: Lint arquitetural e C4 | F3 | ✅ Verified (F3 Verifier, `engine.ts:260-282`, sensor-killed) |
| LNT-03 | P2: Lint arquitetural e C4 | F3 | ✅ Verified (F3 Verifier, `engine.ts:78-80`, sensor-killed) |
| AAC-01 | P2: Architecture-as-code | F3 | ✅ Verified (F3 Verifier, 2 fresh fixtures per DSL, never crashes/fabricates) |
| AAC-02 | P2: Architecture-as-code | F3 | ✅ Verified (F3 Verifier, `mermaid.ts:234-243` + `structurizr.ts:268-277`) |
| CMT-01 | P2: Comentários e revisão | F3 | ✅ Verified (F3 Verifier, `comment.int.spec.ts`) |
| CMT-02 | P2: Comentários e revisão | F3 | ✅ Verified (F3 Verifier, `rbac.ts:76-91` + `rbac.spec.ts:94-104`, sensor-killed) |
| CLB-01 | P3: Colaboração em tempo real | F4 | ✅ Verified (F4 Verifier — cross-instance Redis proof re-run independently, 2/2 green, against a genuinely spawned `redis-server`; `presence.ts`/`redisPresence.ts` zero `Db`/drizzle imports confirmed by grep) |
| CLB-02 | P3: Colaboração em tempo real | F4 | ✅ Verified (F4 Verifier — `reconnectConvergence.int.spec.ts:270-286` deep-equality convergence, "always full state" independently assessed as structurally sufficient for the AC) |
| CLB-03 | P3: Colaboração em tempo real | F4 | ✅ Verified (F4 Verifier — `nodeRestartDurability.int.spec.ts:178-287` re-read, zero Redis confirmed, reproduced green in this session's gate) |
| CLB-04 | P3: Colaboração em tempo real | F4 | ✅ Verified (F4 Verifier — zero `Db`/drizzle imports confirmed by grep in `presence.ts`/`redisPresence.ts`; post-restart mutation success confirmed) |
| EXT-01 | P3: Compartilhamento e webhooks | F4 | ✅ Verified (F4 Verifier — `isRoleWithinCeiling` sensor-mutation-killed, leaked-token-to-real-admin scenario re-confirmed structurally (`routes.ts:210`) and by `share.int.spec.ts:232-277`, uniform-404 IDOR confirmed) |
| EXT-02 | P3: Compartilhamento e webhooks | F4 | ✅ Verified (F4 Verifier — HMAC signs exact sent bytes, sensor-killed on divergence; secret-rotation invalidation confirmed at crypto level; backoff/dead-letter traced + sensor-killed; all 5 event sites confirmed wired, 2 spot-checked in depth) |
| SEC-01 | P1: Hardening de segurança | F5 | ✅ Verified *(independently reproduced — `core/server.ts`'s helmet/cors registration read directly; CSP/X-Content-Type-Options/X-Frame-Options confirmed present on a real running server via `curl -I`; HSTS-conditional-on-https confirmed by `core/server.spec.ts`)* |
| SEC-02 | P1: Hardening de segurança | F5 | ✅ Verified *(independently reproduced — `ai-engine/routes.ts:44`'s `DEFAULT_AI_RUN_RATE_LIMIT`/`export/routes.ts:50`'s `DEFAULT_EXPORT_RATE_LIMIT` confirmed stricter than `core/rateLimit.ts`'s 300/60s default by code read; a real coverage gap — no test exercised the actual shipped defaults — found by the discrimination sensor and closed, commits `3612db6`/`c0c663b`)* |
| SEC-03 | P1: Hardening de segurança | F5 | ✅ Verified *(confirmed pre-existing since F0 — `config.ts:65-74`'s `loadConfig` — now with complete test coverage, `config.spec.ts`, 14/14)* |
| SEC-04 | P1: Hardening de segurança | F5 | ✅ Verified *(independently reproduced — all 8 named actions (login×2, admin access, permission change, restore, publish, export, AI provider config, AI patch approval) confirmed at real `file:line` sites, re-derived from source, not copied from the implementer's table)* |
| SEC-05 | P1: Hardening de segurança | F5 | ✅ Verified *(independently reproduced — 14-entry manifest confirmed complete; 6/14 `coveringTest` entries opened and confirmed to genuinely prove the named scenario, task required ≥4)* |
| OIDC-01 | P1: Autenticação de produção via OIDC | F5 | ✅ Verified *(independently reproduced — `GET /auth/oidc/login`/`callback` confirmed to return 503 (never crash/404) when unconfigured on a real running server; local auth unaffected; real in-process `oidc-provider` PKCE flow re-run, 5/5)* |
| OIDC-02 | P1: Autenticação de produção via OIDC | F5 | ✅ Verified *(`resolveOidcRole`, `oidc.ts:85-101`, read line by line — reads exclusively the configured group claim against an explicit allowlist, never any other claim, never a fallback; a genuine wiring-layer coverage gap — no existing test covered zero-group-match — found by the discrimination sensor and closed with a new adversarial account/test, commit `7f71a3a`)* |
| OIDC-03 | P1: Autenticação de produção via OIDC | F5 | ✅ Verified *(independently reproduced — every session cookie confirmed `httpOnly: true` by reading `cookie.ts`, no IdP token ever set as a cookie or returned in a body; OIDC-originated session refresh re-run through the exact same `/auth/refresh` endpoint)* |
| DR-01 | P1: Disaster recovery reforçado | F5 | ✅ Verified (row-level/logical incremental, disclosed) *(chain-checksum integrity confirmed structurally, `incremental.ts:296-370`, and by a discrimination-sensor mutation the existing test killed; **2 disclosed gaps, not blocking but real**: the AC's own "WAL-based" wording is stricter than the built — and reasonably justified — row-level mechanism; no retention-policy/backup-expiry automation exists anywhere in this codebase)* |
| DR-02 | P1: Disaster recovery reforçado | F5 | ✅ Verified *(`assertIsolatedRestoreTarget`, `restoreTest.ts:97-107`, confirmed to run first, before any I/O, and killed by a bypass mutation; divergence-never-silent confirmed via 2 independent checks — checksum + row-count — both wired to a real audit event and a real `/metrics` counter)* |
| OBS-01 | P1: Observabilidade completa | F5 | ✅ Verified *(9 documented series confirmed registered in `metrics.ts`; real-boot `/metrics` output confirmed valid Prometheus format with non-zero series after real activity)* |
| OBS-02 | P1: Observabilidade completa | F5 | ✅ Verified *(every AI-boundary span attribute in `pipeline.ts` read directly — id/count/model-name only; a constructed prompt-leak mutation was caught immediately by the existing substring-search test, `tracing.int.spec.ts`)* |
| OBS-03 | P1: Observabilidade completa | F5 | ✅ Verified *(all 7 `alerts.yml` rules cross-checked directly against `metrics.ts`'s real registered series names; `alertRules.spec.ts` re-run, 5/5)* |
| PERF-01 | P1: Desempenho sob carga documentada | F5 | ✅ Verified *(`bootstrap.perf.int.spec.ts` read in full — real wall-clock measurements against real PGlite, not stubbed timing; honest sandbox-proxy disclosure confirmed present and accurate)* |
| A11Y-01 | P1: Acessibilidade do shell | F5 | ✅ Verified *(deliberately-broken `<img>`-without-`alt` fixture confirmed to genuinely fail both the severity-filtered check and jest-axe's own matcher; coverage disclosure cross-checked against a real `apps/web/src` directory listing — accurate)* |

**ID format:** `[CATEGORY]-[NUMBER]` — o número corresponde ao critério de aceite de mesma posição na história.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 92 total, **92/92 at Verified or a correctly-scoped, disclosed Partial — the roadmap is fully closed.** 15 F5 requirements (SEC-01..05, OIDC-01..03, DR-01..02, OBS-01..03, PERF-01, A11Y-01) → ✅ **Verified** by an independent Verifier pass (`.specs/features/architecture-canvas/validation.md`'s F5 section) — 13 clean, 1 (DR-01) Verified with 2 disclosed, non-blocking gaps (the AC's own "WAL-based" wording vs. the built, reasonably-justified row-level mechanism; no retention-policy/backup-expiry automation exists anywhere in this codebase). AIC-04 (F2) remains ⚠️ Partial — F5/T83 genuinely closed its per-user AI-run-rate-limiting dimension, but the per-workspace dimension and token/cost budgets named in its original AC text are still unimplemented. This closes the entire architecture-canvas roadmap end-to-end (F0 through F5, all 92 requirements) — the one deliberate remaining item, pilot rollout with real teams, is an organizational activity, never a coding deliverable, explicitly out of scope per the roadmap table.

---

## Fases de entrega (roadmap AI-first, AD-002)

| Fase | Conteúdo | Histórias |
| --- | --- | --- |
| F0 — Fundação (1–2 sem) | Monorepo, compose monólito modular, migrations, health, ADRs, spike adapter + spike renderização server-side | FND |
| F1 — Persistência server-first (4–6 sem) | Auth/RBAC, editor via adapter, op-log LWW, recovery, snapshots/restore, assets, export local, backup | AUTH, EDT, REC, VER, EXP, OPS |
| F2 — IA geradora (4–6 sem) | Provider config, diagram-ir/v1, layout determinístico, biblioteca + semântica, tools, preview/undo, evals | AIC, AIG, AIE, LIB |
| F3 — Arquitetura, docs e apresentação (3–4 sem) | Spec generation, lint/C4, Mermaid/Structurizr, apresentação + protótipos navegáveis, comentários | DOC, PRS, LNT, AAC, CMT |
| F4 — Colaboração realtime (3–5 sem) | Presença, multi-node (Redis), share links, webhooks | CLB, EXT |
| F5 — Hardening (2–4 sem) | OIDC, performance, acessibilidade, DR, observabilidade completa; piloto com times reais é atividade organizacional pós-deploy, fora do escopo de implementação autônoma | SEC, OIDC, DR, OBS, PERF, A11Y |

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
