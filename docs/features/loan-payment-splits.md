# Loan & Mortgage Payment Split Automation

**Status:** Design — not yet planned or implemented  
**Captured:** 2026-06-30  
**App:** FF3Analytics (`selfhosted/FF3Analytics`)

## Problem

Loan and mortgage payments arrive in Firefly as a **single lump-sum transfer** (e.g. checking → liability account) via bank import (SimpleFin). To reflect true spending and debt paydown, each payment must be split into:

- **Principal** — reduces liability balance (transfer to liability account)
- **Interest** — housing/debt cost (withdrawal to expense account)
- **Escrow** — taxes, insurance, HOA, etc. where applicable (withdrawal to expense account or categories)

This split is done manually today and is tedious to repeat every month.

## Goal

FF3Analytics should **detect** matching lump payments, **calculate** principal/interest/escrow amounts, let the user **review and apply** splits, and **write** the result back to Firefly via API. Firefly remains the **system of record** for transactions and account balances; FF3Analytics owns automation logic and editing UX.

## Non-goals (initial version)

- Full budget/category management beyond loan splits
- Replacing Firefly UI for general transaction editing
- Auto-import from bank (SimpleFin continues as today)
- ARM / variable-rate modeling beyond manual profile updates
- Penny-perfect splits without optional statement override
- Historical backfill (optional later; forward-only at launch is acceptable)

## Architecture

```
SimpleFin / bank import
        ↓
Firefly III (lump transfer lands, single split)
        ↓
FF3Analytics: match → calculate → review queue
        ↓
User confirms (or auto-apply when confident)
        ↓
PATCH transaction splits via Firefly API
        ↓
Existing analytics pipeline reads already-split rows
```

### System-of-record split

| Concern | Owner |
|---------|--------|
| Transactions, balances, budgets, categories | Firefly III |
| Loan profile config (match rules + split targets) | Firefly liability account notes (JSON), edited via FF3Analytics UI |
| Match + amortization logic | FF3Analytics backend |
| Review / apply UX | FF3Analytics frontend |

**Config storage:** Embed a versioned JSON blob in the Firefly **liability account `notes`** field, delimited by a marker such as `<!-- ff3analytics:loan_profile.v1 -->`. FF3Analytics reads/writes through the Firefly Accounts API. This avoids a sidecar database and keeps config tied to the account Firefly already manages.

**Fallback (if notes prove awkward):** Small SQLite/JSON sidecar in FF3Analytics keyed by Firefly `account_id`. Prefer Firefly notes first.

## Import payee vs split destinations

Bank imports often use a **generic payee** in the transaction description that does not match the Firefly accounts you want after splitting.

**Example:**

| Stage | What you see |
|-------|----------------|
| **Before split (import)** | Description / payee: `Loan Provider` — single lump payment |
| **After split (applied)** | `$XXX.XX` → `Lending Tree Acct XXXXYY` (principal / liability) |
| | `$xx.xx` → `Lending Tree Interest Acct XXXXYY` (interest / expense) |

The **match fingerprint** identifies the unsplit import (generic payee + amount). The **split recipe** maps each computed component to the **specific Firefly account** you configure — principal liability account, interest expense account, escrow expense account, etc. Those account names can differ entirely from the import description.

Profile editor: pick destination account per split line from Firefly accounts (store `account_id`; display `account_name`).

## Transaction matching

Each loan/mortgage has a **match fingerprint** — the expected shape of the imported lump payment **before** splitting.

### Match signals

| Field | Source | Role |
|-------|--------|------|
| `type` | Firefly split | Must be `transfer` (or `withdrawal` if import lands that way — confirm per loan in profile) |
| `description` | Firefly transaction description (bank payee / memo) | Primary match — often a **generic** servicer label (e.g. `Loan Provider`) |
| `destination_account` | Account on import | Optional; may be a placeholder or liability account depending on import rules |
| `source_account` | Asset account name | Optional guard (e.g. which checking account pays) |
| `amount` | Payment total | Fixed or slowly changing |
| `split_count` | Journal | Must be `1` (not already split) |

**Payee** means the Firefly **description** field (what SimpleFin puts in the memo), not the post-split destination account names.

### Amount matching

- **Expected amount** — configured per loan (e.g. `2847.32`)
- **Tolerance** — small band for rounding (e.g. `0.50`)
- When escrow adjusts and payment changes, user updates expected amount in profile (or app prompts: “payment changed — update fingerprint?”)

Description matching should default to **substring** on a distinctive servicer fragment (e.g. `contains: "WF HOME"`), not exact match.

### Match algorithm

```
1. type matches profile.match.type (default: transfer)
2. description matches (substring or configured pattern) — e.g. "Loan Provider"
3. abs(amount - expected_amount) <= tolerance
4. journal has exactly one split
5. optional: source_account matches
6. optional: destination_account matches import placeholder (if configured)
7. optional: max_one_per_month per profile
```

Do **not** require the import destination to equal the principal liability account — imports may target a generic account; the apply step rewrites splits to the configured accounts.

**Confidence tiers:**

| Tier | Condition | Action |
|------|-----------|--------|
| High | All rules pass | Queue with proposed split; optional auto-apply |
| Review | Payee matches, amount outside tolerance | Queue with warning |
| Skip | Already multi-split, or no profile match | Ignore |

## Split calculation

### Per-payment split (required)

Used when a payment is matched. Anchor on **live Firefly balance of the principal component's destination account** (the configured liability account), not a static origination schedule.

```
remaining_principal = liability account balance before this payment
period_rate         = annual_rate / payments_per_year
monthly_interest    = remaining_principal × period_rate
principal           = payment_amount - monthly_interest - escrow
```

**Inputs:**

| Input | Source |
|-------|--------|
| Current balance | Principal component `destination_account_id` (liability) |
| Annual rate, start date, original principal | Firefly liability account fields |
| Payment amount | Matched transaction (or `expected_amount`) |
| Escrow | Loan profile config (not derivable from amortization) |
| Per-component destination accounts | Loan profile `split.components[]` (Firefly account id + name) |

**Sanity checks:**

- All components ≥ 0
- Splits sum to payment amount (penny adjustment on last component)
- Principal ≤ remaining balance

**Statement override:** Review UI allows manual edit of principal / interest / escrow before apply. Calculated values are defaults; lender statement wins when provided.

### Full amortization schedule (optional UI)

Standard fixed-rate projection: given principal, annual rate, term (months), and payment amount, produce `{ period, payment, principal, interest, balance }[]` for payoff date and total interest display on the loan profile page.

Use **live balance** for monthly splits; use the schedule for **planning and sanity checks** only. Extra principal payments and lender adjustments mean the theoretical schedule diverges from reality over time.

## Firefly transaction shape (after split)

A payment of `$X` from checking becomes one journal with multiple splits. Each component posts to the **account you configured** for that line — not the generic import payee.

**Lending Tree example** (no escrow):

| Component | Amount | Firefly type | Source → Destination (configured) |
|-----------|--------|-------------|-------------------------------------|
| Principal | `$XXX.XX` | `transfer` | Checking → `Lending Tree Acct XXXXYY` |
| Interest | `$xx.xx` | `withdrawal` | Checking → `Lending Tree Interest Acct XXXXYY` |

With escrow, add a third withdrawal split to the configured escrow expense account.

| Component | Firefly type | Typical destination account type |
|-----------|-------------|-----------------------------------|
| Principal | `transfer` | Liability account (loan balance) |
| Interest | `withdrawal` | Expense account (interest) |
| Escrow | `withdrawal` | Expense account (tax / insurance / HOA) |

Optional per component: `category`, `budget` (applied on each split line in the Firefly payload).

Firefly constraint: a withdrawal can split across multiple **destination** expense accounts; principal stays a transfer to the configured liability account.

### API write requirements

- Use `PUT /api/v1/transactions/{id}` with full split payload
- Every existing split must include `transaction_journal_id` or Firefly deletes/recreates splits incorrectly
- Set `apply_rules: false` on update to avoid rule side effects
- See [Firefly transaction update docs](https://docs.firefly-iii.org/references/firefly-iii/api/specials/)

## Loan profile schema (v1)

Stored in the **principal liability account** notes as JSON (the account used for principal splits and balance lookups):

```json
{
  "version": 1,
  "enabled": true,
  "match": {
    "source_account_id": "7",
    "source_account": "Main Checking",
    "import_destination_account_id": null,
    "import_destination_account": null,
    "description_contains": "Loan Provider",
    "expected_amount": "427.18",
    "amount_tolerance": "0.50",
    "max_per_month": 1
  },
  "split": {
    "escrow_amount": "0.00",
    "budget": "Debt",
    "components": [
      {
        "role": "principal",
        "type": "transfer",
        "destination_account_id": "42",
        "destination_account": "Lending Tree Acct XXXXYY",
        "category": "Loan Principal"
      },
      {
        "role": "interest",
        "type": "withdrawal",
        "destination_account_id": "88",
        "destination_account": "Lending Tree Interest Acct XXXXYY",
        "category": "Loan Interest"
      }
    ]
  },
  "rate_override": null,
  "notes": "Import payee is generic; splits go to named LT accounts"
}
```

### Split component fields

| Field | Required | Purpose |
|-------|----------|---------|
| `role` | yes | `principal` \| `interest` \| `escrow` — drives amount assignment |
| `type` | yes | `transfer` (principal) or `withdrawal` (interest, escrow) |
| `destination_account_id` | yes | Firefly account id (used in API payload) |
| `destination_account` | yes | Display name (denormalized for UI / search) |
| `category` | no | Category on this split line |
| `budget` | no | Override profile-level `split.budget` for this line only |

**Principal component** `destination_account` must be a **liability** account (balance used for interest calc). **Interest** and **escrow** components use **expense** accounts.

`import_destination_account_*` optional — only when the unsplit import lands on a specific placeholder account you want to match.

`rate_override` optional when Firefly liability `interest` field is stale.

## Codebase touchpoints

### Existing (read path)

| File | Relevance |
|------|-----------|
| `backend/firefly_client.py` | Extend: fetch account detail, update accounts (notes), update transactions |
| `backend/transaction_normalization.py` | Unchanged for splits; already one row per split |
| Normalized rows include `journal_id` | Links queue items to Firefly edit URL |

### New (write path)

| Module | Responsibility |
|--------|----------------|
| `backend/loan_profiles.py` | Parse/serialize notes JSON; CRUD via Accounts API |
| `backend/loan_matcher.py` | Fingerprint matching on flat splits |
| `backend/amortization.py` | Per-payment split + optional schedule generator |
| `backend/loan_splits.py` | Map computed amounts to `split.components[]`; build Firefly PATCH payload; apply splits |
| `backend/routes/loans.py` (or similar) | REST endpoints for profiles, queue, apply |

### Pipeline extension

`firefly_client.fetch_splits` must add **`description`** (and ideally `transaction_journal_id` per split) to flat split dicts. Description is required for payee matching; journal split id is required for safe updates.

### Frontend

| Surface | Purpose |
|---------|---------|
| `/manage/loans` or sidebar **Loans** | List liability accounts with profiles |
| Loan profile editor | Match fingerprint (generic payee), expected amount; **per-component account picker** (principal / interest / escrow) |
| Split queue | Pending matches with proposed breakdown; Apply / Edit / Dismiss |
| Loan detail (optional) | Amortization schedule chart/table |

## API sketch (for implementation)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/loans` | List liability accounts + parsed profiles |
| `GET` | `/api/loans/{account_id}` | Profile + optional amortization schedule |
| `PUT` | `/api/loans/{account_id}` | Save profile to account notes |
| `GET` | `/api/loan-splits/pending` | Matched unsplit transactions + proposals |
| `POST` | `/api/loan-splits/{journal_id}/apply` | Write splits to Firefly |
| `POST` | `/api/loan-splits/{journal_id}/preview` | Recalculate with overrides |

Query `pending` over a date range (default: current month + previous month).

## UX flows

### Flow 1 — Configure loan (once)

1. User opens Loans → Add/edit profile (anchored on principal liability account)
2. Sets **import payee** substring (e.g. `Loan Provider`), expected amount, escrow
3. For each split line, picks **destination account** from Firefly (e.g. `Lending Tree Acct XXXXYY`, `Lending Tree Interest Acct XXXXYY`)
4. Saves → JSON written to Firefly account notes

### Flow 2 — Monthly split (recurring)

1. Bank import creates lump transfer in Firefly
2. User opens Split queue (or dashboard badge)
3. Sees: “Loan Provider — $427.18” with proposed lines, e.g. `$400.00 → Lending Tree Acct XXXXYY`, `$27.18 → Lending Tree Interest Acct XXXXYY`
4. Clicks **Apply** → Firefly journal rewritten with splits to configured accounts
5. Analytics immediately reflect correct categories on next fetch

### Flow 3 — Amount changed (escrow adjustment)

1. Match fails amount check but description matches → **Review** tier
2. User updates `expected_amount` in profile and applies split

## Delivery slices (suggested for GSD)

| Slice | Delivers |
|-------|----------|
| **A** | `description` on flat splits; loan profile read/write; profile editor UI |
| **B** | Matcher + amortization calc; preview API (no write) |
| **C** | Split queue UI + apply to Firefly |
| **D** | Amortization schedule on loan detail page |
| **E** | Auto-queue on fetch / webhook; optional auto-apply for high confidence |

Start with **A + B + C** (assist mode). Semi-auto and schedule are follow-ons.

## Edge cases

| Case | Handling |
|------|----------|
| Extra principal payment | Different amount/description → no match, or separate profile with `max_per_month` |
| Multiple loans, same generic payee | Distinct `expected_amount` and/or optional `import_destination_account` |
| Already split journal | Skip (`split_count > 1`) |
| Rate change (ARM) | Update Firefly interest or `rate_override`; forward only |
| Escrow-only change | Update `expected_amount` + `escrow_amount` in profile |
| Duplicate import | Same journal id twice — Firefly dedupes; queue shows one item |
| Penny rounding | Adjust principal by ±$0.01 so sum equals payment |

## Analytics impact

Once splits exist in Firefly, the existing OMNI pipeline needs no special cases:

- Interest and escrow withdrawals appear in spending/cash-flow charts under correct categories
- Principal transfers reduce liability balance; not counted as spending (`isSpendingExpense` already excludes non-CC transfers appropriately)
- MoM variance on Housing budget becomes meaningful (interest drifts slightly month to month)

## Security

- Firefly API token remains server-side only (existing pattern)
- Write endpoints are same trust boundary as read — proxy auth (Authelia) protects the app
- Validate account ids and amounts server-side before PATCH
- Never log full token or raw account notes in production logs

## Open questions (resolve during GSD planning)

1. Escrow: single expense account vs split into tax / insurance categories?
2. Forward-only vs one-time historical backfill tool?
3. Dashboard widget vs dedicated queue page for pending splits?
4. Webhook from Firefly vs poll on page load / cron?
5. Confirm Firefly liability balance semantics (pre-payment vs post-payment) with a live fixture test

## References

- Firefly split transactions: https://docs.firefly-iii.org/explanation/financial-concepts/transactions/
- Firefly split update API: https://docs.firefly-iii.org/references/firefly-iii/api/specials/
- Firefly liability split feature request: https://github.com/firefly-iii/firefly-iii/issues/1803
- Account structured metadata request: https://github.com/firefly-iii/firefly-iii/issues/11794
