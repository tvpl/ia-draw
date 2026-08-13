# syntax=docker/dockerfile:1.7
#
# apps/web image: builds the static Vite bundle, then serves it with nginx.
#
# Build (from repo root):
#   docker build -f infra/compose/web.Dockerfile -t arch-canvas-web .

FROM node:22.22-alpine3.24 AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @arch-canvas/web --docker

FROM base AS installer
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# turbo prune --docker only copies workspace package.json/source, not shared
# root config — every package's tsconfig extends this one.
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm exec turbo run build --filter=@arch-canvas/web

FROM nginx:1.31.3-alpine AS runtime
COPY infra/compose/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=installer /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --spider -q http://localhost/ || exit 1
