#!/usr/bin/env bash
# Integration smoke: Firefly compose stack + Lantern API checks (#103).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/demo/docker-compose.integration.yml"
TOKEN_FILE="$ROOT/demo/.integration-token"
LANTERN_URL="${LANTERN_INTEGRATION_URL:-http://localhost:18002}"
FIREFLY_TAG="${FIREFLY_TAG:-version-6.6.3}"
MAX_WAIT=180

cd "$ROOT"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
  rm -f "$TOKEN_FILE"
}
if [[ "${INTEGRATION_KEEP_STACK:-}" != "1" ]]; then
  trap cleanup EXIT
fi

echo "Firefly tag: $FIREFLY_TAG"
echo "Lantern commit: $(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"

echo "Starting Firefly + database (first boot may take 2–3 min)..."
FIREFLY_TAG="$FIREFLY_TAG" docker compose -f "$COMPOSE_FILE" up -d db firefly

echo "Waiting for Firefly healthcheck..."
elapsed=0
while (( elapsed < MAX_WAIT )); do
  status="$(docker compose -f "$COMPOSE_FILE" ps firefly --format '{{.Health}}' 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    echo "Firefly healthy after ${elapsed}s"
    break
  fi
  if (( elapsed > 0 && elapsed % 30 == 0 )); then
    echo "  still waiting (${elapsed}s, health=${status:-unknown})..."
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done
if [[ "$(docker compose -f "$COMPOSE_FILE" ps firefly --format '{{.Health}}' 2>/dev/null)" != "healthy" ]]; then
  echo "ERROR: Firefly did not become healthy within ${MAX_WAIT}s" >&2
  docker compose -f "$COMPOSE_FILE" logs firefly --tail 80 >&2 || true
  exit 1
fi

echo "Bootstrapping Firefly (migrate, user, token, seed)..."
FIREFLY_TAG="$FIREFLY_TAG" bash "$ROOT/demo/seed/bootstrap-firefly.sh"

export FIREFLY_API_TOKEN
FIREFLY_API_TOKEN="$(cat "$TOKEN_FILE")"

echo "Starting Lantern backend..."
if [[ -z "${FIREFLY_API_TOKEN:-}" ]]; then
  echo "ERROR: missing FIREFLY_API_TOKEN (bootstrap may have failed)" >&2
  exit 1
fi
FIREFLY_TAG="$FIREFLY_TAG" FIREFLY_API_TOKEN="$FIREFLY_API_TOKEN" \
  docker compose -f "$COMPOSE_FILE" up -d --wait lantern-backend

elapsed=0
while (( elapsed < MAX_WAIT )); do
  if curl -sf -o /dev/null "$LANTERN_URL/health" 2>/dev/null; then
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if ! curl -sf -o /dev/null "$LANTERN_URL/health" 2>/dev/null; then
  echo "ERROR: Lantern backend did not become healthy at $LANTERN_URL/health" >&2
  docker compose -f "$COMPOSE_FILE" logs lantern-backend firefly >&2 || true
  exit 1
fi

echo "Running pytest integration smoke suite..."
cd "$ROOT/backend"
python3 -m pip install --quiet -r requirements.txt -r requirements-dev.txt
LANTERN_INTEGRATION_URL="$LANTERN_URL" FIREFLY_TAG="$FIREFLY_TAG" \
  pytest -q -m integration tests/test_integration_smoke.py

echo "Integration smoke passed (Firefly $FIREFLY_TAG)."
