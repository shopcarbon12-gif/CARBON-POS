# Carbon POS — standalone Next.js image. Mirrors the WMS Dockerfile build pattern
# so Coolify behaves identically for both apps.
#
# Runtime: Coolify injects DATABASE_URL (pointing at the same WMS Postgres) plus
# every other secret from the application env. POS_AUTO_MIGRATE=1 runs the SQL
# files in /app/migrations at container start; failures log a WARNING but the
# app still starts so /api/health can pass.

FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
ENV NPM_CONFIG_PRODUCTION=false
# BuildKit cache for /root/.npm — reuses tarballs between deploys.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM base AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_PRODUCTION=false
ENV CI=true
ENV DOCKER_BUILD=1
ENV NODE_OPTIONS=--max-old-space-size=6144
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# BuildKit cache for .next/cache — incremental webpack + TS cache survives across deploys.
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked,id=carbon-pos-next-cache \
    node ./node_modules/next/dist/bin/next build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && apk add --no-cache libc6-compat postgresql-client su-exec
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# pg subtree is not in the server-action trace; copy the full tree from deps so
# docker-migrate.mjs (which runs outside Next) can require('pg') at boot.
COPY --from=deps /app/node_modules/pg /app/node_modules/pg
COPY --from=deps /app/node_modules/pg-connection-string /app/node_modules/pg-connection-string
COPY --from=deps /app/node_modules/pg-pool /app/node_modules/pg-pool
COPY --from=deps /app/node_modules/pg-protocol /app/node_modules/pg-protocol
COPY --from=deps /app/node_modules/pg-types /app/node_modules/pg-types
COPY --from=deps /app/node_modules/pgpass /app/node_modules/pgpass
COPY --from=deps /app/node_modules/pg-int8 /app/node_modules/pg-int8
COPY --from=deps /app/node_modules/postgres-array /app/node_modules/postgres-array
COPY --from=deps /app/node_modules/postgres-bytea /app/node_modules/postgres-bytea
COPY --from=deps /app/node_modules/postgres-date /app/node_modules/postgres-date
COPY --from=deps /app/node_modules/postgres-interval /app/node_modules/postgres-interval
COPY --from=deps /app/node_modules/split2 /app/node_modules/split2
COPY --from=deps /app/node_modules/xtend /app/node_modules/xtend
COPY migrations /app/migrations
COPY scripts/docker-migrate.mjs /app/scripts/docker-migrate.mjs
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /app/.next/cache \
  && chown -R nextjs:nodejs /app

EXPOSE 5000
ENV PORT=5000
ENV HOSTNAME=0.0.0.0

# /api/health checks the DB. start_period gives Postgres time to be reachable from
# inside the coolify network on first boot.
HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
