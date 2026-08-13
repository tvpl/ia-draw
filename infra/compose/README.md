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

**Disclosure (T96, same discipline as the rest of this file):** this sandbox
has no Docker daemon, so neither profile was actually booted here. What WAS
verified in this environment: `docker compose --profile observability config`
and `docker compose --profile oidc-dev config` (and both together) all
resolve cleanly — zero errors/warnings, every bind-mounted config file
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

This sandbox has no Docker daemon (`docker` CLI is present, but
`/var/run/docker.sock` doesn't exist — `docker version`'s server half and any
`docker build`/`docker compose up` fail to connect). Everything checkable
without a daemon was verified in this environment:

- `docker compose -f compose.yaml config` — full schema validation and
  variable interpolation, resolved successfully against `.env.example`.
- Each Dockerfile's build logic was dry-run manually: `turbo prune <pkg>
  --docker` was executed for real (it needs no daemon), its `out/json` +
  `out/full` output installed and built with `pnpm install --frozen-lockfile`
  + `turbo run build`, and the resulting compiled `apps/server` was actually
  started and exercised (`/health/live`, `/health/ready` both returned 200
  with real JSON logs). This caught and fixed a real bug: `turbo prune
  --docker` does not copy root-level shared config like `tsconfig.base.json`,
  which every package's `tsconfig.json` extends — each Dockerfile now copies
  it explicitly before building.
- `packages/database`'s `migrate()` was confirmed to resolve
  `infra/migrations` correctly relative to its own compiled location when
  laid out the way the `migrate` image lays it out.

What is **not** verified here, because it requires the daemon: an actual
`docker build`/`docker compose up --build` run, container healthchecks
turning green, and the full stack being reachable at one URL. That is the
F0 Verifier's / CI's job (T7) in an environment with Docker — do not take
this document as evidence the stack was run end-to-end in this sandbox.

## Resetting

`docker compose down -v` deletes the named volumes (`postgres-data`,
`minio-data`, `backups`) — this is destructive and not part of the normal
`up`/`down` cycle. Only run it deliberately.
