#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:28080}"
CHANGE_LIST="${CHANGE_LIST:-reports/migration/changed_urls.txt}"
SINCE="${SINCE:-}"
STATIC_ROOT="${STATIC_ROOT:-/var/www/hctxf-static}"
CRAWL_OUTPUT_DIR="${CRAWL_OUTPUT_DIR:-$STATIC_ROOT}"
TARGET_ENV="${TARGET_ENV:-development}"
CONFIRM_PRODUCTION_ACTION="${CONFIRM_PRODUCTION_ACTION:-false}"

if [[ "${TARGET_ENV,,}" == "production" && "$CONFIRM_PRODUCTION_ACTION" != "true" ]]; then
  echo "Refusing production fallback deploy without CONFIRM_PRODUCTION_ACTION=true"
  exit 1
fi

CHANGE_ARGS=(--output "$CHANGE_LIST")
if [[ -n "$SINCE" ]]; then
  CHANGE_ARGS+=(--since "$SINCE")
fi

npm --prefix platform run generate-change-list -- "${CHANGE_ARGS[@]}"
npm --prefix platform run crawl-static-snapshot -- --base-url "$BASE_URL" --url-list "$CHANGE_LIST" --output-dir "$CRAWL_OUTPUT_DIR"

LATEST_VERSION="$(find "$CRAWL_OUTPUT_DIR" -mindepth 1 -maxdepth 1 -type d -name 'v*' -printf '%f\n' | sort | tail -n 1)"
if [[ -z "$LATEST_VERSION" ]]; then
  echo "No snapshot version generated under $CRAWL_OUTPUT_DIR"
  exit 1
fi

npm --prefix platform run switch-static-snapshot -- --static-root "$STATIC_ROOT" --version "$LATEST_VERSION" --health-check true

echo "Static fallback deployed: $LATEST_VERSION"
