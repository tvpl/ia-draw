# syntax=docker/dockerfile:1.7
#
# One-shot migration runner: builds packages/database and invokes its
# migrate(connectionString) export against $DATABASE_URL, then exits.
#
# Build (from repo root):
#   docker build -f infra/compose/migrate.Dockerfile -t arch-canvas-migrate .

FROM node:22.22-alpine3.24 AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo prune @arch-canvas/database --docker

FROM base AS installer
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# turbo prune --docker only copies workspace package.json/source, not shared
# root config — every package's tsconfig extends this one.
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm exec turbo run build --filter=@arch-canvas/database

FROM node:22.22-alpine3.24 AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=installer /repo .
# turbo prune only copies workspace packages; infra/migrations is plain SQL,
# not a workspace package, so it needs an explicit copy from the build context.
# packages/database/dist/migrate.js resolves it as ../../../infra/migrations
# relative to itself, so the layout below must stay in sync with that path.
COPY infra/migrations ./infra/migrations
CMD ["node", "--input-type=module", "-e", "import('./packages/database/dist/migrate.js').then(({ migrate }) => migrate(process.env.DATABASE_URL)).then(() => { console.log('migration complete'); process.exit(0); }).catch((error) => { console.error(error); process.exit(1); })"]
