# FF3Analytics

Self-hosted analytics UI for a personal Firefly III instance. Planning and GSD artifacts live in the sibling FireflyReports repo; application code lives here.

## Prerequisites

- Docker and Docker Compose v2
- Optional: [jq](https://jqlang.github.io/jq/) for JSON checks in `scripts/verify-foundation.sh` (script falls back to `python3` if `jq` is missing)

## Ports (host)

| Service  | Host port | Container | Image name              |
|----------|-----------|-----------|-------------------------|
| Backend  | 18001     | 8000      | `ff3analytics-backend`  |
| Frontend | 5174      | 5173      | `ff3analytics-frontend` |

These differ from FireflyReports (`18000` / `5173`) so both stacks can run during migration.

## Environment

1. Copy `.env.example` to `.env`
2. Set `FIREFLY_BASE_URL` and `FIREFLY_API_TOKEN` when the backend needs Firefly access (Phase 2+)
3. Do not commit `.env`

## Quick start

From the repo root:

```bash
docker compose up -d --build
curl -sf http://localhost:18001/health
curl -sf http://localhost:5174/health
```

Open http://localhost:5174 in a browser — you should see the FF3Analytics smoke page with a green **Backend healthy** badge when the stack is up.

## Backend tests

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
pytest tests/ -q
```

## Verification

```bash
bash scripts/verify-foundation.sh
```

The script runs `docker compose up -d --build`, waits up to 90s for HTTP 200 on direct backend health (`http://localhost:18001/health`) and proxied frontend health (`http://localhost:5174/health`), asserts JSON `status` is `ok`, ensures responses do not leak `FIREFLY_API_TOKEN`, then runs `docker compose down` on exit.

## Backend only

```bash
docker compose up -d --build backend
curl -sf http://localhost:18001/health
```
