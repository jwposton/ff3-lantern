"""Build bill suggestions from Firefly withdrawal history (DISC-01–DISC-12, #32)."""

from __future__ import annotations

import re
import statistics
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

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


def _metrics_to_suggestion(metrics: dict[str, Any]) -> dict[str, Any]:
    confidence = _score_confidence(metrics)
    status = _assign_status(confidence)
    return {
        "merchant": metrics["merchant"],
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
        "category": metrics["category"],
        "payment_source": metrics["payment_source"],
        "sample_descriptions": metrics["sample_descriptions"],
    }


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
    _ = accounts, firefly_bills, registry_rows

    parsed = [row for row in (_parse_withdrawal(split) for split in splits) if row is not None]
    groups = _group_withdrawals(parsed)

    suggestions: list[dict[str, Any]] = []
    for key, txns in groups.items():
        metrics = _analyze_group(key, txns)
        if metrics is None:
            continue
        if not _is_recurring_candidate(metrics):
            continue
        suggestions.append(_metrics_to_suggestion(metrics))

    return {
        "data": suggestions,
        "meta": {
            "withdrawals_analyzed": len(parsed),
            "suggestions_count": len(suggestions),
            "period_start": period_start,
            "period_end": period_end,
        },
    }
