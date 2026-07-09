"""Deterministic intermittent bill forecast for payment worksheet (#95).

Intermittent forecast treats linked payment gap history as the authoritative cadence
source; Firefly ``repeat_freq`` is used only when gap classification is irregular.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

import app_clock
from payment_worksheet_bill_history import bill_history_date_window
from payment_worksheet_bill_suggestions import _classify_freq

ADVISORY_NOTE = "Advisory — verify before planning"

_MONTH_LABELS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)

_FIREFLY_REPEAT_FREQ: dict[str, str] = {
    "monthly": "monthly",
    "quarterly": "quarterly",
    "weekly": "biweekly",
    "yearly": "annual",
    "half-yearly": "annual",
}


def _decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _parse_row_date(value: Any) -> date | None:
    raw = str(value or "")[:10]
    if len(raw) < 10:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _payment_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payments: list[dict[str, Any]] = []
    for row in rows:
        if abs(_decimal_amount(row.get("amount"))) <= 0:
            continue
        if _parse_row_date(row.get("date")) is None:
            continue
        payments.append(row)
    return payments


def _avg_gap_days(payments: list[dict[str, Any]]) -> float:
    dates = sorted(
        parsed
        for parsed in (_parse_row_date(row.get("date")) for row in payments)
        if parsed is not None
    )
    if len(dates) < 2:
        return 0.0
    gaps = [(dates[index + 1] - dates[index]).days for index in range(len(dates) - 1)]
    return sum(gaps) / len(gaps)


def _normalize_repeat_freq(repeat_freq: str | None) -> str | None:
    if repeat_freq is None:
        return None
    normalized = str(repeat_freq).strip().lower()
    if not normalized:
        return None
    return _FIREFLY_REPEAT_FREQ.get(normalized, normalized)


def _rows_in_window(
    payments: list[dict[str, Any]],
    *,
    today: date,
    months: int,
) -> list[dict[str, Any]]:
    start, end = bill_history_date_window(today, months=months)
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)
    scoped: list[dict[str, Any]] = []
    for row in payments:
        row_date = _parse_row_date(row.get("date"))
        if row_date is None:
            continue
        if start_date <= row_date <= end_date:
            scoped.append(row)
    return scoped


def _format_active_month_labels(active_months: list[int]) -> str:
    if not active_months:
        return ""
    if len(active_months) == 1:
        return _MONTH_LABELS[active_months[0] - 1]
    first = _MONTH_LABELS[active_months[0] - 1]
    last = _MONTH_LABELS[active_months[-1] - 1]
    return f"{first}–{last}"


def detect_seasonal_active_months(
    rows: list[dict[str, Any]],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """Calendar-month clustering across years (D-14–D-15)."""
    if today is None:
        today = app_clock.today()
    payments = _payment_rows(rows)
    scoped = _rows_in_window(payments, today=today, months=24)
    month_years: dict[int, set[int]] = defaultdict(set)
    years_with_data: set[int] = set()
    for row in scoped:
        row_date = _parse_row_date(row.get("date"))
        if row_date is None:
            continue
        month_years[row_date.month].add(row_date.year)
        years_with_data.add(row_date.year)

    active_months = sorted(
        month for month, years in month_years.items() if len(years) >= 2
    )
    detected = (
        len(active_months) > 0
        and len(active_months) < 12
        and len(years_with_data) >= 2
    )
    return {
        "detected": detected,
        "active_months": active_months if detected else [],
        "active_month_labels": _format_active_month_labels(active_months) if detected else None,
    }


def _last_payment_date(payments: list[dict[str, Any]]) -> str | None:
    dates = [
        parsed
        for parsed in (_parse_row_date(row.get("date")) for row in payments)
        if parsed is not None
    ]
    if not dates:
        return None
    return max(dates).isoformat()


def _mean_last_n(
    payments: list[dict[str, Any]],
    *,
    max_n: int = 3,
    min_payments: int = 2,
) -> tuple[str | None, int]:
    if len(payments) < min_payments:
        return None, 0
    ordered = sorted(
        payments,
        key=lambda row: str(row.get("date") or ""),
        reverse=True,
    )[:max_n]
    amounts = [_decimal_amount(row.get("amount")).copy_abs() for row in ordered]
    mean = sum(amounts, Decimal("0")) / Decimal(len(amounts))
    return _format_decimal(mean), len(ordered)


def _worksheet_month_number(month_key: str) -> int:
    return int(month_key.split("-", 1)[1])


def _base_forecast(
    month: str,
    *,
    likelihood: str,
    suggested_amount: str | None,
    basis: str | None,
    n: int,
    lookback_months: int,
    seasonal: dict[str, Any],
    cadence_label: str,
    last_payment_date: str | None,
) -> dict[str, Any]:
    return {
        "month": month,
        "likelihood": likelihood,
        "suggested_amount": suggested_amount,
        "basis": basis,
        "n": n,
        "lookback_months": lookback_months,
        "seasonal": seasonal,
        "cadence_label": cadence_label,
        "last_payment_date": last_payment_date,
        "note": ADVISORY_NOTE,
    }


def _cadence_label_from_freq(freq: str, *, seasonal_detected: bool) -> str:
    if seasonal_detected:
        return "within-season"
    if freq == "annual":
        return "annual"
    if freq == "monthly":
        return "monthly"
    if freq == "bimonthly":
        return "bimonthly"
    if freq == "quarterly":
        return "quarterly"
    if freq == "biweekly":
        return "biweekly"
    return "irregular"


def _resolve_lookback_months(
    *,
    freq: str,
    seasonal_detected: bool,
) -> int:
    # Payload lookback_months is the semantic amount/gap window (A3), not fetch width.
    if seasonal_detected or freq == "annual":
        return 24
    if freq in {"monthly", "bimonthly", "quarterly", "biweekly"}:
        return 12
    return 24


def _payments_in_active_season(
    payments: list[dict[str, Any]],
    active_months: list[int],
) -> list[dict[str, Any]]:
    active = set(active_months)
    return [
        row
        for row in payments
        if (_parsed := _parse_row_date(row.get("date"))) is not None
        and _parsed.month in active
    ]


_REGULAR_GAP_CADENCES = frozenset(
    {"monthly", "bimonthly", "quarterly", "biweekly", "annual"}
)


def _sparse_seasonal_confidence_failure(
    payments: list[dict[str, Any]],
    *,
    today: date,
    seasonal: dict[str, Any],
) -> bool:
    """D-18: clustered months without multi-year hits → unknown, no flat-gap amount."""
    if seasonal.get("detected"):
        return False
    gap_freq = _classify_freq(_avg_gap_days(payments))
    if gap_freq in _REGULAR_GAP_CADENCES:
        return False
    scoped = _rows_in_window(payments, today=today, months=24)
    months_hit: set[int] = set()
    month_years: dict[int, set[int]] = defaultdict(set)
    for row in scoped:
        row_date = _parse_row_date(row.get("date"))
        if row_date is None:
            continue
        months_hit.add(row_date.month)
        month_years[row_date.month].add(row_date.year)
    if len(months_hit) < 4 or len(months_hit) >= 12:
        return False
    return not any(len(years) >= 2 for years in month_years.values())


def _months_between_calendar(start: date, end_year: int, end_month: int) -> int:
    return (end_year - start.year) * 12 + (end_month - start.month)


def _is_bimonthly_on_month(
    last_payment: date,
    *,
    worksheet_year: int,
    worksheet_month: int,
) -> bool:
    """True when worksheet month aligns with every-other-month cadence from last payment."""
    months_elapsed = _months_between_calendar(
        last_payment,
        worksheet_year,
        worksheet_month,
    )
    if months_elapsed <= 0:
        return False
    return months_elapsed % 2 == 0


def _month_has_historical_payment(
    payments: list[dict[str, Any]],
    *,
    worksheet_month: int,
) -> bool:
    for row in payments:
        row_date = _parse_row_date(row.get("date"))
        if row_date is None:
            continue
        if row_date.month == worksheet_month:
            return True
    return False


def compute_intermittent_bill_forecast(
    rows: list[dict[str, Any]],
    *,
    month: str,
    repeat_freq: str | None,
    today: date | None = None,
) -> dict[str, Any]:
    """Pure forecast dict for the worksheet month (WS-04–WS-06)."""
    if today is None:
        today = app_clock.today()
    payments = _payment_rows(rows)
    seasonal = detect_seasonal_active_months(payments, today=today)
    last_payment_date = _last_payment_date(payments)

    if len(payments) < 2:
        return _base_forecast(
            month,
            likelihood="unknown",
            suggested_amount=None,
            basis=None,
            n=0,
            lookback_months=12,
            seasonal=seasonal,
            cadence_label="insufficient-history",
            last_payment_date=last_payment_date,
        )

    gap_freq = _classify_freq(_avg_gap_days(payments))
    if gap_freq != "irregular":
        freq = gap_freq
    else:
        freq = _normalize_repeat_freq(repeat_freq) or "irregular"
    lookback_months = _resolve_lookback_months(
        freq=freq,
        seasonal_detected=bool(seasonal["detected"]),
    )

    if _sparse_seasonal_confidence_failure(payments, today=today, seasonal=seasonal):
        return _base_forecast(
            month,
            likelihood="unknown",
            suggested_amount=None,
            basis=None,
            n=0,
            lookback_months=24,
            seasonal=seasonal,
            cadence_label="sparse-seasonal",
            last_payment_date=last_payment_date,
        )

    scoped = _rows_in_window(payments, today=today, months=lookback_months)
    worksheet_month = _worksheet_month_number(month)
    cadence_label = _cadence_label_from_freq(freq, seasonal_detected=bool(seasonal["detected"]))

    if seasonal["detected"]:
        active_months = list(seasonal["active_months"])
        if worksheet_month not in active_months:
            return _base_forecast(
                month,
                likelihood="unlikely",
                suggested_amount=None,
                basis=None,
                n=0,
                lookback_months=lookback_months,
                seasonal=seasonal,
                cadence_label="off-season",
                last_payment_date=last_payment_date,
            )
        in_season = _payments_in_active_season(scoped, active_months)
        suggested_amount, n = _mean_last_n(in_season)
        if suggested_amount is None:
            return _base_forecast(
                month,
                likelihood="unknown",
                suggested_amount=None,
                basis=None,
                n=0,
                lookback_months=lookback_months,
                seasonal=seasonal,
                cadence_label=cadence_label,
                last_payment_date=last_payment_date,
            )
        return _base_forecast(
            month,
            likelihood="likely",
            suggested_amount=suggested_amount,
            basis="mean_last_n",
            n=n,
            lookback_months=lookback_months,
            seasonal=seasonal,
            cadence_label=cadence_label,
            last_payment_date=last_payment_date,
        )

    if freq == "annual":
        if not _month_has_historical_payment(scoped, worksheet_month=worksheet_month):
            return _base_forecast(
                month,
                likelihood="unlikely",
                suggested_amount=None,
                basis=None,
                n=0,
                lookback_months=lookback_months,
                seasonal=seasonal,
                cadence_label="annual-off-month",
                last_payment_date=last_payment_date,
            )
        suggested_amount, n = _mean_last_n(
            [
                row
                for row in scoped
                if (_parsed := _parse_row_date(row.get("date"))) is not None
                and _parsed.month == worksheet_month
            ]
        )
        if suggested_amount is None:
            return _base_forecast(
                month,
                likelihood="unknown",
                suggested_amount=None,
                basis=None,
                n=0,
                lookback_months=lookback_months,
                seasonal=seasonal,
                cadence_label=cadence_label,
                last_payment_date=last_payment_date,
            )
        return _base_forecast(
            month,
            likelihood="likely",
            suggested_amount=suggested_amount,
            basis="mean_last_n",
            n=n,
            lookback_months=lookback_months,
            seasonal=seasonal,
            cadence_label=cadence_label,
            last_payment_date=last_payment_date,
        )

    if freq == "bimonthly":
        last_parsed = _parse_row_date(last_payment_date)
        worksheet_year = int(month.split("-", 1)[0])
        if last_parsed is None or not _is_bimonthly_on_month(
            last_parsed,
            worksheet_year=worksheet_year,
            worksheet_month=worksheet_month,
        ):
            return _base_forecast(
                month,
                likelihood="unlikely",
                suggested_amount=None,
                basis=None,
                n=0,
                lookback_months=lookback_months,
                seasonal=seasonal,
                cadence_label="bimonthly-off-month",
                last_payment_date=last_payment_date,
            )
        suggested_amount, n = _mean_last_n(scoped)
        if suggested_amount is None:
            return _base_forecast(
                month,
                likelihood="unknown",
                suggested_amount=None,
                basis=None,
                n=0,
                lookback_months=lookback_months,
                seasonal=seasonal,
                cadence_label=cadence_label,
                last_payment_date=last_payment_date,
            )
        return _base_forecast(
            month,
            likelihood="likely",
            suggested_amount=suggested_amount,
            basis="mean_last_n",
            n=n,
            lookback_months=lookback_months,
            seasonal=seasonal,
            cadence_label=cadence_label,
            last_payment_date=last_payment_date,
        )

    if freq in {"monthly", "quarterly", "biweekly"}:
        suggested_amount, n = _mean_last_n(scoped)
        if suggested_amount is None:
            return _base_forecast(
                month,
                likelihood="unknown",
                suggested_amount=None,
                basis=None,
                n=0,
                lookback_months=lookback_months,
                seasonal=seasonal,
                cadence_label=cadence_label,
                last_payment_date=last_payment_date,
            )
        return _base_forecast(
            month,
            likelihood="likely",
            suggested_amount=suggested_amount,
            basis="mean_last_n",
            n=n,
            lookback_months=lookback_months,
            seasonal=seasonal,
            cadence_label=cadence_label,
            last_payment_date=last_payment_date,
        )

    suggested_amount, n = _mean_last_n(scoped)
    if suggested_amount is None:
        return _base_forecast(
            month,
            likelihood="unknown",
            suggested_amount=None,
            basis=None,
            n=0,
            lookback_months=lookback_months,
            seasonal=seasonal,
            cadence_label=cadence_label,
            last_payment_date=last_payment_date,
        )
    return _base_forecast(
        month,
        likelihood="possible",
        suggested_amount=suggested_amount,
        basis="mean_last_n",
        n=n,
        lookback_months=lookback_months,
        seasonal=seasonal,
        cadence_label=cadence_label,
        last_payment_date=last_payment_date,
    )


def _sum_posted_in_month(rows: list[dict[str, Any]], month_key: str) -> Decimal:
    total = Decimal("0")
    for row in rows:
        row_month = str(row.get("date") or "")[:7]
        if row_month != month_key:
            continue
        total += _decimal_amount(row.get("amount")).copy_abs()
    return total


def resolve_intermittent_owed(
    forecast: dict[str, Any],
    rows: list[dict[str, Any]],
    month: str,
) -> str:
    """Map forecast + posted payments to owed string (D-01/D-03/D-04)."""
    posted_total = _sum_posted_in_month(rows, month)
    if posted_total > 0:
        return _format_decimal(posted_total)
    likelihood = str(forecast.get("likelihood") or "")
    if likelihood in {"likely", "possible"}:
        suggested = forecast.get("suggested_amount")
        if suggested is not None and str(suggested).strip():
            return str(suggested)
    return "0.00"


def same_month_posted_payment(rows: list[dict[str, Any]], month: str) -> bool:
    """True when at least one linked payment posted in the worksheet month."""
    return _sum_posted_in_month(rows, month) > 0
