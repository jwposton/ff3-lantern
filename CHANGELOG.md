# Changelog

All notable changes to FF3Analytics are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-07-01

Firefly write automations: AI categorization and loan payment splits, with a Manage section in the sidebar.

### Added

- **Manage navigation** — Sidebar group with Categorize and Loans links and pending-queue count badges
- **AI categorization queue** (`/manage/categorize`) — Uncategorized transaction review, OpenRouter suggest, direct category apply, and rule graduation with preview/create/backfill
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

[Unreleased]: https://github.com/jwposton/FF3Analytics/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/jwposton/FF3Analytics/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/jwposton/FF3Analytics/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/jwposton/FF3Analytics/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/jwposton/FF3Analytics/releases/tag/v1.0.0
