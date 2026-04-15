#!/usr/bin/env bash
set -euo pipefail

STATIC_ROOT="/var/www/hctxf-static"
NEW_VERSION=""
HEALTH_CHECK="true"
TARGET_ENV="${TARGET_ENV:-development}"
CONFIRM_PRODUCTION_ACTION="${CONFIRM_PRODUCTION_ACTION:-false}"
NGINX_TEST_CMD="${NGINX_TEST_CMD:-docker exec hctxf-nginx nginx -t}"
NGINX_RELOAD_CMD="${NGINX_RELOAD_CMD:-docker exec hctxf-nginx nginx -s reload}"

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --static-root)
      STATIC_ROOT="$2"
      shift 2
      ;;
    --version)
      NEW_VERSION="$2"
      shift 2
      ;;
    --health-check)
      HEALTH_CHECK="$2"
      shift 2
      ;;
    --nginx-test-cmd)
      NGINX_TEST_CMD="$2"
      shift 2
      ;;
    --nginx-reload-cmd)
      NGINX_RELOAD_CMD="$2"
      shift 2
      ;;
    -h|--help)
      cat <<USAGE
Usage:
  $0 --static-root /var/www/hctxf-static --version latest --health-check true
  $0 /var/www/hctxf-static v20260415-1200    # backward-compatible positional form
USAGE
      exit 0
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -ge 1 && "$STATIC_ROOT" == "/var/www/hctxf-static" ]]; then
  STATIC_ROOT="${POSITIONAL[0]}"
fi
if [[ ${#POSITIONAL[@]} -ge 2 && -z "$NEW_VERSION" ]]; then
  NEW_VERSION="${POSITIONAL[1]}"
fi

if [[ "${TARGET_ENV,,}" == "production" && "$CONFIRM_PRODUCTION_ACTION" != "true" ]]; then
  echo "Refusing production static switch without CONFIRM_PRODUCTION_ACTION=true"
  exit 1
fi

if [[ -z "$NEW_VERSION" ]]; then
  echo "Missing --version (or positional version argument)"
  exit 1
fi

if [[ "$NEW_VERSION" == "latest" ]]; then
  NEW_VERSION="$(find "$STATIC_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'v*' -printf '%f\n' | sort | tail -n 1)"
  if [[ -z "$NEW_VERSION" ]]; then
    echo "No snapshot versions found under $STATIC_ROOT"
    exit 1
  fi
fi

TARGET_DIR="${STATIC_ROOT}/${NEW_VERSION}"
CURRENT_LINK="${STATIC_ROOT}/current"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Target dir not found: $TARGET_DIR"
  exit 1
fi

if [[ "${HEALTH_CHECK,,}" == "true" || "$HEALTH_CHECK" == "1" || "${HEALTH_CHECK,,}" == "yes" ]]; then
  mapfile -t SAMPLE_FILES < <(find "$TARGET_DIR" -type f -name '*.html' | head -n 5)
  if [[ ${#SAMPLE_FILES[@]} -eq 0 ]]; then
    echo "No html files found in target dir"
    exit 1
  fi

  for file in "${SAMPLE_FILES[@]}"; do
    if [[ ! -s "$file" ]]; then
      echo "Health check failed: empty file $file"
      exit 1
    fi
    if ! grep -qi "<title" "$file"; then
      echo "Health check failed: missing <title> in $file"
      exit 1
    fi
  done
fi

ln -sfn "$TARGET_DIR" "$CURRENT_LINK"

sh -c "$NGINX_TEST_CMD"
sh -c "$NGINX_RELOAD_CMD"

echo "Switched static snapshot to ${TARGET_DIR}"
