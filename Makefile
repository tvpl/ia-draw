SHELL := /bin/bash
.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Architecture Canvas — root Makefile
#
# Wraps two things that otherwise require remembering separate directories
# and flags: the pnpm/turbo workspace commands (lint/typecheck/build/test)
# and the docker compose stack that lives in infra/compose/ (README there
# has the full service list and optional profiles).
#
# Run `make` or `make help` to list every target.
# ---------------------------------------------------------------------------

COMPOSE_DIR := infra/compose
COMPOSE     := docker compose --project-directory $(COMPOSE_DIR) -f $(COMPOSE_DIR)/compose.yaml

# Resolve a pnpm we can actually run: a real `pnpm` on PATH first, falling
# back to `corepack pnpm` (Node >=16.9 ships corepack; it reads the pinned
# version from package.json's "packageManager" field with no extra setup —
# no global `corepack enable` needed just to invoke it this way).
PNPM := $(shell command -v pnpm 2>/dev/null)
ifeq ($(strip $(PNPM)),)
	ifneq ($(shell command -v corepack 2>/dev/null),)
		PNPM := corepack pnpm
	endif
endif

.PHONY: help
help: ## Show this help
	@echo "Architecture Canvas — dev commands"
	@echo ""
	@grep -E '^[a-zA-Z0-9_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: check-pnpm
check-pnpm:
ifeq ($(strip $(PNPM)),)
	@echo "Neither pnpm nor corepack were found on PATH."; \
	echo "Install pnpm (https://pnpm.io/installation) or install Node >=16.9, which ships corepack."; \
	exit 1
endif

# ---------------------------------------------------------------------------
# Workspace (pnpm + turbo) — no Docker involved
# ---------------------------------------------------------------------------

.PHONY: install
install: check-pnpm ## Install workspace dependencies (pnpm install --frozen-lockfile)
	$(PNPM) install --frozen-lockfile

.PHONY: lint
lint: check-pnpm ## Lint + format-check the whole workspace (biome)
	$(PNPM) -w lint

.PHONY: format
format: check-pnpm ## Auto-format the whole workspace (biome --write)
	$(PNPM) -w format

.PHONY: typecheck
typecheck: check-pnpm ## Typecheck every package (tsc --noEmit)
	$(PNPM) -w typecheck

.PHONY: build
build: check-pnpm ## Build every package (turbo run build)
	$(PNPM) -w build

.PHONY: test-unit
test-unit: check-pnpm ## Run unit tests for every package
	$(PNPM) -w test:unit

.PHONY: test-integration
test-integration: check-pnpm ## Run integration tests (real Postgres via PGlite — no Docker needed, see ADR-0007)
	$(PNPM) -w test:integration

.PHONY: test-e2e
test-e2e: check-pnpm ## Run apps/web Playwright e2e tests
	$(PNPM) -w test:e2e

.PHONY: test-e2e-browsers
test-e2e-browsers: check-pnpm ## Install the Playwright browser binaries test-e2e needs
	$(PNPM) --filter @arch-canvas/web exec playwright install --with-deps chromium

.PHONY: test
test: test-unit test-integration ## Run unit + integration tests (fast local loop, no e2e)

.PHONY: ci
ci: lint typecheck test-unit test-integration ## Run the same checks CI runs (.github/workflows/ci.yaml), before you push

.PHONY: web-dev
web-dev: check-pnpm ## Run apps/web alone with Vite's dev server + HMR (point it at a stack from `make up`)
	$(PNPM) --filter @arch-canvas/web dev

.PHONY: clean
clean: ## Remove build output (dist/.turbo/coverage) without touching node_modules
	rm -rf apps/*/dist apps/*/.turbo packages/*/dist packages/*/.turbo infra/backup/dist infra/backup/.turbo
	find . -name coverage -not -path '*/node_modules/*' -type d -prune -exec rm -rf {} +
	find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete

# ---------------------------------------------------------------------------
# Docker sandbox (infra/compose) — the full stack: proxy, server, web,
# postgres, minio, migrate. See infra/compose/README.md for service details
# and optional profiles (observability, oidc-dev).
# ---------------------------------------------------------------------------

$(COMPOSE_DIR)/.env:
	cp $(COMPOSE_DIR)/.env.example $@
	@echo "Created $@ from .env.example (dev-only defaults — do not reuse in production)."

.PHONY: env
env: $(COMPOSE_DIR)/.env ## Create infra/compose/.env from .env.example if it doesn't exist yet

.PHONY: up
up: env ## Build and start the full stack in the background (proxy on http://localhost:8080)
	$(COMPOSE) up --build -d
	@echo ""
	@echo "Stack starting — http://localhost:8080 once health checks go green."
	@echo "Follow logs with: make logs"

.PHONY: up-fg
up-fg: env ## Same as `up`, but stays attached and streams logs (Ctrl+C stops everything)
	$(COMPOSE) up --build

.PHONY: down
down: ## Stop the stack, keep data (named volumes untouched)
	$(COMPOSE) down

.PHONY: reset
reset: ## DESTRUCTIVE: stop the stack and delete its volumes (postgres/minio/backups data)
	@echo "This deletes postgres-data, minio-data and backups volumes."
	@read -p "Type 'reset' to confirm: " ans; [ "$$ans" = "reset" ] || (echo "Aborted."; exit 1)
	$(COMPOSE) down -v

.PHONY: build-images
build-images: env ## Build the server/web/migrate images without starting containers
	$(COMPOSE) build

.PHONY: logs
logs: ## Tail logs for every service (or SERVICE=server make logs for just one)
	$(COMPOSE) logs -f $(SERVICE)

.PHONY: ps
ps: ## Show status + health of every compose service
	$(COMPOSE) ps

.PHONY: restart
restart: ## Restart one service — usage: make restart SERVICE=server
	@if [ -z "$(SERVICE)" ]; then echo "Usage: make restart SERVICE=<name>"; exit 1; fi
	$(COMPOSE) restart $(SERVICE)

.PHONY: migrate
migrate: env ## Re-run the one-shot migration job against the running postgres
	$(COMPOSE) up --build migrate

.PHONY: shell-server
shell-server: ## Open a shell in the running server container
	$(COMPOSE) exec server sh

.PHONY: shell-postgres
shell-postgres: ## Open a psql shell against the running postgres container
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-arch_canvas} -d $${POSTGRES_DB:-arch_canvas}

.PHONY: up-observability
up-observability: env ## Start the full stack plus Prometheus/Grafana/OTel Collector (profile: observability)
	$(COMPOSE) --profile observability up --build -d

.PHONY: up-oidc
up-oidc: env ## Start the full stack plus a local Keycloak IdP (profile: oidc-dev)
	$(COMPOSE) --profile oidc-dev up --build -d
