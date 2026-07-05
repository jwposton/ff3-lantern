#!/usr/bin/env bash
# Bootstrap a disposable Firefly III instance and write a PAT for Lantern integration tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/demo/docker-compose.integration.yml"
TOKEN_FILE="$ROOT/demo/.integration-token"
FIREFLY_SERVICE="${FIREFLY_SERVICE:-firefly}"
FIREFLY_EMAIL="${FIREFLY_EMAIL:-integration@ff3lantern.test}"
FIREFLY_PASSWORD="${FIREFLY_PASSWORD:-IntegrationTestPass123!}"
TOKEN_NAME="${TOKEN_NAME:-Lantern Integration CI}"

cd "$ROOT"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: missing $COMPOSE_FILE" >&2
  exit 1
fi

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

firefly_exec() {
  compose exec -T "$FIREFLY_SERVICE" "$@"
}

echo "==> Waiting for Firefly container"
compose ps --status running "$FIREFLY_SERVICE" >/dev/null

echo "==> Running Firefly migrations"
firefly_exec php artisan migrate --force

echo "==> Initializing Passport"
firefly_exec php artisan passport:keys --force
firefly_exec php artisan passport:client --personal --no-interaction --name="$TOKEN_NAME"

echo "==> Creating integration user and personal access token"
compose cp "$ROOT/demo/seed/bootstrap-firefly.php" "$FIREFLY_SERVICE:/tmp/bootstrap-firefly.php"
TOKEN="$(
  firefly_exec php /tmp/bootstrap-firefly.php "$FIREFLY_EMAIL" "$FIREFLY_PASSWORD" "$TOKEN_NAME" 2>/dev/null \
    | grep -Eo 'eyJ[A-Za-z0-9._-]+' \
    | tail -1 \
    | tr -d '\r\n'
)"

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: failed to create Firefly personal access token" >&2
  exit 1
fi

printf '%s' "$TOKEN" >"$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

echo "==> Seeding minimal Firefly dataset"
host_port="${FIREFLY_INTEGRATION_PORT:-8081}"
export FIREFLY_BASE_URL="${FIREFLY_BASE_URL:-http://127.0.0.1:${host_port}}"
export FIREFLY_API_TOKEN="$TOKEN"
python3 -m pip install --quiet httpx
python3 "$ROOT/demo/seed/seed_minimal_data.py"

echo "==> Bootstrap complete; token written to demo/.integration-token"
