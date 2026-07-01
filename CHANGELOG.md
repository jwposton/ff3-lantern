# Changelog

All notable changes to FF3Analytics are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/jwposton/FF3Analytics/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/jwposton/FF3Analytics/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/jwposton/FF3Analytics/releases/tag/v1.0.0
