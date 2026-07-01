# FF3Analytics

Self-hosted analytics UI for a personal [Firefly III](https://www.firefly-iii.org/) instance. Pick a date range and explore spending trends, Sankey flows, month-over-month variance, and transaction drilldowns.

Release notes: [CHANGELOG.md](CHANGELOG.md)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2
- A running Firefly III instance with API access
- Optional: [jq](https://jqlang.github.io/jq/) for JSON checks in `scripts/verify-foundation.sh` (falls back to `python3`)

## Ports (host)

| Service  | Host port | Container | Notes |
|----------|-----------|-----------|-------|
| Backend  | 18001     | 8000      | Direct API access (optional; CORS-restricted) |
| Frontend | 5174      | 80        | Production nginx static SPA + `/api` proxy |

## Configuration

Copy `.env.example` to `.env` and fill in values. **Never commit `.env`** — the Firefly token stays server-side only.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIREFLY_BASE_URL` | Yes | — | Base URL of your Firefly III instance (trailing slash optional) |
| `FIREFLY_API_TOKEN` | Yes | — | Personal access token from Firefly III (see below) |
| `CORS_ALLOWED_ORIGINS` | No | localhost dev fallback | Comma-separated browser origins allowed to call the API directly on `:18001` |
| `GITHUB_OWNER` | No | `jwposton` | GitHub org/user for ghcr.io image pulls |
| `FF3ANALYTICS_TAG` | No | `latest` | Image tag when pulling pre-built images from ghcr.io |
| `FF3ANALYTICS_DATA_PATH` | No | `./data` | Host directory bind-mounted for the SQLite sidecar (`ff3analytics.db` at `{path}/ff3analytics.db`) |
| `PUID` / `PGID` | No | `1000` / `1000` | UID/GID the backend container runs as; sidecar files are created with this ownership |
| `FIREFLY_REFERENCE_CACHE_TTL_SECONDS` | No | `7200` (2h) | In-process cache TTL for Firefly accounts, categories, and budgets |

The backend image sets `FF3ANALYTICS_DATA_DIR=/data` internally; compose only configures the host bind mount via `FF3ANALYTICS_DATA_PATH`.

### Firefly personal access token

1. Sign in to Firefly III as a user with access to the data you want to analyze.
2. Open **Profile** (top-right) → **OAuth** → **Personal access tokens**.
3. Create a token with a descriptive name (e.g. `ff3analytics`).
4. Copy the token immediately — Firefly shows it only once.
5. Paste into `.env` as `FIREFLY_API_TOKEN`.

Set `FIREFLY_BASE_URL` to your Firefly instance URL, e.g. `https://firefly.example.com`.

**Production deep links:** Sankey and transaction links use `firefly_base_url` returned by the API at runtime from `FIREFLY_BASE_URL`. No frontend build-time `VITE_FIREFLY_BASE_URL` is required in production.

### Automation environment variables

Used by AI categorization and loan split features (v1.1+). See [Automations](#automations) below.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | No | — | OpenRouter API key for AI suggest; when empty, queue is read-only |
| `OPENROUTER_MODEL` | No | `openai/gpt-4o-mini` | Model id sent to OpenRouter for categorization |
| `FF3ANALYTICS_RULE_GROUP` | No | `FF3Analytics AI` | Firefly rule group title for user-approved AI rules |
| `FF3ANALYTICS_AI_TAG` | No | `ai-categorized` | Tag applied on direct apply and AI-created rules |
| `FF3ANALYTICS_LOAN_SPLITS_SINCE` | No | — | Forward-only start date for loan split queue (`YYYY-MM-DD`) |
| `FF3ANALYTICS_LOAN_TAG` | No | `loan-split` | Tag applied after loan split apply |

## Automations

FF3Analytics **proposes** categorizations and loan splits; **you approve** every write. Firefly III remains the system of record — nothing is written without an explicit click in the Manage UI.

### Manage routes

| Route | Purpose |
|-------|---------|
| `/manage/categorize` | Uncategorized queue, AI suggest, direct category apply, or graduate to a Firefly rule |
| `/manage/loans` | Loan profile editor and payment split review queue |

### Approval workflow

- **No autonomous writes** — OpenRouter and rule engines only suggest; apply/create endpoints run after user action.
- When `OPENROUTER_API_KEY` is missing, the categorize queue still loads but **Suggest** is hidden (read-only).
- Direct apply updates one transaction (`PUT` via Firefly API) and tags it with `FF3ANALYTICS_AI_TAG`.
- **Rule graduation:** edit title and `description_contains`, run **Preview matches** to see test-hit counts, then **Create rule**. Rules are created in `FF3ANALYTICS_RULE_GROUP` with category, optional budget, and the AI tag action.
- **Backfill is opt-in, default off** — a checkbox applies the rule to existing transactions in the selected date range via a separate trigger call only after you check it.
- Loan splits apply forward from `FF3ANALYTICS_LOAN_SPLITS_SINCE`; loan profiles live in Firefly account notes (no sidecar profile DB).

### Health

`GET /health` reports `openrouter_configured` and `sidecar_writable` so operators can verify automation prerequisites without opening the UI.

### Design references

- [AI-assisted categorization & rules](docs/features/ai-categorization.md)
- [Loan & mortgage payment split automation](docs/features/loan-payment-splits.md)

## Quick start (standalone)

Works on a LAN or VPN with no reverse proxy — one URL serves the UI and proxied API.

```bash
cp .env.example .env
# edit .env with FIREFLY_BASE_URL and FIREFLY_API_TOKEN

mkdir -p data
chown "${PUID:-1000}:${PGID:-1000}" data   # match PUID/PGID in .env if you change them

docker compose up -d --build
curl -sf http://localhost:18001/health
curl -sf http://localhost:5174/health
```

Open http://localhost:5174 in a browser.

The frontend container serves a static build and proxies `/api` and `/health` to the backend. HTTPS is not required for VPN-only access; use HTTP on the host port.

## Local development (Vite hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This overlay swaps the production nginx image for the Vite dev server on port 5174.

## Release deployment (pre-built images)

Multi-arch images (`linux/amd64`, `linux/arm64`) publish to GitHub Container Registry when a `v*` tag is pushed (see `.github/workflows/publish.yml`):

```text
ghcr.io/<your-github-user>/ff3analytics-backend:1.0.0
ghcr.io/<your-github-user>/ff3analytics-frontend:1.0.0
```

Pull and run without a local build:

```bash
cp .env.example .env
# edit .env

export GITHUB_OWNER=your-github-user
export FF3ANALYTICS_TAG=1.0.0   # or latest

docker compose pull
docker compose up -d
```

After the first publish, set each package to **Public** under GitHub → Packages if anonymous pulls fail.

Ensure the repository has **Actions → Workflow permissions → Read and write packages** enabled for `GITHUB_TOKEN`.

## Behind a reverse proxy (nginx, SWAG, Caddy)

The same images work behind an external reverse proxy with TLS and optional auth (e.g. Authelia).

**Option A — path split at the edge (recommended when you already run SWAG/nginx):**

```nginx
location /api/ {
    proxy_pass http://backend:8000;
}
location / {
    proxy_pass http://frontend:80;
}
```

**Option B — single upstream to frontend:** point the edge proxy at the frontend container only; in-container nginx proxies `/api` to the backend.

In both cases:

- Terminate TLS at the edge proxy, not inside the app containers.
- Set `CORS_ALLOWED_ORIGINS=https://analytics.example.com` in `.env` if browsers may hit the backend directly on `:18001`.
- Do not publish backend/frontend ports to the public internet unless intentional.

## Backend tests

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
FF3ANALYTICS_DATA_DIR=./data pytest tests/ -q
```

Local `uvicorn` (outside Docker) also uses `./data` unless you set `FF3ANALYTICS_DATA_DIR`.

## Verification

```bash
bash scripts/verify-foundation.sh
```

Runs prod-default `docker compose up -d --build`, waits for backend health (`:18001/health`) and proxied frontend health (`:5174/health`), checks proxied API returns 422 without query params, verifies SPA deep links, ensures responses do not leak `FIREFLY_API_TOKEN`, then tears down.

## Troubleshooting

### CORS errors in the browser

- Symptom: API calls fail from the browser with CORS policy errors when using direct backend access on `:18001`.
- Fix: Add your browser origin to `CORS_ALLOWED_ORIGINS` in `.env`, e.g. `https://analytics.example.com,http://localhost:5174`. Restart the backend container.

### Empty charts or no data

- Confirm `FIREFLY_API_TOKEN` is set and valid (regenerate in Firefly if unsure).
- Confirm `FIREFLY_BASE_URL` has no typo and matches your Firefly instance URL.
- Widen the date range — some reports need transactions in the selected period.
- Check backend logs: `docker compose logs backend`.

### Health check failures

- Backend: `curl -sf http://localhost:18001/health` should return `{"status":"ok",...}`.
- Frontend (proxied): `curl -sf http://localhost:5174/health` should return the same JSON via nginx.
- If containers fail to start: `docker compose logs` and confirm ports 18001 and 5174 are free.

### Token misconfiguration

- `FIREFLY_API_TOKEN` must be the raw token string, not wrapped in quotes with extra whitespace.
- `FIREFLY_BASE_URL` should be the Firefly **web** URL (e.g. `https://firefly.example.com`), not the API path.
- Never commit `.env` or paste tokens into issue trackers.

## Icon attributions

Navigation icons from [The Noun Project](https://thenounproject.com/) (CC BY 3.0):

| Icon | Creator | Used for |
|------|---------|----------|
| [Sankey Chart](https://thenounproject.com/browse/icons/term/sankey-chart/) | Kirby Wu | Sankey report nav |
| [age picture diagram](https://thenounproject.com/browse/icons/term/age-picture-diagram/) | birdpeople | Variance report nav |

Other sidebar icons are from [Lucide](https://lucide.dev/). See the in-app **About** page (`/about`) for live previews and links.
