#!/usr/bin/env bash
# Build and start the FF3 Lantern public demo from host-supplied data files (#102).
#
# Put artifacts on the host (never in git), e.g. ~/ff3lantern-demo-data/:
#   ff3lantern.db
#   firefly-export.sanitized.json
#
# Optional faster Firefly seed (preserves IDs, no API import):
#   firefly.dump          # pg_dump -Fc from a seeded Firefly DB
#
# Usage:
#   DEMO_DATA_DIR=~/ff3lantern-demo-data ./demo/demo-up.sh
#   ./demo/demo-up.sh --reset          # wipe docker volumes and re-import
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/demo/docker-compose.demo.yml"
DEMO_DATA_DIR="${DEMO_DATA_DIR:-$ROOT/demo-secrets}"
RUNTIME_DIR="${DEMO_RUNTIME_DIR:-$ROOT/demo/.runtime}"
ENV_FILE="$ROOT/demo/.env.demo"
FIREFLY_PORT="${DEMO_FIREFLY_PORT:-8088}"
FRONTEND_PORT="${DEMO_FRONTEND_PORT:-8080}"

RESET=0
if [[ "${1:-}" == "--reset" ]]; then
  RESET=1
fi

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "ERROR: missing $1" >&2
    echo "Place demo data under DEMO_DATA_DIR=$DEMO_DATA_DIR" >&2
    exit 1
  fi
}

if [[ "$RESET" == "1" ]]; then
  echo "==> Resetting demo volumes"
  compose down -v --remove-orphans 2>/dev/null || true
  rm -rf "$RUNTIME_DIR"
  rm -f "$ENV_FILE"
fi

mkdir -p "$RUNTIME_DIR/lantern-data"
export DEMO_RUNTIME_DIR="$RUNTIME_DIR"

require_file "$DEMO_DATA_DIR/ff3lantern.db"

has_json=0
has_dump=0
[[ -f "$DEMO_DATA_DIR/firefly-export.sanitized.json" ]] && has_json=1
[[ -f "$DEMO_DATA_DIR/firefly.dump" ]] && has_dump=1

if [[ "$has_json" == "0" && "$has_dump" == "0" ]]; then
  echo "ERROR: need firefly-export.sanitized.json or firefly.dump in $DEMO_DATA_DIR" >&2
  exit 1
fi

echo "==> Starting Postgres"
compose up -d db --wait

if [[ "$has_dump" == "1" && ! -f "$RUNTIME_DIR/.demo-seeded" ]]; then
  echo "==> Restoring Firefly from pg_dump (IDs preserved)"
  compose up -d firefly
  sleep 3
  compose stop firefly
  cat "$DEMO_DATA_DIR/firefly.dump" | compose exec -T db pg_restore -U firefly -d firefly --clean --if-exists 2>/dev/null || true
  cp "$DEMO_DATA_DIR/ff3lantern.db" "$RUNTIME_DIR/lantern-data/ff3lantern.db"
  touch "$RUNTIME_DIR/.demo-seeded"
fi

echo "==> Starting Firefly"
compose up -d firefly --wait

if [[ ! -f "$ENV_FILE" ]] || ! grep -q '^FIREFLY_API_TOKEN=ey' "$ENV_FILE" 2>/dev/null; then
  bash "$ROOT/demo/seed/bootstrap-demo.sh"
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if [[ ! -f "$RUNTIME_DIR/.demo-seeded" ]]; then
  if [[ "$has_json" == "1" ]]; then
    echo "==> Importing Firefly JSON + remapping sidecar (first boot may take several minutes)"
    python3 -m pip install --quiet httpx
    FIREFLY_BASE_URL="${FIREFLY_BASE_URL:-http://127.0.0.1:${FIREFLY_PORT}}" \
      FIREFLY_API_TOKEN="$FIREFLY_API_TOKEN" \
      python3 "$ROOT/demo/seed/seed_demo_from_json.py" \
        --data-dir "$DEMO_DATA_DIR" \
        --sidecar-out "$RUNTIME_DIR/lantern-data/ff3lantern.db"
  else
    cp "$DEMO_DATA_DIR/ff3lantern.db" "$RUNTIME_DIR/lantern-data/ff3lantern.db"
  fi
  touch "$RUNTIME_DIR/.demo-seeded"
else
  echo "==> Demo data already seeded (delete $RUNTIME_DIR/.demo-seeded or use --reset to re-import)"
  if [[ ! -f "$RUNTIME_DIR/lantern-data/ff3lantern.db" ]]; then
    cp "$DEMO_DATA_DIR/ff3lantern.db" "$RUNTIME_DIR/lantern-data/ff3lantern.db"
  fi
fi

echo "==> Starting Lantern"
compose up -d lantern-backend lantern-frontend --wait

echo ""
echo "Demo ready:"
echo "  UI:      http://127.0.0.1:${FRONTEND_PORT}"
echo "  Firefly: http://127.0.0.1:${FIREFLY_PORT} (local bootstrap only; do not expose publicly)"
echo ""
echo "Stop:  docker compose -f demo/docker-compose.demo.yml down"
echo "Reset: ./demo/demo-up.sh --reset"
