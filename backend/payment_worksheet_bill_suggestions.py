"""Build bill suggestions from Firefly withdrawal history (DISC-01–DISC-12, #32)."""

from __future__ import annotations

import hashlib
import re
import statistics
from datetime import date, datetime
from decimal import ROUND_HALF_UP, ROUND_UP, Decimal, InvalidOperation
from typing import Any, Literal

import sidecar_db
from firefly_client import FireflyClient
from payment_worksheet_liabilities import is_liability_summary
from payment_worksheet_profiles import is_credit_card_asset
from transaction_normalization import description_fingerprint

LOOKBACK_CHOICES: tuple[int, ...] = (6, 12, 24)

BUCKET_ORDER: tuple[str, ...] = (
    "Streaming & Media",
    "AI & Dev Tools",
    "Hosting & Domains",
    "Utilities & Telecom",
    "Utilities — Trash",
    "Insurance",
    "Housing — Rent",
    "Apple Services",
    "Tickets & Events",
    "Other Recurring",
)

CONFIDENCE_RANK: dict[str, int] = {"high": 0, "medium": 1, "low": 2}

CATEGORY_BLOCKLIST: frozenset[str] = frozenset({
    "Restraunts",
    "Restaurants",
    "Groceries",
    "Gas",
    "Fast Food",
    "Coffee",
    "Shopping",
    "Entertainment",
    "Travel",
    "Rideshare",
    "Uber",
    "Lyft",
    "Parking",
    "Tolls",
    "Credit Card Interest",
    "Loan Payment",
    "Loan Interest",
    "Mortgage",
    "Mortgate interest",
})

LEGAL_SUFFIX_RE = re.compile(
    r"\b(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|ltd\.?|usa)\s*$",
    re.IGNORECASE,
)

GAS_MERCHANT_KEYWORDS: tuple[str, ...] = (
    "sunoco",
    "exxon",
    "shell",
    "chevron",
    "mobil",
    "texaco",
    "marathon",
    "speedway",
    "bp ",
    "circle k",
)

APPLE_CASH_P2P_RE = re.compile(r"APPLE CASH SENT MONEY", re.IGNORECASE)
CC_INTEREST_DESC_RE = re.compile(r"interest charge", re.IGNORECASE)

_BLOCKLIST_FOLDED: frozenset[str] = frozenset(c.casefold() for c in CATEGORY_BLOCKLIST)

_CATEGORY_BLOCK_ALIASES: frozenset[str] = frozenset({
    "restaurant",
    "restraunt",
    "gasoline",
    "fuel",
    "food & dining",
    "dining out",
    "grocery",
    "mortgage interest",
})

OPAQUE_NOTES = "Multiple subscriptions detected; sub-split rules in a future update"

PREAPPROVED_RE = re.compile(r"preapproved payment", re.IGNORECASE)


def _should_exclude_category(category: str) -> bool:
    """True when category matches D-06 blocklist (case-insensitive, with aliases)."""
    text = (category or "").strip()
    if not text:
        return False
    folded = text.casefold()
    if folded in _BLOCKLIST_FOLDED or folded in _CATEGORY_BLOCK_ALIASES:
        return True
    for blocked in _BLOCKLIST_FOLDED:
        if blocked in folded:
            return True
        stem = blocked.rstrip("s")
        if len(stem) >= 3 and stem in folded:
            return True
    for alias in _CATEGORY_BLOCK_ALIASES:
        if alias in folded:
            return True
    return False


def _account_summary(
    tx: dict[str, Any],
    accounts: dict[str, dict[str, Any]],
    *,
    side: str,
) -> dict[str, Any]:
    account_id = str(tx.get(f"{side}_id") or "")
    if account_id and account_id in accounts:
        return accounts[account_id]
    return {
        "type": tx.get(f"{side}_type") or "",
        "role": tx.get(f"{side}_role") or "",
    }


def _is_asset_account(summary: dict[str, Any]) -> bool:
    acct_type = (summary.get("type") or "").casefold()
    return "asset" in acct_type


def _is_gas_merchant(destination: str, category: str) -> bool:
    dest = (destination or "").casefold()
    if "gas" in (category or "").casefold():
        return True
    return any(keyword in dest for keyword in GAS_MERCHANT_KEYWORDS)


def _is_noise_transaction(tx: dict[str, Any], accounts: dict[str, dict[str, Any]]) -> bool:
    """Exclude D-06 noise: blocklisted categories, gas, P2P, interest, loans, internal transfers."""
    category = str(tx.get("category_name") or "")
    if _should_exclude_category(category):
        return True

    destination = str(tx.get("destination_name") or "")
    description = str(tx.get("description") or "")

    if _is_gas_merchant(destination, category):
        return True

    if APPLE_CASH_P2P_RE.search(description):
        return True

    if CC_INTEREST_DESC_RE.search(description) or category.casefold() == "credit card interest":
        return True

    dest_summary = _account_summary(tx, accounts, side="destination")
    if is_liability_summary(dest_summary):
        return True

    source_summary = _account_summary(tx, accounts, side="source")
    if _is_asset_account(source_summary) and _is_asset_account(dest_summary):
        if destination.strip() and not is_liability_summary(dest_summary):
            src_name = (source_summary.get("name") or str(tx.get("source_name") or "")).casefold()
            dst_name = (dest_summary.get("name") or destination).casefold()
            if src_name != dst_name:
                return True

    return False


def _subtract_months(end: date, months: int) -> date:
    """Return calendar date N months before end (day clamped to month length)."""
    year = end.year
    month = end.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(end.day, _days_in_month(year, month))
    return date(year, month, day)


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    first = date(year, month, 1)
    return (next_month - first).days


def _parse_withdrawal(split: dict[str, Any]) -> dict[str, Any] | None:
    """Keep only positive withdrawal splits."""
    if (split.get("type") or "").lower() != "withdrawal":
        return None
    try:
        amount = Decimal(str(split.get("amount") or "0")).copy_abs()
    except InvalidOperation:
        return None
    if amount <= 0:
        return None
    return {**split, "amount": amount}


def _split_subscription_id(row: dict[str, Any]) -> str | None:
    """Return Firefly subscription or bill linkage id when split is already linked."""
    for key in ("subscription_id", "bill_id"):
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _normalize_key(destination: str, description: str) -> str:
    """Group key: payee when present, else normalized description fingerprint."""
    payee = (destination or "").strip()
    if payee:
        return payee.lower()
    return description_fingerprint(description)


def _group_withdrawals(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Group parsed withdrawal rows by normalized payee/description key."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = _normalize_key(
            str(row.get("destination_name") or ""),
            str(row.get("description") or ""),
        )
        if not key:
            continue
        groups.setdefault(key, []).append(row)
    return groups


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _parse_date(value: str) -> date | None:
    text = (value or "")[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def _analyze_group(key: str, txns: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Compute recurrence metrics for a grouped withdrawal cluster."""
    _ = key
    dated: list[tuple[date, dict[str, Any]]] = []
    for txn in txns:
        parsed = _parse_date(str(txn.get("date") or ""))
        if parsed is not None:
            dated.append((parsed, txn))

    unique_dates = sorted({d for d, _ in dated})
    if len(unique_dates) < 2:
        return None

    amounts = [txn["amount"] for _, txn in dated if isinstance(txn.get("amount"), Decimal)]
    if not amounts:
        return None

    amount_min = min(amounts)
    amount_max = max(amounts)
    amount_avg = sum(amounts, Decimal("0")) / Decimal(len(amounts))

    if amount_avg > 0:
        max_dev = max(abs(a - amount_avg) for a in amounts)
        amt_variance_pct = float((max_dev / amount_avg) * Decimal("100"))
    else:
        amt_variance_pct = 0.0

    gaps: list[int] = []
    for prev, curr in zip(unique_dates, unique_dates[1:]):
        gaps.append((curr - prev).days)

    avg_gap_days = sum(gaps) / len(gaps) if gaps else 0.0
    gap_std = statistics.pstdev(gaps) if len(gaps) >= 2 else 0.0
    if avg_gap_days > 0:
        regularity = 1.0 - min(gap_std / avg_gap_days, 1.0)
    else:
        regularity = 0.0

    latest_txn = max(dated, key=lambda item: item[0])[1]
    last_date = unique_dates[-1].isoformat()
    first_date = unique_dates[0].isoformat()
    payment_source = str(latest_txn.get("source_name") or "")
    category = str(latest_txn.get("category_name") or "")
    merchant = str(latest_txn.get("destination_name") or "").strip() or key
    descriptions = sorted({
        str(txn.get("description") or "").strip()
        for _, txn in dated
        if str(txn.get("description") or "").strip()
    })

    freq = _classify_freq(avg_gap_days)

    return {
        "occurrences": len(unique_dates),
        "amount_min": amount_min,
        "amount_max": amount_max,
        "amount_avg": amount_avg,
        "amt_variance_pct": amt_variance_pct,
        "gaps": gaps,
        "avg_gap_days": avg_gap_days,
        "gap_std": gap_std,
        "regularity": regularity,
        "freq": freq,
        "last_date": last_date,
        "first_date": first_date,
        "payment_source": payment_source,
        "category": category,
        "merchant": merchant,
        "sample_descriptions": descriptions[:3],
    }


def _classify_freq(avg_gap_days: float) -> str:
    if 25 <= avg_gap_days <= 35:
        return "monthly"
    if 12 <= avg_gap_days <= 18:
        return "biweekly"
    if 85 <= avg_gap_days <= 100:
        return "quarterly"
    if 350 <= avg_gap_days <= 380:
        return "annual"
    return "irregular"


def _is_fixed_subscription(metrics: dict[str, Any]) -> bool:
    return (
        metrics["amt_variance_pct"] < 3
        and metrics["occurrences"] >= 3
        and metrics["amount_avg"] <= Decimal("200")
    )


def _is_utility_like(metrics: dict[str, Any]) -> bool:
    return (
        metrics["amount_avg"] > Decimal("40")
        and metrics["regularity"] >= 0.4
        and metrics["occurrences"] >= 3
    )


def _is_recurring_candidate(metrics: dict[str, Any]) -> bool:
    freq = metrics["freq"]
    if freq == "monthly" and metrics["regularity"] >= 0.5 and metrics["occurrences"] >= 3:
        return True
    if freq in ("annual", "quarterly") and metrics["occurrences"] >= 2:
        return True
    if _is_fixed_subscription(metrics):
        return True
    if _is_utility_like(metrics):
        return True
    return False


def _score_confidence(metrics: dict[str, Any]) -> Literal["high", "medium", "low"]:
    freq = metrics["freq"]
    if (
        freq == "monthly"
        and metrics["regularity"] >= 0.7
        and metrics["occurrences"] >= 3
        and metrics["amt_variance_pct"] < 5
    ):
        return "high"
    if (
        (freq == "monthly" and metrics["regularity"] >= 0.5)
        or _is_fixed_subscription(metrics)
        or _is_utility_like(metrics)
    ):
        return "medium"
    return "low"


def _assign_status(
    confidence: str,
    *,
    is_opaque_combined: bool = False,
) -> Literal["ready", "review"]:
    if is_opaque_combined:
        return "review"
    if confidence == "high":
        return "ready"
    return "review"


def _friendly_merchant_name(raw_payee: str) -> str:
    text = (raw_payee or "").strip()
    if not text:
        return ""
    while True:
        stripped = LEGAL_SUFFIX_RE.sub("", text).strip()
        if stripped == text:
            break
        text = stripped
    words: list[str] = []
    for word in text.split():
        if word.isupper() and len(word) <= 4:
            words.append(word)
        elif "&" in word:
            words.append(word)
        else:
            words.append(word.capitalize())
    return " ".join(words)


def _pad_amounts(
    amount_min: Decimal,
    amount_max: Decimal,
    *,
    pct: Decimal = Decimal("0.05"),
) -> tuple[str, str]:
    lo = (amount_min * (Decimal("1") - pct)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    hi = (amount_max * (Decimal("1") + pct)).quantize(Decimal("0.01"), ROUND_UP)
    return f"{lo}", f"{hi}"


def _assign_bucket(
    merchant: str,
    category: str,
    description: str,
    *,
    is_opaque: bool = False,
) -> str:
    if is_opaque:
        return "Apple Services"
    merchant_lower = merchant.casefold()
    category_lower = category.casefold()
    description_lower = description.casefold()
    if "spotify" in merchant_lower or "music streaming" in category_lower:
        return "Streaming & Media"
    if "all american waste" in merchant_lower or "trash" in category_lower:
        return "Utilities — Trash"
    if any(token in category_lower for token in ("streaming", "media")):
        return "Streaming & Media"
    if "utility" in category_lower or "telecom" in category_lower:
        return "Utilities & Telecom"
    if "insurance" in category_lower or "insurance" in merchant_lower:
        return "Insurance"
    if "rent" in category_lower or "rent" in merchant_lower:
        return "Housing — Rent"
    if "hosting" in merchant_lower or "domain" in merchant_lower:
        return "Hosting & Domains"
    if "ticket" in merchant_lower or "event" in description_lower:
        return "Tickets & Events"
    if any(token in merchant_lower for token in ("openai", "anthropic", "github", "cursor")):
        return "AI & Dev Tools"
    return "Other Recurring"


def _recommend_amount_mode(metrics: dict[str, Any]) -> Literal["recurring", "intermittent"]:
    if metrics["amt_variance_pct"] <= 10 and metrics["regularity"] >= 0.5:
        return "recurring"
    return "intermittent"


def _infer_payment_rail(
    txns: list[dict[str, Any]],
    accounts: dict[str, dict[str, Any]],
) -> Literal["bank", "credit_card"]:
    latest = max(txns, key=lambda txn: str(txn.get("date") or ""))
    source_id = str(latest.get("source_id") or "")
    summary = accounts.get(source_id, {})
    attrs = {
        "type": summary.get("type") or latest.get("source_type") or "",
        "account_role": summary.get("role") or latest.get("source_role") or "",
    }
    if summary.get("role") == "Credit card" or is_credit_card_asset(attrs):
        return "credit_card"
    return "bank"


def _is_opaque_payee_cluster(txns: list[dict[str, Any]]) -> bool:
    descriptions = {str(txn.get("description") or "").strip() for txn in txns}
    if not any(PREAPPROVED_RE.search(desc) for desc in descriptions):
        return False
    categories = {
        str(txn.get("category_name") or "").strip()
        for txn in txns
        if str(txn.get("category_name") or "").strip()
    }
    payees = {
        str(txn.get("destination_name") or "").casefold()
        for txn in txns
    }
    if any("apple.com/bill" in p for p in payees):
        amounts = {
            txn.get("amount")
            for txn in txns
            if isinstance(txn.get("amount"), Decimal)
        }
        return len(categories) >= 2 or len(amounts) >= 2
    return len(categories) >= 2


def _freq_to_repeat_freq(freq: str) -> str | None:
    mapping: dict[str, str | None] = {
        "monthly": "monthly",
        "biweekly": "every 2 weeks",
        "quarterly": "every 3 months",
        "annual": "yearly",
        "irregular": None,
    }
    return mapping.get(freq, "monthly")


def _build_register_prefill(
    metrics: dict[str, Any],
    txns: list[dict[str, Any]],
    accounts: dict[str, dict[str, Any]],
    *,
    raw_payee: str,
    is_opaque: bool = False,
) -> dict[str, Any]:
    friendly = _friendly_merchant_name(raw_payee)
    amount_min, amount_max = _pad_amounts(metrics["amount_min"], metrics["amount_max"])
    freq = metrics["freq"]
    if freq == "irregular":
        amount_mode: Literal["recurring", "intermittent"] = "intermittent"
        repeat_freq = None
    else:
        amount_mode = _recommend_amount_mode(metrics)
        repeat_freq = _freq_to_repeat_freq(freq)
    return {
        "mode": "create_new",
        "name": friendly,
        "amount_mode": amount_mode,
        "amount_min": amount_min,
        "amount_max": amount_max,
        "repeat_freq": repeat_freq,
        "worksheet_section": "bills",
        "payment_rail": _infer_payment_rail(txns, accounts),
        "destination_account": raw_payee,
        "category_name": "" if is_opaque else metrics["category"],
        "description_contains": "",
        "amount_exactly": None,
    }


def _make_suggestion_id(key: str) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return f"sug-{digest}"


def _build_reasons(metrics: dict[str, Any], *, is_opaque: bool) -> list[str]:
    reasons: list[str] = []
    if metrics["freq"] == "monthly" and metrics["regularity"] >= 0.7:
        reasons.append("regular_monthly")
    if metrics["amt_variance_pct"] < 5:
        reasons.append("stable_amount")
    if is_opaque:
        reasons.append("opaque_payee")
    return reasons


def _is_already_registered(
    key: str,
    metrics: dict[str, Any],
    *,
    registry_rows: list[dict[str, Any]],
    firefly_bills: list[dict[str, Any]],
    registered_bill_ids: set[str],
    txns: list[dict[str, Any]] | None = None,
) -> bool:
    """Skip suggestions already represented in worksheet registry or Firefly bills."""
    if txns:
        for txn in txns:
            linked_id = _split_subscription_id(txn)
            if linked_id and linked_id in registered_bill_ids:
                return True

    friendly = _friendly_merchant_name(str(metrics.get("merchant") or key))
    raw_payee = str(metrics.get("merchant") or key).strip() or key
    labels = {friendly.casefold(), raw_payee.casefold(), key.casefold()}

    registered_labels = {
        str(row.get("row_label") or "").casefold()
        for row in registry_rows
        if row.get("row_label")
    }
    if labels & registered_labels:
        return True

    bill_names = {
        str(bill.get("name") or "").casefold(): str(bill.get("id") or "")
        for bill in firefly_bills
    }
    for label in labels:
        bill_id = bill_names.get(label)
        if bill_id and bill_id in registered_bill_ids:
            return True

    return False


def _sort_suggestions(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket_rank = {name: index for index, name in enumerate(BUCKET_ORDER)}

    def sort_key(item: dict[str, Any]) -> tuple[int, int, int, str]:
        bucket = item.get("bucket") or "Other Recurring"
        confidence = str(item.get("confidence") or "low")
        return (
            bucket_rank.get(bucket, len(BUCKET_ORDER)),
            CONFIDENCE_RANK.get(confidence, 99),
            -int(item.get("occurrences") or 0),
            str(item.get("last_date") or ""),
        )

    return sorted(items, key=sort_key)


def _enrich_suggestion(
    key: str,
    txns: list[dict[str, Any]],
    metrics: dict[str, Any],
    accounts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    raw_payee = str(metrics["merchant"] or key).strip() or key
    is_opaque = _is_opaque_payee_cluster(txns)
    friendly = _friendly_merchant_name(raw_payee)
    confidence = _score_confidence(metrics)
    status = _assign_status(confidence, is_opaque_combined=is_opaque)
    latest_category = metrics["category"]
    bucket = _assign_bucket(
        raw_payee,
        latest_category,
        " ".join(metrics.get("sample_descriptions") or []),
        is_opaque=is_opaque,
    )
    register_prefill = _build_register_prefill(
        metrics,
        txns,
        accounts,
        raw_payee=raw_payee,
        is_opaque=is_opaque,
    )
    suggestion: dict[str, Any] = {
        "id": _make_suggestion_id(key),
        "merchant": friendly,
        "confidence": confidence,
        "status": status,
        "amount_min": _format_decimal(metrics["amount_min"]),
        "amount_max": _format_decimal(metrics["amount_max"]),
        "amount_avg": _format_decimal(metrics["amount_avg"]),
        "occurrences": metrics["occurrences"],
        "freq": metrics["freq"],
        "regularity": round(metrics["regularity"], 2),
        "last_date": metrics["last_date"],
        "first_date": metrics["first_date"],
        "category": latest_category,
        "payment_source": metrics["payment_source"],
        "sample_descriptions": metrics["sample_descriptions"],
        "bucket": bucket,
        "cluster": None,
        "register_prefill": register_prefill,
        "reasons": _build_reasons(metrics, is_opaque=is_opaque),
    }
    if is_opaque:
        suggestion["notes"] = OPAQUE_NOTES
    return suggestion


async def fetch_bill_suggestions(
    client: FireflyClient,
    *,
    lookback_months: int = 12,
) -> dict[str, Any]:
    """Fetch Firefly data and build bill suggestions (compute-on-demand, read-only sidecar)."""
    if lookback_months not in LOOKBACK_CHOICES:
        raise ValueError("lookback_months must be 6, 12, or 24.")
    period_end = date.today()
    period_start = _subtract_months(period_end, lookback_months)
    start_iso = period_start.isoformat()
    end_iso = period_end.isoformat()
    splits = await client.fetch_splits(start_iso, end_iso)
    accounts = await client.fetch_accounts()
    bills = await client.fetch_bills()
    registry_rows = await sidecar_db.list_worksheet_registry()
    return build_bill_suggestions(
        splits,
        accounts=accounts,
        firefly_bills=bills,
        registry_rows=registry_rows,
        period_start=start_iso,
        period_end=end_iso,
    )


def build_bill_suggestions(
    splits: list[dict[str, Any]],
    *,
    accounts: dict[str, dict[str, Any]],
    firefly_bills: list[dict[str, Any]],
    registry_rows: list[dict[str, Any]],
    period_start: str,
    period_end: str,
) -> dict[str, Any]:
    """Pure engine — primary unit-test entry point."""
    registered_bill_ids = {
        str(row["firefly_bill_id"])
        for row in registry_rows
        if row.get("firefly_bill_id")
    }

    parsed = [row for row in (_parse_withdrawal(split) for split in splits) if row is not None]
    filtered = [row for row in parsed if not _is_noise_transaction(row, accounts)]
    filtered = [row for row in filtered if _split_subscription_id(row) is None]
    groups = _group_withdrawals(filtered)

    suggestions: list[dict[str, Any]] = []
    for key, txns in groups.items():
        metrics = _analyze_group(key, txns)
        if metrics is None:
            continue
        if not _is_recurring_candidate(metrics):
            continue
        if _is_already_registered(
            key,
            metrics,
            registry_rows=registry_rows,
            firefly_bills=firefly_bills,
            registered_bill_ids=registered_bill_ids,
            txns=txns,
        ):
            continue
        suggestions.append(_enrich_suggestion(key, txns, metrics, accounts))

    sorted_suggestions = _sort_suggestions(suggestions)

    return {
        "data": sorted_suggestions,
        "meta": {
            "withdrawals_analyzed": len(parsed),
            "suggestions_count": len(sorted_suggestions),
            "period_start": period_start,
            "period_end": period_end,
        },
    }
