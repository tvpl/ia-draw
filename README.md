# Architecture Canvas

Plataforma self-hosted de diagramação de arquitetura sobre o [Excalidraw](https://github.com/excalidraw/excalidraw), com persistência **server-first** — nenhum diagrama depende do navegador como fonte da verdade — e um motor de **IA geradora de diagramas** entregue como API.

> **Status:** os 92 requisitos de F0–F5 estão implementados como **contrato de backend verificado**: cada um foi checado onda a onda por um Verifier independente, com evidência em `file:line`. Ver [`.specs/STATE.md`](.specs/STATE.md) (marco final) e [`.specs/features/architecture-canvas/validation.md`](.specs/features/architecture-canvas/validation.md).
>
> A **superfície de produto é rastreada à parte** e está atrás do backend. Das 26 capacidades do [mapa de capacidades](docs/capability-map.yaml), 4 têm tela hoje e **22 são `backend-only`** — API verificada, sem nenhum componente em `apps/web` que as exponha ao usuário final. Em rotas: das 82 rotas REST registradas, 4 são consumidas pela interface e 78 não têm consumidor ([inventário](docs/route-inventory.md)). O CI roda `repo-tools audit` a cada pull request e falha quando o mapa declara uma superfície que não é um componente existente em `apps/web/src`. O portão cobre o mapa contra o código, não este texto contra o mapa — a correspondência entre a prosa daqui e as entradas do mapa continua sendo revisão humana.

## O que é

**Com tela hoje** (as 4 capacidades com superfície em `apps/web/src`):

- Diagramas técnicos e de negócio (AWS/cloud, C4, microsserviços, fluxos, swimlanes) desenhados no editor Excalidraw, mas **persistidos e reconciliados no servidor** a cada alteração — crash de navegador, reload ou troca de máquina nunca apagam trabalho confirmado.
- Sessão autenticada no editor, recuperação da fila local após crash do navegador, e o shell da aplicação com acessibilidade verificada.

**Contrato de backend verificado, ainda sem tela** (`backend-only` no mapa — a API existe e é testada, o usuário final não tem por onde acessar):

- Um agente de IA que gera diagramas a partir de linguagem natural (via uma representação intermediária declarativa, `diagram-ir/v1`) e edita diagramas existentes com **preview, aprovação explícita e undo real**. É o diferencial declarado do produto e a primeira fatia do roadmap de UI.
- Colaboração em tempo real (WebSocket + presença), documentação viva gerada a partir do canvas, lint arquitetural, import/export Mermaid/Structurizr, apresentações navegáveis, comentários, biblioteca de componentes, histórico e restore de versão, export de imagem e bundle, compartilhamento externo por link e webhooks.
- Hardening de produção: OIDC, rate limiting, auditoria completa, backup incremental com teste de restore automatizado, métricas Prometheus, tracing OpenTelemetry.

O que cada capacidade tem de evidência de backend, e se tem ou não superfície, está em [`docs/capability-map.yaml`](docs/capability-map.yaml) — uma entrada por capacidade, verificada pelo CI.

## Quick start (local)

> Esta seção é só pra rodar/testar na sua máquina — usa segredos de dev inseguros de propósito
> (`dev-insecure-secret-change-me`). Pra subir uma instância real, pule pra
> [Deploy em produção (Dokploy)](#deploy-em-produção-dokploy).

```bash
make up
```

Abre em `http://localhost:8080` com health checks verdes, sem depender de internet (exceto o endpoint de IA que você configurar). Equivalente a `cd infra/compose && cp .env.example .env && docker compose up --build`, mas com `make help` listando todos os atalhos (`make logs`, `make down`, `make reset`, `make up-observability`, `make up-oidc`...). Ver [`infra/compose/README.md`](infra/compose/README.md) para o detalhe de cada profile e comandos de backup.

## Deploy em produção (Dokploy)

O mesmo `infra/compose/compose.yaml` do Quick start local roda sem alteração nenhuma no
[Dokploy](https://dokploy.com) — ele já usa `${VAR:-default}` em todo lugar, que é exatamente como o
Dokploy injeta variáveis de ambiente definidas na sua UI. Os passos abaixo assumem uma instância
Dokploy já rodando e este repositório acessível por ela (git remoto).

### 1. Criar a aplicação

Na Dokploy, crie um projeto do tipo **Docker Compose**, aponte pro repositório/branch, e em
**Compose Path** informe:

```
infra/compose/compose.yaml
```

(o compose não fica na raiz do repo — se deixar o path em branco o Dokploy não vai achar o arquivo).

### 2. Configurar as variáveis de ambiente

Na aba **Environment** do app, defina — isso substitui a necessidade do `.env` local, o Dokploy grava
essas variáveis num `.env` ao lado do compose file automaticamente:

| Variável | Por quê |
| --- | --- |
| `SESSION_SECRET` | assinatura do cookie de sessão — `loadConfig()` **recusa subir** em produção se isso continuar `dev-insecure-secret-change-me` (FND-03), então esquecer de trocar falha rápido e visível, não silenciosamente inseguro |
| `ENCRYPTION_KEY` | criptografa (AES-256-GCM) o token do provider de IA salvo no banco — mesma trava do `loadConfig()` acima |
| `POSTGRES_PASSWORD` | senha do Postgres do compose |
| `MINIO_ROOT_PASSWORD` | senha do MinIO (assets/exports/backups) |

`NODE_ENV` **não precisa ser definido** — o compose já usa `NODE_ENV: ${NODE_ENV:-production}`, então
sem essa variável ele já sobe em modo produção (é só o `.env.example` do Quick start local que força
`development`, e esse arquivo não entra no deploy do Dokploy). Todo o resto de `.env.example` tem
default aceitável pra produção (nomes de usuário/banco) — só as 4 senhas acima são obrigatórias.

O endpoint e a chave do **provider de IA** não são variável de ambiente: são configurados depois do
deploy, dentro do próprio app (cifrados no banco pelo módulo `ai-provider`, com bloqueio de SSRF) —
não procure isso na UI do Dokploy.

### 3. Domínio e HTTPS

Duas opções, dependendo do que você precisa:

- **Porta direta (mais simples):** não mexe em nada — o compose já publica o `proxy` (Caddy) em
  `${PUBLIC_PORT:-8080}:80` no host. A instância fica acessível em `http://<ip-do-servidor>:8080`
  (ou aponte um domínio pra esse IP:porta na sua ferramenta de DNS/proxy de preferência). Nenhuma
  configuração adicional no Dokploy é necessária, e não há conflito de porta: 8080 não é 80/443, que
  são as únicas portas que o Traefik do próprio Dokploy reserva pra si.
- **Domínio + HTTPS automático via Dokploy (recomendado pra produção de verdade):** o Dokploy tem uma
  aba **Domains** que gera os labels do Traefik e o certificado automaticamente — mas ela espera que
  o serviço **não** publique porta pro host. Isso exige duas mudanças no `proxy` desse compose (aplique
  no seu fork/branch de deploy, não no `compose.yaml` compartilhado, já que isso quebraria o Quick
  start local):
  ```yaml
  proxy:
    # ports: ["${PUBLIC_PORT:-8080}:80"]   # remova esta linha
    expose:
      - "80"                                # troque por esta
  ```
  Depois, em **Domains**, aponte o domínio pro serviço `proxy`, porta `80`. Se o app não estiver
  marcado como "Isolated Deployment", confirme que o `proxy` está anexado à rede `dokploy-network`
  (é isso que deixa o Traefik do Dokploy alcançar o container) — ver a
  [documentação de domínios do Dokploy](https://docs.dokploy.com/docs/core/docker-compose/domains).

### 4. Migrations, dados e redeploy

- O serviço `migrate` já roda como parte do próprio `docker compose up` (o `server` só sobe depois que
  `migrate` termina com sucesso) — todo deploy novo já aplica migrations pendentes sozinho, sem passo
  manual. É idempotente: rodar de novo sobre um schema já atualizado não faz nada.
- `postgres-data`, `minio-data` e `backups` são volumes nomeados — persistem entre redeploys
  automaticamente; não precisam de configuração extra no Dokploy.
- Redeploy: manual pelo botão da UI, ou configure um webhook do Dokploy no seu Git host (GitHub/
  GitLab/Gitea/Bitbucket) pra redeployar a cada push na branch.
- Os profiles opcionais (`observability`, `oidc-dev`) descritos em
  [`infra/compose/README.md`](infra/compose/README.md) também funcionam no Dokploy, mas cada app
  Dokploy roda um `docker compose up` sem flag de profile por padrão — pra ativá-los aqui você
  precisaria adaptar o comando de deploy ou manter um app Dokploy separado por profile.
- Se for configurar um health check de domínio no Dokploy (ou qualquer monitor externo), aponte pra
  `/health/live` ou `/health/ready` — o `Caddyfile` já roteia esse caminho pro `server`, então a
  resposta é o JSON real do backend (incluindo o status do Postgres em `/health/ready`), não o HTML
  estático do `web`.

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

## Desenvolvimento (local)

### Pré-requisitos (fora do Docker)

`make up` não precisa de nada disso — os containers já vêm com Node 22 fixado. Mas `make install`,
`make ci` e `make web-dev` rodam no seu Node local, e o projeto trava em **Node 22.x**
(`.nvmrc`, `package.json#engines: ">=22 <23"`): em versões mais novas o `fetch` nativo do Node fica
mais rígido e quebra o `AbortSignal` do ambiente jsdom que o Vitest usa em alguns testes (ver o
comentário em `apps/server/src/modules/ai-engine/callProvider.ts`) — os sintomas são testes de
`callProvider.spec.ts` falhando com `network_error` em vez do erro esperado.

Forma mais simples de garantir a versão certa em qualquer máquina, com o
[fnm](https://github.com/Schniz/fnm) (troca de versão automática por projeto, via `.nvmrc`):

```bash
brew install fnm
echo 'eval "$(fnm env --use-on-cd)"' >> ~/.zshrc
source ~/.zshrc
fnm install 22
cd architecture-canvas && fnm use 22   # com --use-on-cd já configurado, isso passa a acontecer sozinho
corepack enable                          # habilita o `pnpm` de verdade nessa versão de Node
```

`corepack enable` é obrigatório: este repo só declara a versão do `pnpm` via `packageManager` no
`package.json` (Corepack), não como dependência global — sem habilitar, `pnpm`/`turbo` não acham o
binário (`Unable to find package manager binary`). É por versão de Node, então rode de novo sempre
que trocar de versão via fnm/nvm.

### Comandos

```bash
make install
make ci                 # lint + typecheck + test:unit + test:integration — mesmo que o CI roda
make web-dev             # apps/web sozinho, Vite + HMR
```

Ou direto via pnpm, se preferir: `pnpm install`, `pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w build`,
`pnpm -w test:unit`, `pnpm -w test:integration` (Postgres real via PGlite, sem Docker — ADR-0007).
`make help` lista todos os atalhos, tanto de workspace quanto do stack Docker.

Requisitos rastreáveis, design e progresso de cada onda de desenvolvimento vivem em [`.specs/features/architecture-canvas/`](.specs/features/architecture-canvas/) — cada requisito tem um ID (`FND-*`, `AUTH-*`, `EDT-*`, ... `SEC-*`, `OIDC-*`, `DR-*`, `OBS-*`, `PERF-*`, `A11Y-*`) rastreável até o código e o teste que o verifica.
