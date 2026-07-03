# Payment Worksheet (Bill Pay Planner)

**Status:** Design — ready for GSD phase planning  
**Captured:** 2026-07-03  
**App:** FF3Analytics (`selfhosted/FF3Analytics`)

## Problem

A personal Google Sheet ("New Balance History") drives monthly bill payment today: snapshot balances across bank accounts, plan credit card and loan payments, verify enough cash in each funding bucket, pay items one-by-one, and track remainder / shortfall. Firefly III holds the ledger (SimpleFin imports) but has no equivalent **payment-run worksheet** UX.

## Goal

FF3Analytics adds an optional **Manage** feature (`/manage/payment-run`) that replicates the spreadsheet workflow:

- Read Firefly balances and month-to-date activity on demand (**refresh**)
- Plan payments and mark items paid for the **current calendar month**
- Compute **funding bucket remainings** and **SHORTFALL** before money leaves the bank
- Register recurring bills in Firefly (bill + matching rule) via setup wizard
- Never create fake transactions — optional user-approved metadata writes only (bills, rules, account notes, link withdrawal to bill)

Firefly remains **system of record** for transactions, balances, bills, and rules. FF3Analytics owns worksheet layout, ephemeral month state, and the planning UX.

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
| Bank Accounts | 2–6 | Per-bucket balance, planned outflows, **Total Remaining** |
| Revolving Credit | 9–19 (total 20) | Per card: New, Owed, Paid, interest est, util % |
| Bills | 21–33 | Utilities and fixed costs |
| Loans / Rent / Mortgage | 36–46 | Balance, payment, interest, payments remaining |
| Cash-flow planner | 47–61 | Aggregate remainder / shortfall |

### Funding sources (user-confirmed)

| Category | Pays from bucket |
|----------|------------------|
| Credit cards | Checking |
| Most bills | Checking |
| Some bills | Savings |
| Mortgage | Savings |
| Rent | Checking |
| Personal loans | Loan account bucket |

## Architecture

```
User opens Payment Worksheet
        ↓
Refresh (optional) → read FF balances + MTD txns → freeze snapshot
        ↓
Opted-in rows: CC assets, liabilities, registered bills
        ↓
User edits planned payments, marks paid (sidecar worksheet_state)
        ↓
Compute bucket remainings + SHORTFALL
        ↓
User pays externally; imports land in Firefly
        ↓
(Phase 3) Suggest matches: CC transfer or bill-linked withdrawal
```

### System-of-record split

| Concern | Owner |
|---------|--------|
| Transactions, balances, bills, rules | Firefly III |
| Funding bucket definitions (Checking, Savings, …) | FF3Analytics SQLite sidecar |
| Bill worksheet opt-in + bucket link | Sidecar `worksheet_registry` |
| Account worksheet opt-in + bucket + section | Firefly account `notes` (`payment_worksheet.v1`) |
| Loan split / amortization config | Existing `loan_profile.v1` in liability notes |
| Current-month planned amount, paid flag | Sidecar `worksheet_state` |
| Refresh snapshot | Sidecar `worksheet_refresh` |

**No new transactions.** Allowed FF writes: create/update bills, create rules, update account notes/interest, link existing withdrawal to bill (`PUT` journal `bill_id`, `apply_rules: false`).

## Worksheet population (opt-in only)

New Firefly accounts/bills do **not** appear until registered.

### Row types

| Row type | Firefly source | Opt-in | Bucket link |
|----------|----------------|--------|-------------|
| **Credit card** | Asset account, `account_role: creditCard` | `payment_worksheet.v1` in account notes (`included: true`, `section: "credit"`) | `funding_bucket_key` in notes |
| **Loan / mortgage / rent** | Liability account | Same notes marker (`section: "loan"` \| `"mortgage"` \| `"rent"`) | `funding_bucket_key` in notes |
| **Recurring bill** | FF bill or subscription | `worksheet_registry` sidecar row | `funding_bucket_key` in registry |

**Credit cards are not bills.** Card paydown is a **transfer** (checking → card asset). Firefly bills attach only to **withdrawals**.

**Credit card discovery:** asset accounts with credit card role — not the liability list. Reuse `frontend/src/lib/accounts.ts` / `backend/firefly_client.py` role normalization.

### `payment_worksheet.v1` notes block

Marker: `<!-- ff3analytics:payment_worksheet.v1 -->` — same append/strip pattern as `loan_profiles.py`.

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

### Funding buckets (sidecar only)

Table `funding_buckets`:

| Column | Example |
|--------|---------|
| `id` | `checking` |
| `label` | `Checking` |
| `sort_order` | `1` |
| `firefly_account_ids` | `["42", "87"]` — summed at refresh |

## Bills: fixed, variable, and irregular

### Fixed monthly (electricity, cell, internet)

- FF bill with monthly repeat + amount
- Registry: `amount_mode: "fixed"`
- Wizard creates bill + rule (`description_contains`, optional `amount_exactly`) + registry row

### Variable / seasonal (heating oil, propane)

- FF bill stores **min/max** and repeat (e.g. every 2–3 months)
- Registry: `amount_mode: "range"` or `"manual"`; optional `active_months` (e.g. `[10,11,12,1,2,3]` for oil)
- **Planned payment** defaults to **$0** off-season or until user enters an amount for a fill
- One bill entity (e.g. "Heating oil"); attach each payment to it (rule or manual link)

### Bill registration wizard

Mirrors categorize rule graduation:

1. User enters name, amount/range, repeat, funding bucket
2. `POST /api/v1/bills` in Firefly
3. Create matching rule (`link_to_bill` action; optional `amount_more`/`amount_less` for ranges)
4. Insert `worksheet_registry` row
5. Optional rule tag: `FF3ANALYTICS_PAYMENT_WORKSHEET_TAG`

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
| `POST /payment-run/refresh` | Pull FF data; update refresh snapshot |
| `PUT /payment-run/rows/{key}` | Planned payment / mark paid |
| `PUT /payment-run/accounts/{id}/worksheet` | Register/update notes marker |
| `POST /payment-run/bills/register` | Wizard: FF bill + rule + registry |
| `DELETE /payment-run/bills/{registry_id}` | Unregister |
| `GET/POST/PUT /payment-run/buckets` | Funding bucket CRUD |
| `GET /payment-run/available` | Unregistered FF accounts/bills |
| `POST /payment-run/link-transaction` | Phase 3: attach bill to withdrawal |

Helper: `backend/payment_worksheet_profiles.py` (parse/write notes, mirror `loan_profiles.py`).

### Sidecar tables

- `funding_buckets`
- `worksheet_registry` — `firefly_bill_id`, `funding_bucket_key`, `amount_mode`, `active_months`, `rule_id`
- `worksheet_state` — `row_key`, `row_type`, `month`, `planned_amount`, `paid_at`, optional `matched_journal_id`
- `worksheet_refresh` — `month`, `refreshed_at`, `balances_json`

### Environment

| Variable | Purpose |
|----------|---------|
| `FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED` | Feature gate |
| `FF3ANALYTICS_PAYMENT_WORKSHEET_RULE_GROUP` | Firefly rule group for bill rules |
| `FF3ANALYTICS_PAYMENT_WORKSHEET_TAG` | Optional tag on rule-matched txns |

## UI

| Route | Purpose |
|-------|---------|
| `/manage/payment-run` | Worksheet (sections + bucket summary + SHORTFALL) |
| `/manage/payment-run/setup` | Buckets, register accounts/bills, wizard |

Sidebar: new item under **Manage** in `AppSidebar.tsx`.

**Refresh** shows last-refreshed timestamp; balances static between refreshes. Planned/paid edits persist in sidecar.

## GSD delivery phases (suggested)

### Phase A — MVP worksheet

- Funding buckets + CC registration (`payment_worksheet.v1`)
- Revolving credit section; bucket remainings; mark paid; SHORTFALL; refresh
- Feature flag + changelog

### Phase B — Bills, loans, setup wizard

- Bill register wizard; bills + loans sections; cash-flow footer
- Bulk template from spreadsheet; first-run wizard

### Phase C — Reconciliation

- CC transfer match; bill link suggestions; manual attach

## Success criteria (phase-level)

**MVP (Phase A):**

1. User can define funding buckets mapped to Firefly asset accounts
2. User can register credit card asset accounts on the worksheet with planned payment and mark paid
3. Refresh pulls live balances; remainings and SHORTFALL update when planned payments change
4. Checking **Total Remaining** matches spreadsheet intent (bucket balance minus planned outflows from that bucket)

**Full feature (through Phase C):**

5. User can register bills via wizard (FF bill + rule + worksheet row)
6. Variable bills (oil) support $0 planned default and manual attach when rule misses
7. User can link an imported withdrawal to a bill from the worksheet without creating transactions

## References

- Existing patterns: `backend/loan_profiles.py`, `frontend/src/pages/CategorizePage.tsx`, `frontend/src/pages/LoansPage.tsx`
- Design discussion: `.cursor/plans/bill_payment_run_feature_353aefed.plan.md`
- Spreadsheet: "New Balance History" tab
