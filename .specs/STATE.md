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

- **Feature**: platform-maturity (`.specs/features/platform-maturity/`) — programa de maturidade sobre o roadmap architecture-canvas ja fechado.
- **Branch**: `feature/improvements`. Nada foi enviado para o remoto; todos os commits sao locais.
- **Phase / Task**: **Onda F6 fechada e verificada.** T1-T17 (implementacao) + T18-T22 (rodada 1 de correcao). Verifier independente: rodada 1 FAIL (6 lacunas), rodada 2 **PASS** — 15/15 ACs com evidencia `file:line`, 15 mutacoes com 10 mortas, 4 sobreviventes que nao falseiam nenhuma AC, 1 inerte. `validate_state.py platform-maturity` sai 0.
- **Entregue em F6**:
  - `tools/repo-tools` — package novo, 45 testes: extrator de rotas, extrator de consumidores da UI, reconciliador de inventario, checker do mapa de capacidades, checker de piso de cobertura, CLI `audit`.
  - `docs/capability-map.yaml` (26 capacidades, 22 `backend-only`) e `docs/route-inventory.md` (82 rotas, 4 consumidas, 78 sem superficie).
  - CI passou de 5 para 9 jobs: `+commit-lint`, `+e2e`, `+compose-smoke`, `+capability-audit`.
  - README e `docs/architecture-overview.html` reescritos para separar contrato de backend verificado de produto entregue.
  - `ui-roadmap.md` (16 entradas de produto + 6 superficies operacionais) e `.specs/features/ai-dock/spec.md` (prefixo `DOCK`, 23 requisitos) como exemplar.
- **Proximo passo**: F7 (AGT-01..05, onboarding agentico), F8 (GOV-01..06 + API-01..03) e F9 (MCP-01..08) ainda **nao tem `tasks.md`**. F7 e F8 tocam superficies disjuntas e podem correr em paralelo; F9 precisa de fase de Design antes (cria `apps/mcp`, aplicacao nova).
- **Residuais nao bloqueantes da rodada 2** (registrados em `validation.md`, nenhum vira fix task de F6): piso de cobertura declaravel sem `coverage.enabled`; piso de `0` aceito; texto da AC UIX-02 mais forte que a entrega; orcamento de saude do `compose-smoke` chega a 7 min por causa do `redis`; nada protege o proprio `ci.yaml` de ser esvaziado.
- **Nao provado localmente**: boot completo do compose (o `canvas` compila do zero em Alpine e estoura o tempo de uma rodada), suite Playwright, e tudo que depende de evento real de pull request (`base.sha`/`head.sha`, artefatos e cache do `actions/*`, Renovate instalado).
- **Armadilhas de ambiente**: Node **22.x** obrigatorio (`fnm use 22 && corepack enable`) — Node 24 quebra `apps/server/src/modules/ai-engine/callProvider.spec.ts` por `AbortSignal` cross-realm sob jsdom. `make ci` **nao passa nesta maquina** por falta de `pg_lsclusters` e `redis-server` (erros `ENOENT` de spawn, anteriores a este trabalho); o gate substituto e `make lint && make typecheck && make test-unit`.
- **Licoes**: L-017..L-021 registradas como `candidate` em `.specs/lessons.json`.
- **Uncommitted**: nenhum. Arvore limpa.

## 🏁 MARCO FINAL: roadmap architecture-canvas completo (F0–F5, 92/92 requirements)

Com o fechamento de F5, **todo o roadmap architecture-canvas está implementado e independentemente verificado, onda a onda, do F0 ao F5** — mesmo padrão de rigor que os marcos de fechamento de F2 ("MVP interno mínimo": persistência + IA geradora) e F3 ("visão completa": docgen, apresentação, lint arquitetural, architecture-as-code, comentários), agora estendido ao roadmap inteiro:

- **F0 (Fundação)** — infraestrutura base, sessão/RBAC, persistência server-first.
- **F1 (Identidade/RBAC, Persistência, Assets/Snapshots/Export/Backup)** — o invariante central do produto (server-first, nunca confiar no cliente) provado ponta a ponta.
- **F2 (IA: Biblioteca+Provider, Geração via IR, Edição com preview/aprovação/undo)** — o diferencial declarado do produto: geração de diagramas por linguagem natural, com IR determinística, aprovação atômica e undo real. **MVP interno mínimo do roadmap.**
- **F3 (Docgen, Apresentação/Protótipos, Lint arquitetural/C4, Architecture-as-code, Comentários assíncronos)** — a **visão completa** do documento-fonte.
- **F4 (Colaboração em tempo real via WebSocket, Compartilhamento externo com links/webhooks)** — o primeiro transporte novo (WS) e a primeira dependência externa opcional nova (Redis) do projeto, ambos provados com engines reais, nunca mockados.
- **F5 (Hardening: segurança de produção, OIDC, disaster recovery reforçado, observabilidade completa, performance documentada, acessibilidade do shell)** — **o fechamento do roadmap**: os controles que tornam a plataforma operável com confiança fora de um ambiente de desenvolvimento.

**Todos os 92 requirements do documento-fonte estão em `✅ Verified` ou em um `⚠️ Partial` corretamente escopado e disclosed** (AIC-04: dimensão de workspace/budget de limite de IA ainda não construída; DR-01: nota de precisão de wording "WAL-based" vs. o mecanismo row-level construído, e ausência de mecanismo de retenção automatizada de backups — ambos disclosed, ambos não-bloqueantes, nenhum inventado nem silenciosamente aceito).

**A única exceção deliberada é o piloto com times reais** — uma atividade organizacional pós-deploy do usuário (rollout gradual, coleta de feedback real, ajuste operacional), nunca um item de código, explicitamente fora de escopo desde a definição do roadmap (`spec.md`'s "Fases de entrega").

- **Next step**: nenhum — roadmap completo; próximos passos são operacionais (deploy real, piloto com times reais), não mais desenvolvimento autônomo desta spec.
- **Lições registradas** (`.specs/lessons.json`, todas `candidate`): L-001..L-016, incluindo L-008 (wiring de produção, aplicada proativamente desde F1c), L-016 (mutação sensor em pacote cross-package via node_modules simlincado — mitigado nesta onda rodando `pnpm install`/`build` dentro do próprio worktree scratch) e as mais recentes sobre asserção de shape de resposta vs. substring (F2a), cobertura de propriedade incompleta (F2b/AIG-03), RunStore in-memory (aceitável para MVP single-process) e violação de author≠verifier corrigida (T57 se auto-marcou Verified antes do Verifier rodar — sem impacto funcional, corrigido; não recorreu em F3/F4/F5, confirmado pelos Verifiers/batch workers destas ondas). F5's Verifier pass found no NEW instance of any previously-registered lesson class; its own 2 fixed gaps (rate-limit/OIDC tests that inject a custom fixture instead of also covering the real shipped default/edge case) are candidates for a new lesson, left for the next `lessons.py distill` pass rather than hand-authored here.
- **Blockers**: none
- **Uncommitted files**: none
- **Branch**: claude/architecture-canvas-system-cdwop7
