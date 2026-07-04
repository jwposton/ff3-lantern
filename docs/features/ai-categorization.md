# AI-Assisted Transaction Categorization & Rules

**Status:** Design — not yet planned or implemented  
**Captured:** 2026-06-30  
**App:** FF3 Lantern (`selfhosted/FF3 Lantern`)

## Problem

Bank imports (SimpleFin) often land in Firefly with **no category** (and sometimes no budget). Uncategorized rows show up as **Uncategorized** in Sankey, MoM variance, and budget drilldowns — making spending reports noisy and hiding real patterns.

Manual cleanup in Firefly works but is slow:

- Open each transaction, pick a category, save
- For recurring payees, create a **rule** so future imports auto-categorize

Firefly's built-in rule editor is capable but requires the user to think through trigger/action syntax. Many uncategorized rows share obvious payee fragments (`AMZN MKTP`, `SQ *COFFEE`, `PAYPAL *…`) that a model can map to existing categories quickly — if suggestions are **reviewed before anything is written**.

## Goal

FF3 Lantern should **surface** uncategorized transactions, **propose** category (and optionally budget) assignments via an LLM through [OpenRouter](https://openrouter.ai/), and let the user **approve** before:

1. **Direct categorize** — update the transaction's category (and budget) in Firefly via API, or
2. **Create rule** — create a Firefly rule that auto-categorizes matching future (and optionally past) transactions

Firefly remains the **system of record** for transactions, categories, budgets, and rules. FF3 Lantern owns AI prompting, suggestion quality, and the review/apply UX.

## Non-goals (initial version)

- Fully autonomous categorization without user approval
- Replacing Firefly's rule editor for advanced rule maintenance
- Creating new Firefly categories or budgets (pick from existing lists only)
- Splitting or retagging transfers (loan splits are a separate feature; see [loan-payment-splits.md](./loan-payment-splits.md))
- Training or hosting a custom model
- Bulk retroactive apply without per-batch review (optional later)

## Architecture

```
SimpleFin / bank import
        ↓
Firefly III (uncategorized withdrawals/deposits)
        ↓
FF3 Lantern: detect uncategorized → build AI context → OpenRouter
        ↓
Review queue (suggestions + confidence + rule vs direct recommendation)
        ↓
User approves / edits / dismisses
        ↓
PUT transaction (category)  OR  POST rule (+ optional fire rule)
        ↓
Existing analytics pipeline reads updated rows on next fetch
```

### System-of-record split

| Concern | Owner |
|---------|--------|
| Transactions, categories, budgets, rules | Firefly III |
| OpenRouter API key, model selection, prompt templates | FF3 Lantern backend (env + config) |
| Suggestion cache / review queue state | FF3 Lantern SQLite sidecar (see [Resolved decisions](#resolved-decisions)) |
| Review / apply UX | FF3 Lantern frontend |

**No Firefly-side config blob** is required for this feature (unlike loan profiles). Optional: store user preferences (default model, auto-suggest on load) in a small FF3 Lantern config file or env.

## What counts as "uncategorized"

Align with existing analytics labeling in `transaction_normalization.py` and `fireflySearch.ts`:

| Row | Include in queue? |
|-----|-------------------|
| Withdrawal/deposit with null `category_name` | **Yes** — primary target |
| Withdrawal with budget but no category | **Yes** |
| Transfer that received pseudo-label (`Transfer to …`, CC payment labels) | **No** — already labeled for charts |
| Row with any non-null category | **No** |
| Reconciliation / opening balance (if detectable) | **No** — exclude via type or tag filter |

Detection query (server-side over flat splits):

```
type in (withdrawal, deposit)
AND category_name is null/empty
AND NOT assign_transfer_labels would rewrite category
```

Optional date window: default **last 90 days** + user-selected range; cap batch size (e.g. 50 suggestions per run) to control cost.

## Two apply modes

### Mode A — Direct categorize (one transaction)

Use when the payee looks **one-off** or the user only wants to fix this row.

- `PUT /api/v1/transactions/{journal_id}` with full split payload
- Set `category_name` / `category_id` (and `budget_name` / `budget_id` when AI suggested and user kept it) on the relevant split line(s)
- Add tag **`ai-categorized`** on the journal (create tag in Firefly if missing)
- Set `apply_rules: false` on update to avoid double-processing while editing
- Include every split's `transaction_journal_id` (same constraint as loan splits)
- **User must click Approve** — no silent or batch auto-apply

### Mode B — Create Firefly rule (recurring pattern)

Use when the same description fragment appears on **multiple** uncategorized rows, or the model confidence is high that it will recur.

- **User must explicitly approve every rule** — FF3 Lantern never creates or activates rules without a confirm click on the rule draft (title, triggers, actions). No background rule creation.
- `POST /api/v1/rules` with:
  - `trigger`: `store-journal` (runs on new/edited transactions)
  - `triggers`: e.g. `description_contains: "AMZN MKTP"` (+ optional `transaction_type: withdrawal`)
  - `actions`: `set_category`; `set_budget` when AI suggested and user kept it in the draft; **`add_tag: ai-categorized`** always
  - `rule_group_title`: from `FF3LANTERN_RULE_GROUP` env (default `FF3 Lantern AI`; create group if missing)
- After user approval, **optional** backfill via **`POST /api/v1/rules/{id}/trigger`** — checkbox **default OFF**; user opts in after seeing test-hit count
- Before create, preview match count against cached splits (or **`GET /api/v1/rules/{id}/test`** post-create for verification)

**User choice:** Review UI shows AI recommendation (`direct` vs `rule`) but user can override. Rule path still requires one explicit **Create rule** approval — user does not approve each future matching row individually, but must review the full rule draft and test-hit summary first.

### When AI should prefer a rule

| Signal | Prefer |
|--------|--------|
| Same normalized description fingerprint appears ≥ 2 times in queue | Rule |
| Description contains stable merchant token (`NETFLIX`, `SPOTIFY`) | Rule |
| Amount varies but payee stable | Rule |
| Unique memo, unlikely to repeat | Direct |
| Low confidence (< threshold) | Direct with warning, or dismiss |

**Description fingerprint:** lowercase, strip digits/punctuation runs, collapse whitespace — used for grouping queue items, not sent as the only trigger (Firefly rule should use a human-readable substring the user can edit).

## AI integration (OpenRouter)

### Configuration

| Env var | Purpose |
|---------|---------|
| `OPENROUTER_API_KEY` | Server-side only; never exposed to frontend |
| `OPENROUTER_MODEL` | Default `openai/gpt-4o-mini`; override via env for harder merchants |
| `OPENROUTER_BASE_URL` | Optional override (default `https://openrouter.ai/api/v1`) |
| `FF3LANTERN_RULE_GROUP` | Firefly rule group title (default `FF3 Lantern AI`) |
| `FF3LANTERN_AI_TAG` | Tag applied on AI writes (default `ai-categorized`) |

Add to `.env.example`; document in README. Feature disabled gracefully when key missing (queue shows "AI not configured").

### Request shape

Use OpenRouter's OpenAI-compatible **`POST /chat/completions`** with **`response_format: json_object`** (or tool call) so output is structured.

**System prompt (sketch):**

- You categorize personal finance transactions for Firefly III.
- Output must use **only** category names from the provided list (exact string match).
- Optionally assign a budget from the provided budget list.
- Prefer existing user patterns shown in few-shot examples.
- Return confidence 0–1 and whether a **rule** is appropriate.
- Never invent categories or budgets.

**User payload per suggestion batch:**

```json
{
  "transaction": {
    "date": "2026-06-15",
    "type": "withdrawal",
    "amount": "47.23",
    "description": "AMZN MKTP US*AB1CD2EF3",
    "source_account": "Main Checking",
    "destination_account": "Amazon"
  },
  "allowed_categories": ["Groceries", "Shopping", "…"],
  "allowed_budgets": ["Essentials", "Discretionary", "…"],
  "similar_categorized_examples": [
    {
      "description": "AMZN MKTP US*XY9",
      "category": "Shopping",
      "budget": "Discretionary"
    }
  ],
  "existing_rules_summary": [
    "description_contains AMAZON → Shopping"
  ]
}
```

**Model response schema:**

```json
{
  "category": "Shopping",
  "budget": "Discretionary",
  "confidence": 0.92,
  "recommendation": "rule",
  "rule": {
    "title": "Amazon marketplace",
    "description_contains": "AMZN MKTP",
    "transaction_type": "withdrawal"
  },
  "rationale": "Matches prior Amazon purchases; payee token stable across imports."
}
```

Validate response server-side: category ∈ allowed list, budget ∈ allowed list or null, confidence numeric, rule fields present when `recommendation === "rule"`.

### Context minimization & privacy

- Send **one transaction at a time** (or one fingerprint group) per completion — not full ledger export
- Include at most **5** similar categorized examples (same destination account or description prefix)
- Include **rule titles + trigger summaries only**, not full rule bodies
- Do not send Firefly API token, account numbers, or notes to OpenRouter
- Log model id + token usage counts locally; do not log raw descriptions in production unless debug flag set

### Cost & rate limits

- Debounce: user clicks **Suggest** (or **Refresh suggestions**), not on every page load by default
- Cap concurrent OpenRouter calls (e.g. 3) with queue progress UI
- Store last suggestion per `journal_id` + model in **SQLite** to avoid re-billing on revisit or container restart
- Optional setting: max spend / max rows per session

## Review queue UX

### Surfaces

| Surface | Purpose |
|---------|---------|
| Sidebar **Categorize** (or `/manage/categorize`) | Primary queue |
| Drilldown link from **Uncategorized** Sankey/MoM node | Deep-link with date + `has_any_category:false` scope |
| Badge on dashboard | "N uncategorized in last 90 days" |

### Queue item card

Each item shows:

- Date, amount, description, accounts (from flat split)
- Proposed **category** + **budget** (dropdowns prefilled from AI, editable)
- Confidence badge + short rationale
- Toggle: **Apply to this transaction** vs **Create rule**
- Rule editor (when toggled): title, `description_contains`, optional amount bounds, test-hit count
- Actions: **Approve**, **Skip**, **Open in Firefly**
- Grouped view: "12 similar — suggest one rule" collapses duplicates

### Approval flows

**Flow 1 — Direct categorize**

1. User opens Categorize queue (filtered date range)
2. Clicks **Suggest** → backend calls OpenRouter for uncategorized rows
3. Reviews card, adjusts category if needed, clicks **Approve**
4. Backend writes transaction via Firefly API
5. Item leaves queue; analytics refresh on next fetch

**Flow 2 — Create rule**

1. Same queue; AI recommends rule for a fingerprint group
2. User edits trigger substring (e.g. trim to `AMZN MKTP`)
3. UI calls rule **test** endpoint → "Would match 8 transactions (3 uncategorized)"
4. User clicks **Create rule** → `POST /api/v1/rules`
5. Optional (checkbox **unchecked by default**): **Apply rule to existing** → `POST /rules/{id}/trigger` for date range
6. Matching uncategorized items cleared from queue (and future imports tagged via rule)

**Flow 3 — Dismiss**

- Skip removes item from session queue without Firefly write
- Optional "Don't suggest again for this description" → local dismiss list

## Firefly API requirements

### Read path extensions (`firefly_client.py`)

Today `fetch_splits` omits `description` and per-split journal ids — both are **required** for this feature (same gap noted in loan-payment-splits).

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/transactions` | Add `description`, `transaction_journal_id`, `notes` to flat splits |
| `GET /api/v1/categories` | Build allowed category list for prompts + dropdowns |
| `GET /api/v1/budgets` | Optional budget list |
| `GET /api/v1/rules` | Detect duplicate/overlapping rules before create |
| `GET /api/v1/rule-groups` | Resolve/create `FF3 Lantern AI` group |

### Write path (new)

| Endpoint | Purpose |
|----------|---------|
| `PUT /api/v1/transactions/{id}` | Apply category/budget to one journal |
| `POST /api/v1/rules` | Create approved rule |
| `GET /api/v1/rules/{id}/test` | Preview matches before create (if supported pre-store: use client-side match against cached splits) |
| `POST /api/v1/rules/{id}/trigger` | Backfill after rule create |

Reference: [Firefly Rules API](https://docs.firefly-iii.org/references/firefly-iii/api/), [transaction update](https://docs.firefly-iii.org/references/firefly-iii/api/specials/).

## Codebase touchpoints

### Existing (read path)

| File | Relevance |
|------|-----------|
| `backend/firefly_client.py` | Extend: descriptions, journal split ids, categories, budgets, rules |
| `backend/transaction_normalization.py` | `is_uncategorized_for_queue(row)` helper |
| `frontend/src/lib/fireflySearch.ts` | `has_any_category:false` drilldown already exists |
| `frontend/src/lib/sankey.ts` | "Uncategorized" label — link into categorize queue |

### New (backend)

| Module | Responsibility |
|--------|----------------|
| `backend/openrouter_client.py` | Chat completions, JSON schema validation, usage logging |
| `backend/categorization_context.py` | Build few-shot examples from categorized history |
| `backend/categorization_suggest.py` | Fingerprint grouping, prompt assembly, cache |
| `backend/categorization_apply.py` | Transaction PUT payload; rule POST payload |
| `backend/routes/categorize.py` | REST: list queue, suggest, apply, create rule, test rule |

### New (frontend)

| Surface | Purpose |
|---------|---------|
| `/manage/categorize` | Queue table/cards, suggest button, approve/skip |
| Rule preview drawer | Trigger editor + test-hit count |
| Settings section | Model picker (from allowlist), date range default |

## API sketch (for implementation)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/categorize/pending` | Uncategorized rows in date range (from Firefly or cache) |
| `POST` | `/api/categorize/suggest` | Body: `{ journal_ids?: string[], limit?: number }` → AI suggestions |
| `GET` | `/api/categorize/suggest/{journal_id}` | Cached suggestion for one row |
| `POST` | `/api/categorize/{journal_id}/apply` | Body: `{ category_id, budget_id? }` → PUT transaction |
| `POST` | `/api/categorize/rules/preview` | Body: rule draft → match count against cached splits |
| `POST` | `/api/categorize/rules` | Body: approved rule → POST Firefly rule |
| `POST` | `/api/categorize/rules/{id}/trigger` | Body: `{ start, end }` → backfill |
| `GET` | `/api/categorize/meta` | Categories, budgets, existing rule summaries, AI configured flag |

Query `pending` with `start`, `end`, `limit`, `group_by_fingerprint=true`.

## Delivery slices (suggested for GSD)

| Slice | Delivers |
|-------|----------|
| **A** | `description` + split journal ids on flat splits; `GET pending` + Uncategorized drilldown link |
| **B** | OpenRouter client + suggest endpoint; queue UI (read-only suggestions) |
| **C** | Direct apply (PUT transaction) with approval |
| **D** | Rule preview + create + optional trigger backfill |
| **E** | Fingerprint grouping, similar-example context, duplicate-rule detection |
| **F** | Auto-suggest on cron (deferred; v1 is poll + manual Suggest only) |

Start with **A + B + C** (manual suggest + direct apply). Rule creation (**D**) is the high-leverage follow-on for recurring imports.

**Queue refresh (v1):** Poll Firefly on categorize page load for pending rows; AI runs only when user clicks **Suggest** (no webhooks, no auto-suggest on load).

## Edge cases

| Case | Handling |
|------|----------|
| AI picks invalid category hallucination | Server rejects; show error, force user dropdown |
| Category exists but name ambiguous | Send category **id** + name to model; apply by id |
| Multi-split journal | Categorize spending split only; show journal-level preview |
| Rule would match already-categorized rows | Test count shows breakdown; user confirms before trigger |
| Duplicate rule exists | Warn with link to existing rule; skip create |
| Transfer uncategorized | Exclude from queue (pseudo-labels cover analytics) |
| Deposit (income) | Include; model may suggest revenue category or skip |
| OpenRouter down / rate limited | Retry with backoff; show degraded "manual only" mode |
| User has no categories in Firefly | Block feature; link to Firefly category setup |

## Analytics impact

Once categories are applied in Firefly:

- Sankey and MoM **Uncategorized** buckets shrink
- Budget→category drilldowns become meaningful for newly tagged payees
- No OMNI pipeline changes beyond reading updated `category_name` / `budget_name`

## Security

- `OPENROUTER_API_KEY` and `FIREFLY_API_TOKEN` server-side only (existing pattern)
- All writes require authenticated FF3 Lantern session (Authelia proxy)
- Validate category/budget ids against freshly fetched Firefly lists before PUT/POST
- User must explicitly click Approve — no silent writes
- Audit log (local): `{ timestamp, journal_id, action, category_id, rule_id?, model }`

## Resolved decisions

Captured 2026-06-30 during design review.

| # | Question | Decision |
|---|----------|----------|
| 1 | Suggestion cache storage | **SQLite** sidecar in FF3 Lantern — persists suggestions + audit log across restarts |
| 2 | Default OpenRouter model | **`openai/gpt-4o-mini`** — upgrade via `OPENROUTER_MODEL` env when needed |
| 3 | Rule actions (after user approval) | **`set_category` + `set_budget` when AI suggested and user kept it** in the rule draft; never auto-create rules |
| 4 | Backfill on rule create | **Opt-in, default OFF** — show test-hit count; user checks box to trigger |
| 5 | Discover new uncategorized rows | **Poll on categorize page load** + **manual Suggest**; no Firefly webhooks in v1 |
| 6 | Audit tag in Firefly | **Always** — `add_tag: ai-categorized` on direct apply and on every AI-created rule |
| 7 | Rule group name | Default **`FF3 Lantern AI`**, overridable via **`FF3LANTERN_RULE_GROUP`** env |

**Approval invariant:** Every write to Firefly (transaction update or rule create) requires an explicit user **Approve** / **Create rule** click. AI proposes only; FF3 Lantern never writes autonomously.

## References

- OpenRouter API: https://openrouter.ai/docs
- Firefly Rules API: https://docs.firefly-iii.org/references/firefly-iii/api/
- Firefly rule triggers/actions enums: https://api-docs.firefly-iii.org/
- Firefly transaction update: https://docs.firefly-iii.org/references/firefly-iii/api/specials/
- Existing drilldown filter: `has_any_category:false` in `frontend/src/lib/fireflySearch.ts`
- Related: [Loan & mortgage payment split automation](./loan-payment-splits.md)
