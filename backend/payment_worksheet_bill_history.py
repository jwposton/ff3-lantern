"""Bill history aggregation for worksheet-registered bills (PAY-19–PAY-21)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

import app_clock


def _decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _month_key_for_date(value: date) -> str:
    return f"{value.year}-{value.month:02d}"


def _month_key_offset(today: date, months_back: int) -> str:
    year = today.year
    month = today.month - months_back
    while month <= 0:
        month += 12
        year -= 1
    return f"{year}-{month:02d}"


def bill_history_date_window(today: date | None = None) -> tuple[str, str]:
    """Fetch window: 12 complete months plus the current partial month through today.

    Span is (month - 12) through today so early in the month you still see the
    same month last year (e.g. July rent before this month's payment posts).
    Stats use a conditional 12-month window — see ``bill_history_stats_month_range``.
    """
    if today is None:
        today = app_clock.today()
    year = today.year
    month = today.month - 12
    while month <= 0:
        month += 12
        year -= 1
    start = f"{year}-{month:02d}-01"
    end = today.isoformat()
    return start, end


def rows_have_current_month_payment(
    rows: list[dict[str, Any]],
    today: date | None = None,
) -> bool:
    """True when at least one linked payment falls in the current calendar month."""
    if today is None:
        today = app_clock.today()
    current_key = _month_key_for_date(today)
    for row in rows:
        month_key = str(row.get("date") or "")[:7]
        if month_key != current_key:
            continue
        if abs(_decimal_amount(row.get("amount"))) > 0:
            return True
    return False


def bill_history_stats_month_range(
    today: date | None = None,
    *,
    current_month_has_payment: bool,
) -> tuple[str, str]:
    """Inclusive YYYY-MM range for summary stats.

    When the current month has a linked payment, use current + prior 11 months
    (drop the oldest month from the 13-month fetch window). Otherwise use the
    12 complete months before the current month (keep last year's same-month hit).
    """
    if today is None:
        today = app_clock.today()
    if current_month_has_payment:
        return _month_key_offset(today, 11), _month_key_for_date(today)
    return _month_key_offset(today, 12), _month_key_offset(today, 1)


def _month_in_stats_range(month_key: str, start_month: str, end_month: str) -> bool:
    return start_month <= month_key <= end_month


def _month_key_tuple(month_key: str) -> tuple[int, int] | None:
    if len(month_key) != 7 or month_key[4] != "-":
        return None
    try:
        return int(month_key[:4]), int(month_key[5:7])
    except ValueError:
        return None


def compute_trailing_monthly_average(
    rows: list[dict[str, Any]],
    *,
    months: int = 3,
) -> Decimal | None:
    """Arithmetic mean of summed monthly payment totals over the trailing N months."""
    totals_by_month: dict[tuple[int, int], Decimal] = {}
    for row in rows:
        month_key = str(row.get("date") or "")[:7]
        key = _month_key_tuple(month_key)
        if key is None:
            continue
        totals_by_month[key] = totals_by_month.get(key, Decimal("0")) + abs(
            _decimal_amount(row.get("amount"))
        )

    if not totals_by_month:
        return None

    recent_keys = sorted(totals_by_month.keys())[-months:]
    month_totals = [totals_by_month[key] for key in recent_keys]
    return (
        sum(month_totals, Decimal("0")) / Decimal(len(month_totals))
    ).quantize(Decimal("0.01"))


def bill_amount_due_fetch_window(
    today: date | None = None,
    *,
    lookback_months: int = 4,
) -> tuple[str, str]:
    """Inclusive fetch window for trailing monthly averages on refresh."""
    if today is None:
        today = app_clock.today()
    start_month = _month_key_offset(today, lookback_months)
    return f"{start_month}-01", today.isoformat()


def compute_bill_history_stats(
    rows: list[dict[str, Any]],
    today: date | None = None,
) -> dict[str, Any]:
    """Aggregate rows into rolling 12-month totals and averages."""
    if today is None:
        today = app_clock.today()
    current_month_has_payment = rows_have_current_month_payment(rows, today)
    stats_start, stats_end = bill_history_stats_month_range(
        today,
        current_month_has_payment=current_month_has_payment,
    )
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
