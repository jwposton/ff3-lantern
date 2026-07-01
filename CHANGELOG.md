# Changelog

All notable changes to FF3Analytics are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.9] - 2026-07-01

### Fixed

- **Categorize queue scope** — Pending queue includes withdrawals missing a category, a budget, or both (aligns with dashboard “Uncategorized” budget bucket)

### Changed

- **Categorize page copy** — Queue and empty state refer to missing category or budget, not category alone

## [1.1.8] - 2026-07-01

### Added

- **MoM variance data tables** — Budget × month numeric tables below Compare and Trend charts on Spending and Cash Flow variance pages; drilldown shows category rows for the selected budget
- **MoM compare table columns** — vs Average adds a rolling mean/median summary column; vs Month shows the two selected months plus a Δ column
- **MoM trend table** — Month-over-month delta columns with red/green intensity heatmap
- **Chart zebra striping** — Alternating band backgrounds on MoM and other bar/line charts for easier row tracking
- **Firefly reference data cache** — In-process 2h TTL cache for accounts, categories, and budgets; reduces repeated Firefly API calls on transaction and meta endpoints (`FIREFLY_REFERENCE_CACHE_TTL_SECONDS` override)
- **Clear reference cache** — Refresh icon in the global date bar calls `POST /api/cache/clear` and refreshes normalized transactions, categorize meta, and loan meta
- **Dashboard budget pie chart legend** — Fixed vertical legend listing all slices (top 15 + Other) with budget name and % share; complements exterior labels on larger slices
- **Categorize destination rule triggers** — Payee rules support contains, starts with, ends with, and exact match; preview counts, Firefly rule creation, and duplicate detection honor the selected match type (closes #6)
- **Categorize rule group bootstrap** — Auto-creates the `FF3ANALYTICS_RULE_GROUP` rule group in Firefly when missing so rule creation does not fail with “No such rule group”

### Fixed

- **Categorize rule backfill** — Firefly 6.5+ requires `Content-Type` on rule trigger POST; send empty JSON body with date query params so backfill no longer fails with HTTP 415; UI surfaces Firefly error text instead of a bare status code

### Changed

- **MoM variance date scope** — Spending and Cash Flow variance reports use their own date range; the global date filter no longer applies there
- **MoM variance controls** — Compare vs Month restores independent Month A / Month B pickers for direct two-month comparison; Trend vs Month uses To month + Range for sequential month-over-month deltas
- **Table readability** — Shared table component uses zebra row striping and muted sticky headers (including transaction list)
- **Dashboard budget charts** — Click a pie slice or bar row to drill into Spending Bar scoped to that budget and the dashboard date range; uncategorized budgets route to the categorize queue (same pattern as MoM/Sankey)

## [1.1.7] - 2026-07-01

### Added

- **Favicon** — Custom FF3Analytics icon (three-bar chart motif using app chart colors)

### Changed

- **Dashboard budget pie chart** — Solid full pie (top 15 + Other), taller layout, exterior labels on slices ≥5% share, no scroll legend
- **Dashboard budget bar chart** — Top 15 budgets, tooltip-only values, legend and grid spacing tweaks

## [1.1.6] - 2026-07-01

### Added

- **Dashboard budget charts** — Pie chart of spending by budget (top 20) for the selected date range; horizontal bar chart comparing current-month spend to the 12-month rolling average per budget (reuses MoM variance rolling-average logic)

### Changed

- **CI** — Bump GitHub Actions to Node.js 24 runtimes (`checkout@v5`, `setup-python@v6`, `setup-node@v6`, Docker actions v4/v7)

## [1.1.5] - 2026-07-01

### Fixed

- **Categorize direct apply tag** — `FF3ANALYTICS_AI_TAG` is written on the Firefly journal line in `transactions[]`; previously sent at the wrong PUT level and was silently ignored

## [1.1.4] - 2026-07-01

### Fixed

- **CI / production build** — Import `RuleDraft` type in `CategorizePage` (TypeScript build failed in Docker)
- **CI** — Run `npm run build` before publishing frontend images

## [1.1.3] - 2026-07-01

### Changed

- **AI suggest context** — Removed Firefly rule titles from the OpenRouter prompt; suggestions use transaction fields, category/budget allowlists, and few-shot categorized history only
- **Rule editor** — Destination account (payee), transaction type, and bank description context; triggers can combine description and payee (AND logic)
- **AI rule drafts** — Normalize titles to `{Merchant} → {Category}`; prefer payee trigger when bank description is generic (`POS PURCHASE`, etc.)

### Fixed

- **Create rule 502** — Firefly rule trigger backfill uses query params (`start`/`end`) and accepts HTTP 204; readable Firefly error messages on failure
- **Rule create payload** — `active: true` on triggers/actions, `strict` when multiple triggers, duplicate title detection
- **Rule duplicate detection** — Destination account triggers included in overlap checks

## [1.1.2] - 2026-07-01

### Changed

- **Sidecar data path** — Backend image sets `FF3ANALYTICS_DATA_DIR=/data`; deploys only configure the host bind mount (`FF3ANALYTICS_DATA_PATH`)
- **Frontend nginx** — Re-resolves `backend` via Docker DNS on each proxy request (no stale IP after backend recreate)
- **Compose** — Backend healthcheck; frontend starts after backend is healthy

### Fixed

- **Pull-only deploy crash** — Backend without `FF3ANALYTICS_DATA_DIR` defaulted to `./data` in `/app` and failed with permission denied instead of using the `/data` volume
- **502 after upgrade** — nginx proxied to a cached backend container IP after `docker compose up`

## [1.1.1] - 2026-07-01

### Changed

- **Backend container user** — Runs as configurable `PUID`/`PGID` (default `1000:1000`); SQLite sidecar files are created with matching ownership
- **SQLite sidecar storage** — Host bind mount via `FF3ANALYTICS_DATA_PATH` (default `./data`) replaces the named Docker volume
- **Compose data path** — `FF3ANALYTICS_DATA_DIR` is fixed at `/data` in `docker-compose.yml` (not set via `.env`) so it cannot drift from the bind mount target

### Fixed

- **v1.1.0 sidecar permissions** — Backend image ran as root, so bind-mounted `ff3analytics.db` was created `root:root`

## [1.1.0] - 2026-07-01

Firefly write automations: AI categorization and loan payment splits, with a Manage section in the sidebar.

### Added

- **Manage navigation** — Sidebar group with Categorize and Loans links and pending-queue count badges
- **AI categorization queue** (`/manage/categorize`) — Uncategorized withdrawal review, OpenRouter suggest, direct category apply, and rule graduation with preview/create/backfill
- **Categorization APIs** — Pending queue, meta, suggest, apply, grouped-by-fingerprint queue, and Firefly rule preview/create/trigger endpoints
- **Loan profiles** (`/manage/loans`) — Profile editor on Firefly liability accounts (match fingerprint, principal/interest/escrow destinations, categories, budgets); link to the Firefly account page in the header
- **Loan split queue** (`/manage/loans/queue`) — Forward-only pending payment splits with amortization preview, editable amounts, and apply
- **Loan APIs** — Profile CRUD, `/api/loans/meta` reference data, pending split queue, preview, and apply
- **SQLite sidecar** — Suggestion cache and audit log (`FF3ANALYTICS_DATA_DIR`)
- **Firefly write path** — Transaction and account updates with split preservation, `apply_rules: false`, and loan profiles embedded in account notes
- **Deep links** — Open in Firefly on queue cards; `buildFireflyAccountUrl` and `buildFireflyTransactionUrl` helpers
- **Sankey integration** — Uncategorized nodes route to the categorize queue instead of Firefly search
- **Report cache invalidation** — Charts and Transaction Explorer refresh after automation apply
- **Health** — `openrouter_configured` and `sidecar_writable` on `/health`
- **README** — Automations section and environment variable table for v1.1 features

### Changed

- **Loan split apply** — Sends positive split amounts, uses a uniform transaction type per group (`match.type`), and includes `group_title` when splitting into multiple lines (Firefly API requirements)
- **Loan profile validation** — `match.type` (`transfer` or `withdrawal`); all split components must use the same type; escrow destination optional when escrow amount is zero
- **Loan profile editor** — Category/budget/account pickers from meta API; match type syncs component types; omits read-only `rate_override` on save
- **Loan profile notes parsing** — Brace-balanced JSON extraction so operator notes with stray `}` characters do not break profiles
- **Categorize queue** — Pending queue includes uncategorized withdrawals only; deposits are ignored
- **Categorize suggest** — Preloads Firefly context once per batch, runs OpenRouter calls concurrently, and requests five journals per UI call; nginx proxy timeout raised to 300s
- **Categorize rule graduation** — Rule `transaction_type` taken from the queue row when the AI omits it; backfill failures surface without dismissing the card
- **Cached AI suggestions** — Revalidated against current category/budget allowlists before reuse
- **Apply errors** — Loan split apply shows Firefly error detail from the API response
- **Sidebar badges** — Queue counts align on the same line as Categorize and Loans labels

### Fixed

- **Loans sidebar link** — Points to the split review queue (`/manage/loans/queue`)
- **Firefly queue links** — Use transaction group `journal_id` (not split journal id)
- **Rule duplicate detection** — Short rule titles no longer false-positive when they are only a substring of the draft needle
- **Loan split queue** — Skips payments where amortization would produce a negative principal
- **OpenRouter client** — Retries only on transport errors, not validation failures
- **OpenRouter suggest schema** — Strict JSON schema includes `transaction_type` on rule objects (fixes 400 errors on every suggest)
- **Sidecar writability probe** — Treats any init failure as non-writable

## [1.0.2] - 2026-07-01

### Changed

- **CI:** Native split-matrix Docker builds (`ubuntu-latest` amd64 + `ubuntu-24.04-arm` arm64) without QEMU emulation; manifests merged via `buildx imagetools`

## [1.0.1] - 2026-07-01

### Added

- **CHANGELOG.md** — release history (Keep a Changelog format)
- **Version badge** — `v1.0.1` in sidebar footer and About page (from `package.json` at build time)

## [1.0.0] - 2026-07-01

First stable release: self-hosted Firefly III analytics with production Docker deployment.

### Added

- **Foundation:** Docker Compose stack, FastAPI backend, React + Vite frontend, health checks
- **Data pipeline:** Firefly III normalized transactions API (`/api/normalized_transactions`)
- **Analytics shell:** Global date picker, sidebar navigation, dashboard layout
- **Transaction Explorer:** Filterable transaction table with Firefly deep links
- **Spending reports:** Bar charts with category drilldown, line/trend views, stacked cash-flow trends
- **Sankey flows:** Spending and cash-flow Sankey diagrams with top-N grouping and drilldown
- **Month-over-month variance:** Trend and compare tabs for spending and cash-flow families, synced budget→category drill
- **Production polish:** Env-driven CORS (no wildcard), nginx static frontend with `/api` proxy, dev Compose overlay for Vite hot reload
- **CI/CD:** GitHub Actions publish to ghcr.io (`ff3analytics-backend`, `ff3analytics-frontend`) on `v*` tags
- **Ops docs:** README with env table, Firefly PAT walkthrough, standalone and reverse-proxy deployment, troubleshooting
- **About page:** Icon attributions (Noun Project + Lucide)

### Security

- Firefly API token stays server-side only; CORS restricted to configured origins

[Unreleased]: https://github.com/jwposton/FF3Analytics/compare/v1.1.9...HEAD
[1.1.9]: https://github.com/jwposton/FF3Analytics/compare/v1.1.8...v1.1.9
[1.1.8]: https://github.com/jwposton/FF3Analytics/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/jwposton/FF3Analytics/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/jwposton/FF3Analytics/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/jwposton/FF3Analytics/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/jwposton/FF3Analytics/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/jwposton/FF3Analytics/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/jwposton/FF3Analytics/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/jwposton/FF3Analytics/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/jwposton/FF3Analytics/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/jwposton/FF3Analytics/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/jwposton/FF3Analytics/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/jwposton/FF3Analytics/releases/tag/v1.0.0
