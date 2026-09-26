#!/usr/bin/env bash
# A throwaway Postgres for development, in .data/pg on port 54329.
#
#   npm run db:start   start (initialising on first run)
#   npm run db:stop    stop
#   npm run db:reset   drop and recreate the database
#
# Production is Aurora PostgreSQL; nothing here is used there. When running as
# root (cloud containers), the server runs as the `postgres` user, since
# initdb refuses root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.data/pg"
PORT="${ZSITE_PG_PORT:-54329}"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -n "$PG_BIN" ] && export PATH="$PG_BIN:$PATH"

as_pg() {
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

psql_admin() {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"
}

start() {
  if [ ! -s "$DATA/PG_VERSION" ]; then
    mkdir -p "$DATA"
    [ "$(id -u)" = "0" ] && chown -R postgres "$ROOT/.data"
    as_pg initdb -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
    echo "initialised $DATA"
  fi
  if as_pg pg_ctl -D "$DATA" status >/dev/null 2>&1; then
    echo "postgres already running on $PORT"
  else
    as_pg pg_ctl -D "$DATA" -l "$DATA/server.log" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -w start >/dev/null
    echo "postgres started on $PORT"
  fi
  ensure_db
}

ensure_db() {
  psql_admin -d postgres -tc "select 1 from pg_roles where rolname='zsite_app'" | grep -q 1 \
    || psql_admin -d postgres -c "create role zsite_app login password 'zsite'"
  psql_admin -d postgres -tc "select 1 from pg_database where datname='zsite'" | grep -q 1 \
    || psql_admin -d postgres -c "create database zsite"
}

stop() {
  as_pg pg_ctl -D "$DATA" -m fast stop >/dev/null 2>&1 && echo "postgres stopped" || echo "postgres was not running"
}

reset() {
  start
  psql_admin -d postgres -c "drop database if exists zsite with (force)"
  psql_admin -d postgres -c "create database zsite"
  echo "database zsite recreated"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset) reset ;;
  *) echo "usage: $0 start|stop|reset" >&2; exit 2 ;;
esac
