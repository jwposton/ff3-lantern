# Payment Worksheet (Bill Pay Planner)

**Status:** Phase A (MVP) shipped on `gsd/v1.2-payment-worksheet` — 2026-07-03  
**Captured:** 2026-07-03  
**App:** FF3 Lantern (`selfhosted/ff3-lantern`)  
**Epic:** [GitHub #17](https://github.com/jwposton/ff3-lantern/issues/17)

## Problem

A personal Google Sheet ("New Balance History") drives monthly bill payment today: snapshot balances across bank accounts, plan credit card and loan payments, verify enough cash in each funding bucket, pay items one-by-one, and track remainder / shortfall. Firefly III holds the ledger (SimpleFin imports) but has no equivalent **payment-run worksheet** UX.

## Goal

FF3 Lantern adds an optional **Manage** feature (`/manage/payment-run`) that replicates the spreadsheet workflow:

- Read Firefly balances and month-to-date activity on demand (**refresh**)
- Plan payments and mark items paid for the **current calendar month**
- Compute **funding bucket remainings** and **SHORTFALL** from **user-editable bucket balances** (overridable when you move cash between buckets before Firefly catches up)
- Register recurring bills in Firefly (bill + matching rule) via setup wizard
- Never create fake transactions — optional user-approved metadata writes only (bills, rules, account notes, link withdrawal to bill)

Firefly remains **system of record** for transactions, balances, bills, and rules. FF3 Lantern owns worksheet layout, ephemeral month state, and the planning UX.

## Non-goals (initial version)

- Multi-month worksheet history in the sidecar (Firefly has transactions)
- Autonomous payment execution or bank API integration
- Replacing Firefly UI for general transaction editing
- Credit card purchases as bills (paydown is a transfer, not a withdrawal)
- Duplicating loan amortization config (read existing `loan_profile.v1`)

## Source spreadsheet

**Tab:** `New Balance History` (ignore `Debt Reduction Calculator` and duplicate month columns).

| Section | Rows | Purpose |
|---------|------|---------|
| Bank Accounts | 2–6 | Per-bucket reported balance, user balance, planned outflows, **Total Remaining** |
| Revolving Credit | 9–19 (total 20) | Per card: New, interest accrued + fees (subsets of New), Owed, Paid, util % |
| Bills | 21–33 | Utilities and fixed costs |
| Loans / Rent / Mortgage | 36–46 | Balance, payment, interest, payments remaining |
| Cash-flow planner | 47–61 | Aggregate remainder / shortfall |

### Revolving credit columns (per card)

| Column | Meaning | Source |
|--------|---------|--------|
| **New** | Net new activity since the last bank→card payment (total **X**) | Computed at refresh from MTD transactions (see below) |
| **Interest accrued** | Interest charge line(s) included in **New** | Subset of **New** — posted interest transactions in the same window |
| **Fees** | Fee line(s) included in **New** | Subset of **New** — posted fee transactions in the same window (annual, late, FX, etc.) |
| **Owed** | Total owed right now | Firefly credit card asset balance at refresh |
| **Paid** | Planned payment for this month | Sidecar `worksheet_state` (editable; semibold row + checkbox when marked paid) |
| **Debt/Credit %** | Utilization | `owed ÷ credit_limit` |

**New** is **not** a balance delta and **not** tied to worksheet planned/paid. It is transaction-based:

1. On refresh, pull transactions from the **start of the prior calendar month** through today (so the last bank payment can be found even when it posted before the current month).
2. Find the **most recent transfer from a bank account** (checking/savings asset) **to** this card asset — same detection as `isCreditCardPaymentFlow` in `frontend/src/lib/cashFlowLabels.ts` (bank source → credit card destination).
3. Define the activity window: **latest bank payment in the current month** when one exists; otherwise **latest bank payment in the prior month** (from the fetched range); otherwise **current month start**. Count net card activity on or after that date (exclusive of the payment transfer itself).
4. **New (X)** = net activity on the card in that window (exclusive of the payment transfer itself): purchases, fees, **interest posts**, refunds/credits.
5. **Interest accrued** = sum of **interest charge** transactions in that same window (a component of **X**, shown on its own line).
6. **Fees** = sum of **fee** transactions in that same window (a component of **X**, shown on its own line).

```
New (X)           = purchases + fees + interest_accrued + refunds/credits (net)
Interest accrued  ⊆ X   (posted interest lines only)
Fees              ⊆ X   (posted fee lines only)
New charges       = X − interest_accrued − fees   (purchases + net refunds)
```

**Interest** and **fees** are **posted** activity from Firefly imports, not estimates. Match by description/category heuristics — tune per issuer during implementation:

| Breakout | Typical patterns |
|----------|------------------|
| Interest | `INTEREST`, `FINANCE CHARGE` |
| Fees | `ANNUAL FEE`, `LATE FEE`, `FOREIGN TRANSACTION FEE`, `MEMBERSHIP FEE`, `RETURNED PAYMENT` |

A transaction counts in at most one breakout bucket (interest **or** fees **or** purchases). Unclassified lines roll into **new charges**.

**Activity drill-down (shipped):** On refresh, each card snapshot also stores `new_transactions[]` — line items (date, description, payee, category, budget, amount) that sum to **New**. The worksheet expands the **New** column to show this inline table (frozen at refresh; expand again after new Firefly imports).

**Paid** (mark-paid flag) is worksheet progress tracking only — it does **not** change outflow tallies, **user balance**, or **New**. Actual CC payments for **New** are discovered from Firefly transfers, not mark-paid state.

### Funding sources (user-confirmed)

| Category | Pays from bucket |
|----------|------------------|
| Credit cards | Checking |
| Most bills | Checking |
| Some bills | Savings |
| Mortgage | Savings |
| Rent | Checking |
| Personal loans | Loan account bucket |

Some bills (cell, internet) charge a **credit card**, not a bank bucket — see **Payment rail** below. They stay FF bills for ledger/rules but can be excluded from cash-plan math.

## Architecture

```
User opens Payment Worksheet
        ↓
Refresh (optional) → read FF balances + MTD txns → freeze snapshot
        ↓
Opted-in rows: CC assets, liabilities, registered bills
        ↓
User edits planned payments, user bucket balances, marks paid (sidecar)
        ↓
Compute bucket remainings (from user balance) + section subtotals + grand total + SHORTFALL
        ↓
User pays externally; imports land in Firefly
        ↓
(Phase 3) Suggest matches: CC transfer or bill-linked withdrawal
```

### System-of-record split

| Concern | Owner |
|---------|--------|
| Transactions, balances, bills, rules | Firefly III |
| Funding bucket definitions (Checking, Savings, …) | FF3 Lantern SQLite sidecar |
| Bill worksheet opt-in + bucket link | Sidecar `worksheet_registry` |
| Account worksheet opt-in + bucket + section | Firefly account `notes` (`payment_worksheet.v1`) |
| Loan split / amortization config | Existing `loan_profile.v1` in liability notes |
| Current-month planned amount, paid flag | Sidecar `worksheet_state` |
| Refresh snapshot (reported balances, CC activity) | Sidecar `worksheet_refresh` |
| Per-bucket user balance override | Sidecar `worksheet_bucket_balance` |

**No new transactions.** Allowed FF writes: create/update bills, create rules, update account notes/interest, link existing withdrawal to bill (`PUT` journal `bill_id`, `apply_rules: false`).

## Worksheet population (opt-in only)

New Firefly accounts/bills do **not** appear until registered.

### Row types

| Row type | Firefly source | Opt-in | Worksheet section |
|----------|----------------|--------|-------------------|
| **Credit card** | Asset account, `account_role: creditCard` | `payment_worksheet.v1` in account notes | Always **Credit cards** (`worksheet_section: "credit"`) |
| **Loan / mortgage** | Liability account | `payment_worksheet.v1` in account notes | Always **Liabilities** (`section: "loan"` \| `"mortgage"`) |
| **Any recurring bill** (rent, utilities, etc.) | FF bill or subscription | `worksheet_registry` | **User choice:** `"bills"` or `"liabilities"` (default `"bills"`) |

**Firefly entity ≠ worksheet section for bills.** Rent is a bill in Firefly either way; you pick **Bills** or **Liabilities** on the worksheet at registration (changeable in setup). A utility can live under Liabilities if you want it grouped there.

| Field | Registry / notes | Purpose |
|-------|------------------|---------|
| `funding_bucket_key` | All row types | Which bucket funds the outflow |
| `worksheet_section` | Bills via registry; CC/loans via notes | Where the row appears on the page |
| `row_label` | Optional on registry | Display badge: `Rent`, `Loan`, `Mortgage`, or custom — cosmetic only |

**Credit cards are not bills.** Card paydown is a **transfer** (checking → card asset). Firefly bills attach only to **withdrawals**.

**Credit card discovery:** asset accounts with credit card role (`creditCard` or `ccAsset` in Firefly) — not the liability list. Reuse `frontend/src/lib/accounts.ts` / `backend/firefly_client.py` role normalization.

### `payment_worksheet.v1` notes block

Marker: `<!-- ff3lantern:payment_worksheet.v1 -->` (v2 writes; parsers also read legacy `ff3analytics:payment_worksheet.v1`) — same append/strip pattern as `loan_profiles.py`.

```json
{
  "included": true,
  "worksheet_section": "credit",
  "funding_bucket_key": "checking",
  "credit_limit": "6000.00",
  "annual_fee": "0.00",
  "default_planned_payment": null,
  "sort_order": 10
}
```

**Liability example** (mortgage registered on worksheet; no duplicate of loan split config):

```json
{
  "included": true,
  "worksheet_section": "mortgage",
  "funding_bucket_key": "savings",
  "default_planned_payment": "2500.00",
  "sort_order": 20
}
```

`default_planned_payment` is a **fallback** only — see **Liabilities — auto-draft** below. Do not store the monthly draft amount here when `loan_profile.v1` already has `match.expected_amount`.

### Funding buckets (sidecar only)

Table `funding_buckets`:

| Column | Example |
|--------|---------|
| `id` | `checking` |
| `label` | `Checking` |
| `sort_order` | `1` |
| `firefly_account_ids` | `["42", "87"]` — summed at refresh |

## Worksheet section placement (user-configurable for bills)

Three scroll sections on the page: **Credit cards**, **Bills**, **Liabilities**. Placement rules:

| Source | Section | Configurable? |
|--------|---------|---------------|
| Credit card asset | Credit cards | No |
| Loan / mortgage liability | Liabilities | No |
| FF bill (any) | Bills **or** Liabilities | **Yes** — `worksheet_section` on `worksheet_registry` |

Setup wizard and **Edit registration** expose a **Worksheet section** dropdown for every bill. Examples:

| You want… | Firefly | `worksheet_section` |
|-----------|---------|---------------------|
| Rent grouped with loans (spreadsheet layout) | Bill "Rent" | `"liabilities"` |
| Rent listed with utilities | Bill "Rent" | `"bills"` |
| HOA fee next to mortgage | Bill "HOA" | `"liabilities"` |
| Electricity with other utilities | Bill "Electricity" | `"bills"` (default) |

Behavior (`planned_sync`, `payment_rail`, cash-plan math) is **independent** of section — section is layout only.

### Rent (typical setup)

Rent is a **bill in Firefly** (`planned_sync: fixed`, bank rail, counts toward cash plan). Default registration template suggests `worksheet_section: "liabilities"` to match your spreadsheet, but you can move it to Bills anytime in setup.

```json
{
  "firefly_bill_id": "99",
  "worksheet_section": "liabilities",
  "row_label": "Rent",
  "amount_mode": "fixed",
  "planned_sync": "fixed",
  "payment_rail": "bank",
  "funding_bucket_key": "checking",
  "counts_toward_cash_plan": true
}
```

Optional autopay later: `planned_sync: "autodraft"` — still a bill, still whatever section you chose.

## Liabilities — loans and mortgage (auto-draft)

Loan/mortgage **liability accounts** always render in **Liabilities**. Bill-backed rows appear there only when you set `worksheet_section: "liabilities"`. Auto-draft semantics below apply to **loans/mortgage only**, not every row in that section.

Most loan/mortgage liabilities are **fixed monthly auto-drafts** — the same total hits the bank each month. For payment-run planning you only need that **total outflow** (principal + interest + escrow combined). Split breakdown stays in `loan_profile.v1` / loan splits — not duplicated on the worksheet.

### Planned amount source (priority on refresh)

When a loan/mortgage row is registered and the user has **not** manually overridden planned amount this month:

| Priority | Source | Field |
|----------|--------|-------|
| 1 | Existing `loan_profile.v1` on the liability | `match.expected_amount` — **total monthly draft** (full payment before splits) |
| 2 | `payment_worksheet.v1` fallback | `default_planned_payment` — rare fallback when no loan profile |
| 3 | None | `planned_amount` = `$0` until user enters |

**On refresh:** re-seed `planned_amount` from (1) or (2) when `planned_sync: "autodraft"`. If the user edited planned amount this month (`planned_amount_override = true` in `worksheet_state`), **preserve** their value.

Having `loan_profile.v1` with `expected_amount` implies **`planned_sync: autodraft`** — no extra flag needed.

### What we do not duplicate

| Already in `loan_profile.v1` | Worksheet uses |
|------------------------------|----------------|
| `expected_amount` | Total planned payment (one number) |
| `split.components[]` (principal / interest / escrow) | **Ignored** for cash-flow planning |
| Escrow, rate, amortization | Loans page / split queue only |

### UI

- **Auto-draft** badge when `planned_sync: autodraft` and amount synced from profile (not manually overridden).
- **Planned payment** remains editable — one-off month sets `planned_amount_override` and shows **Manual**.
- Liability account rows: balance (owed), **planned total**, mark paid, funding bucket, kind badge (Loan / Mortgage).

## Payment rail — bank vs credit card

Two independent knobs per worksheet row (bills and rent; loans are always `bank`):

| Field | Values | Purpose |
|-------|--------|---------|
| **`payment_rail`** | `bank` (default) \| `credit_card` | Where the charge actually lands |
| **`counts_toward_cash_plan`** | `true` (default) \| `false` | Include in bucket remainings + **cash grand total** |

### Bank-funded (electricity, rent, mortgage)

```
payment_rail: bank
counts_toward_cash_plan: true
funding_bucket_key: checking | savings | …
```

Planned amount reduces that bucket's **remaining** and rolls into section subtotals + **cash grand total**.

### CC-funded (cell, internet on auto-pay to card)

Still **FF bills** for imports, rules, and categorization. On the payment worksheet:

```json
{
  "amount_mode": "fixed",
  "planned_sync": "fixed",
  "payment_rail": "credit_card",
  "credit_card_account_id": "42",
  "counts_toward_cash_plan": false
}
```

- **Do not** subtract from checking/savings remainings — you're not paying these from the bank bucket this month.
- Spend is already reflected on the card (**New** / owed) when SimpleFin imports the charge; you plan **card paydown** separately in Revolving Credit.
- Row can still appear under **Bills** for a checklist (badge **Via AmEx** / card name) or stay **off the worksheet** entirely if you don't want the clutter — registration is opt-in.
- Section subtotal splits: **Bills (cash)** vs optional **Bills (on card — informational)** excluded from **cash grand total**.

**Cash grand total** = Σ `planned_amount` where `counts_toward_cash_plan: true` only (CC + bills + liabilities + card paydown from checking).

### `planned_sync` summary

| Value | Typical rows | Refresh pre-fill | Badge |
|-------|--------------|------------------|-------|
| `autodraft` | Mortgage, personal loan (`loan_profile`) | `expected_amount` | Auto-draft |
| `fixed` | Rent, electricity, fixed bills | FF bill amount / default | — (or Fixed) |
| `manual` / `range` | Oil, propane | `$0` or user entry | — |

## Bills: fixed, variable, and irregular

### Fixed monthly (electricity, cell, internet)

- FF bill with monthly repeat + amount
- Registry: `amount_mode: "fixed"`, `planned_sync: "fixed"`
- **Bank-paid** (electricity): `payment_rail: "bank"`, `counts_toward_cash_plan: true`, assign `funding_bucket_key`
- **CC-paid** (cell, internet): `payment_rail: "credit_card"`, `credit_card_account_id`, `counts_toward_cash_plan: false` — optional worksheet row; does not affect bucket remainings
- Wizard creates bill + rule (`description_contains`, optional `amount_exactly`) + registry row

### Variable / seasonal (heating oil, propane)

- FF bill stores **min/max** and repeat (e.g. every 2–3 months)
- Registry: `amount_mode: "range"` or `"manual"`; optional `active_months` (e.g. `[10,11,12,1,2,3]` for oil)
- **Planned payment** defaults to **$0** off-season or until user enters an amount for a fill
- One bill entity (e.g. "Heating oil"); attach each payment to it (rule or manual link)

### Bill registration wizard

Mirrors categorize rule graduation:

1. User enters name, amount/range, repeat, **worksheet section** (Bills or Liabilities), **payment rail**, funding bucket (if bank)
2. `POST /api/v1/bills` in Firefly
3. Create matching rule (`link_to_bill` action; optional `amount_more`/`amount_less` for ranges)
4. Insert `worksheet_registry` row
5. Optional rule tag: `FF3LANTERN_PAYMENT_WORKSHEET_TAG`

## Due dates vs rules

| FF field | Role |
|----------|------|
| CC `monthly_payment_date` | Display reminder in worksheet |
| Bill repeat schedule | FF dashboard "next expected" |
| Rule triggers | Match on import: description, amount, transaction date — **not** bill due date |

Rules fire when SimpleFin creates/updates a transaction. Bill min/max is for FF forecasting; wizard sets explicit rule triggers.

## Reconciliation (Phase 3)

| Row type | Match strategy |
|----------|----------------|
| CC payment | Transfer → card asset ID + amount ≈ planned |
| Fixed bill | Rule-linked withdrawal, or suggest by description/amount |
| Oil / etc. | Rule when possible; **manual bill link** common |

Manual bill link: user picks MTD withdrawal → `PUT /transactions/{id}` with `bill_id`, `apply_rules: false`.

## API sketch

Route module: `backend/routes/payment_run.py`

| Endpoint | Purpose |
|----------|---------|
| `GET /payment-run` | Worksheet view (opted-in rows + state + computed remainings) |
| `POST /payment-run/refresh` | Pull FF data; update refresh snapshot (reported balances) |
| `PUT /payment-run/buckets/{id}/balance` | Set user balance override for a funding bucket |
| `PUT /payment-run/rows/{key}` | Planned payment / mark paid; `clear_planned_override` resets soft zero |
| `PUT /payment-run/accounts/{id}/worksheet` | Register/update notes marker |
| `POST /payment-run/bills/register` | Wizard: FF bill + rule + registry |
| `PUT /payment-run/bills/{registry_id}` | Update registry (worksheet section, payment rail, bucket, etc.) |
| `DELETE /payment-run/bills/{registry_id}` | Unregister |
| `GET/POST/PUT /payment-run/buckets` | Funding bucket CRUD |
| `GET /payment-run/available` | Unregistered FF accounts/bills |
| `GET /payment-run/bill-suggestions` | Analyze withdrawal history; ranked bill candidates with register wizard prefill |
| `POST /payment-run/link-transaction` | Phase 3: attach bill to withdrawal |

Helper: `backend/payment_worksheet_profiles.py` (parse/write notes, mirror `loan_profiles.py`).

### Bill suggestions (`GET /payment-run/bill-suggestions`)

Compute-on-demand analysis of Firefly **withdrawal** history to surface recurring bill candidates for the register wizard. Requires `FF3LANTERN_PAYMENT_WORKSHEET_ENABLED` (same gate as other payment-run routes — returns **404** when disabled).

| Query param | Values | Default |
|-------------|--------|---------|
| `lookback_months` | `6`, `12`, or `24` only | `12` |

Invalid lookback values return **422** with `lookback_months must be 6, 12, or 24.` Firefly failures return **502** with a short error message (no token leakage).

**Response:** `{ "data": [ …suggestion objects… ], "meta": { "withdrawals_analyzed", "suggestions_count", "period_start", "period_end" } }`

Each suggestion includes `register_prefill` shaped for `POST /payment-run/bills/register` (wizard prefill). Results are **not persisted** — re-fetch on each GET. Implementation: `backend/payment_worksheet_bill_suggestions.py` (`fetch_bill_suggestions` → `build_bill_suggestions`).

**Discover grouping:** Suggestions are grouped on the discover page by **payee** (`payee` / `bucket` fields — Firefly `destination_name`, or a canonical token from withdrawal descriptions when present). Audit-style buckets (Streaming & Media, etc.) are not used.

**Opaque payee clusters:** When a PreApproved/Bill User Payment payee has multiple distinct **category+amount** fingerprints (e.g. `APPLE.COM/BILL`, PayPal bill payments), the engine emits **one suggestion per sub-group** instead of a single combined row. Sub-groups share the same payee section header. The engine scans withdrawal descriptions for domain-like tokens (e.g. `APPLE.COM/BILL`, `PAYPAL *DIGITALGOODS`) and uses the most frequent match; when no token is found, the payee falls back to Firefly `destination_name` (which may be a friendly label like `Apple Services`). Each sub-group carries a `cluster` slug (slugified payee) and **category-derived** `merchant` label (category is the stable alignment field when payee strings shift); a **misc catch-all** row (`{payee} (misc)`) may appear for unresolved one-offs with `status: review` and intermittent amounts. The Bill column shows the merchant name with muted category and payee detail beneath.

### Sidecar tables

- `funding_buckets`
- `worksheet_registry` — `firefly_bill_id`, `worksheet_section` (`"bills"` \| `"liabilities"`), `row_label` (optional), `funding_bucket_key`, `amount_mode`, `planned_sync`, `payment_rail`, `credit_card_account_id` (optional), `counts_toward_cash_plan`, `active_months`, `rule_id`
- `worksheet_state` — `row_key`, `row_type`, `month`, `planned_amount`, `planned_amount_override` (bool), `paid_at`, optional `matched_journal_id`
- `worksheet_refresh` — `month`, `refreshed_at`, `balances_json` (per bucket: `reported_balance`; per CC: `owed`, `new_total`, `interest_accrued`, `fees`, `last_payment_date`, `last_payment_amount`, `new_transactions[]` with `journal_id`, `date`, `description`, `payee`, `category`, `budget`, `kind`, `amount`)
- `worksheet_bucket_balance` — `bucket_key`, `month`, `user_balance`, `user_balance_override` (bool — true once user edits; refresh does not overwrite)

### Environment

| Variable | Purpose |
|----------|---------|
| `FF3LANTERN_PAYMENT_WORKSHEET_ENABLED` | Feature gate |
| `FF3LANTERN_PAYMENT_WORKSHEET_RULE_GROUP` | Firefly rule group for bill rules |
| `FF3LANTERN_PAYMENT_WORKSHEET_BILL_GROUP` | Firefly object group for wizard-created subscriptions (defaults to rule group title) |
| `FF3LANTERN_PAYMENT_WORKSHEET_TAG` | Optional tag on rule-matched txns |

## UI

| Route | Purpose |
|-------|---------|
| `/manage/payment-run` | Single-page worksheet (sticky bucket bar + scrollable sections) |
| `/manage/payment-run/discover` | Bill discover — recurring charge suggestions from withdrawal history; adopt into registration wizard (requires payment worksheet enabled) |
| `/manage/payment-run/setup` | Buckets, register accounts/bills, wizard |

Sidebar: new item under **Manage** in `AppSidebar.tsx`.

### Layout — one screen

One scrollable worksheet page. **Bank / bucket balances stick to the top** (`position: sticky`) so funding context stays visible while scrolling through credit cards, bills, and liabilities.

```
┌─────────────────────────────────────────────────────────────┐
│ STICKY: Funding buckets (Reported / User / Remaining)       │
│         + total reported + total user + total remaining     │
├─────────────────────────────────────────────────────────────┤
│ Credit cards (rows…)                                        │
│   Subtotal — planned payments                               │
├─────────────────────────────────────────────────────────────┤
│ Bills (rows…)                                               │
│   Subtotal — planned payments                               │
├─────────────────────────────────────────────────────────────┤
│ Liabilities — loans, mortgage, rent (rows…)                 │
│   Subtotal — planned payments (cash-plan rows)              │
│   (rent rows are FF bills; loans/mortgage are liabilities)  │
├─────────────────────────────────────────────────────────────┤
│ GRAND TOTAL — Σ planned payments (all sections)            │
│ SHORTFALL banner if any bucket remaining < 0                │
└─────────────────────────────────────────────────────────────┘
```

No separate tab per section in v1 — vertical scroll only. Setup/registration stays on `/manage/payment-run/setup`.

### Sticky bucket bar

Per funding bucket (Checking, Savings, Loan account, …):

| Field | Editable | Source / formula |
|-------|----------|------------------|
| **Reported balance** | No | Sum of mapped Firefly asset accounts at last **Refresh** |
| **User balance** | Yes | Defaults to reported on first load; field shows **reported** as soft placeholder when not overridden; override only when you move cash **between buckets** (e.g. savings → checking) before Firefly reflects it; clear field or **Reset to reported** removes override |
| **Planned outflows** | — | Σ `planned_amount` for rows assigned to this bucket where `counts_toward_cash_plan: true` (paid and unpaid) |
| **Remaining** | No | `user_balance − planned_outflows` |

Footer row in the sticky bar:

| Field | Formula |
|-------|---------|
| **Total reported** | Σ reported balance across all buckets |
| **Total user** | Σ user balance across all buckets |
| **Total remaining** | Σ remaining across all buckets |

**Refresh behavior:**

- Always updates **reported** balances from Firefly.
- Sets **user** balance = reported when the bucket has no manual override (`user_balance_override = false`).
- Preserves **user** balance when the user has edited it (inter-bucket moves ahead of SimpleFin import).
- Optional per-bucket **Reset to reported** control clears the override.

Remainings and **SHORTFALL** use **user balance** (not reported) so bucket totals reflect where you believe cash sits **right now** — including manual adjustments after moving money between accounts.

**Outflow tally rule:** Rows with `counts_toward_cash_plan: true` count toward bucket **planned outflows**, **cash** section subtotals, and **cash grand total** regardless of mark-paid state. CC-rail bills (`counts_toward_cash_plan: false`) are informational only — card spend is in Revolving Credit **New**.

**User balance override rule:** Edit bucket user balances only to reflect **inter-account transfers** (e.g. you moved $2k from Savings to Checking; FF still shows old balances). Do **not** adjust user balance when marking a bill or card payment paid — that flag is unrelated to bucket math.

### Payment sections (scrollable body)

Three stacked sections on the same page. Each row has a funding bucket assignment (from notes/registry). Column sets differ slightly by row type but share **planned payment** and **mark paid**.

**1. Credit cards** — New, interest accrued, fees, owed, planned (Paid), util %  
**2. Bills** — FF bills with `worksheet_section: "bills"` (utilities, etc.)  
**3. Liabilities** — loan/mortgage liability accounts **plus** any FF bill with `worksheet_section: "liabilities"` (e.g. rent). One section subtotal; `row_label` / kind badge for Loan / Mortgage / Rent / custom.  

Each section ends with a **subtotal** row: Σ `planned_amount` for cash-plan rows in that section (paid and unpaid). CC-rail bills may show a separate informational subtotal excluded from cash totals.

Below all sections:

- **Cash grand total** — Σ `planned_amount` across all rows with `counts_toward_cash_plan: true` (paid and unpaid)
- **SHORTFALL** — highlighted when any bucket **remaining** &lt; 0

Subtotals and grand total are planning totals (what you intend to pay this run), not Firefly ledger totals.

### Paid vs unpaid — visual treatment

Mirrors the spreadsheet habit of **bolding a row when paid**, using FF3 Lantern table patterns (`TableRow`, `Badge`, checkbox). Mark-paid is cosmetic only — amounts still count in outflow tallies.

**Control (last column):** checkbox labeled **Paid** — click row checkbox or toggle to flip `paid_at` in sidecar. Keyboard-accessible (`role="checkbox"`).

| State | Row | Name / planned amount | Status |
|-------|-----|----------------------|--------|
| **Unpaid** | Default zebra striping (`odd:bg-background even:bg-muted/30`) | Normal weight | Empty checkbox |
| **Paid** | `data-state="paid"` — subtle done tint (`bg-emerald-50/80` light / `bg-emerald-950/25` dark) | **Semibold** on name + planned amount (spreadsheet bold) | Checked checkbox + optional `Paid` badge (`secondary` variant) |

**Do not use** strikethrough or reduced opacity on paid rows — that reads as cancelled or excluded from totals. Paid rows stay **fully legible** and **in the same sort order** (work down the list top-to-bottom, same as the sheet).

**Section header** shows progress: e.g. `Bills · 4 / 11 paid` (count of rows with `paid_at` set). Unpaid rows remain visually dominant; paid rows are clearly settled but still visible for the run audit trail.

**Optional (Phase C):** when a Firefly transaction is linked (`matched_journal_id`), show a small Firefly link icon on the row — independent of mark-paid (import may lag; user can mark paid before FF catches up).

### Interaction

- **Refresh** — updates reported balances, CC activity columns, and `new_transactions` drill-down data; shows last-refreshed timestamp.
- **User balance** edit — for inter-bucket moves only; soft placeholder matches reported until overridden; clearing the field resets to reported; persists in sidecar.
- **Planned payment** — soft `0.00` placeholder when unset; clearing the field resets to default (no manual override); saved amounts require explicit edit.
- **Planned / mark paid** — persists in sidecar; recalculates remainings when `planned_amount` changes only.
- **Mark paid** — toggle checkbox; semibold + tint on row (see **Paid vs unpaid** above); no effect on user balance, outflow tallies, subtotals, grand total, or remaining.
- **New expand** — chevron on **New** column opens inline activity table (right-aligned under dollar columns); links to Firefly when configured.
- **Card Details** — pencil opens sheet for bucket, limit, due day, APR, default planned pay, exclude; writes `payment_worksheet.v1` to Firefly notes.
- **Manage cards** — restore excluded credit card asset accounts to the worksheet.

## GSD delivery phases (suggested)

Map to GitHub issues for commit tracking — see **GitHub issues** below.

### Phase A — MVP worksheet

- Funding buckets + CC registration (`payment_worksheet.v1`)
- Sticky bucket bar (reported / user / remaining); user balance override
- Revolving credit section with subtotal; mark paid; SHORTFALL; refresh
- Feature flag + changelog

### Phase B — Bills, liabilities, setup wizard

- Bill register wizard; bills + liabilities sections on same page; section subtotals + grand total
- Bulk template from spreadsheet; first-run wizard

### Phase C — Reconciliation

- CC transfer match; bill link suggestions; manual attach

## Success criteria (phase-level)

**MVP (Phase A):**

1. User can define funding buckets mapped to Firefly asset accounts
2. User can register credit card asset accounts on the worksheet with planned payment and mark paid
3. Sticky bucket bar shows reported balance, editable user balance, and remaining per bucket; totals across buckets
4. Refresh updates reported balances; user overrides persist until reset (overrides are for inter-bucket moves, not mark-paid)
5. Remaining and SHORTFALL use **user balance**, not reported
6. Credit card section shows subtotal of planned payments

**Full feature (through Phase C):**

7. Bills and liabilities on the same scrollable page with section subtotals and grand total
8. User can register bills via wizard (FF bill + rule + worksheet row)
9. Variable bills (oil) support $0 planned default and manual attach when rule misses
10. User can link an imported withdrawal to a bill from the worksheet without creating transactions

## GitHub issues

Track implementation with [epic #17](https://github.com/jwposton/ff3-lantern/issues/17). **GSD commits must reference the issue** for the work being done:

```
feat(payment-run): sticky bucket bar with user balance override (#20)
```

Use `Refs #NN` in intermediate commits; `Closes #NN` in the final commit or PR for that issue. Changelog bullets stay user-facing (no issue numbers required there).

| Issue | GSD phase | Design phase | Scope |
|-------|-----------|--------------|--------|
| [#17](https://github.com/jwposton/ff3-lantern/issues/17) | — | — | Epic / parent tracker |
| [#18](https://github.com/jwposton/ff3-lantern/issues/18) | 14 | A (1/3) | Sidecar tables, funding buckets API, feature flag |
| [#19](https://github.com/jwposton/ff3-lantern/issues/19) | 14 | A (2/3) | `payment_worksheet.v1`, refresh, New/interest/fees, row state |
| [#20](https://github.com/jwposton/ff3-lantern/issues/20) | 14 | A (3/3) | MVP UI — sticky buckets, CC section, mark paid, SHORTFALL |
| [#21](https://github.com/jwposton/ff3-lantern/issues/21) | 15 | B (1/2) | Bills + liabilities sections, registry, payment rail |
| [#22](https://github.com/jwposton/ff3-lantern/issues/22) | 15 | B (2/2) | Bill registration wizard + setup page |
| [#23](https://github.com/jwposton/ff3-lantern/issues/23) | 16 | C | Reconciliation — CC match, bill link |

When running `/gsd-new-milestone` or `/gsd-plan-phase`, paste issue URLs into phase CONTEXT.md and PLAN.md frontmatter (`github_issues: [18, 19, 20]`). Each plan task should name the target issue in its commit instruction.

## References

- Existing patterns: `backend/loan_profiles.py`, `frontend/src/pages/CategorizePage.tsx`, `frontend/src/pages/LoansPage.tsx`
- Spreadsheet: "New Balance History" tab
