#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-internal}"
TARGET_ENV="${TARGET_ENV:-development}"
CONFIRM_PRODUCTION_ACTION="${CONFIRM_PRODUCTION_ACTION:-false}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONF_FILE="${CONF_FILE:-$PLATFORM_ROOT/nginx/conf.d/redirects/gray-mode.conf}"
NGINX_TEST_CMD="${NGINX_TEST_CMD:-docker exec hctxf-nginx nginx -t}"
NGINX_RELOAD_CMD="${NGINX_RELOAD_CMD:-docker exec hctxf-nginx nginx -s reload}"

if [[ "$MODE" != "off" && "$MODE" != "internal" && "$MODE" != "all" ]]; then
  echo "Invalid mode: $MODE (expected off|internal|all)"
  exit 1
fi

if [[ "${TARGET_ENV,,}" == "production" && "$CONFIRM_PRODUCTION_ACTION" != "true" ]]; then
  echo "Refusing production gray-mode change without CONFIRM_PRODUCTION_ACTION=true"
  exit 1
fi

mkdir -p "$(dirname "$CONF_FILE")"
BACKUP_FILE="${CONF_FILE}.bak"
if [[ -f "$CONF_FILE" ]]; then
  cp "$CONF_FILE" "$BACKUP_FILE"
fi

cat > "$CONF_FILE" <<CONFIG
# Generated/managed by platform/scripts/set-gray-mode.sh
# Allowed values: off | internal | all
map "" \$legacy_redirect_mode {
  default ${MODE};
}
CONFIG

if ! sh -c "$NGINX_TEST_CMD"; then
  echo "nginx -t failed, restoring previous gray-mode config"
  if [[ -f "$BACKUP_FILE" ]]; then
    cp "$BACKUP_FILE" "$CONF_FILE"
  fi
  exit 1
fi

sh -c "$NGINX_RELOAD_CMD"
echo "Gray mode set to ${MODE}"
