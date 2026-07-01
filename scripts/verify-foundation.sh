#!/usr/bin/env bash
# Nyquist foundation verification: compose up, health curls, compose down.
# Prod-default: nginx static frontend on :5174 (proxies /api and /health).
# Dev overlay: docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f docker-compose.yml ]]; then
  echo "ERROR: docker-compose.yml not found in $ROOT (scaffold in plan 01-01)." >&2
  exit 1
fi

cleanup() {
  docker compose down --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

BACKEND_HEALTH="http://localhost:18001/health"
FRONTEND_HEALTH="http://localhost:5174/health"
MAX_WAIT=120

assert_status_ok() {
  local url="$1"
  local label="$2"
  local body
  body="$(curl -sf "$url")"

  if echo "$body" | grep -q 'FIREFLY_API_TOKEN'; then
    echo "ERROR: $label health response must not contain FIREFLY_API_TOKEN" >&2
    exit 1
  fi

  if command -v jq >/dev/null 2>&1; then
    echo "$body" | jq -e '.status == "ok"' >/dev/null
  else
    python3 -c '
import json, sys
data = json.load(sys.stdin)
if data.get("status") != "ok":
    sys.exit(1)
' <<<"$body"
  fi
  echo "OK: $label health status=ok"
}

wait_for_health() {
  local url="$1"
  local label="$2"
  local elapsed=0
  while (( elapsed < MAX_WAIT )); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      assert_status_ok "$url" "$label"
      return 0
    fi
    sleep 2
    elapsed=$(( elapsed + 2 ))
  done
  echo "ERROR: $label did not return HTTP 200 within ${MAX_WAIT}s ($url)" >&2
  exit 1
}

echo "Starting stack (docker compose up -d --build)..."
docker compose up -d --build

echo "Waiting for backend health ($BACKEND_HEALTH)..."
wait_for_health "$BACKEND_HEALTH" "backend"

echo "Waiting for proxied frontend health ($FRONTEND_HEALTH)..."
wait_for_health "$FRONTEND_HEALTH" "frontend"

FRONTEND_API="http://localhost:5174/api/normalized_transactions"
echo "Checking proxied API ($FRONTEND_API)..."
api_code="$(curl -s -o /dev/null -w '%{http_code}' "$FRONTEND_API")"
if [[ "$api_code" != "422" ]]; then
  echo "ERROR: proxied API expected HTTP 422 (missing query params), got $api_code" >&2
  exit 1
fi
echo "OK: proxied API returned 422"

FRONTEND_DEEPLINK="http://localhost:5174/reports/spending/sankey"
echo "Checking SPA deep link ($FRONTEND_DEEPLINK)..."
deeplink_body="$(curl -sf "$FRONTEND_DEEPLINK")"
if ! echo "$deeplink_body" | grep -q 'id="root"'; then
  echo "ERROR: SPA deep link response missing id=\"root\" mount point" >&2
  exit 1
fi
echo "OK: SPA deep link served index.html"

echo "Foundation verification passed."
