# STATE

## Decisions

### AD-001
- **Decision**: Sincronização e persistência por op-log LWW nativo do Excalidraw (`version`/`versionNonce` + `reconcileElements`) com deltas JSON de domínio em `diagram_operations`; Yjs CRDT descartado para o MVP.
- **Reason**: Updates Yjs são binários opacos — validar permissão por elemento, gerar `operation_summary` e auditar exigiria materializar o documento a cada batch. O LWW por elemento é o modelo nativo do upstream e dá auditoria, diff e replay legíveis de graça.
- **Trade-off**: Sem merge granular de texto colaborativo dentro do mesmo elemento; conflitos no mesmo elemento resolvem por last-writer-wins (variantes preservadas no histórico).
- **Scope**: `diagram-domain`, `editor-adapter`, `apps/server` (persistência e realtime), modelo de dados (`diagram_operations`, `diagram_snapshots`).
- **Date**: 2026-08-11
- **Status**: active

### AD-002
- **Decision**: Roadmap AI-first — IA geradora (F2) entregue antes da colaboração realtime multiplayer (F4); comentários assíncronos antes do realtime (F3).
- **Reason**: O diferencial declarado do produto é geração de diagramas de alta qualidade por IA; realtime multiplayer é a infra mais cara (presença, multi-node, Redis) e não bloqueia o valor central.
- **Trade-off**: Coedição simultânea chega meses depois; até lá, edição concorrente resolve por op-log + reconexão, sem cursores ao vivo.
- **Scope**: Roadmap, priorização de todas as fases.
- **Date**: 2026-08-11
- **Status**: active

### AD-003
- **Decision**: MVP como monólito modular — um processo Node (`apps/server`: REST + WebSocket + jobs) em vez de api/realtime/worker separados; fronteiras mantidas nos packages do monorepo.
- **Reason**: Corta a superfície operacional do compose (~7 serviços em vez de 10) sem sacrificar o split futuro, que fica trivial porque as fronteiras já existem nos packages.
- **Trade-off**: Escala independente de módulos só após split; um crash derruba REST+WS+jobs juntos no MVP.
- **Scope**: `apps/server`, `infra/compose`, topologia de deploy.
- **Date**: 2026-08-11
- **Status**: active

### AD-004
- **Decision**: IR declarativa `diagram-ir/v1` (JSON Schema versionado: nós, containers, edges semânticos, swimlanes, layout hints) como peça central da geração por IA e do architecture-as-code; LLM emite IR one-shot para criação, tool calls só para edição incremental; layout sempre determinístico no servidor.
- **Reason**: Um shot de IR coerente supera dezenas de tool calls em custo, latência e consistência visual; a mesma IR alimenta import/export Mermaid/Structurizr e geração programática sem LLM.
- **Trade-off**: Mais um schema para versionar e manter compatível; conversões IR↔cena precisam de testes de round-trip próprios.
- **Scope**: `packages/diagram-ir`, `packages/ai-tools`, pipeline de geração, import/export.
- **Date**: 2026-08-11
- **Status**: active

### AD-005
- **Decision**: Renderização server-side (thumbnails, PNG/PDF, preview) via `exportToSvg` do pacote utils em Node + rasterização resvg/sharp; Chromium headless somente como fallback se a fidelidade exigir. Spike obrigatório na F0 valida a rota.
- **Reason**: Evita Chromium como dependência dura do worker (imagem pesada, superfície de segurança); a rota SVG-first é leve e determinística.
- **Trade-off**: Possíveis diferenças de fidelidade (fontes, embeds) vs render do browser; o spike decide e o fallback existe.
- **Scope**: módulo de jobs do `apps/server`, exports, thumbnails, preview de IA.
- **Date**: 2026-08-11
- **Status**: active

### AD-006
- **Decision**: MVP sem Redis — jobs via pg-boss sobre PostgreSQL; Redis entra apenas na fase de colaboração realtime multi-node (F4), restrito a presença/pub-sub.
- **Reason**: Um store a menos para operar e fazer backup no MVP; Redis nunca seria fonte da verdade de qualquer forma.
- **Trade-off**: Throughput de fila limitado pelo PostgreSQL (irrelevante na escala interna); migração de fila para BullMQ/Redis se o volume exigir.
- **Scope**: `infra/compose`, módulo de jobs, F4.
- **Date**: 2026-08-11
- **Status**: active

### AD-007
- **Decision**: Testes de integração de PostgreSQL usam `@electric-sql/pglite` (Postgres real compilado para WASM, roda em Node puro) em vez de testcontainers em qualquer ambiente sem daemon Docker; CI (GitHub Actions) continua usando Postgres/MinIO reais via `services:` já que tem Docker.
- **Reason**: Este ambiente de execução não tem Docker (`docker` CLI presente, socket ausente). PGlite roda um engine Postgres genuíno, preservando fidelidade de constraints/SQL sem exigir daemon.
- **Trade-off**: Não cobre comportamento específico de rede/socket do Postgres real (irrelevante para os testes de schema/constraint que este projeto escreve); MinIO não tem equivalente WASM — testes de integração de asset/storage ficam reservados ao CI real (onda F1c).
- **Scope**: todo teste de integração de `packages/database` e futuros módulos do `apps/server` que dependem de Postgres, em qualquer ambiente sem Docker.
- **Date**: 2026-08-12
- **Status**: active

### AD-008
- **Decision**: Nenhum pacote/módulo que roda server-side (`apps/server/**`, `packages/diagram-domain`, `packages/diagram-ir`, `packages/ai-tools`) pode importar `@excalidraw/excalidraw` ou `@arch-canvas/editor-adapter` **por valor** (chamada de função real) — somente `import type`. Elementos de cena construídos/mesclados no servidor usam implementações locais e dependency-free (ex. `packages/diagram-domain/src/mergeScene.ts`).
- **Reason**: o bundle publicado de `@excalidraw/excalidraw` importa `roughjs/bin/rough` sem extensão `.js`; o resolvedor ESM estrito do Node rejeita isso (`ERR_MODULE_NOT_FOUND`), funcionando só sob bundlers (Vite/webpack). `apps/server`'s entrypoint real (`node dist/index.js`) quebra no boot se qualquer coisa no seu grafo de import carregar esse pacote. Todos os testes (Vitest, via Vite) passavam porque o transform do Vite resolve isso de forma lenient — só descoberto ao tentar subir o `dist/index.js` compilado de verdade.
- **Trade-off**: pequena duplicação da regra de desempate LWW (poucas linhas, documentadas e testadas independentemente) em vez de reusar `applyRemote` do `editor-adapter`; cada novo pacote server-side que precisar de lógica de elemento precisa da mesma disciplina.
- **Scope**: todo pacote/módulo server-side atual e futuro que manipula `SceneElement`/diffs de elemento.
- **Date**: 2026-08-12
- **Status**: active

### AD-009
- **Decision**: F4's presença/cursores em tempo real (CLB-01) usam um `PresenceBroadcaster` injetável com duas implementações — `InMemoryPresenceBroadcaster` (padrão, EventEmitter, um processo) e `RedisPresenceBroadcaster` (pub/sub via `ioredis`, opcional). O servidor sobe e funciona inteiramente sem `REDIS_URL` configurado (degrade explícito: presença só cruza conexões dentro do MESMO processo Node — consistente com AD-003, que ainda não foi superada, o MVP continua sendo um único processo). Redis só passa a ser exercitado de verdade quando dois processos `apps/server` distintos apontam para a mesma instância Redis — provado por um teste de integração genuíno com dois processos reais nesta onda (não mockado), já que este sandbox tem `redis-server` disponível (diferente de Docker, ausente — ver AD-007).
- **Reason**: AD-006 já reservava Redis "restrito a presença/pub-sub" exatamente para a fase de colaboração realtime (F4) — esta AD só formaliza a forma de injeção (mesmo padrão de `deps.jobs`/`deps.storage` em `registerAllModules`) e confirma que o caminho sem Redis nunca foi deixado quebrado: presença nunca é persistida em lugar nenhum (CLB-04), então a ausência de Redis nunca arrisca conteúdo durável — só reduz o alcance da presença a um processo.
- **Trade-off**: sem Redis configurado, dois usuários conectados a instâncias `apps/server` diferentes (atrás de um load balancer, por exemplo) não veem os cursores um do outro — aceitável para o MVP de processo único; documentado explicitamente em `infra/compose/compose.yaml`'s novo serviço `redis` (opcional, comentado no README de infra).
- **Scope**: `apps/server/src/modules/ws-gateway`, `infra/compose/compose.yaml`, F4 em diante.
- **Date**: 2026-08-12
- **Status**: active

## Handoff

- **Feature**: architecture-canvas (`.specs/features/architecture-canvas/`)
- **Phase / Task**: Execute AUTÔNOMO em andamento (autorizado pelo usuário em 2026-08-12: "siga até terminá-lo totalmente", "sem precisar me perguntar nada", usando sub-agents em loop com Verifier independente por onda). **Nota operacional**: o ambiente de execução já reiniciou uma vez nesta sessão (silenciosamente matou um sub-agent Verifier em background sem notificação) — o repositório git é sempre a fonte da verdade após um reinício, nunca assumir que um sub-agent despachado ainda está vivo só por falta de notificação; checar `git log`/`git status` e timestamps de arquivo antes de concluir que algo travou de verdade.
- **Completed (todas com Verifier independente + sensor de mutação, PASS)**:
  - **F0 (Fundação)** — 11 tasks. FND-03/EDT-07 Verified, demais Implementing por escopo de spike (corretamente).
  - **F1a (Identidade/RBAC)** — T12-T18. AUTH-01/04 Verified; AUTH-02/03/05 Implementing (gaps honestos).
  - **F1b (Persistência do canvas — núcleo do invariante server-first)** — T19-T26. Achado crítico pós-batch corrigido pelo orquestrador: `index.ts` nunca registrava módulos + `diagram-domain` quebrava boot sob Node puro (AD-008). EDT-01..05/07, REC-01..05 → Verified.
  - **F1c (Assets/Snapshots/Export/Backup)** — T27-T36, PASS na 1ª iteração. Log redaction, AD-008 e backup/restore real (2 Postgres 16 genuínos neste sandbox) todos reproduzidos independentemente pelo Verifier. VER-01..04/EXP-01..04/OPS-01..05/EDT-06 → Verified. **F1 está inteiramente fechada.**
  - Gap de follow-up do F1c (zip-bomb/tamanho de import sem limite explícito) corrigido pelo orquestrador (`7667df6`): `bodyLimit` 10MB + `MAX_IMPORT_ELEMENTS` 20k.
  - **F2a (Biblioteca + Provider de IA)** — T37-T42, PASS na iteração 2 (iteração 1 pegou 1 mutante sobrevivente — fix `38b320c`). LIB-01..04, AIC-01..03 → Verified; AIC-04 parcial (limites de workspace/budget deferidos a F2c).
  - **F2b (diagram-ir: schema/layout/compilador/métricas)** — T43-T48, PASS na 1ª iteração. AD-008 confirmado (zero import de Excalidraw no dist), bug real de overflow no swimlane pego por property-based testing. AIG-01/02/07 → Verified; AIG-03 fechado por fix direto pós-Verifier (`9fa4492`/`48cf0bc`); AIG-06 Implementing (rejeição de patch é escopo F2c).
  - **F2c (T49-T57: cliente do provider, contexto, tools, pipeline de execução, aprovação/undo, prompt injection, evals)** — PASS na 1ª iteração, verificação adversarial: Verifier traçou o mecanismo estrutural exato que barra prompt injection (rejeição de tool desconhecida pelo `ToolRegistry`, limiar de aprovação) e construiu seu próprio 7º cenário adversarial além dos 6 do worker. Token nunca sai do escopo de `callProvider`; apply atômico + snapshot `pre_ai` + undo confirmados ponta a ponta contra PGlite real; boundary 50/51 de aprovação exato. 9/9 ACs verificados, 0 gaps. **F2 está inteiramente fechada — isso é o MVP interno mínimo do roadmap (AD-002/documento-fonte §15: "persistência + IA geradora").**
  - **F3 (T58-T70: docgen, apresentação/protótipos, lint arquitetural/C4, architecture-as-code Mermaid/Structurizr, comentários assíncronos)** — PASS na 1ª iteração, gate real reproduzido do zero (`lint`/`typecheck`/`build --force`/`test:unit` 244 server+22 web/`test:integration` 244 em 27 arquivos, tudo verde e batendo com os números auto-reportados). AD-008 confirmado (zero import real de Excalidraw nos três dist trees, só a exceção pré-existente de `render/svg.js`); smoke-test de boot real refeito do zero (`node dist/index.js`, `curl` sem sessão em todas as 5 rotas novas → 401, nunca 404, inclusive confirmando que o path literal do texto da task para interop 404 corretamente enquanto o path real registrado `/projects/:id/import:mermaid` 401). PRS-02 (imutabilidade do snapshot publicado) traçado no código-fonte (`getPublishedPresentation` nunca toca `materializeScene`/`diagram_operations`) E reproduzido empiricamente (publicar → mutar cena ao vivo via `/operations:batch` → reler link publicado → inalterado). AAC-01/02 honestidade de round-trip confirmada com fixtures Mermaid/Structurizr próprias do Verifier (nunca quebra em sintaxe inválida, nunca fabrica node/edge não declarado, sempre relata `limitations`). DOC-03 "nunca inventar" confirmado com fixture de cena própria (componente sem metadata semântica → literalmente "não especificado"). Sensor de mutação: 4/4 mortos (regra de supressão do lint, checagem de expiração do publish, gate de autoria de edição de comment, bypass do placeholder DOC-03) — 0 sobreviventes, sem fix-loop necessário. 16 ACs (DOC-01..04/PRS-01..05/LNT-01..03/AAC-01..02/CMT-01..02) → Verified; PRS-01 marcado "Verified (backend)" com nota honesta de que o modo apresentador/navegação por teclado é client-side e está fora da superfície de diff desta onda (só `apps/server`/`packages/*`). **F3 está inteiramente fechada — fecha a "visão completa" do documento-fonte (§15) por inteiro, restando só F4 (realtime, P3) e F5 (hardening) no roadmap.**
- **Next step**: autorar F4 (colaboração em tempo real — CLB-01..04, EXT-01..02) → validate_tasks → batch(es) → gate real → Verifier independente com sensor de mutação → fix-loop se FAIL (máx. 3 iterações) → repetir para F5 (hardening), sem pausar salvo bloqueio genuíno.
  - **F4 Batch 1 (T71-T74)**: merged — schema `share_links`/`webhook_endpoints`/`webhook_deliveries`, per-message WS payload schemas, `ws-gateway` module (handshake/sync/mutation relay reusing REST's `appendOperation`), `PresenceBroadcaster` (in-memory default + real Redis pub/sub, T74 gate `build` PASS).
  - **F4 Batch 2 (T75-T78)**: implemented by this batch worker (author, not yet independently Verified) — one commit per task, all landed on `claude/architecture-canvas-system-cdwop7`. T75: real cross-instance Redis presence proof (2 genuine `FastifyInstance`s, 2 real `RedisPresenceBroadcaster`s, 1 real spawned `redis-server`) — required adding the missing `presence.subscribe()` relay to `ws-gateway/routes.ts` (T73 had only ever called `.publish`, never `.subscribe`, so no code path could forward a broadcast event back out over any socket; documented as a necessary in-scope fix in T75's Status note) plus two small `redisPresence.ts` robustness fixes (missing `'error'` listeners, unhandled rejections on fire-and-forget `subscribe`/`unsubscribe`) surfaced by tearing down two real instances against a real Redis. T76: reconnection convergence proof — deliberately did NOT add an incremental `afterSequence` sync path (documented decision: `loadDiagramScene` always folds the full op-log, so "always full state" already satisfies CLB-02 trivially; building incremental catch-up here would be unrequested scope). T77: node-restart durability proof, explicit zero-Redis (`InMemoryPresenceBroadcaster` only), gate `build` reproduced clean. T78: new `apps/server/src/modules/share/` module — capped-role (`isRoleWithinCeiling` vs `packages/auth`'s `ROLES` ordering) expiring share links for diagrams/presentations, `GET /share/:token` public+IDOR-safe (uniform 404 for expired/revoked/nonexistent, modeled on `presentation/publish.ts`'s `getPublishedPresentation`), one-shot token reveal via existing `generateOpaqueToken`/`hashToken`. CLB-01..04 and EXT-01 flipped `Pending` → `Implementing` in `spec.md` (never `Verified` — that stays the independent Verifier's job). Full gate reproduced clean after T78 (not just T78's own declared `quick`): `lint`/`typecheck`/`build`/`test:unit` (267/267 server) /`test:integration` (276/276 server, 34 files) all green; `grep -rln excalidraw apps/server/dist/**/*.js` shows only the same pre-existing allowlisted comment-only hits (AD-008 intact); zero lingering `redis-server` processes after every test run. `registerModules.ts`/`config.ts`/compose wiring for `ws-gateway`/`share`/(future `webhook`) is explicitly T81's job, not this batch's — same precedent T74 already established for `ws-gateway` itself.
  - **F4 Batch 3 (T79-T81)**: NOT started by this batch worker — webhooks CRUD, delivery pipeline + 5-event wiring, and final production wiring/compose/smoke-test/gate remain open. Batch 2 is pushed to `origin/claude/architecture-canvas-system-cdwop7` but has not yet had an independent Verifier pass.
- **Lições registradas** (`.specs/lessons.json`, todas `candidate`): L-001..L-016, incluindo L-008 (wiring de produção, aplicada proativamente desde F1c), L-016 (mutação sensor em pacote cross-package via node_modules simlincado — mitigado nesta onda rodando `pnpm install`/`build` dentro do próprio worktree scratch) e as mais recentes sobre asserção de shape de resposta vs. substring (F2a), cobertura de propriedade incompleta (F2b/AIG-03), RunStore in-memory (aceitável para MVP single-process) e violação de author≠verifier corrigida (T57 se auto-marcou Verified antes do Verifier rodar — sem impacto funcional, corrigido; não recorreu em F3, confirmado pelo Verifier desta onda).
- **Blockers**: none
- **Uncommitted files**: none
- **Branch**: claude/architecture-canvas-system-cdwop7
