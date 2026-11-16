# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f apps/web/Dockerfile .)
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS build
ENV CI=1 HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN corepack enable && corepack install
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@my-home/web..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @my-home/web build

# Unprivileged nginx (uid 101, port 8080) so the image runs under restricted Pod Security.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
# The nginx entrypoint renders /etc/nginx/templates/*.template with envsubst at start-up.
# Writable paths at runtime: /etc/nginx/conf.d (rendered config) and /tmp (pid, temp files).
ENV API_UPSTREAM=http://api:3000
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
