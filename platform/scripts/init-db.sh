#!/usr/bin/env bash
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-hctxf}"
POSTGRES_USER="${POSTGRES_USER:-hctxf_user}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Please install PostgreSQL client or run inside a postgres-enabled container."
  exit 1
fi

if [[ -z "${POSTGRES_PASSWORD}" ]]; then
  echo "POSTGRES_PASSWORD is required."
  exit 1
fi

export PGPASSWORD="$POSTGRES_PASSWORD"

psql "host=$POSTGRES_HOST port=$POSTGRES_PORT dbname=$POSTGRES_DB user=$POSTGRES_USER" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SQL

echo "Database extensions ensured for $POSTGRES_DB"
