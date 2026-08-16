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
# apps/web devDependends on @arch-canvas/server (for tests), which pulls in
# `canvas` — no prebuilt binary for musl/Alpine, needs Python + a C++ toolchain
# + Cairo/Pango/JPEG/GIF headers to compile from source. Build-only: this
# image's runtime stage below is static nginx, none of this ships in it.
RUN apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev jpeg-dev giflib-dev
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
# `127.0.0.1`, not `localhost`: Alpine's /etc/hosts resolves `localhost` to
# `::1` first, but this nginx.conf only `listen`s on IPv4 (no `listen [::]:80`)
# — wget would always hit "connection refused" and the healthcheck would
# never pass, which then blocks `proxy` forever (it depends on this being healthy).
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --spider -q http://127.0.0.1/ || exit 1
