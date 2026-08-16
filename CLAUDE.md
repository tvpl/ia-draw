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
make test-e2e              # Playwright em apps/web
make ci                   # lint + typecheck + test-unit + test-integration — o que o CI roda
make up                   # sobe o stack completo via Docker (proxy, server, web, postgres, minio)
make web-dev               # apps/web sozinho, Vite + HMR, apontando pra um stack de `make up`
make help                 # lista todos os atalhos, workspace e Docker
```

Direto via pnpm, se preferir: `pnpm install`, `pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w build`,
`pnpm -w test:unit`, `pnpm -w test:integration`.

**Armadilha conhecida deste ambiente sandbox:** `make ci` pode falhar aqui por faltarem
`pg_lsclusters`/`redis-server` no host (erros `ENOENT` de spawn, não relacionados a este trabalho).
Quando isso acontecer, o gate substituto é `make lint && make typecheck && make test-unit` — rode
`make test-integration` separadamente se PGlite estiver disponível (não depende de daemon Docker,
ver ADR-0007).

## Invariantes de arquitetura (não óbvios lendo o código isolado)

Resumo executivo; a decisão completa (contexto, trade-off, escopo) está em `docs/adr/000N-*.md` e
`.specs/STATE.md` (seção Decisions, AD-001..AD-009). Nova ADR: copie `docs/adr/TEMPLATE.md`
(formato Status/Data/Contexto/Decisão/Consequências já usado por `0001..0009`).

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
