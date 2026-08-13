# syntax=docker/dockerfile:1.7
#
# apps/server image. Multi-stage build via pnpm + turbo (`turbo prune`), built
# from the monorepo root as build context so pnpm workspace resolution works.
#
# Build (from repo root):
#   docker build -f infra/compose/server.Dockerfile -t arch-canvas-server .

FROM node:22.22-alpine3.24 AS base
RUN corepack enable
WORKDIR /repo

# 1) Prune the workspace down to what apps/server needs, keeping the same
#    repo-relative directory layout `turbo prune --docker` produces.
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @arch-canvas/server --docker

# 2) Install the pruned deps, copy the pruned full source, build.
FROM base AS installer
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# turbo prune --docker only copies workspace package.json/source, not shared
# root config — every package's tsconfig extends this one.
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm exec turbo run build --filter=@arch-canvas/server

# 3) Minimal runtime.
FROM node:22.22-alpine3.24 AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN addgroup -S app && adduser -S app -G app
COPY --from=installer --chown=app:app /repo .
USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget --spider -q http://localhost:3000/health/live || exit 1
CMD ["node", "apps/server/dist/index.js"]
