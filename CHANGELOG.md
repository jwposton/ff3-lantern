# Changelog

All notable changes to FF3 Lantern are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Income line on bar charts** — Spending and Cash Flow bar reports show a green monthly Income line (bank inflows) with legend toggle and tooltip; drilldown charts unchanged (#48)

### Changed

- **Sidebar Lantern toggle** — clicking the FF3 Lantern icon expands or collapses the sidebar; the collapsed icon is larger for easier targeting (#49)

## [2.3.0] - 2026-07-05

### Added

- **Worksheet grand total breakdowns** — footer uses two cards: **Balances owed** (liabilities with real estate/loans, revolving CC) and **Due & planned** with collapsible **Cash (bank)** and **Credit card** groups; each group shows liabilities, bills, and credit card pmts on the same rail (#76)

### Changed

- **Worksheet grand total footer** — collapsible parent rows; all-zero child lines hidden (#76)
- **Bill registration (Link existing)** — empty state no longer shows redundant helper text above the “no bills found” message (#46)
- **Payment worksheet copy** — renamed Payment rail → Paid from, Pmt Src → Pay from, and Bucket/Funding bucket → Cash account / Account across worksheet surfaces (#47)

## [2.2.0] - 2026-07-05

### Added

- **Bill groups hub** — manage groups and membership at /manage/payment-run/bill-groups (#45)
- **Payment setup** — Bill groups card on setup landing (#45)
- **Bill registration** — optional group picker and Show in group on Bills hub and Discover (#45)
- **Expandable bill groups on worksheet** — Bills table shows collapsible group rollup rows with aggregated due/planned; members hidden from group stay in ungrouped section (#44)
- **Worksheet bill groups metadata** — GET payment-run worksheet includes `bill_groups[]` and per-row `bill_group_id` / `show_in_group` for registry-backed bills and bill-liabilities (#43)
- **Bill groups API** — CRUD at /payment-run/bill-groups with registry bill_group_id and show_in_group fields on bill register and update (#42)

### Changed

- **Payment worksheet** — group parent rows link to Bill groups hub for structural edits (#45)
- **Worksheet inline edit** — pencil on bill, card, and liability rows opens that item's sheet on the worksheet so you stay on the plan view after saving (#74)
- **Bill group assignment** — rejects members from a different worksheet section than existing group members (Bills vs Liabilities) (#43)

### Fixed

- **Bill discover adopt** — semi-monthly usage billing (e.g. Backblaze) no longer prefills invalid repeat frequencies that Firefly rejects with 422
- **Bill discover monthly prefill** — recurring monthly suggestions pre-fill equal min/max from the trailing 3-month average of total cluster spend per month (#73)
- **Worksheet bill amount due** — recurring bills use the same trailing 3-month average of linked payments on refresh; falls back to Firefly min/max when no history exists (#73)
- **Bill group validation** — fails when a group member references a missing registry row (#43)
- **Bill groups PATCH** — explicit `member_ids: null` returns 422 instead of HTTP 500 (#42)
- **Bill group assignment** — empty `bill_group_id` strings are cleared instead of stored as invalid references (#42)
- **Bill registry update** — bills with dormant `show_in_group` after group removal or delete can be edited again without clearing the visibility flag (#42)
- **Budget vs 12-month average tile** — credit card charges (interest, purchases) now count toward the bar chart using the same spending definition as the pie chart (#57)
- **Variance detail table** — sticky budget column stays opaque and matches row striping while scrolling horizontally (#56)
- **Transaction Explorer filters** — filter panel scrolls with the page instead of staying pinned (#38)
- **Bill edit registration** — editing a registered bill pre-fills amount min/max from Firefly and saves amount changes back to the linked bill (#40)

### Removed

- **Transaction Explorer AI filter** — removed the natural-language “Describe what you're looking for…” panel, `POST /api/transactions/parse-filter`, and `OPENROUTER_FILTER_MODEL`; manual and Advanced filters unchanged (#39)

## [2.1.1] - 2026-07-04

### Added

- **Bill history registration** — Bills page lets you link an existing Firefly bill or register a new one from the header or empty state, using the same registration wizard as discover and the payment worksheet
- **Payment setup landing** — `/manage/payment-run/setup` is an overview with summary cards and punch-outs to Bills, Cash buckets, Credit cards, and Liabilities hubs (replaces the buried Configure worksheet sheet)
- **Domain hub routes** — full management for cash buckets (`/manage/payment-run/buckets`), credit cards (`/manage/payment-run/cards`), and liability accounts (`/manage/liabilities`)

### Changed

- **Payment worksheet demotion** — worksheet is plan-only: inline planned/paid/balances stay; bill registration, configure sheet, and structural edit pencils are removed in favor of links to domain hubs and Payment setup
- **Sidebar** — **Payment setup** nav entry when payment worksheet is enabled; worksheet header button renamed from Configure worksheet to Payment setup

### Fixed

- **Bill summary stats window** — 12-month total and averages on the Bills page keep last year's same-month payment until this month's bill posts; after it posts, stats roll forward and drop the oldest month

## [2.1.0] - 2026-07-04

### Added

- **Bill discover transaction drill-down** — expand a suggestion row on the discover page to audit underlying withdrawal transactions (date, amount, description, category, payee, budget) before Adopt; chevron expand is separate from Adopt; respects active lookback window
- **Bill discover ignored categories** — operators choose expense categories to skip on the discover page; new installs seed common dining/travel categories (not Entertainment — subscriptions may live there); settings persist in the sidecar
- **Bill discover page** — Find recurring bill suggestions at `/manage/payment-run/discover` when payment worksheet is enabled; adopt suggestions into registration wizard
- **Bill suggestions API** — GET /payment-run/bill-suggestions analyzes withdrawal history and returns ranked bill candidates with wizard prefill (requires payment worksheet enabled)
- **Opaque payee splitter** — PreApproved clusters split into separate bill suggestions per category+amount sub-group; discover groups rows by payee and shows category + payee detail on each bill row

### Changed

- **Bill discover fuzzy payee merge** — recurring charges with the same category and amount merge across landlord/payee renames in noisy categories; near-match payee strings (LLC/Inc variants) also collapse to one suggestion
- **Bill discover grouping** — suggestions group by Firefly payee instead of hardcoded audit buckets (Streaming & Media, etc.); discretionary category exclusions are operator-managed on the discover page instead of a built-in blocklist

### Fixed

- **Bill discover billing-anchor streams** — semi-monthly payees with stable calendar anchors (e.g. Comcast ~3rd and ~20th) merge rate increases within each stream instead of splitting into historical amount tiers
- **Bill discover drill-down polish** — withdrawal count subtitle matches loaded table rows (not unique charge dates); mini-table rows use separators for easier scanning
- **Bill discover drill-down cache** — changing ignored categories now collapses expanded rows and clears cached withdrawal lists so drill-down matches the refreshed suggestion set
- **Bill discover expand chevron** — rows can be collapsed while withdrawal transactions are still loading — semi-monthly billing on stable calendar anchor days (e.g. Backblaze on ~12 and ~19) is recognized as cyclical, not restaurant-style visits; no longer bypassed by category name guesses
- **Bill discover SaaS and hosting gaps** — usage-metered charges with a few line items per month (Cursor) and annual hosting with two renewals in lookback (Ionos) use timing stats, not extra category markers
- **Bill discover stale subscription links** — withdrawals linked to deleted Firefly bills/subscriptions (ghost `subscription_id` on journals) are analyzed again instead of being silently skipped
- **Bill discover sidecar migration** — existing databases without `defaults_version` on `discover_settings` no longer crash backend startup during seed insert
- **Opaque payee two-hit sub-split** — PreApproved clusters that trigger on two category+amount fingerprints with two charges each now emit separate suggestions instead of an empty list
- **Bill discover UX** — registration success no longer shows an error when cache refresh fails; period dates use local calendar days; suggestion count respects hide-review; invalid lookback URLs normalize; credit-card adopt prefill picks the matching card; registration sheet cannot dismiss mid-save
- **Bill suggestions opaque payee detection** — subscriptions with varying amounts (e.g. Spotify price changes) are no longer misclassified as combined Apple Services rows
- **Bill suggestions irregular cadence prefill** — irregular-frequency candidates use intermittent amount mode without a misleading monthly repeat frequency
- **Bill suggestions category noise filter** — blocklist matching now catches common category variants (e.g. Restaurant, Gasoline) not just exact Firefly names
- **Bill suggestions lookback validation** — direct callers of the suggestion engine reject lookback values other than 6, 12, or 24 months
- **Bills page refresh** — Bills list updates after registering from discover or worksheet; Bills page header adds Refresh control
- **Bills page Refresh layout** — header Refresh control no longer shifts layout when refetching
- **Bill registration rule trigger** — registering a bill or subscription now automatically runs the Firefly link rule over the last 12 months so historical withdrawals link without manual rule execution
- **Bill discover adopt prefill** — opaque sub-group rows now prefill exact amount in the registration wizard when the charge is a stable monthly subscription (within 5% amount variance)
- **Opaque payee discover labels** — payee headers prefer canonical tokens from withdrawal descriptions (e.g. `APPLE.COM/BILL`); junk description tokens like `DEAD` no longer override the Firefly payee name

## [2.0.0] - 2026-07-03

### Changed

- **Product rename** — FF3Analytics is now **FF3 Lantern** with tagline *Self-hosted companion for Firefly III — reports, categorization, and bill planning*; new flame favicon and sidebar mark
- **Environment variables** — all `FF3ANALYTICS_*` renamed to `FF3LANTERN_*` (hard cutover; no aliases)
- **Docker images** — publish as `ghcr.io/<owner>/ff3-lantern-{backend,frontend}`; compose service/container names updated
- **Sidecar database** — default filename `ff3lantern.db`; auto-renames legacy `ff3analytics.db` on startup when the new file is absent
- **Firefly note markers** — writers emit `ff3lantern:` markers; parsers still read legacy `ff3analytics:` markers
- **GitHub repository** — `jwposton/ff3-lantern` (see README upgrade guide for remote URL)

### Fixed

- **Collapsed sidebar mark** — flame icon centers in the icon-only rail; expand via the sidebar edge rail or open-state toggle

### Removed

- **`FF3ANALYTICS_*` configuration** — deployers must migrate `.env` to `FF3LANTERN_*` (see README **Upgrading from v1.x**)

## [1.2.0] - 2026-07-03

### Added

- **Bill history** — open `/manage/bills` from Manage sidebar to view 12-month payment history, monthly averages, and Firefly links for worksheet-registered bills
- **Bills** — Manage sidebar entry and routes at `/manage/bills` when the payment worksheet is enabled
- **Payment worksheet** — Monthly payment planning at `/manage/payment-run` (feature flag `FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED`): funding buckets with reported/user balances and planned outflows; credit card table with manual refresh, mark paid, shortfall banner, expandable activity drill-down (charges, interest, fees under **New**), and Details sheet (bucket, limit, due day, APR, default pay, exclude); bills and liabilities with cash-plan subtotals and grand total; inline editable planned/paid, bucket user balances, bill owed (month-only), and amount due; soft placeholders for unset planned and user-balance fields; **Configure worksheet** panel for cash buckets, bill registry, credit cards, and loans/liabilities (replaces the separate Payment setup sidebar entry; legacy `/manage/payment-run/setup` redirects)
- **Bill registration** — Register Firefly bills on the worksheet with matching rules in one confirmed action; create-new or link-existing wizard with payee/description/category triggers, amount min/max, object-group placement, and rollback on failure; link-existing reuses an existing rule when present
- **Credit card worksheet profiles** — Include-all-by-default from Firefly on refresh (`ccAsset` and `creditCard`); exclude and bucket assignment via Details or Configure; liability accounts stay out of the credit card table
- **Transaction Explorer mass edit** — Advanced filters (description, destination, type, exact amount, uncategorized only), row selection, and bulk category/budget updates via Firefly API
- **Transaction Explorer AI filters** — Optional natural-language filter parsing via OpenRouter (`OPENROUTER_FILTER_MODEL` overrides the categorize model when set)
- **Categorize → Explorer links** — Open in Explorer from the queue or each transaction card with pre-applied filters (transaction description/destination or rule triggers)
- **Categorize transaction description** — Optional description edit when saving a single transaction; field pre-fills with the Firefly bank description

### Changed

- **Bill history window** — fetches 12 complete months plus the current partial month so last year's same-month payment still appears when this month's rent has not posted yet; **12-month total and averages** use a rolling 12 months through the current month (drops the oldest fetched month so a paid current month counts and you still have 12 months when it does not)
- **App shell** — Global date picker only on routes where it drives page data; top header bar hidden elsewhere; sidebar collapse toggle in the sidebar header; **Clear cache** moved to sidebar footer (above About)
- **MoM variance** — Title, lens toggle, and month/compare controls pinned above scroll; charts and tables scroll underneath
- **Charts** — Spending/Cash Flow toggle on each chart page header; sidebar Charts lists types only (Bar, Line/Trend, Sankey, Variance)
- **Payment worksheet layout** — Compact header (description in help tooltip); funding bucket table sticks while title and actions scroll; bucket add/edit in Configure worksheet; linked accounts inline on bucket rows; section subtotals as single table rows; bill/liability names link to Firefly; Bills **Rail** renamed **Pmt Src**; liabilities columns reordered; credit cards sort by configured order with temporary header sort; actions column aligned across tables; loan/mortgage rows open a profile sheet from the Actions pencil
- **Payment worksheet bills** — Rows grouped cash monthly → cash intermittent → credit monthly → credit intermittent; Auto-draft, Manual, and Via card badges inline beside names
- **Payment worksheet credit cards** — Read-only balances with only Planned and Paid editable inline; paid rows use a light green background; card name links to Firefly; subtotal sums dollar columns with balance-weighted APR and utilization; narrow columns hide below xl; due dates red when overdue, unpaid, and no bank payment posted this month; activity sub-table aligned under dollar columns; **New** charge drill-down sorts by budget then category by default with clickable column headers
- **Transaction Explorer** — Shows all transaction types by default with optional **Bank spending only**; description column (sortable); general search across fields with OR terms; min/max amount filters; AI maps merchant keywords to search and supports combined amount + OR queries; dates as `YYYY-MM-DD` and amounts to two decimals app-wide (explorer, categorize, loan splits, rule preview)
- **Categorize** — Tighter transaction tiles; Transaction/Rule mode toggle; direct apply uses **Save**; rule preview as compact matching table; **Open in Explorer** button height matches row actions
- **Click affordance** — Pointer cursor on standard interactive controls

### Fixed

- **Payment worksheet refresh** — A stale registered bill missing in Firefly no longer aborts the entire refresh
- **Bill registration wizard** — Edit pencil opens existing row settings; link bill pre-selects the clicked Firefly bill; link-existing list refreshes from Firefly when opened; intermittent create without amount no longer fails Firefly validation; recurring **Owed** uses the average of min and max on refresh
- **Payment worksheet profiles** — Bucket assignment and exclude apply to the viewed month; bucket unassign clears assignment; ccAsset profile saves no longer send invalid liability fields back to Firefly
- **Funding buckets** — Only non–credit-card asset accounts (checking/savings) can be linked to a cash pool
- **AI filter parse** — Account allowlist for natural-language parsing no longer crashes when reading Firefly accounts

## [1.1.12] - 2026-07-02

### Added

- **Categorize rule amount trigger** — Optional exact amount on rule preview and create (Firefly `amount_exactly`); defaults to the transaction amount and can be cleared to match any amount

### Changed

- **Categorize rule description** — Defaults to the transaction bank description; editable before preview/create. AI still reads description and amount for category/budget suggestions but no longer outputs or modifies rule trigger fields
- **Categorize AI rule schema** — Removed `description_contains` and `amount` from the suggest response; the app pre-fills those from the transaction

### Fixed

- **CI build** — Restored editable description field handler removed when description was briefly read-only (TypeScript TS6133)

## [1.1.11] - 2026-07-01

### Added

- **Dashboard cash flow KPIs** — Income, net cash flow (bank in/out), and total spending (incl. credit card) for the current month and the selected date range
- **Dashboard selected-period pies** — Spending by budget and cash flow by budget charts follow the global date filter; pie drilldown routes to spending or cash flow reports

### Changed

- **Dashboard layout** — Split into **This month** (cash flow KPIs, spending pie, budget vs 12-month average) and **Selected period** (cash flow KPIs and budget pies for the global date range)
- **Dashboard tile headers** — Title and date-range subtitle on separate rows with consistent styling across KPI and chart cards

## [1.1.10] - 2026-07-01

### Added

- **Categorize ignore** — Ignore button tags a transaction with `categorize-ignore` (configurable via `FF3ANALYTICS_CATEGORIZE_IGNORE_TAG`) and removes it from the pending queue without assigning category or budget

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

[Unreleased]: https://github.com/jwposton/ff3-lantern/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/jwposton/ff3-lantern/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/jwposton/ff3-lantern/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/jwposton/ff3-lantern/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/jwposton/ff3-lantern/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/jwposton/ff3-lantern/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/jwposton/FF3Analytics/compare/v1.1.12...v1.2.0
[1.1.12]: https://github.com/jwposton/FF3Analytics/compare/v1.1.11...v1.1.12
[1.1.11]: https://github.com/jwposton/FF3Analytics/compare/v1.1.10...v1.1.11
[1.1.10]: https://github.com/jwposton/FF3Analytics/compare/v1.1.9...v1.1.10
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
