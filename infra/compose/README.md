# Docker compose stack

Local self-hosted stack (`docs/product-spec.md` §12). `compose.yaml` lives
here, in `infra/compose/`, not at the repo root — run compose commands from
this directory (or pass `-f infra/compose/compose.yaml` from elsewhere).

## Usage

```bash
cd infra/compose
cp .env.example .env
docker compose up --build
```

This builds `server`, `web` and `migrate` from the repo root (build context
is `../..`), starts `postgres` and `minio`, runs `migrate` and `minio-init`
as one-shot jobs, then brings up `server`, `web` and the `proxy` (Caddy)
front door on `http://localhost:${PUBLIC_PORT:-8080}`.

## Services

| Service | Purpose |
| --- | --- |
| `proxy` | Caddy — single public entrypoint. `/api/*` and `/ws*` go to `server`, everything else to `web`. |
| `server` | `apps/server`, built via `server.Dockerfile` (multi-stage: `turbo prune` + `turbo build`, compiled JS runtime). |
| `web` | `apps/web` static bundle, built via `web.Dockerfile`, served by nginx. |
| `postgres` | PostgreSQL 16, named volume `postgres-data`, `pg_isready` healthcheck. |
| `minio` | Object storage, named volume `minio-data`, `/minio/health/live` healthcheck. |
| `minio-init` | One-shot: creates the `assets`, `exports`, `backups` buckets idempotently (`mc mb --ignore-existing`), then exits. |
| `migrate` | One-shot: runs `packages/database`'s `migrate(DATABASE_URL)` against `postgres`, then exits. `server` waits for it to complete successfully. |

Named volumes: `postgres-data`, `minio-data`, `backups` (the last is mounted
into `server` at `/backups`, reserved for the F1 backup job — nothing writes
to it yet).

## Optional profiles (docs/product-spec.md §12, T96)

Neither profile starts by default — `docker compose up` never touches them.

| Profile | Services | Purpose |
| --- | --- | --- |
| `observability` | `prometheus`, `grafana`, `otel-collector` | Prometheus scrapes T91's `GET /metrics` and evaluates T93's `infra/observability/alerts.yml`; Grafana ships with Prometheus pre-provisioned as its datasource (`infra/observability/grafana-datasources.yml`); the OTel Collector receives OTLP traces on 4317 (gRPC) / 4318 (HTTP), config at `infra/observability/otel-collector-config.yml`. |
| `oidc-dev` | `keycloak` | A real local OIDC Identity Provider for exercising T87's OIDC login against a genuine external IdP (distinct from T88's in-process `oidc-provider`, which exists only for the automated test suite). Provisions the container only — an operator still creates a realm/client and points `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` at it manually (see `compose.yaml`'s `keycloak` service comment). |

```bash
docker compose --profile observability up
docker compose --profile oidc-dev up
# both together:
docker compose --profile observability --profile oidc-dev up
```

**Disclosure:** the base stack (no profile) has since been booted end-to-end
with a real Docker daemon — see "What's verified" below. These two profiles
specifically have not: what's verified here is still only
`docker compose --profile observability config` and
`docker compose --profile oidc-dev config` (and both together) resolving
cleanly — zero errors/warnings, every bind-mounted config file
(`infra/observability/{prometheus,otel-collector-config,
grafana-datasources}.yml`) resolves to a real file that exists on disk, and
each profile's services are correctly absent from the base (no-profile)
`config` output. Also carried forward from T92's own disclosed gap:
`apps/server`'s OpenTelemetry tracing currently defaults to an in-memory
exporter — nothing sends real spans to `otel-collector` yet even once this
profile is genuinely booted with Docker.

## Environment

`.env.example` documents every variable with a clearly insecure development
default (matching `apps/server/src/core/config.ts`'s `dev-insecure-secret-change-me`
placeholder). **Production must override every secret** — `SESSION_SECRET`
and `ENCRYPTION_KEY` in particular: `loadConfig()` refuses to boot in
production while either still equals the dev placeholder, naming the
offending variable (FND-03).

## What's verified here vs. what isn't

The base stack (`docker compose up --build`, no profile) has been run
end-to-end with a real Docker daemon (Docker Desktop, linux/arm64) — not just
config-validated. That run caught three real bugs, now fixed:

- **`canvas` doesn't build on Alpine/musl.** It ships no prebuilt binary for
  `napi + linux + arm64/amd64 + musl`, so `pnpm install` compiles it from
  source via node-gyp — which needs Python 3, a C++ toolchain, and Cairo/
  Pango/JPEG/GIF headers that a bare `node:22-alpine` doesn't have. It's a
  transitive dependency in all three images (`server` uses it directly for
  PNG rasterization; `web` and `migrate` pull it in because they
  devDepend-on `@arch-canvas/server`/`@arch-canvas/database` for tests, and
  `turbo prune --docker` keeps that whole subgraph). Fixed: `server.
  Dockerfile` and `web.Dockerfile` and `migrate.Dockerfile` now `apk add`
  the build toolchain in their `installer` stage; `server.Dockerfile`'s
  runtime stage additionally installs the plain (non-`-dev`) shared
  libraries `canvas`'s compiled addon links against at runtime.
- **`server` and `web` healthchecks never passed.** Both used
  `wget http://localhost/...`, but Alpine's `/etc/hosts` resolves
  `localhost` to `::1` (IPv6) before `127.0.0.1`, and neither Fastify nor
  this `nginx.conf` listen on IPv6 — every healthcheck attempt hit
  "connection refused" and both containers sat permanently `unhealthy`.
  Since `proxy` requires both `service_healthy` before it starts, the whole
  stack never came up. Fixed: both `HEALTHCHECK` instructions now target
  `127.0.0.1` explicitly. (`proxy`'s own `wget http://localhost/`
  healthcheck was left as-is — Caddy binds `:80` dual-stack by default, so
  it isn't affected; confirmed by it going healthy without this change.)
- **`/health/*` wasn't routed through the public proxy.** The `Caddyfile`
  only had `handle` blocks for `/api/*` and `/ws*`; `/health/live` and
  `/health/ready` fell through to the catch-all `web` route, and nginx's
  SPA fallback (`try_files ... /index.html`) answered with 200 + the
  frontend HTML instead of the server's real health JSON — a silent false
  positive for anyone pointing an external check at that path through the
  domain. Fixed: added a `handle /health/*` block routing to `server:3000`.
  (`/metrics` was deliberately left unrouted — see the Environment section
  above and `apps/server/src/core/metrics.ts`: it's meant to be reached
  only on the internal network, e.g. by `prometheus` directly, never
  publicly.)

After those three fixes, one full `docker compose up --build` cycle was
confirmed clean: `migrate` and `minio-init` both exit 0; `postgres`,
`redis`, `minio`, `server`, `web` and `proxy` all reach `healthy`; and
`GET http://localhost:8080/`, `/health/live` and `/health/ready` all
returned real, correct responses (200 with the SPA HTML, and
`{"status":"ok"}` / `{"status":"ok","dependencies":[...]}` respectively —
the latter proving live Postgres connectivity, not just a stub).

Not verified here: the `observability` and `oidc-dev` profiles (see above),
and everything that only shows up over time or under load — a long-running
soak, backup/restore against this compose stack specifically, or a real
deploy on an actual Dokploy instance (only the Dockerfiles/compose file
themselves were exercised, not Dokploy's own UI/Traefik integration).

## Resetting

`docker compose down -v` deletes the named volumes (`postgres-data`,
`minio-data`, `backups`) — this is destructive and not part of the normal
`up`/`down` cycle. Only run it deliberately.
