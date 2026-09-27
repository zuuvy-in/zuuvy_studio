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
# Find the Postgres server tools: $PG_BIN, then whatever is on PATH, then the usual
# install locations (Debian/Ubuntu, Homebrew on Apple silicon and Intel, Postgres.app).
# Always returns 0: under `set -e` a failing lookup inside $(...) would end the
# script silently — which is exactly how this used to fail on macOS.
find_pg_bin() {
  if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN"; return 0; fi
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return 0; fi
  local d
  for d in /usr/lib/postgresql/*/bin \
           /opt/homebrew/opt/postgresql@*/bin /opt/homebrew/opt/postgresql/bin \
           /usr/local/opt/postgresql@*/bin /usr/local/opt/postgresql/bin \
           /Applications/Postgres.app/Contents/Versions/latest/bin; do
    if [ -x "$d/initdb" ]; then echo "$d"; return 0; fi
  done
  return 0
}
PG_BIN="$(find_pg_bin)"
if [ -n "$PG_BIN" ]; then export PATH="$PG_BIN:$PATH"; fi
if ! command -v initdb >/dev/null 2>&1 || ! command -v pg_ctl >/dev/null 2>&1; then
  echo "PostgreSQL server tools (initdb, pg_ctl) not found." >&2
  echo "  macOS:  brew install postgresql@16" >&2
  echo "  Ubuntu: sudo apt install postgresql-16" >&2
  echo "  Or point at them: PG_BIN=/path/to/postgres/bin npm run db:start" >&2
  exit 1
fi

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
