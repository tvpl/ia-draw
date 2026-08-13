# Architecture Canvas

Plataforma self-hosted de diagramação de arquitetura sobre o [Excalidraw](https://github.com/excalidraw/excalidraw), com **IA geradora de diagramas de alta qualidade** e persistência **server-first** — nenhum diagrama depende do navegador como fonte da verdade.

> **Status:** roadmap completo (F0–F5, 92/92 requisitos), implementado e independentemente verificado onda a onda. Ver [`.specs/STATE.md`](.specs/STATE.md) (marco final) e [`.specs/features/architecture-canvas/validation.md`](.specs/features/architecture-canvas/validation.md).

## O que é

- Diagramas técnicos e de negócio (AWS/cloud, C4, microsserviços, fluxos, swimlanes) desenhados no editor Excalidraw, mas **persistidos e reconciliados no servidor** a cada alteração — crash de navegador, reload ou troca de máquina nunca apagam trabalho confirmado.
- Um agente de IA gera diagramas a partir de linguagem natural (via uma representação intermediária declarativa, `diagram-ir/v1`) e edita diagramas existentes com **preview, aprovação explícita e undo real**.
- Colaboração em tempo real (WebSocket + presença), documentação viva gerada a partir do canvas, lint arquitetural, import/export Mermaid/Structurizr, apresentações navegáveis, comentários, compartilhamento externo e webhooks.
- Hardening de produção: OIDC, rate limiting, auditoria completa, backup incremental com teste de restore automatizado, métricas Prometheus, tracing OpenTelemetry, acessibilidade.

## Quick start

```bash
cd infra/compose
cp .env.example .env
docker compose up --build
```

Abre em `http://localhost:8080` com health checks verdes, sem depender de internet (exceto o endpoint de IA que você configurar). Ver [`infra/compose/README.md`](infra/compose/README.md) para profiles opcionais (`observability`, `oidc-dev`, `realtime-scale`) e comandos de backup.

## Stack

Node 22 · TypeScript · Fastify 5 (REST + WebSocket) · PostgreSQL 16 (Drizzle ORM) · MinIO (S3-compatible) · pg-boss (jobs, sem Redis obrigatório) · React 19 + Vite · pnpm workspaces + Turborepo · Biome · Vitest.

## Estrutura do monorepo

```
apps/
  server/    REST + WebSocket + jobs — um único processo Node (monólito modular)
  web/       shell React (editor, i18n, fila de mutação local)
packages/
  editor-adapter/    única fronteira com o pacote @excalidraw/excalidraw
  diagram-domain/    op-log, reconciliação LWW, diff estrutural (server-side, sem Excalidraw)
  diagram-ir/        schema diagram-ir/v1, layout determinístico, compilador, Mermaid/Structurizr
  ai-tools/          ferramentas de leitura/escrita do agente de IA (produzem patches, nunca tocam DB/rede)
  auth/              RBAC puro (can(actor, action, resource))
  database/          schema Drizzle + migrations
  shared-contracts/  tipos REST/WS, problem+json, envelope de mensagem WS
  library-content/   biblioteca de componentes (ícones AWS, C4, wireframe kit)
  test-fixtures/     cenas/IRs sintéticas para testes (1k/5k/10k elementos)
infra/
  compose/     docker compose local (proxy, server, web, postgres, minio, profiles opcionais)
  backup/      CLI de backup:create/verify/restore + incremental
  observability/  regras de alerta Prometheus, config de Grafana/OTel Collector
docs/
  product-spec.md   spec de produto/engenharia original (documento-fonte)
  adr/              Architecture Decision Records
.specs/
  STATE.md                              decisões de arquitetura + handoff/marco final
  features/architecture-canvas/
    spec.md         92 requisitos em notação EARS, com rastreabilidade
    design.md        design técnico completo
    tasks-*.md        tasks de cada onda (F0..F5), com evidência de conclusão
    validation.md      relatórios de verificação independente por onda
```

Um mapa visual de todos os módulos e como cada um funciona está em [`docs/architecture-overview.html`](docs/architecture-overview.html) (abra no navegador).

## Decisões de arquitetura

Ver [`docs/adr/`](docs/adr/) para o texto completo de cada uma; resumo:

| ADR | Decisão |
| --- | --- |
| [0001](docs/adr/0001-server-first-op-log-lww.md) | Op-log LWW nativo do Excalidraw, não Yjs/CRDT |
| [0002](docs/adr/0002-ai-first-roadmap.md) | Roadmap AI-first — IA geradora antes de colaboração realtime |
| [0003](docs/adr/0003-modular-monolith.md) | Monólito modular (um processo Node) com fronteiras nos packages |
| [0004](docs/adr/0004-diagram-ir-v1.md) | IR declarativa `diagram-ir/v1` como peça central da geração por IA |
| [0005](docs/adr/0005-server-side-rendering.md) | Renderização server-side via SVG + rasterização, sem Chromium obrigatório |
| [0006](docs/adr/0006-mvp-without-redis.md) | MVP sem Redis — jobs via pg-boss sobre PostgreSQL |
| [0007](docs/adr/0007-pglite-for-postgres-integration-tests.md) | PGlite para testes de integração de Postgres sem Docker |
| [0008](docs/adr/0008-no-excalidraw-import-server-side.md) | Nenhum pacote server-side importa `@excalidraw/excalidraw` por valor |
| [0009](docs/adr/0009-pluggable-presence-broadcaster.md) | Presença em tempo real via `PresenceBroadcaster` injetável (memória/Redis) |

## Desenvolvimento

```bash
pnpm install
pnpm -w lint            # biome check
pnpm -w typecheck       # tsc --noEmit em todos os packages
pnpm -w build           # turbo build
pnpm -w test:unit       # testes unitários
pnpm -w test:integration  # testes de integração (Postgres real via PGlite)
```

Requisitos rastreáveis, design e progresso de cada onda de desenvolvimento vivem em [`.specs/features/architecture-canvas/`](.specs/features/architecture-canvas/) — cada requisito tem um ID (`FND-*`, `AUTH-*`, `EDT-*`, ... `SEC-*`, `OIDC-*`, `DR-*`, `OBS-*`, `PERF-*`, `A11Y-*`) rastreável até o código e o teste que o verifica.
