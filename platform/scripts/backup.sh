#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/platform/docker/compose.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found"
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/$TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

POSTGRES_DB="${POSTGRES_DB:-hctxf}"
POSTGRES_USER="${POSTGRES_USER:-hctxf_user}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

if [[ -z "$POSTGRES_PASSWORD" ]]; then
  echo "POSTGRES_PASSWORD is required for pg_dump"
  exit 1
fi

echo "[1/2] Backing up Postgres..."
docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$BACKUP_DIR/postgres.sql"

echo "[2/2] Backing up MinIO data volume..."
docker compose -f "$COMPOSE_FILE" exec -T minio sh -c "tar -C /data -czf - ." > "$BACKUP_DIR/minio-data.tar.gz"

echo "Backup completed: $BACKUP_DIR"
