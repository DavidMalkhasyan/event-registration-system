# EventFlow application image (K-720, PD-101): the web process, the worker and the operator commands share
# one image; Compose chooses the command. Built from the repository root:
#   docker build -f deploy/Dockerfile -t eventflow:<version> .

# ---- build: install everything, build the client and the server
FROM node:24-bookworm-slim AS build
WORKDIR /src
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/e2e/package.json apps/e2e/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @ers/server build && pnpm --filter @ers/client build

# ---- runtime: production dependencies of the server only, the built files, PostgreSQL 18 client tools
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pg_dump and pg_restore must be at least the server's version (18) for pnpm ops:backup.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/e2e/package.json apps/e2e/
RUN pnpm install --frozen-lockfile --prod --filter @ers/server
COPY --from=build /src/apps/server/dist apps/server/dist
COPY apps/server/migrations apps/server/migrations
COPY --from=build /src/apps/client/dist apps/client/dist
RUN mkdir -p /data/media /data/tile-cache /data/backups /data/mailbox && chown -R node:node /data
USER node
ENV HOST=0.0.0.0 PORT=3000 CLIENT_DIST_DIR=/app/apps/client/dist MEDIA_DIR=/data/media TILE_CACHE_DIR=/data/tile-cache
EXPOSE 3000
CMD ["node", "apps/server/dist/entrypoints/web.js"]
