# FF3 Lantern public demo (#102)

Infra lives in this repo. **Demo data stays on the host** — never commit it.

## Host data directory

Create a directory outside git (example: `~/ff3lantern-demo-data/`):

| File | Required | Purpose |
|------|----------|---------|
| `ff3lantern.db` | yes | Sanitized Lantern sidecar |
| `firefly-export.sanitized.json` | yes* | Firefly seed (API import + sidecar ID remap) |
| `firefly.dump` | optional | `pg_dump -Fc` — faster, preserves Firefly IDs (sidecar copy as-is) |

\*Not needed if you only use `firefly.dump`.

Generate the bundle with the private **[ff3lantern-demo-tools](https://github.com/jwposton/ff3lantern-demo-tools)** repo, then copy to the server for VPS deploy.

```bash
# in ~/HarvestWind/selfhosted/ff3lantern-demo-tools
python3 sanitize-demo-data.py --output-dir ~/ff3lantern-demo-data
```

## Local demo (one command)

```bash
chmod +x demo/demo-up.sh demo/seed/bootstrap-demo.sh

DEMO_DATA_DIR=~/ff3lantern-demo-data ./demo/demo-up.sh
```

Open **http://127.0.0.1:8080** (Lantern UI). Demo compose pins **today** to **July 5, 2026** via `FF3LANTERN_DEMO_ANCHOR_DATE` — no need to regenerate dates on the server.

First boot imports ~2.6k transactions via Firefly API and remaps sidecar bill/account IDs. Expect several minutes. Later starts reuse Docker volumes (`demo/.runtime/.demo-seeded`).

Re-import from scratch:

```bash
./demo/demo-up.sh --reset
```

## VPS deploy

1. Install Docker on the host.
2. Clone this repo (infra only).
3. Copy `~/ff3lantern-demo-data/*` to the VPS (scp/rsync).
4. Run the same `demo-up.sh` on the VPS.
5. Put Caddy/nginx in front of **port 8080** (frontend only). Do not expose Firefly (8088).

| Item | Guidance |
|------|----------|
| **Shape** | Oracle Cloud Free Tier ARM Ampere A1: 2–4 OCPU, 8–12 GB RAM (avoid 1 GB AMD micro) |
| **DNS** | `demo.<your-domain>` → VPS public IP |
| **TLS** | External Caddy or nginx (Let’s Encrypt); not bundled in compose |
| **Updates** | `git pull && docker compose pull && ./demo/demo-up.sh` on release tag |
| **Isolation** | Separate domain from homelab; do not expose Firefly or backend API publicly |

## MVP scope (#102)

Shipped in **PR #105**:

- `demo/docker-compose.demo.yml` + `demo-up.sh` (host-supplied sanitized data)
- Firefly bootstrap: service PAT + browser demo user (`demo` role, no admin)
- Demo anchor clock (`FF3LANTERN_DEMO_ANCHOR_DATE`) and UI banner
- Firefly deep links via `FF3LANTERN_FIREFLY_PUBLIC_URL` (Firefly bound to localhost)
- Sanitization pipeline in **[ff3lantern-demo-tools](https://github.com/jwposton/ff3lantern-demo-tools)** (private repo; no PII in git)
- Nightly reset docs (static bundle + `demo-up.sh --reset`)

Deferred to epic **#101** follow-up:

- `FF3LANTERN_DEMO_MODE` read-only API + write UI disabled
- Caddy service in compose (operators use external reverse proxy today)
- Committed baked artifacts in `demo/` (host `DEMO_DATA_DIR` replaces this)

## Faster Firefly seed (optional)

If JSON import is too slow, create a Postgres dump once after a successful local import:

```bash
docker compose -f demo/docker-compose.demo.yml exec -T db \
  pg_dump -U firefly -Fc firefly > ~/ff3lantern-demo-data/firefly.dump
```

Future runs with `firefly.dump` skip API import and copy `ff3lantern.db` unchanged.

## Gitignored paths

- `demo-secrets/` — default local data dir
- `demo/.runtime/` — Lantern sidecar volume bind mount
- `demo/.env.demo` — generated Firefly token

## Firefly credentials

Bootstrap creates **two** Firefly users on first empty DB:

| Account | Email | Password | Purpose |
|---------|-------|----------|---------|
| **Service** (Lantern API) | `lantern-service@ff3lantern.internal` | random (not published) | Owner; personal access token written to `demo/.env.demo` |
| **Browser demo** | `demo@demo.ts` | `password123` | Demo role — create/edit transactions, no Firefly admin |

The browser user is added to the service user’s financial group with transaction rights so **Open in Firefly** deep links show the same demo data.

Lantern **Open in Firefly** links use `FF3LANTERN_FIREFLY_PUBLIC_URL` (default `http://127.0.0.1:8088`). Sign in with the **browser demo** row above. Lantern never exposes the service account password or token in the UI.

On a VPS with Firefly behind a public path, set `FF3LANTERN_FIREFLY_PUBLIC_URL` (e.g. `https://demo.example.com/firefly`) in compose or `/etc/ff3lantern-demo.env`.

Override before bootstrap: `DEMO_FIREFLY_SERVICE_EMAIL`, `DEMO_FIREFLY_EMAIL`, `DEMO_FIREFLY_PASSWORD`.

## Demo clock

`docker-compose.demo.yml` sets `FF3LANTERN_DEMO_ANCHOR_DATE=2026-07-05` on the **Lantern backend only**. The app treats that as “today” (worksheet month, due-date alerts, date pickers). Host OS time, Firefly, and Postgres are **not** changed — only Lantern’s logic reads the env var.

## Nightly reset (VPS)

Public demo users can mutate Firefly/sidecar data. Nightly job: **`demo-up.sh --reset`** against the **static** sanitized bundle (no re-sanitize). See **[ff3lantern-demo-tools](https://github.com/jwposton/ff3lantern-demo-tools)** for systemd timer setup.

## Integration tests (#103)

CI uses `demo/docker-compose.integration.yml` with synthetic data — not this demo bundle.
