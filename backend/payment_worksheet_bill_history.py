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
    """Last 12 calendar months: first day of month 11 months ago through today inclusive."""
    if today is None:
        today = date.today()
    year = today.year
    month = today.month - 11
    while month <= 0:
        month += 12
        year -= 1
    start = f"{year}-{month:02d}-01"
    end = today.isoformat()
    return start, end


def compute_bill_history_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate bill transaction rows into 12-month totals and averages."""
    monthly: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for row in rows:
        raw_date = row.get("date") or ""
        month_key = str(raw_date)[:7]
        if len(month_key) != 7:
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
