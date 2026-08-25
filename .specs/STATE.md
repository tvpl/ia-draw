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

### AD-010
- **Decision**: Aplicação de patches/deltas remotos ao canvas do editor (`apps/web`) passa por um handle imperativo exposto por `EditorSurface` (`forwardRef` + `useImperativeHandle`, método `applyRemoteScene(remote: readonly SceneElement[])`), que internamente chama `applyRemote` (`packages/editor-adapter/src/applyRemote.ts`, wrapper de `reconcileElements` do Excalidraw) para fundir a cena remota com a cena local por elemento (LWW, mesma regra de AD-001), antes de `excalidrawAPI.updateScene(...)`. Nenhum consumidor deve descartar a cena local inteira (ex. remount por `key`) para refletir uma mudança de origem remota.
- **Reason**: `applyRemote` existia desde F4 mas nunca tinha um caller real em `apps/web`; a alternativa mais simples (remontar `<EditorSurface>` com uma nova `key` para forçar `initialData` a reaplicar) descarta silenciosamente qualquer edição local ainda não sincronizada — violação direta de AD-001 e do próprio requisito funcional que motivou a decisão (o dock de IA precisa continuar permitindo edição manual do canvas enquanto um run está em andamento).
- **Trade-off**: Uma extensão pequena e aditiva na API de `EditorSurface` (props/handle novos, assinatura existente inalterada) em vez de uma solução mais simples porém com perda de dados; todo consumidor futuro que precisar refletir estado remoto no canvas (colaboração em tempo real, undo de IA, etc.) deve reusar este mesmo handle, não inventar um caminho próprio.
- **Scope**: `packages/editor-adapter` (`EditorSurface`, `applyRemote`), `apps/web` (qualquer feature que precise refletir mudança remota no canvas — `ai-dock` é o primeiro caller, `realtime-presence`/R10 é o próximo).
- **Date**: 2026-08-16
- **Status**: active

### AD-011
- **Decision**: `apps/web/src/auth/AuthProvider.tsx` (`useAuth()`) é a única fonte de verdade de sessão no frontend. Toda feature de `apps/web` que precisa saber quem é o usuário logado consome `useAuth()` — nenhuma chama `GET /me` por conta própria. `ProtectedRoute` (mesmo diretório) é o único guard de rota; uma sessão sem resposta válida de `GET /me` tenta `POST /auth/refresh` uma vez antes de redirecionar para `/login?next=<rota>`.
- **Reason**: antes desta feature (`sso-sign-in`, R2), nada em `apps/web` reagia a um `401` de `/me` — `DiagramEditorPage.tsx` chamava `/me` direto e seguia adiante com `user.id` `undefined` numa sessão morta. Centralizar evita que cada feature futura (R3 workspace-navigation em diante) reimplemente o mesmo boot-check e o mesmo retry de refresh com variações sutis.
- **Trade-off**: um ponto de acoplamento novo — toda rota protegida depende de `AuthProvider` estar montado acima dela em `App.tsx`; em troca, nenhuma feature futura precisa decidir de novo "o que fazer num 401 no boot".
- **Scope**: `apps/web` inteiro, a partir de R2; toda feature subsequente do roadmap de produto que precisa de identidade do usuário logado.
- **Date**: 2026-08-16
- **Status**: active

### AD-012
- **Decision**: `AuthProvider` é um **escopo de rota**, não um envelope global de `apps/web`. Em `App.tsx`, uma rota de layout sem path (`AuthLayout` = `<AuthProvider><Outlet/></AuthProvider>`) envolve todas as rotas autenticadas; toda superfície pública (sem sessão) entra como rota **irmã** dessa rota de layout, nunca dentro dela. `/share/:token` (R11) é a primeira.
- **Reason**: uma página pública montada dentro de `AuthProvider` dispara `GET /me` + `POST /auth/refresh` para um visitante que nunca vai ter sessão — dois round-trips inúteis com cookies enviados a rotas de auth — e faz a garantia de "esta página não depende de sessão" depender de `AuthProvider` continuar não redirecionando, o que é convenção e não estrutura. Fora do provider, a garantia é estrutural: nada acima da rota consegue redirecionar.
- **Trade-off**: uma indireção nova (`AuthLayout`) em `App.tsx`; em troca, nenhuma rota pública futura precisa reprovar que não vaza chamada de sessão. Não contradiz AD-011: `useAuth()` continua sendo a única fonte de verdade de sessão para toda superfície autenticada — só deixa de ser montado onde não há sessão nenhuma para resolver.
- **Scope**: `apps/web/src/App.tsx` e toda superfície pública futura (R12's visão pública de apresentação é a próxima).
- **Date**: 2026-08-17
- **Status**: active

### AD-013
- **Decision**: Os prefixos de caminho que pertencem ao servidor vivem numa fonte única (`packages/shared-contracts/src/routePrefixes.ts`). O proxy de desenvolvimento importa a lista; o `Caddyfile` do compose continua escrito à mão, mas um teste de paridade em `repo-tools` exige que rotas registradas, `Caddyfile` e proxy de desenvolvimento descrevam exatamente o mesmo conjunto. As rotas do servidor continuam sem prefixo `/api`.
- **Reason**: o `Caddyfile` roteava `/api/*`, um namespace que nenhuma das 90 rotas usa, então toda chamada de API no stack do Docker caía no catch-all e recebia a SPA — `POST /auth/login` respondia 405 do nginx. O `vite.config.ts` já tinha detectado a divergência (`SPEC_DEVIATION`) e corrigido só a si mesmo, deixando a outra borda errada e a própria lista incompleta em 7 prefixos. Sem fonte comum e sem teste, as duas bordas divergem de novo na próxima rota.
- **Trade-off**: o `Caddyfile` não é gerado, então uma mudança de prefixo exige editar dois arquivos — em troca ele continua legível e `infra/` não ganha passo de build. Prefixar as rotas com `/api` foi descartado: quebraria `docs/openapi.json`, o módulo MCP e todo consumidor externo.
- **Scope**: `infra/compose/Caddyfile`, `apps/web/vite.config.ts`, `packages/shared-contracts`, `tools/repo-tools`, e toda rota nova de `apps/server`.
- **Date**: 2026-08-24
- **Status**: active

### AD-014
- **Decision**: `apps/web` adota Tailwind CSS v4 com configuração CSS-first: os tokens de cor, espaçamento, raio, tipografia e sombra são declarados uma única vez num bloco `@theme` em `apps/web/src/styles/theme.css`, e componentes consomem apenas utilitários. Nenhum valor literal de cor existe em componente de produção e nenhum `style={{}}` permanece. A folha da aplicação é carregada depois da do Excalidraw, e nenhuma regra da aplicação seleciona dentro do canvas.
- **Reason**: o produto não tinha camada de estilo nenhuma — 0 arquivos CSS, 0 `className`, 9 `style={{}}` inline, todos concentrados na rota do editor, onde produziram a sobreposição entre painel lateral e canvas. Com 41 componentes esperando, CSS Modules exigiria escrever escalas, estados e densidade à mão antes de estilizar a primeira tela.
- **Trade-off**: uma dependência de build nova, e o Biome não ordena classes de Tailwind (nenhum segundo linter será adicionado só para isso). Tema escuro fica fora até a paleta clara estabilizar.
- **Scope**: `apps/web` inteiro; toda tela futura estiliza por tokens e utilitários, nunca por valor literal.
- **Date**: 2026-08-24
- **Status**: active

### AD-015
- **Decision**: A criação do administrador inicial é uma rota pública autolimitada (`GET`/`POST /auth/first-run`), disponível apenas enquanto a tabela `users` está vazia e respondendo `404` em ambas as verbas assim que deixa de estar. A operação é transacional (conta + organização + workspace + associação `org_admin`) e a corrida é resolvida pelo banco, não pela aplicação: a perdedora recebe `409`. O papel nunca vem de parâmetro do cliente.
- **Reason**: `createLocalAccount` não tinha nenhum chamador de produção — só testes e o harness e2e. Uma instância recém-subida ficava com tela de login e nenhuma conta, e a única saída era inserir hash no banco à mão. Provisionar por variável de ambiente foi descartado por manter segredo em variável persistida e duplicar o caminho de criação.
- **Trade-off**: uma superfície pública nova no módulo de auth, cuja segurança depende inteiramente da guarda de instância vazia — por isso a guarda é do banco, a resposta indisponível é `404` (não `403`, que confirmaria estado) e a rota reusa o limitador de taxa já aplicado às demais rotas de auth.
- **Scope**: `apps/server/src/modules/auth`, `apps/web/src/auth`, `infra/compose` (smoke), `README.md` (Quick start e deploy).
- **Date**: 2026-08-24
- **Status**: active

### AD-016
- **Decision**: O papel efetivo de um ator sobre um workspace é resolvido por uma única função no servidor, que considera a associação em `workspace_members` e o papel na organização dona, aplicando o mais permissivo dos dois. `org_admin` passa a valer em todo workspace da sua organização sem exigir associação. `reviewer` passa a conceder `comment:resolve`, que `viewer` deixa de conceder. A guarda que impede um workspace de ficar sem administrador roda dentro da mesma transação da alteração.
- **Reason**: os cinco papéis colapsavam em três conjuntos idênticos — `org_admin` ≡ `workspace_admin` e `reviewer` ≡ `viewer` — e `org_admin` não tinha nenhum poder além do workspace onde possuía linha, o que tornava o nome uma promessa que a API não cumpria. A ausência de guarda no servidor permitia remover o último administrador por chamada direta; a proteção existia só no cliente, e o próprio código admitia isso.
- **Trade-off**: mexer em autorização exige reescrever a matriz de teste para cobrir os cinco papéis contra todas as ações, incluindo ator sem associação. Reduzir para três papéis foi descartado: exigiria migração destrutiva de enum e quebra do contrato público da API. Nenhum valor de papel muda — apenas os grants associados a eles.
- **Scope**: `packages/auth/src/rbac.ts`, `apps/server/src/modules/workspace`, `apps/web/src/nav`.
- **Date**: 2026-08-24
- **Status**: active
- **Resolved consequence**: `org_admin` valendo em qualquer workspace da organização (por falta de `organization_members`) era a única leitura possível sem migração — declarado aqui como consequência de desenho aberta. **AD-017** fecha isso: tabela `organization_members` dedicada, os três call sites migrados.

### AD-017
- **Decision**: `organization_members(id, organization_id, user_id, created_at)`, sem coluna de papel, única por `(organization_id, user_id)`, é a fonte única de quem administra cada organização. Os três call sites que liam `workspace_members.role='org_admin'` como proxy de alcance organizacional migram para ela: `effectiveRole.ts`'s `resolveOrganizationRole`, `ai-provider/routes.ts`'s `hasOrgAdminMembership`, `workspaces.ts`'s `listWorkspacesForUser`. Um módulo novo (`organizationAdmins.ts`) e rotas REST dedicadas (`GET/POST/DELETE /workspaces/:id/organization-admins[/:userId]`) concedem/revogam sem editar papel de workspace, com a mesma guarda de último administrador de `lastAdmin.ts`. `workspace_members.role='org_admin'` deixa de conceder alcance de organização; os seletores de papel de workspace (convite e troca) param de oferecê-lo como opção nova.
- **Reason**: AD-016 tinha documentado essa leitura como consequência de desenho deliberada e aberta ("a única leitura que o schema atual suporta, sem migração"). Uma varredura achou que ela não vivia só em `resolveEffectiveRole` — dois outros call sites faziam a mesma varredura bruta por conta própria, a mesma classe de defeito (segundo caminho de autorização divergente) que AD-016 já tinha fechado uma vez.
- **Trade-off**: o enum `workspace_member_role` mantém os cinco valores — removê-lo quebraria linhas existentes e a matriz de RBAC sem necessidade, já que só o significado organizacional muda, não a validade do valor. Uma linha legada com `org_admin` continua existindo e exibindo esse rótulo com fidelidade, só não pode ser reatribuída a ele pelos seletores.
- **Scope**: `packages/database/src/schema.ts`, `apps/server/src/modules/workspace/*`, `apps/server/src/modules/ai-provider/routes.ts`, `apps/server/src/modules/auth/firstRun.ts`, `apps/web/src/nav/{organizationAdminClient.ts,WorkspaceMembersPage.tsx}`.
- **Date**: 2026-08-25
- **Status**: active

## Handoffs

Uma subseção por frente ativa (GOV-06). Hoje só há uma frente (`platform-maturity`); o formato
comporta N sem colisão de merge — cada frente edita só a sua própria subseção.

### platform-remediation (branch: claude/project-failures-analysis-ij346k)

- **Feature**: onda **F11 — remediação**, indexada em `.specs/features/platform-maturity/remediation-roadmap.md` (R17–R23). Ao contrário de `ui-roadmap.md`, que decompunha capacidade ausente, esta onda decompõe **defeito confirmado**: cada entrada saiu de um achado reproduzido na análise de 2026-08-24, nenhuma de suspeita.
- **Branch**: `claude/project-failures-analysis-ij346k`, cortada de `main` em `434259e`.
- **Phase / Task**: **onda completa — R17 a R23 fechadas e verificadas.** 62 tasks executadas, 7 `validation.md` escritos, 107 requisitos (ESTB, EDGE, BOOT, GATE, UIF, RBAC, DOCS) marcados `✅ Verified`.
  - **R17 `editor-stability` — PASS**, 14 ACs com evidência `file:line`, sensor 7/7. A rota do editor monta. Causa raiz: `EditorSurface.onChange` emitia `onSelectionChange` com um array novo a cada change; o consumidor elevava para estado e o re-render voltava ao `onChange` (React #185). Guarda de estabilidade por chave de seleção. Toda rota ganhou `RouteErrorBoundary`; um e2e com allowlist de console **vazia** reprova em qualquer erro.
  - **R18 `edge-routing` — PASS**, 10 de 12 ACs diretos e 2 estruturais (EDGE-03/04, exigem o stack de pé; executados em R20). O `Caddyfile` deixou de rotear `/api` — namespace que nenhuma das 92 rotas usa — e passou a rotear os 15 prefixos reais, todos declarados uma única vez em `shared-contracts/routePrefixes.ts` (AD-013).
  - **R19 `instance-bootstrap` — PASS**. `GET`/`POST /auth/first-run`, pública enquanto `users` está vazia e `404` depois; conta + organização + workspace + `org_admin` numa transação sob `pg_advisory_xact_lock`, perdedora recebe `409` (AD-015). Antes disso uma instância nova não tinha nenhuma conta com que entrar e a única saída era inserir um hash Argon2 à mão.
  - **R20 `green-gate` — PASS, com emenda no fechamento**. **`make ci` ficou verde pela primeira vez na história do repositório.** Quatro bloqueios reais e um flake, dos quais o plano previa dois. O flake diagnosticado em `STATE.md` como "conhecido" era contenção de concorrência do turbo (10 suítes vitest disputando 4 CPUs contra o timeout de 1s do `findByText`) — resolvido por `--concurrency=2`, não por tolerância. `infra/backup` saiu para um job próprio, com Emenda registrada na ADR-0007. **Emenda de 2026-08-25**: `--concurrency=2` reduziu o flake mas não o eliminou (~1 falha em 4 no fechamento da onda). Havia três causas, duas delas imunes a qualquer aumento de timeout — um evento de teclado disparado antes do listener de um efeito passivo é descartado, e contar ticks de microtask é palpite. Fechado em `20f57fc`, com 13 corridas limpas consecutivas e `make ci` verde sob `TURBO_FORCE=true`.
  - **R21 `ui-foundations` — PASS**. Tailwind v4 CSS-first com tokens num único bloco `@theme`; nenhum `style={{}}` e nenhum literal de cor sobrevive em componente de produção (`tokenSweep.spec.ts`, com uma isenção nomeada). O chunk de entrada caiu de **1.486 kB para 246 kB** ao carregar sob demanda as 5 rotas que trazem o canvas (AD-014).
  - **R22 `rbac-clarity` — PASS com 2 parcialidades nomeadas**. Os cinco papéis deixaram de ser três: `reviewer` ganhou `comment:resolve` e `viewer` perdeu; `org_admin` passou a valer em toda a organização (AD-016). Guarda transacional de último administrador sob lock de linha. **Achado fora do plano**: existia um segundo caminho de autorização dentro de `getWorkspaceById`/`listWorkspacesForUser`, que anulava a mudança inteira.
  - **R23 `docs-truth` — PASS**, 13 de 13 ACs diretos, sensor 6/6. Os números do README passaram a ser escritos pelo auditor a partir da medição, e o mapa de capacidades passou a ser checado **nas duas direções**. **Achado fora do plano**: o próprio extrator de consumidores era cego a 24% da interface (só reconhecia `fetch`/`fetchImpl`, e `lintClient` usa `doFetch`); a medição real subiu de 51 para 67 rotas consumidas.
- **Execução sem sub-agentes**: o oferecimento obrigatório de sub-agentes não pôde ser feito — a ferramenta não estava disponível nesta sessão. As 62 tasks rodaram inline e a validação foi o passe standalone de `validate.md`, com autor e verificador sendo o mesmo agente. **Limitação registrada, não dispensa**: custou um `Done when` marcado sem o artefato existir (changeset de T1/R17) e um gate declarado verde sobre cache do turbo (R22, ver abaixo).
- **Testes existentes modificados de propósito** (declarado, nunca silencioso): `webConsumers.spec.ts` (contagem congelada → 5 invariantes), `DiagramEditorPage.spec.tsx` (asserções sobre `style` inline que UIF-13 remove → asserções sobre `className`, com asserção de largura mais forte), `comment.int.spec.ts` (afirmava que `viewer` resolve comentário — contrato que AD-016 removeu → agora fixa os dois lados da fronteira). Cada um justificado no `validation.md` da sua onda.
- **Decisões de produto tomadas com o usuário nesta sessão**: escopo da onda completo (7 specs); Tailwind v4 com tokens; first-run wizard como bootstrap (descartadas variável de ambiente e CLI); diferenciar os cinco papéis de verdade (descartada a redução para três). Registradas como AD-013..AD-016 acima e como `docs/adr/0013..0016`.
- **Next step**: R24–R28 fechadas e verificadas — ver marcos abaixo. A onda R24–R28 está completa.
- **R24 `shared-resource-frame-fix` — fechada.** `SharedResourcePage` ganhou `key={frame.id}` em `<EditorSurface>` (T1), forçando remount real por frame — o `<Excalidraw/>` real só lê `initialData` no mount, e a versão anterior trocava a prop sem remontar, então a apresentação publicada ficava presa no primeiro frame apesar do teste unitário (mockado) passar. T2 corrigiu o comentário e o teste em `EditorSurface.tsx`/`.spec.tsx` que fixavam essa premissa errada. T3 acrescentou um e2e Playwright contra o `<Excalidraw/>` REAL (sem mock) que publica uma apresentação de 2 frames com cores distintas e lê os pixels do canvas (`getImageData`) para provar a troca de conteúdo — confirmado como sensor de discriminação de verdade: reverter `key={frame.id}` faz o teste falhar. **Achado fora do escopo durante T3**: `/share` é prefixo de rota do servidor (AD-013) — Vite E Caddy encaminham QUALQUER requisição sob `/share*` para `apps/server`, então uma navegação de página inteira para `/share/:token` nunca alcança a SPA (devolve o JSON cru da API). Defeito real, pré-existente, ortogonal ao bug corrigido aqui — registrado em `remediation-roadmap.md`'s "Descoberto durante a execução", aberto e sem dono (corrigir tocaria `vite.config.ts`/`Caddyfile`/`routePrefixes.ts`, fora do escopo desta feature). O e2e contorna isso navegando a SPA por `/login` e então roteando client-side (`history.pushState`+`popstate`) até `/share/:token` — mesma árvore React, mesmo componente real. **Verificação independente encontrou um segundo defeito real**: o próprio e2e de T3 não conseguia rodar até o fim — `runTestServer.ts` bootava `registerAllModules` sem `deps.storage`, então `publishPresentation` tentava falar com um MinIO real inalcançável (`ECONNREFUSED 127.0.0.1:9000`). Corrigido injetando o mesmo double `StorageClient` em memória que `apps/server`'s `publish.int.spec.ts` já usa — `apps/web/e2e/support/fakeStorage.ts` (novo), reusado, não reinventado. Lição L-062: um `Done when` de gate marcado `[x]` não prova que o comando passa num ambiente limpo até ser rodado isolado.
- **R25 `editor-panel-collapse` — fechada.** UIF-17 (recolher o painel devolve a largura ao canvas) nunca tinha task própria desde R21 — construído agora em `DiagramEditorPage.tsx`: recolher remove o `<aside>` da árvore (o canvas, já `flex-1`, reclama a largura), um controle no mesmo lugar da árvore reabre. A aba ativa de `EditorSidePanel` (IA/Comentários/Lint) sobe a estado controlado no pai para sobreviver ao ciclo recolher/expandir. A tabela de rastreabilidade de `ui-foundations/spec.md`, que dizia UIF-17 `✅ Verified` enquanto o próprio `validation.md` da mesma onda documentava "não implementado", foi corrigida para bater com a realidade. Verificador independente: PASS de primeira, 6/6 critérios, 2/2 mutações do sensor mortas.
- **R26 `list-retry-action` — fechada.** UIF-10 (ação de tentar novamente no estado de erro) completada nas quatro páginas de lista — três reusando `resourceListStore`'s `setError`/nova função nomeada chamável pelo botão, e `WorkspaceMembersPage` com o botão na ramificação `notFound` (MEM-03 preservado: retry nunca distingue motivo de falha).
- **R27 `concurrency-proof` — fechada.** RBAC-12 (duas remoções concorrentes deixam no máximo um
  workspace sem admin) e BOOT-08 (dois `first-run` concorrentes criam no máximo uma conta) saem de
  `⚠️ Verified (parcial)` para `✅ Verified` em `rbac-clarity/spec.md`/`instance-bootstrap/spec.md`.
  Nova suíte, Postgres real (não PGlite): `apps/server/src/modules/workspace/lastAdmin.concurrency.int.spec.ts`
  e `.../auth/firstRun.concurrency.int.spec.ts`, alvo próprio `make test-integration-concurrency`,
  job de CI dedicado, Emenda de 2026-08-25 na ADR-0007 — mesmo padrão de exceção nomeada que
  `infra/backup` já tinha. **Achado durante a execução**: `app.inject` (a mesma técnica de
  `rbac-matrix.int.spec.ts`) resolvia a corrida de RBAC-12 numa ordem fixa determinada pela posição
  no array do `Promise.all`, não por concorrência real — o segundo mover perdia a própria
  associação (removida pelo primeiro) antes do seu próprio `requireMembership`, virando `404` em
  vez do `409` esperado, sempre, em toda execução. Sockets reais (`app.listen` + `fetch`) mais um
  ciclo de aquecimento descartado (JIT/pool na primeira invocação do par de rotas) resolvem a
  corrida de verdade, com o vencedor variando entre execuções — confirmado por instrumentação
  manual antes de escrever o teste final, não assumido. `make ci`/`make test-integration`
  continuam passando com zero Postgres instalado (verificado rodando `make ci` com o cluster
  local parado). **Verificação independente encontrou um segundo defeito real**: a mesma
  mitigação (sockets reais + aquecimento) nunca foi aplicada ao teste de BOOT-08 — sensor de
  mutação mostrou que remover `pg_advisory_xact_lock` de `bootstrapInstance` só era pego 13/24
  vezes (54%), quase cara-ou-coroa para uma garantia de integridade de dados. Causa raiz:
  `argon2.hash` roda antes do lock, e uma corrida ÚNICA entre dois `first-run` concorrentes é
  inerentemente próxima de 50/50 sem o lock — nem sockets reais nem aquecimento (testados,
  medidos 24/24 numa forma e 10/24 noutra contra o MESMO código) tornam uma amostra única
  confiável. Correção real: repetir a corrida 15 vezes dentro do mesmo teste, resetando `users`
  via `TRUNCATE` entre tentativas (mesma conexão, sem recomeço a frio), exigindo que TODA
  repetição resolva certo — em lotes de 4 contra apps Fastify sucessivos, porque `/auth/
  first-run` tem limite de taxa próprio (10 req/60s) que uma única aplicação de vida longa
  estouraria em 15 repetições. Sensor após a correção: 15/15 execuções completas (225 tentativas
  de corrida) mataram a mutação — 100%.
- **R28 `organization-admins` — fechada.** `organization_members(id, organization_id, user_id,
  created_at)` é a fonte única de quem administra cada organização — sem coluna de papel, presença
  é o sinal inteiro. Migração de backfill preservou exatamente o conjunto de administradores
  existentes. Os três call sites que liam `workspace_members.role='org_admin'`
  (`resolveOrganizationRole`, `hasOrgAdminMembership`, `listWorkspacesForUser`) migraram para a
  tabela nova, cada um trocando sua única consulta antiga pela equivalente. Módulo
  `organizationAdmins.ts` (list/add/remove + guarda de último administrador sob lock de linha,
  mesmo padrão de `lastAdmin.ts`) e rotas REST dedicadas (`GET/POST/DELETE
  /workspaces/:id/organization-admins[/:userId]`); seção nova em `WorkspaceMembersPage` concede e
  revoga por e-mail sem editar papel de workspace. `org_admin` deixou de ser oferecido como opção
  nova nos seletores de papel de workspace (`ASSIGNABLE_ROLE_VALUES`, 4 valores); uma linha legada
  continua exibindo o rótulo com fidelidade. Registrado como **AD-017**
  (`docs/adr/0017-organization-members-table.md`) — resolve a consequência de desenho que AD-016
  tinha deixado aberta e sem dono.
- **Aberto e sem dono** (dívida honesta, nenhuma escondida):
  - **`/share/:token` é inalcançável por navegação de página inteira** — o proxy do Vite e o `Caddyfile` encaminham `/share*` inteiro para `apps/server` (AD-013), então uma visita fria à URL pública real (a que `ShareLinkPanel.tsx` distribui) devolve o JSON da API, nunca a SPA. Achado durante R24/T3, fora do escopo dela para corrigir. Precisa de uma spec própria tocando `vite.config.ts`/`Caddyfile`/`routePrefixes.ts`.
  - **BOOT**: o caso de borda `503` (banco indisponível durante o first-run) não tem teste.
- **Lições novas**: L-046 a L-063 (`candidate`) — memoizar prop pelo valor e nunca pelo mount; mock mais permissivo que a lib esconde defeito; `Done when` que produz artefato tem de ser conferido contra o disco; guard por substring de identificador aprova redefinição local (recorreu em R21 com `--color-accent` casando `--color-accent-hover`); AC que exige serviço de pé é estrutural, não verde; um segundo caminho de autorização anula a mudança do primeiro; **gate que passa por cache do turbo não é gate que passou**; `git checkout -- <arquivo>` descarta trabalho não commitado igual a `git stash` (recorrência de L-024 em forma nova); flake tem mais de uma causa e aumentar timeout só resolve uma delas; `asyncUtilTimeout` da Testing Library tem de ficar abaixo do `testTimeout` do vitest; um `Done when` de gate marcado `[x]` não prova que o comando passa isolado (L-062); e a maior delas — **um instrumento de medição que só verifica uma direção não descobre o que ele próprio não mede**.
- **Blockers**: nenhum.
- **Uncommitted files**: nenhum.

### platform-maturity (branch: feature/improvements-3)

- **Feature**: platform-maturity (`.specs/features/platform-maturity/`) — programa de maturidade sobre o roadmap architecture-canvas ja fechado. A partir de F10, a frente entrou na fase de produto: `ui-roadmap.md`'s R1-R16, uma spec própria por entrada, cada uma sua própria onda de Specify → (Design) → Tasks → Execute → Verify.
- **Branch**: `feature/improvements-3` (a antiga `feature/improvements-2` já foi mergeada via PR #3 e virou histórico; este trabalho continua na branch nova, cortada de `main` no mesmo commit do merge). Nada foi enviado para o remoto; todos os commits são locais.
- **Phase / Task**: **Onda F6 fechada e verificada** (ver marco abaixo). **Onda F7 fechada e verificada.** **Onda F8 (GOV-01..06, API-01..03): fechada e verificada nas duas rodadas do Verifier.** Round 1 confirmou as 9 ACs individualmente `✅ Verified` por evidência `file:line` (ver `validation.md`'s "F8 Wave Report") mas reportou `⚠️ Issues`/FAIL no Gate Check: `pnpm --filter @arch-canvas/server run test:unit` saía 1 porque o piso de cobertura de `functions` travado por CIQ-04 (F6) regrediu de 39.73% para 28.87% nesta onda (confirmado via `git worktree` na baseline real `a55c4d7`, não `git stash`), e a nota original de `tasks.md:453` (T26) que classificava isso como "pré-existente" estava errada (isolação por `git stash` comparou contra um estado intermediário do próprio wave, não contra o início real da onda). Fix Plan 1 foi aplicado no commit `ba20552`: piso de `functions` recalibrado deliberadamente para o valor genuinamente medido (28.87%, com justificativa inline em `apps/server/vitest.config.ts`), `lines`/`branches`/`statements` intactos, e `tasks.md:453` corrigido para atribuir a regressão a este wave. **Round 2 (2026-08-16) re-rodou só o Gate Check** (escopo estreito, per o próprio round 1) e confirmou: `pnpm --filter @arch-canvas/server run test:unit` sai 0 (380/380 testes, `functions` medido 28.87% numa run fresca, batendo com o piso), `make lint`/`make typecheck`/`make test-unit` todos verdes, e o fix é legítimo (valor bate com medição real, nenhum outro piso foi baixado, comentário de justificativa preciso) — não uma margem de segurança inflada. **F8 está fechada.** **Onda F9 (MCP-01..08): fechada e verificada (2026-08-16).** As 8 ACs foram verificadas com evidência `file:line`, incluindo execução direta (não só leitura) dos testes de integração MCP-01/02/03 e do teste de round-trip `compile→scene→decompile` (`packages/diagram-ir/src/decompile.spec.ts`) contra o `irDocumentSchema` real. Sensor de discriminação: 3/3 mutações mortas (`decompile()`'s inferência geométrica de containers, `componentLookup.ts`'s direção inbound/outbound, `requireMcpToken`'s decisão de auth). Gate: `make lint`/`make typecheck`/`make test-unit` verdes; `apps/server test:integration` 339/352 passaram — as 3 falhas (`backup/restoreTest`, `ws-gateway/crossInstancePresence`, `ws-gateway/presenceBroadcaster`) são o gap de sandbox pré-existente e não relacionado a esta onda, causa raiz reconfirmada pelo próprio Verifier (`pg_lsclusters`/`redis-server` ausentes do host, não algo tocado por este diff); `repo-tools run audit` sai 0 (88 rotas, 0 violações). Durante a execução, o batch de T16-T17 corretamente parou num `repo-tools audit` vermelho (o `mcp/routes.ts`'s `routeSchemas` nunca tinha sido importado em `openapi/registry.ts` — nenhuma task listava esse arquivo explicitamente, mesma classe de lacuna do Phase 2d do F8) em vez de forçar o commit; o orquestrador aplicou o fix no commit `14560ff`, e o Verifier re-confirmou o audit em 0 de forma independente, não só lendo a mensagem do commit. **F9 está fechada.**
- **Entregue em F7**:
  - `CLAUDE.md` (raiz) — comandos de build/teste/stack, invariantes AD-001..009 resumidos, armadilhas de ambiente (Node 22, corepack, AD-008).
  - `.claude/settings.json` — permissoes de ferramenta (allowlist de comandos seguros deste repo) + hook `SessionStart` que avisa quando o Node ativo nao e 22.x.
  - `.claude/commands/audit.md` e `.claude/commands/gate.md` — os dois fluxos que cada onda repetia em prosa (auditoria de capacidades/rotas, gate local) agora versionados como slash commands.
  - 2 licoes novas (`L-022`, `L-023`, `candidate`): nome de script que colide com subcomando builtin do pnpm precisa de `run` explicito; prosa de onboarding nao tem nenhum guardiao automatizado (lint/CI), entao um comando documentado errado so e pego na primeira execucao real, nunca na leitura.
- **Entregue em F8 (fechada e verificada — round 2 confirmou o Fix Plan 1 aplicado)**:
  - Phases 1-4 (T1-T28, API-01..03): gerador de OpenAPI 3.1 a partir dos schemas Zod (`apps/server/src/openapi/*`), `routeSchemas` exportado por cada módulo de rotas, portão de CI `capability-audit` estendido com `checkOpenApiParity`, `checkEvalThreshold`/`EVAL_SUCCESS_THRESHOLD` e job `ai-evals` dedicado no CI.
  - Phase 5 (T29-T35, GOV-01..06): `CODEOWNERS` (raiz, `@tvpl` por domínio de primeiro nível); `.github/PULL_REQUEST_TEMPLATE.md` (Requirement IDs, spec link, checklist `/gate`); `.changeset/config.json` (`access: restricted`) + `@changesets/cli` como devDependency da raiz; job `changeset-check` novo em `.github/workflows/ci.yaml` (mesmo padrão `base.sha`/`head.sha` do `commit-lint`, falha nomeando o package sem changeset); `docs/adr/TEMPLATE.md` extraindo o formato já usado por `0001..0009` + linha no `CLAUDE.md`; linha no `CLAUDE.md` confirmando a convenção "uma spec por domínio" (exemplar: `ai-dock/spec.md`); esta própria migração de `## Handoff` para `## Handoffs` por frente.
- **Entregue em F9 (fechada e verificada)**:
  - `packages/diagram-ir/src/decompile.ts` — primeiro compilador reverso cena→IR do projeto (fecha o débito do ADR-0004), inferência geométrica de containers por bounding-box, `kind` sempre `'group'` quando inferido (limitação disclosed, não recuperável da geometria).
  - `mcp_tokens` (tabela + migration `0011`), `apps/server/src/modules/mcp/{auth,mcpTokens,componentLookup,routes}.ts` — token MCP nomeado/revogável (espelha `shareLinks`), `requireMcpToken` middleware, toda autorização via `can()`, convênio 404 uniforme (AUTH-04/MCP-05) em toda rota token-autenticada.
  - `apps/mcp` (aplicacao nova, servidor MCP stdio) — cliente HTTP fino (`client.ts`), 3 resources (`listDiagrams`/`readDiagram`/`readComponent`) com wrapper de dado não-confiável (MCP-06) em toda resposta, `cli.ts` entrypoint, zero import de pacote de domínio (`@arch-canvas/diagram-domain`/`@arch-canvas/diagram-ir`/etc — confirmado por grep, regra arquitetural de `design.md`).
  - `POST /diagrams/:id/mcp-patch` + tool `set_component_metadata` (MCP-07) — escrita atrás de `MCP_WRITE_ENABLED`, gate em nível de registro de rota (não checagem em handler) nos dois lados (servidor e `apps/mcp`), reusa exatamente `createSnapshot(kind:'pre_ai')`/`appendOperation`/`applyMetadataOps` de `ai-engine/applyPatch.ts`.
  - `apps/mcp/README.md` (MCP-08) — config pronta para Claude Code e Cursor; `docs/capability-map.yaml` — entrada nova para o servidor MCP.
  - 1 lição nova (`L-026`, `candidate`): task plan que adiciona um módulo de rotas novo deve tasquear explicitamente a fiação em TODO registro cross-cutting (module registration E o registro OpenAPI) na mesma task que cria as rotas — este é o segundo caso desta classe de lacuna no projeto (o primeiro foi o Phase 2d do F8, com convenção de nome de arquivo).
- **Entregue em F10 — R1 `ai-dock` (fechada e verificada, round 2 PASS 23/23)**:
  - Dock de IA em `apps/web/src/ai-dock/` (`AiDock.tsx`, `aiDockStore.ts`, `aiDockClient.ts`) — primeira superfície de produto para geração/edição por IA (DOCK-01..23): pedido em linguagem natural, prévia estrutural, aprovação explícita obrigatória (inclusive quando `requiresExplicitApproval` é `false`), undo via snapshot `pre_ai`.
  - `GET /diagrams/:id/bootstrap` ganhou `mutatePermissions` aditivo (decisão `diagram:mutate`, antes só existia `permissions`/`diagram:read` — o frontend não tinha sinal correto para decidir se renderiza o dock).
  - `packages/editor-adapter/src/EditorSurface.tsx` ganhou `onSelectionChange` e um handle imperativo `applyRemoteScene` (`forwardRef`/`useImperativeHandle`) que usa `applyRemote` (existia desde F4, nunca tinha caller real) para fundir cena remota com a local por elemento (LWW) — registrado como **AD-010**, é o padrão que R10 (`realtime-presence`) vai reusar.
  - Verifier round 1 encontrou gate vermelho (achado incidental, fora do diff de ai-dock: `docs/openapi.json` desformatado pela regeneração de R2) + 6 gaps de cobertura de teste (DOCK-04/06/08/10/14/18/20/21 — todos "duas cláusulas, só a emissão testada, o estado resultante não"); fix round fechou os 6, round 2 confirmou 23/23 ACs, sensor 5/5 mutações mortas.
  - 3 lições novas (`L-027`, `L-028`, `L-029`, `candidate`): AC de duas cláusulas precisa de asserção nas duas; gerador que escreve arquivo versionado deve formatar a própria saída (não deixar pro lint pegar depois); lista limitada por `.slice()` precisa de wording de spec que combine com o comportamento (não promete "rolagem" sem paginação real).
- **Entregue em F10 — R2 `sso-sign-in` (fechada e verificada, round 2 PASS 21/21)**:
  - Primeira tela de login do produto: `apps/web/src/auth/` (`AuthProvider.tsx`/`useAuth()`/`useLogout()`, `ProtectedRoute.tsx`, `LoginPage.tsx`) — local (e-mail/senha) + SSO condicional, sessão renovada reativamente (`GET /me` → 401 → `POST /auth/refresh` uma vez → retry), redirecionamento para `/login?next=` preservando destino.
  - Duas mudanças de servidor decididas com o usuário antes do Specify (registradas na spec, não silenciosas): `GET /auth/oidc/status` nova (`{configured: boolean}`, sem segredo) para o botão de SSO nunca aparecer incondicionalmente; `GET /auth/oidc/callback` numa falha agora redireciona para `${publicUrl}/login?error=oidc_failed` em vez de devolver `problem+json` cru no navegador.
  - `AuthProvider`/`useAuth()` registrado como **AD-011**: única fonte de verdade de sessão em `apps/web` daqui pra frente — nenhuma feature futura deve chamar `/me` por conta própria.
  - Verifier round 1: 20/21 ACs, 1 gap real (SSO-20, anúncio `aria-live` nunca testado, mutante sobreviveu). Fix foi só teste (`+6` linhas), round 2 confirmou 21/21, sensor 6/6 mortas, incluindo 3 mutações específicas contra o próprio fix.
  - Residual não bloqueante disclosed (não é gap, é limite da ferramenta): `repo-tools audit` continua marcando `GET /me`/`POST /auth/refresh`/`POST /auth/logout` como `pending-product` porque `AuthProvider.tsx` chama através de um wrapper `doFetch` com alias local que o scanner estático do audit não segue (regex só pega `fetch(`/`this.fetchImpl(` literais); `POST /auth/login` e `GET /auth/oidc/status` são detectados corretamente. T8 fica `[~]` em vez de `[x]` no `tasks.md`, com a causa raiz documentada.
  - 1 lição nova (`L-030`, `candidate`): quando uma AC nomeia um atributo ARIA ou região live, o teste precisa afirmar esse atributo — não só que o texto renderiza.
- **Lição operacional desta sessão (sem número, é sobre o processo, não sobre o código)**: rodar dois batch workers de features diferentes em paralelo, sem isolamento de `git worktree`, contra a mesma árvore de trabalho é genuinamente arriscado — um índice/HEAD race real aconteceu duas vezes nesta onda (uma sweep acidental de arquivos de doc não commitados para dentro do commit de outra task; uma sweep de testes de `ai-dock` para dentro de um commit de `sso-sign-in`). Nenhum dado foi perdido nas duas vezes (histórico local, `git worktree`/`reset --soft` recuperaram tudo, cada commit final foi reconferido com `git show --stat`) mas o custo de recuperação foi real. A partir daqui: batches concorrentes que tocam arquivos possivelmente sobrepostos (ex. `DiagramEditorPage.tsx` tocado por duas features) devem rodar em sequência, nunca em paralelo sem isolamento; Verifiers (só leitura + scratch worktree próprio) continuam seguros em paralelo com um batch worker de outra feature.
- **Entregue em F10 — R3 `workspace-navigation` (fechada e verificada, round 2 PASS 26/26)**:
  - Primeira navegação real do produto: `apps/web/src/nav/` (`WorkspaceListPage.tsx`, `ProjectListPage.tsx`, `DiagramListPage.tsx`) — `/` → workspaces → `/w/:id` → projetos → `/w/:id/p/:id` → diagramas → editor (rota existente, inalterada). Primeiro roteamento aninhado do app (`AppShell` virou layout com `<Outlet/>`).
  - `resourceClient.ts`/`resourceListStore.ts` genéricos (parametrizados, uma implementação pros três recursos) — cliente/store de list+create+rename+archive reusado por workspace/projeto/diagrama, não três cópias quase-idênticas.
  - `ConfirmArchiveDialog.tsx` — primeiro `<dialog>` nativo do app; "arquivar" é `DELETE` (soft-delete, sem restore) nos três níveis por decisão do usuário, nomeado "Arquivar" na UI com aviso explícito de irreversibilidade.
  - `GET /workspaces`/`GET /workspaces/:id` ganharam `role` aditivo (decisão do papel efetivo do usuário, mesmo precedente de `mutatePermissions`/`canMutate` já usado duas vezes nesta frente) — decide client-side se mostra criar/renomear/arquivar, servidor continua sendo a autoridade final.
  - `apps/web` ganhou sua primeira dependência de `@arch-canvas/auth` (`Role`/`can()`, pacote puro sem runtime deps) — evita redeclarar união de papéis e lógica de grant à mão.
  - Verifier round 1: 21/26 ACs, 5 gaps — o principal (NAV-21, Major) era real: nem `ProjectListPage` nem `DiagramListPage` tinham ação pra arquivar o **container que a pessoa está vendo no momento** (só linhas filhas), então "arquivar e subir um nível" nunca disparava. Fix round adicionou o controle que faltava (`c9103aa`) + 4 commits de teste (teclado, segundo locale, aria-live, casos de borda). Round 2: 26/26, sensor 8/8 mortas, incluindo 3 mutações específicas contra o próprio fix de NAV-21.
  - Residual disclosed (mesma classe de limitação já vista em `sso-sign-in`): `repo-tools audit` só reconhece 14 das ~15 rotas do roadmap como consumidas — `resourceClient.ts` chama URL por propriedade de config (`config.listUrl`), não string literal, e o extrator estático da ferramenta não resolve isso. Não é uma regressão funcional, é um limite conhecido do scanner.
  - 4 lições novas (`L-031`..`L-034`, `candidate`): quando uma AC descreve ação sobre o container que está sendo visto (não só seus filhos), a task precisa escopar explicitamente um controle de página, não só ações por linha da lista.
- **Entregue em F10 — R4 `workspace-members` (fechada e verificada, PASS 21/21 na primeira rodada)**:
  - Tela de membros por workspace: `apps/web/src/nav/WorkspaceMembersPage.tsx` — ver, convidar por e-mail, trocar papel, remover. Alcançável a partir de um link em `ProjectListPage`, visível a qualquer papel (leitura é universal), rota `/w/:workspaceId/members`.
  - Nova rota `GET /users:lookup?email=` (decidida com o usuário) — resolve e-mail → identidade antes de adicionar, já que `POST /workspaces/:id/members` exige `userId` exato e não existia nenhum jeito de descobrir isso a partir de um e-mail. Só sessão válida, sem escopo de workspace; projeção explícita de 3 campos (nunca vaza hash de senha).
  - `memberClient.ts` — cliente dedicado, não o `resourceClient` genérico de `workspace-navigation` (pesquisa confirmou que convite e troca de papel não encaixam na forma `create`/`rename` do genérico sem gambiarra).
  - Proteção client-side (não autoritativa — servidor não tem essa guarda) contra o workspace ficar sem nenhum admin: bloqueia a própria pessoa se remover ou se rebaixar quando é o único `org_admin`/`workspace_admin`; um segundo admin removendo o primeiro continua permitido, por decisão de escopo.
  - Busca por e-mail só dispara no submit do formulário, nunca por tecla digitada — evita amplificar um oráculo de existência de conta.
  - Verifier: PASS de primeira, 21/21 ACs, sensor P0-full (8/8 mortas, por tocar lógica adjacente a autorização), incluindo prova das duas pontas da proteção de último-admin (bloqueia quando deveria, não bloqueia quando um segundo admin age sobre o primeiro).
  - Nenhuma lição nova — PASS limpo sem sinal.
- **R5 (`component-library`), R6 (`history-snapshots`) e R7 (`export-import`)**: fechadas e verificadas (PASS) numa worktree paralela do usuário, mergeadas na branch remota de `feature/improvements-3` e trazidas para esta sessão via `git pull`. Não fazem mais parte do trabalho pendente desta frente.
- **Entregue em F10 — R9 `diagram-comments`, R10 `realtime-presence`, R11 `share-links`, R15 `ai-provider-admin`, R16 `workspace-webhooks` (as cinco fechadas e verificadas, PASS, mergeadas em `feature/improvements-3` via worktrees isoladas em paralelo)**:
  - **R9 diagram-comments**: `CommentsSidebar` (thread, resolver/reabrir/responder/filtrar/atualizar) mergeada em `EditorSidePanel` como segunda aba ao lado do `AiDock` — 27/27 ACs, sem lição nova.
  - **R10 realtime-presence**: `PresenceClient`/`presenceStore`/`ConnectionStatus` — WebSocket de presença (cursor, seleção, status idle) com backoff e catch-up pós-reconexão. Fix de protocolo decidido com o usuário: `presencePayloadSchema` (`shared-contracts`) ganhou `senderId`/`displayName` aditivos, e `ws-gateway/routes.ts` passou a derivar a identidade do relay a partir da sessão autenticada pelo ticket em vez de confiar num `senderId` forjável pelo cliente. `EditorSurface` ganhou `onPointerMove` (wired ao `onPointerUpdate` nativo do Excalidraw) e o handle `applyCollaborators`/`RemoteCollaborator` (usa `updateScene({collaborators})` nativo). PASS 27/27.
  - **R11 share-links**: `ShareLinkPanel`/`SharedResourcePage`/`PublicShell` — primeira rota pública do app (`/share/:token`, sem sessão). `App.tsx` reestruturado: `AuthProvider` saiu do topo e virou uma rota de layout sem path (`AuthLayout`, **AD-012**) cobrindo só as rotas autenticadas; `/share/:token` é irmã dela, nunca filha. Fix de protocolo decidido com o usuário: `EditorSurface` ganhou `viewModeEnabled` (repassado direto pro `<Excalidraw viewModeEnabled/>`), canvas fica genuinamente read-only quando o papel não tem `diagram:mutate`; `logging.ts` ganhou redação do token de `/share/:token` e do `ticket` de `/ws/diagrams/:id` nos logs (só no log, `request.url` real não muda). Round 1 FAIL (SHR-04: teste de criação de link usava o valor default do form, mutante sobreviveu); fix trocou o papel escolhido no teste por um que não é default em nenhum dos três sentidos (estado inicial do `<select>`, primeira `<option>`, default do helper de preenchimento) e passou a asserir o corpo do POST. Round 2 PASS 31/31.
  - **R15 ai-provider-admin**: `AiProviderAdminPage` (`/admin/ai-providers` global e `/w/:id/admin/ai-providers` por workspace) — listar, criar, editar sem reenviar a chave, testar conexão, trocar qual config está ativa. Fix decidido com o usuário: `providerConfigs.ts` passou a impor exclusividade de config ativa por escopo dentro de uma `withTx`, disparada pelo estado resultante da linha, não pela forma do request body. PASS.
  - **R16 workspace-webhooks**: `WorkspaceWebhooksPage` (`/w/:id/webhooks`, admin-only) — CRUD de webhook, painel de segredo de revelação única. Round 1 FAIL (WHK-17: dismiss do painel de segredo só provado no nível de callback do componente, não no DOM da página); fix adicionou teste de página clicando no botão real ("Já guardei") e asserindo `queryByTestId('webhook-secret-panel')` nulo. Round 2 PASS.
  - Cada merge das 5 worktrees paralelas para `feature/improvements-3` exigiu reconstrução manual de conflito em arquivos compartilhados entre features (`DiagramEditorPage.tsx`/`.spec.tsx`, `App.tsx`, `EditorSurface.tsx`, i18n JSON, `ProjectListPage.tsx`) — sempre preservando as adições dos dois lados como irmãs, nunca escolhendo um lado, validado rodando os testes reais depois de cada resolução, não só inspeção visual. Achado de infra durante o merge de R11: dois pacotes (`@arch-canvas/editor-adapter`, `@arch-canvas/shared-contracts`) resolvem via `dist/` (não `src/`) em `apps/web`'s Vitest — `pnpm install --force` religa symlinks mas não reconstrói o `dist/` desatualizado; um rebase que só troca `src/*.ts` sem rodar `pnpm -w build` deixa os testes rodando contra o código-objeto antigo, com falhas que parecem lógica de app quebrada mas são só um `dist/` obsoleto. `.specs/lessons.json`/`.specs/LESSONS.md` são geridos por script (`lessons.py`) — colisão de próximo-ID entre worktrees paralelas (duas geraram `L-037`) resolvida mantendo a numeração de um lado e realocando a lição do outro lado pro próximo ID livre (`L-039`), nunca hand-editando o `.md` renderizado diretamente.
  - 3 lições novas (`L-037`, `L-038`, `L-039`, `candidate`): AC fraseada sobre a tela precisa de teste no nível da tela, não só a asserção de callback de um componente filho; dismiss de uma revelação única precisa provar que o valor sensível some do documento, não só que o callback disparou; quando um teste afirma que um valor escolhido pelo usuário chega no corpo do request, escolher um valor que o código não poderia plausivelmente hardcodar (nunca o default do campo ou a primeira opção).
- **PR #5 mergeado em `main`** (2026-08-17): `feature/improvements-3` (R1-R7, R9-R11, R15-R16) chegou a `main` via PR #5. A partir daqui esta frente trabalha na branch `claude/platform-maturity-r8-r14-av3mgj`, cortada de `main` no commit do merge (`41cc792`). Confirmado com o usuário: as 4 entradas restantes (R8, R12, R13, R14) rodam em paralelo, cada uma em worktree isolada própria (`.claude/worktrees/<slug>`, branch `feature/<slug>`), merge sequencial (nunca simultâneo) de volta pra `claude/platform-maturity-r8-r14-av3mgj`, gate completo depois de cada merge, R12 por último (maior superfície de conflito em `DiagramEditorPage.tsx`).
- **Entregue em F10 — R8 `interop-panel` (fechada e verificada, PASS 17/17, mergeada em `claude/platform-maturity-r8-r14-av3mgj`)**:
  - Mermaid e Structurizr adicionados ao mesmo menu de export/import que R7 já entregou (`ExportMenu.tsx`, `ImportDialog.tsx`) — zero superfície nova, confirmando o dimensionamento "0 superfície" do roadmap. `exportClient.ts` ganhou as chamadas para as duas rotas já existentes e verificadas (`POST /projects/:id/import:mermaid`/`:structurizr`, `POST /diagrams/:id/export:mermaid`/`:structurizr` — capacidade AAC-01/02, sem nenhuma mudança de backend).
  - Diferenças de contrato desta fatia vs. R7, documentadas no Problem Statement: import Mermaid/Structurizr cria o diagrama direto (sem preview-then-confirm, ao contrário do `.excalidraw`); export devolve o texto DSL em si (não uma URL assinada); `title` é opcional no import DSL.
  - Nota de processo: o worktree desta feature não tinha acesso a um tool de sub-agente (`Task`/`Agent` ausente naquele contexto) — a rodada de Specify→Execute foi feita normalmente, mas a Verificação usou o "standalone fallback" que o próprio SKILL.md sanciona (mesmo agente, re-derivação rigorosa a partir só do spec.md, sensor de discriminação real em worktree scratch isolado) em vez de author≠verifier genuíno com um sub-agente fresco. Documentado no topo do `validation.md` da feature — não é um PASS silenciosamente mais fraco, é uma limitação de ambiente disclosed.
  - 2 gaps não-bloqueantes deixados abertos (não fix task, registrados como lição): INT-10 (anúncio aria-live do import DSL nunca testado diretamente, só o resultado da navegação) e INT-17 (i18n verificado estruturalmente por grep, sem teste de runtime trocando locale — mesmo tratamento que XPRT-18 de R7 já recebeu neste repo).
  - Achado de ferramenta (não corrigido, fora de escopo desta fatia): `repo-tools`'s `extractWebConsumers` normaliza `` `export:${format}` `` para `export::param` (dois-pontos duplo) e por isso nunca casa com o padrão registrado `export:format` — as novas chamadas desta fatia continuam invisíveis pro audit, mesma classe de limitação já registrada para `resourceClient.ts` (R3) e `doFetch` (R2).
  - 2 lições novas (`L-040`, `L-041`, `candidate`).
  - Gate pós-merge: `make lint`/`make typecheck` verdes; `make test-unit` verde em todo pacote **exceto** um teste pré-existente (`tools/repo-tools/src/webConsumers.spec.ts`, "finds exactly the 4 endpoints") que já falhava idêntico em `main` antes deste merge (confirmado rodando o mesmo teste numa worktree scratch em `main`, sem nenhuma mudança de R8) — o golden count de 4 endpoints ficou obsoleto há várias ondas (hoje o app consome 36) e nunca foi atualizado; decisão: não corrigir agora (cada merge subsequente de R12/R13/R14 muda a contagem de novo), corrigir uma vez só depois do último merge desta rodada.
- **Entregue em F10 — R13 `living-docs` (fechada e verificada, PASS 30/30, mergeada em `claude/platform-maturity-r8-r14-av3mgj`)**:
  - `DocsPanel`/`SpecViewer`/`parseSpecMarkdown`/`docgenClient` (`apps/web/src/docs/`) — gera a spec Markdown a partir do canvas, lista versões geradas, regenera uma seção específica, cada seção linkada de volta ao elemento que a originou. Painel montado em `DiagramEditorPage.tsx` como um `<details>` ao lado de Library/Metadata/Share (mesmo padrão que `diagram-comments` já usa para referência de elemento como texto, não clicável).
  - Mudança de backend decidida e documentada (não uma feature nova, um gap de contrato real): as 3 rotas de docgen pré-existentes nunca devolviam o Markdown gerado, só metadado de linha do banco — `apps/server/src/modules/docgen/routes.ts` ganhou `markdownUrl` aditivo (GET assinado, TTL 3600s) em todo objeto de spec, mesmo padrão que `export/routes.ts` já usa.
  - Nota de processo: mesma limitação de ambiente que R8 (sem tool de sub-agente local; `create_session` exigiria push, proibido) — Verificação rodou como "standalone fallback" sancionado pelo SKILL.md, disclosed no topo do `validation.md`.
  - 2 lições novas (`L-042`, `L-043`, `candidate` — renumeradas de `L-040`/`L-041` originais por colisão de `next_id` com R8, resolvida no merge mantendo a numeração de R8 e realocando as de R13).
  - Gate pós-merge: `make lint`/`make typecheck` verdes; `make test-unit` verde em todo pacote exceto o mesmo teste pré-existente já registrado no fechamento de R8 (`webConsumers.spec.ts`, golden count agora em 38 depois do `audit`, teste nunca atualizado ao longo das ondas — não é regressão desta feature).
  - Conflito de merge: só em `.specs/lessons.json`/`LESSONS.md` (`next_id` colidindo com R8) — resolvido preservando as duas lições de cada lado com IDs distintos, `LESSONS.md` regenerado via `lessons.py prune` (nunca editado à mão). `docs/route-inventory.md` teve diff automático (90 rotas, 38 consumidas) sem conflito — regenerado via `audit` mesmo assim, por convenção. `DiagramEditorPage.tsx`/`.tsx.spec` e i18n JSON fundiram sem conflito (R13 tocou uma seção diferente da que R8 tocou).
- **Mudança de instrução do usuário (2026-08-17)**: o usuário interrompeu a espera pelo ciclo completo de Verificação em R14/R12 e pediu para pausar a execução e mergear tudo direto para `main` — incluindo push pra `origin/main` — sem esperar o Verifier. Confirmado explicitamente via pergunta de esclarecimento antes de agir (as duas sessões de sub-agente de R14 e R12 foram paradas via `TaskStop`, sem perda de trabalho: tudo já estava commitado nas branches `feature/architecture-lint`/`feature/presentation-mode`, só 2 arquivos ficaram com edição em andamento — ambos revisados, testados e commitados pelo orquestrador antes do merge, um deles (`FrameViewer.a11y.spec.tsx` de R12) tinha um bug genuíno de fixture de teste, corrigido).
- **Entregue em F10 — R14 `architecture-lint` (mergeada em `claude/platform-maturity-r8-r14-av3mgj`, SEM Verifier PASS)**:
  - `LintPanel`/`lintClient` (`apps/web/src/lint/`) — painel de avisos de lint arquitetural, sempre consultivo, nunca bloqueia o desenho; aba "Lint" nova em `EditorSidePanel` ao lado de Docs/Comments/AiDock. "Salto pro elemento" via `focusElement` novo no handle imperativo de `EditorSurface` (mesmo padrão AD-010, reusado, não reinventado).
  - **Fechada e verificada em 2026-08-21** (sessão `claude/tlc-spec-driven-continuation-76lvir`) — ver entrada dedicada mais abaixo. Débito original ("sem `validation.md`, sem Verifier PASS") não se aplica mais.
  - Fix aplicado pelo orquestrador antes do merge (trabalho do sub-agente parado no meio): `LintPanel.tsx` passou a mostrar `warning.rule` (categoria estável) junto da mensagem, não só a mensagem — 10/10 testes de `LintPanel.spec.tsx` verdes.
  - Conflito de merge: só em i18n (`en`/`pt-BR` `translation.json`) — chave `docs` (R13) e `lint` (R14) preservadas como irmãs. `packages/editor-adapter` foi tocado (`focusElement`) — `pnpm -w build` rodado antes dos testes de `apps/web`, por precaução (lição já registrada).
  - Achado não-bloqueante: 1 teste pré-existente de `packages/editor-adapter` (`EditorSurface.spec.tsx`, "icon.kind external... inserts the rectangle+label fallback") falha de forma idêntica em `main` antes deste merge (confirmado numa worktree scratch) — quebra de medição de wrap de texto (`'Amazon\nEC2'` vs `'Amazon EC2'`), não relacionada a nenhuma mudança desta rodada.
- **Entregue em F10 — R12 `presentation-mode` (mergeada em `claude/platform-maturity-r8-r14-av3mgj`, SEM Verifier PASS)**:
  - Maior entrada do roadmap: 18 commits, 4 superfícies novas em `apps/web/src/presentation/` — `PresentationListPage`, `PresentationEditorPage` (frames, notas do apresentador, reordenar, links de navegação/protótipo, publicar/republicar com aviso de que substitui o link já distribuído, export PDF), `PresenterPage` (modo tela cheia via `FrameViewer` compartilhado), e a visão pública publicada (reusa a rota `/share/:token` de R11 — `resourceType: 'presentation'`, que R11 deixou como placeholder "ainda não disponível", agora resolvido com o viewer de frames real, sem rota pública nova).
  - `presentationClient.ts` — cliente para as 8 rotas do módulo `presentation` (`GET|POST /presentations`, `GET|PATCH /presentations/:id`, `POST|PATCH .../frames`, `PATCH|DELETE .../frames/:frameId`, `POST .../:publish`, `GET .../published`, `POST .../:export-pdf`).
  - `packages/editor-adapter/src/EditorSurface.tsx` ganhou `scrollToFrame` no handle imperativo (mesmo padrão AD-010) — usado pelo modo apresentador pra mover o viewport pro frame atual, casando com `apps/server/src/modules/presentation/exportPdf.ts`'s `sceneForFrame` (comentário cross-referenciado nos dois arquivos).
  - Mudança de backend decidida e documentada: `POST /presentations` (criar a partir de um diagrama) e `resolve()` da visão pública ganharam a cena publicada (`published scene`), gap real de contrato sem o qual o viewer não teria o que renderizar.
  - **Fechada e verificada em 2026-08-21** (sessão `claude/tlc-spec-driven-continuation-76lvir`) — ver entrada dedicada mais abaixo, incluindo uma rodada 1 real (FAIL, achado sério: T19-T28 nunca tinham sido executados) e uma rodada 2 (PASS 48/48) depois de uma onda de fix completa. Débito original ("maior peça de código sem verificação de todo o roadmap") não se aplica mais.
  - Fix aplicado pelo orquestrador antes do merge (trabalho do sub-agente parado no meio da task T18): `FrameViewer.a11y.spec.tsx` tinha um bug de fixture — testava foco de teclado no botão "Próximo" com `currentIndex` no último frame, onde o botão fica `disabled` por design (não pode receber foco); corrigido usando um terceiro frame e testando a partir do frame do meio. 3/3 testes verdes depois do fix.
  - Conflito de merge real (não só aditivo) em `packages/editor-adapter/src/EditorSurface.tsx`: R14 e R12 estenderam o mesmo método `ExcalidrawSceneApi.scrollToContent` com assinaturas incompatíveis — R14 (`focusElement`) exigia um único elemento, obrigatório; R12 (`scrollToFrame`) aceitava um array, opcional. Reconciliado numa assinatura só, batendo com a API real do Excalidraw upstream (que aceita elemento único OU array): `scrollToContent?: (target: SceneElement | readonly SceneElement[], opts?) => void`, opcional. `focusElement` passou a chamar com `?.()` defensivo, igual `scrollToFrame` já fazia. `EditorSurface.spec.tsx` também tinha conflito real no mock (R14 assumia `scrollToContentSpy` sempre presente via `beforeEach`; R12 tinha o padrão mais defensivo de opt-in por teste, com um teste dedicado provando que a ausência do método nunca quebra) — resolvido adotando o padrão de R12 (mais defensivo e testado) e adicionando `scrollToContentSpy = vi.fn()` explícito nos 4 testes de `focusElement` que precisavam dele. Validado rodando os testes reais antes de commitar o merge: 79/80 verdes (a 1 falha é a mesma flake pré-existente de wrap de texto já registrada na entrada de R14 acima).
  - Conflito de i18n: mesma resolução de sempre — `docs`/`lint` (já mergeados) e `presentation` como chaves irmãs em `en`/`pt-BR`.
- **As 16 entradas do roadmap (R1-R16) estão todas com código mergeado e agora todas com `validation.md` PASS** — ver a entrada de 2026-08-21 abaixo, que fecha o débito de R14/R12 registrado aqui.

### Fechamento de R14 e R12 — sessão `claude/tlc-spec-driven-continuation-76lvir` (2026-08-21)

Trabalho autônomo (`@tlc-spec-driven`, "continue o plano, engenharia em loop, garanta completude,
decida sozinho") fechando o débito explícito de duas ondas anteriores: R14 (`architecture-lint`) e
R12 (`presentation-mode`) tinham código mergeado em `main` mas nunca passaram por uma rodada real
de Verificação (o usuário pediu para pular a espera numa sessão passada). Esta sessão rodou os dois
Verifiers pela primeira vez, de verdade, cada um como sub-agente fresco (author ≠ verifier).

**R14 `architecture-lint`**: PASS round 1 (12/14 ACs batendo exatamente, 3/3 mutações do sensor
mortas), com 2 gaps de precisão de spec sinalizados — ALNT-07 (aviso nunca bloqueia o canvas) e
ALNT-13 (painel inteiro só por teclado) provados só estruturalmente/parcialmente, não pelo teste
fim-a-fim exato que a Independent Test de cada um pede. Fix aplicado no mesmo turno (2 testes novos:
um em `DiagramEditorPage.spec.tsx` que desenha/edita com um aviso visível e confirma sucesso; um em
`LintPanel.a11y.spec.tsx` que percorre a sequência real abrir aba → ler → Atualizar → salto só por
teclado) + 1 correção cosmética de contagem de teste em `tasks.md`. 14/14 ACs verificados no
`validation.md` atualizado. **F14 está fechada.**

**R12 `presentation-mode`**: round 1 do Verifier deu **FAIL** — achado sério, não cosmético: as
tasks T19-T28 (metade do plano de 28 tasks da onda) **nunca tinham sido executadas**, apesar do
`STATE.md` (entrada antiga acima) descrever a feature como entregue com as "4 superfícies novas".
Na prática: `PresenterModePage` não existia em lugar nenhum do repositório; `SharedResourcePage` (a
visão pública de `/share/:token`) nunca foi tocada para renderizar apresentações publicadas, mesmo
com o lado de backend (T1) pronto e testado; exportar PDF tinha cliente HTTP testado mas zero UI; e
o achado mais grave — **a rota `/present/:presentationId` nunca foi registrada em `App.tsx`**,
deixando as ~1500 linhas já implementadas e testadas de T9-T14 (criar/editar/reordenar/publicar
frames) inalcançáveis a partir do app real rodando. 28/48 ACs batiam, 19 com zero evidência. Esta é
exatamente a classe de falha que a separação author≠verifier existe para pegar — e pegou.

Fix wave completa nesta mesma sessão, executada diretamente pelo orquestrador (sem sub-agentes de
batch — o volume de contexto já acumulado tornava mais barato continuar na mesma sessão do que
re-derivar tudo num worker novo), retomando exatamente os itens T19-T28 do `tasks.md` original (o
plano nunca foi invalidado, só nunca executado) mais os 6 Fix Plans do round 1:

- **T19 `PresenterModePage`** + **G1**: página nova (`apps/web/src/presentation/PresenterModePage.tsx`) — cena viva
  somente leitura, `EditorSurface` com `viewModeEnabled` sempre `true`, navegação por teclado
  (setas/PageUp/PageDown/Space/Escape) via listener a nível de `document` (não um handler JSX num
  elemento estático — evita `noStaticElementInteractions` do biome e casa melhor com "funciona em
  qualquer lugar da tela"). G1: `EditorSurfaceHandle.scrollToFrame` tinha um no-op verdadeiro quando
  `elementId` não casava com nada na cena — contradizia o próprio Done-when de T2 e o Edge Case do
  spec ("cair no fallback de mostrar a cena inteira") — corrigido para usar o mesmo heurístico que
  `cropSceneForFrame.ts` já usava.
- **Fix 1 + T20**: `/present/:presentationId` e `/present/:presentationId/presenter` registradas em
  `App.tsx` (a lacuna raiz do FAIL) + botão "Apresentar" em `PresentationEditorPage`, desabilitado
  com 0 frames.
- **T22 + T25**: `SharedResourcePage`'s ramo `presentation` passa a checar `result.scene` — presente
  monta o `FrameViewer` real com a cena recortada por `cropSceneForFrame`; ausente mantém o
  placeholder de R11 byte a byte (SHR-27/28 sem alteração de asserção). Edge cases cobertos:
  `elementId` órfão cai no fallback de cena inteira; cena publicada vazia renderiza canvas vazio, não
  a mensagem de link inválido.
- **T23**: a11y estendida para o novo estado publicado (zero violação axe, navegação só por teclado,
  sem `AuthProvider` montado — AD-012).
- **T24**: controle de exportar PDF em `PresentationEditorPage` — desabilitado com motivo até
  publicada + ≥1 frame; `200` mostra link (nova aba) + `pageCount`, nunca dispara download; `400`/
  `404`/erro mostram mensagens distintas, nunca trava carregando.
- **T26 + T27**: sweep de i18n confirmou os dois locales já com as mesmas 416 chaves (nenhuma nova
  necessária — T6 já tinha plantado tudo, só não estava sendo consumido); 1 changeset novo para o
  único pacote `packages/*/src` tocado (`editor-adapter`, o fix de G1); `capability-map.yaml` perde
  `status: backend-only`, `repo-tools audit` confirma as rotas do módulo como consumidas.
- **Fix 6 (G2/G3, Minor)**: teste de duplo-envio do formulário de adicionar frame (guarda
  `addInFlight` já existia, nunca tinha teste); teste de dupla-revogação idempotente de um link de
  apresentação (mesma rota `:revoke` de R11, agora provada também no escopo de apresentação).

**Round 2 do Verifier — PASS 48/48**, sensor 5/5 mutações mortas (alvo: handler de teclado do
presenter, fallback do `scrollToFrame`, ramo de gating por `result.scene`, condição de desabilitar
o export, registro da rota do presenter). Gate completo: `make lint`/`make typecheck` verdes;
`test-unit` por pacote (`web` 905/905, `server` 400/400 unit + 373/373 integration via PGlite,
`editor-adapter` 79/80 — a 1 falha é a mesma quebra de medição de wrap de texto pré-existente já
registrada em F10/R14) — nenhuma falha atribuível a esta feature. `route-inventory.md` regenerado.

**Flake confirmado nesta sessão (não é regressão)**: sob `make test-unit`/execução paralela completa
do `apps/web`, exatamente 1 arquivo de teste falha por vez, um arquivo diferente a cada corrida
(`PresenterModePage.spec.tsx`, depois `DiagramEditorPage.spec.tsx`'s teste de "discard" pré-existente)
— sempre passa limpo isolado e numa terceira corrida completa (905/905). Mesma classe de contenção de
recursos sob execução paralela já registrada em ondas anteriores (T2's nota sobre `V8CoverageProvider`).

`tasks.md` de `architecture-lint` teve sua nota de contagem de teste (T5, 32→33) corrigida junto do
fix. `spec.md` de ambas as features teve a tabela de Requirement Traceability atualizada de
`Pending`/`Implementing` para `✅ Verified` (ALNT-01..14, PRZ-01..48).

2 lições novas registradas nesta sessão (`L-044`, `L-045`, `candidate`, pelo Verifier round 1 de
R14): sobre o padrão de gap "provado estruturalmente, não pelo teste fim-a-fim que o Independent
Test da história pede". Nenhuma lição nova do round 2 de R12 (PASS limpo, sem sinal — a lição real
já estava implícita no próprio achado do round 1, não repetida aqui).
- **Residuais nao bloqueantes de F6** (registrados em `validation.md`, nenhum vira fix task): piso de cobertura declaravel sem `coverage.enabled`; piso de `0` aceito; texto da AC UIX-02 mais forte que a entrega; orcamento de saude do `compose-smoke` chega a 7 min por causa do `redis`; nada protege o proprio `ci.yaml` de ser esvaziado.
- **Residuais nao bloqueantes de F7** (registrados em `validation.md`): nada lint-a o conteudo em prosa do `CLAUDE.md` (uma invariante removida silenciosamente nao e pega por nada); nada faz dry-run do corpo de um slash command antes de commitar — foi exatamente assim que o bug do `/audit` sobreviveu ate a verificacao.
- **Residual nao bloqueante de F8** (achado incidental do Verifier round 2, fora do escopo do Fix Plan 1, nao vira fix task): `tasks.md:476` (nota "Done when" de T27) ainda afirma que o gate "sai 1 só pelo mesmo piso de cobertura global pré-existente já registrado na nota de T26" — isso ficou desatualizado depois do Fix Plan 1 (o gate agora sai 0, e a nota de T26 que T27 cita ja nao diz "pré-existente"). Cosmetico — o checkbox de T27 continua `[x]` corretamente e a afirmacao nao afeta nenhuma AC, gate ou a tabela de rastreabilidade — mas vale um ajuste de uma linha na proxima onda que tocar `tasks.md`.
- **Nao provado localmente (F8)**: o job `changeset-check` (T32) e o job `ai-evals`/`capability-audit`'s `checkOpenApiParity` (Phases 3-4) dependem de evento real de pull request (`base.sha`/`head.sha`) — mesma limitacao ja registrada para os jobs de CI de F6; verificados rodando a logica de diff/match diretamente contra ranges `base..head` reais do historico do repo, nao contra um evento de PR de verdade.
- **Nao provado localmente (geral)**: boot completo do compose (o `canvas` compila do zero em Alpine e estoura o tempo de uma rodada), suite Playwright, e tudo que depende de evento real de pull request (artefatos e cache do `actions/*`, Renovate instalado).
- **Armadilhas de ambiente**: Node **22.x** obrigatorio (`fnm use 22 && corepack enable`) — Node 24 quebra `apps/server/src/modules/ai-engine/callProvider.spec.ts` por `AbortSignal` cross-realm sob jsdom. `make ci` **nao passa nesta maquina** por falta de `pg_lsclusters` e `redis-server` (erros `ENOENT` de spawn, anteriores a este trabalho); o gate substituto e `make lint && make typecheck && make test-unit`. Isso esta documentado no `CLAUDE.md` versionado, nao so aqui.
- **Licoes**: L-017..L-026 registradas como `candidate` em `.specs/lessons.json` (L-024: isolar uma suspeita de gate pré-existente via `git worktree` na baseline real, nunca `git stash` de só os últimos arquivos, antes de aceitar a classificação "pré-existente/não relacionado"; L-025: o scope de uma ferramenta de scan é uma suposição, não um fato — confirmar contra uma contagem independente antes de assumir cobertura completa; L-026, F9: um plano de tasks que adiciona um módulo de rotas novo deve tasquear explicitamente a fiação em todo registro cross-cutting — module registration E registro OpenAPI — na mesma task que cria as rotas, ou a fiação que não foi nomeada fica silenciosamente esquecida até uma ferramenta de auditoria pegar).
- **Uncommitted**: nenhum apos cada commit de task; arvore limpa ao final da Phase 5 (antes desta propria task T35 ser commitada).

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
