#!/bin/sh
set -e
cd /app

# Optional schema bootstrap. Failures must NOT exit — Next must come up so /api/health
# can report DB problems instead of the container restart-looping.
if [ -n "$DATABASE_URL" ] && [ "${POS_AUTO_MIGRATE:-}" = "1" ]; then
  set +e
  echo "pos: running node /app/scripts/docker-migrate.mjs (POS_AUTO_MIGRATE=1)"
  export NODE_PATH="${NODE_PATH:-/app/node_modules}"
  node /app/scripts/docker-migrate.mjs
  _s=$?
  if [ "$_s" -ne 0 ]; then echo "pos: WARNING docker-migrate.mjs exited $_s — fix DB; starting app anyway" >&2; fi
  set -e
fi

# Sanity check: report if the WMS tables POS depends on aren't present.
if [ -n "$DATABASE_URL" ]; then
  missing=""
  for t in locations users custom_skus epcs; do
    hit=$(psql "$DATABASE_URL" -tAc "select 1 from information_schema.tables where table_schema='public' and table_name='$t' limit 1" 2>/dev/null | tr -d " \t\r\n")
    if [ "$hit" != "1" ]; then
      missing="${missing}${missing:+ }${t}"
    fi
  done
  if [ -n "$missing" ]; then
    echo "pos: CRITICAL — missing WMS table(s) POS reads from: ${missing}." >&2
    echo "pos: Confirm DATABASE_URL points at the WMS Postgres and that WMS migrations have run." >&2
  else
    echo "pos: WMS tables OK (locations, users, custom_skus, epcs)" >&2
  fi
  for t in pos_locations pos_registers pos_register_sessions pos_sales pos_sale_lines pos_payments; do
    hit=$(psql "$DATABASE_URL" -tAc "select 1 from information_schema.tables where table_schema='public' and table_name='$t' limit 1" 2>/dev/null | tr -d " \t\r\n")
    if [ "$hit" != "1" ]; then
      echo "pos: NOTE — $t not yet present. Set POS_AUTO_MIGRATE=1 and redeploy, or run npm run db:migrate from a workstation." >&2
    fi
  done
fi

exec su-exec nextjs:nodejs "$@"
