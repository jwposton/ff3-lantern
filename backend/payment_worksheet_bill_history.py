"""Bill history aggregation for worksheet-registered bills (PAY-19–PAY-21)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any


def _decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def bill_history_date_window(today: date | None = None) -> tuple[str, str]:
    """Fetch window: 12 complete months plus the current partial month through today.

    Span is (month - 12) through today so early in the month you still see the
    same month last year (e.g. July rent before this month's payment posts).
    Linked payments include the current month; stats drop the oldest fetched month.
    """
    if today is None:
        today = date.today()
    year = today.year
    month = today.month - 12
    while month <= 0:
        month += 12
        year -= 1
    start = f"{year}-{month:02d}-01"
    end = today.isoformat()
    return start, end


def bill_history_stats_month_range(today: date | None = None) -> tuple[str, str]:
    """Inclusive YYYY-MM range for stats: rolling 12 months through current (drops oldest fetched month)."""
    if today is None:
        today = date.today()
    end_key = f"{today.year}-{today.month:02d}"
    year = today.year
    month = today.month - 11
    while month <= 0:
        month += 12
        year -= 1
    start_key = f"{year}-{month:02d}"
    return start_key, end_key


def _month_in_stats_range(month_key: str, start_month: str, end_month: str) -> bool:
    return start_month <= month_key <= end_month


def compute_bill_history_stats(
    rows: list[dict[str, Any]],
    today: date | None = None,
) -> dict[str, Any]:
    """Aggregate rows into rolling 12-month totals and averages (drops oldest fetched month)."""
    stats_start, stats_end = bill_history_stats_month_range(today)
    monthly: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for row in rows:
        raw_date = row.get("date") or ""
        month_key = str(raw_date)[:7]
        if len(month_key) != 7:
            continue
        if not _month_in_stats_range(month_key, stats_start, stats_end):
            continue
        monthly[month_key] += abs(_decimal_amount(row.get("amount")))

    monthly_totals = [
        {"month": month, "total": _format_decimal(total)}
        for month, total in sorted(monthly.items())
    ]

    total = sum(monthly.values(), Decimal("0"))
    calendar_average = total / Decimal("12")

    active_months = [m for m in monthly.values() if m > 0]
    active_month_count = len(active_months)
    if active_month_count:
        active_month_average = sum(active_months, Decimal("0")) / Decimal(
            str(active_month_count)
        )
    else:
        active_month_average = Decimal("0")

    return {
        "total": _format_decimal(total),
        "calendar_average": _format_decimal(calendar_average),
        "active_month_average": _format_decimal(active_month_average),
        "active_month_count": active_month_count,
        "monthly_totals": monthly_totals,
    }
