# CLAUDE.md

Onboarding para agentes (Claude Code, Cursor, etc.) e pessoas novas neste repositório. Se você só
puder ler um arquivo antes de trabalhar aqui, é este — ele cobre os comandos que rodam tudo, os
invariantes de arquitetura que não são óbvios lendo o código isoladamente, e as armadilhas de
ambiente já batidas por sessões anteriores.

## O projeto

Architecture Canvas: canvas colaborativo de diagramas de arquitetura com geração e edição por IA.
Stack: Node 22 · TypeScript · Fastify 5 (REST + WebSocket) · PostgreSQL 16 (Drizzle ORM) · MinIO ·
pg-boss · React 19 + Vite · pnpm workspaces + Turborepo · Biome · Vitest. Ver `README.md` para
visão de produto e `docs/architecture-overview.html` para o mapa visual dos módulos.

## Pré-requisito de ambiente (leia antes de rodar qualquer comando fora do Docker)

Este repo trava em **Node 22.x** (`.nvmrc`, `package.json#engines: ">=22 <23"`). Em Node 24+ o
`fetch` nativo fica mais rígido e quebra o `AbortSignal` cross-realm sob jsdom que o Vitest usa —
sintoma: `apps/server/src/modules/ai-engine/callProvider.spec.ts` falha com `network_error` em vez
do erro esperado. `make up` (Docker) não é afetado — os containers já fixam Node 22.

```bash
fnm install 22 && fnm use 22   # ou nvm/asdf equivalente — o essencial é Node 22.x, não 24
corepack enable                  # obrigatório: pnpm só é declarado via packageManager (Corepack),
                                  # não como dependência global. Sem isso: "Unable to find package
                                  # manager binary". Refaça sempre que trocar de versão de Node.
```

## Comandos

Todos rodam da raiz do repo.

```bash
make install            # pnpm install --frozen-lockfile
make lint                # biome check . (lint + format-check)
make typecheck           # tsc --noEmit em todo package
make test-unit            # testes unitários de todo package
make test-integration      # Postgres real via PGlite (WASM) — sem Docker, ver ADR-0007
make test-integration-backup # infra/backup — exige cluster Postgres real (exceção da ADR-0007)
make test-e2e              # Playwright em apps/web
make ci                   # lint + typecheck + test-unit + test-integration — o que o CI roda
make up                   # sobe o stack completo via Docker (proxy, server, web, postgres, minio)
make web-dev               # apps/web sozinho, Vite + HMR, apontando pra um stack de `make up`
make help                 # lista todos os atalhos, workspace e Docker
```

Direto via pnpm, se preferir: `pnpm install`, `pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w build`,
`pnpm -w test:unit`, `pnpm -w test:integration`.

**`make ci` é o gate único e passa num checkout limpo** (fechado na onda F11/R20). Uma única
suíte fica de fora dele porque exige um cluster PostgreSQL real, que PGlite não fornece:

```bash
make test-integration-backup   # infra/backup — precisa de pg_dump/pg_createcluster; roda em job próprio no CI
```

Ver a Emenda de 2026-08-24 em `docs/adr/0007-*.md` para por que essa é a única exceção. Os scripts
raiz passam `--concurrency=2` ao turbo de propósito: sem isso, dez suítes vitest disputando 4 CPUs
estouram o timeout de 1s do `findByText` e derrubam um arquivo de teste diferente a cada corrida.

## Invariantes de arquitetura (não óbvios lendo o código isolado)

Resumo executivo; a decisão completa (contexto, trade-off, escopo) está em `docs/adr/00NN-*.md` e
`.specs/STATE.md` (seção Decisions, AD-001..AD-016). Nova ADR: copie `docs/adr/TEMPLATE.md`
(formato Status/Data/Contexto/Decisão/Consequências já usado por `0001..0016`).

- **AD-003 — Monólito modular.** `apps/server` é um único processo Node (REST + WebSocket + jobs).
  Não crie `apps/api`, `apps/worker` ou `apps/realtime` separados — as fronteiras de domínio já
  existem nos `packages/*`, o split fica trivial quando/se for preciso, mas não é o modelo atual.
- **AD-008 — Nenhum import por valor de `@excalidraw/excalidraw` server-side.** Nenhum pacote que
  roda no servidor (`apps/server/**`, `packages/diagram-domain`, `packages/diagram-ir`,
  `packages/ai-tools`, e qualquer pacote futuro na mesma situação) pode importar
  `@excalidraw/excalidraw` ou `@arch-canvas/editor-adapter` **por valor** — só `import type`. O
  bundle publicado do Excalidraw importa `roughjs/bin/rough` sem extensão `.js`; o resolvedor ESM
  estrito do Node rejeita isso no boot real (`node dist/index.js`), mesmo com toda a suíte de
  testes verde sob Vitest/Vite (que resolve de forma lenient). Elementos de cena manipulados no
  servidor usam implementações locais dependency-free (ver
  `packages/diagram-domain/src/mergeScene.ts`). Confirme com
  `pnpm -w build && grep -rn "excalidraw" <pacote>/dist/*.js` — nenhum import/require real deve
  aparecer.
- **AD-007 — Testes de integração usam PGlite, não testcontainers.** `@electric-sql/pglite`
  (Postgres real compilado para WASM) roda em Node puro, sem daemon Docker. O CI real (GitHub
  Actions) continua usando Postgres/MinIO via `services:` de verdade.
  MinIO não tem equivalente WASM — testes de integração de storage/asset ficam reservados ao CI.
- **AD-001 — Sincronização por op-log LWW, não CRDT.** Deltas de domínio em `diagram_operations`,
  reconciliação via `version`/`versionNonce` nativos do Excalidraw. Sem merge granular de texto
  dentro do mesmo elemento — conflitos resolvem por last-writer-wins, variantes preservadas no
  histórico.
- **AD-004 — IR declarativa `diagram-ir/v1`.** A IA gera IR one-shot (não tool calls incrementais)
  para criação de diagramas; layout é sempre determinístico no servidor, nunca decidido pelo LLM.
  A mesma IR alimenta import/export Mermaid/Structurizr.
- **AD-006 / AD-009 — Sem Redis obrigatório.** Jobs via pg-boss sobre PostgreSQL. Presença em tempo
  real (F4) usa `PresenceBroadcaster` injetável: `InMemoryPresenceBroadcaster` por padrão,
  `RedisPresenceBroadcaster` só quando `REDIS_URL` está configurado. O servidor sobe e funciona
  inteiramente sem Redis — degrade explícito: presença só cruza conexões no mesmo processo Node.
- **AD-013 — Prefixos de borda vêm de uma fonte única** (`docs/adr/0013-edge-route-prefix-contract.md`).
  Os caminhos que pertencem a `apps/server` são declarados só em
  `packages/shared-contracts/src/routePrefixes.ts`. O proxy do Vite importa a lista; o `Caddyfile`
  a repete por não ter como importar, e `repo-tools audit` reprova quando as três divergem. Rota
  nova com prefixo novo: acrescente o prefixo lá **antes** de registrar a rota — senão ela responde
  a SPA (foi assim que `POST /auth/login` devolvia 405 no stack do Docker). Nenhum namespace `/api`.
- **AD-014 — Estilo vem de tokens e utilitários** (`docs/adr/0014-tailwind-tokens-for-web.md`).
  `apps/web` usa Tailwind v4 CSS-first: os tokens ficam num único bloco `@theme` em
  `apps/web/src/styles/theme.css` e os componentes consomem utilitários, agrupados em
  `apps/web/src/styles/classNames.ts`. Em componente de produção não entra `style={{}}` nem literal
  de cor — `tokenSweep.spec.ts` reprova, com isenção nomeada só para
  `presence/collaboratorColor.ts`. A folha da app carrega depois da do Excalidraw e nenhuma regra
  dela seleciona dentro do canvas.
- **AD-015 — Primeiro acesso é a única rota pública de criação de conta**
  (`docs/adr/0015-first-run-public-bootstrap.md`). `GET`/`POST /auth/first-run` existe enquanto
  `users` está vazia e responde `404` depois disso; cria conta, organização, workspace e `org_admin`
  numa transação sob `pg_advisory_xact_lock`. Não abra outro caminho público de signup e não aceite
  papel vindo do cliente — quem precisa de convite usa o fluxo de membros já autenticado.
- **AD-016 — Papel de organização vale em todos os workspaces dela**
  (`docs/adr/0016-org-role-crosses-workspaces.md`). O papel efetivo sai de uma função só,
  `resolveEffectiveRole` (`apps/server/src/modules/workspace/effectiveRole.ts`), que combina a
  associação direta com o papel na organização dona e aplica o mais permissivo. Não releia
  `workspace_members` por conta própria numa rota nova — era exatamente essa a segunda via de
  autorização que a onda fechou. Remoção/rebaixamento de admin passa por `withLastAdminGuard`,
  dentro da mesma transação.

## Requisitos e progresso rastreável

Cada onda de desenvolvimento vive em `.specs/features/<feature>/` — `spec.md` (requisitos com IDs
rastreáveis, notação EARS), `tasks.md` (quebra em tasks atômicas), `validation.md` (relatório do
Verifier independente por onda). O trabalho é feito com a skill `tlc-spec-driven`
(`.claude/skills/tlc-spec-driven/`) — ative-a pelo nome ao planejar ou implementar uma feature; ela
é a fonte de verdade do fluxo (Specify → Design → Tasks → Execute, sub-agentes, Verifier, sensor de
discriminação, lições). `.specs/STATE.md` guarda o log de decisões (AD-NNN) e o handoff da sessão
mais recente — leia-o ao retomar trabalho. Convenção em uso desde F6: uma spec por domínio em
`.specs/features/<domínio>/` — nunca uma spec monolítica cobrindo vários domínios; exemplar real:
`.specs/features/ai-dock/spec.md` (prefixo de requisito próprio, `DOCK-NNN`).

## Fluxos versionados (em vez de instrução repetida em prosa)

- `/audit` (`.claude/commands/audit.md`) — roda o auditor de capacidades/rotas
  (`pnpm --filter @arch-canvas/repo-tools run audit`), que toda onda usa antes de fechar para conferir
  o mapa de capacidades e o piso de cobertura.
- `/gate` (`.claude/commands/gate.md`) — roda o gate local completo (lint + typecheck + testes) que
  toda task deste projeto usa como critério de "Done when".
