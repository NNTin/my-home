# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f apps/api/Dockerfile .)
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV CI=1 HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN corepack enable && corepack install

FROM base AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@my-home/api..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @my-home/api build

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --store-dir /pnpm-store \
      --filter @my-home/api

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api/package.json ./apps/api/
COPY apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
# Writable PGlite directory, used only when DATABASE_URL is unset.
RUN mkdir .data && chown node:node .data
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations run at start-up (MIGRATE_ON_START=true by default); `node dist/migrate.js`
# runs them as a separate step instead.
CMD ["node", "dist/server.js"]
