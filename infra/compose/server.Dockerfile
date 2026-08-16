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
# `canvas` (server-side PNG rasterization, apps/server/src/modules/render) ships
# no prebuilt binary for musl/Alpine — it compiles from source via node-gyp,
# which needs Python + a C++ toolchain + Cairo/Pango/JPEG/GIF headers.
RUN apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev jpeg-dev giflib-dev
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
# Shared libraries `canvas`'s compiled native addon links against at runtime
# (the -dev/toolchain packages from the installer stage are build-only).
RUN apk add --no-cache cairo pango jpeg giflib
RUN addgroup -S app && adduser -S app -G app
COPY --from=installer --chown=app:app /repo .
USER app
EXPOSE 3000
# `127.0.0.1`, not `localhost`: Alpine's /etc/hosts resolves `localhost` to
# `::1` first, but Fastify here only binds IPv4 — wget would always hit
# "connection refused" and the healthcheck would never pass.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget --spider -q http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "apps/server/dist/index.js"]
