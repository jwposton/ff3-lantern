"""Build bill suggestions from Firefly withdrawal history (DISC-01–DISC-12, #32)."""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

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
    return {
        "data": [],
        "meta": {
            "withdrawals_analyzed": 0,
            "suggestions_count": 0,
            "period_start": period_start,
            "period_end": period_end,
        },
    }
