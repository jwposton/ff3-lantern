"""Credit card history aggregation for analytics pages (#113)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any, Literal

import app_clock
from payment_worksheet_bill_history import (
    bill_history_date_window,
    bill_history_stats_month_range,
    rows_have_current_month_payment,
)
from payment_worksheet_cc import classify_cc_activity_category, is_credit_card_payment_flow

TransactionKind = Literal["charge", "interest", "fee", "payment"]


def _decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _net_change(charges: Decimal, interest: Decimal, payments: Decimal) -> Decimal:
    """Balance impact: positive when debt grows, negative when payments exceed activity."""
    return charges + interest - payments


def _split_date(split: dict[str, Any]) -> str:
    raw = split.get("date") or ""
    return raw[:10] if len(raw) >= 10 else raw


def _touches_card(split: dict[str, Any], card_id: str) -> bool:
    return split.get("source_id") == card_id or split.get("destination_id") == card_id


def _is_payment_to_card(split: dict[str, Any], card_id: str) -> bool:
    return (
        split.get("destination_id") == card_id
        and is_credit_card_payment_flow(split)
    )


def _amount_for_card_activity(split: dict[str, Any], card_id: str) -> Decimal:
    amount = _decimal_amount(split.get("amount"))
    if split.get("source_id") == card_id:
        return amount
    if split.get("destination_id") == card_id:
        return -amount
    return Decimal("0")


def _activity_description(split: dict[str, Any], card_id: str) -> str:
    desc = (split.get("description") or "").strip()
    if desc:
        return desc
    if split.get("source_id") == card_id:
        return (split.get("destination_name") or "").strip() or "—"
    return (split.get("source_name") or "").strip() or "—"


def _activity_payee(split: dict[str, Any], card_id: str) -> str | None:
    if split.get("source_id") == card_id:
        name = (split.get("destination_name") or "").strip()
    else:
        name = (split.get("source_name") or "").strip()
    return name or None


def _activity_kind_label(category: str) -> TransactionKind:
    if category == "interest":
        return "interest"
    if category == "fee":
        return "fee"
    return "charge"


def _month_in_stats_range(month_key: str, start_month: str, end_month: str) -> bool:
    return start_month <= month_key <= end_month


def splits_to_cc_history_transactions(
    splits: list[dict[str, Any]],
    card_id: str,
    *,
    interest_cats: list[str],
    fee_cats: list[str],
) -> list[dict[str, Any]]:
    """Flatten Firefly splits into classified CC history rows."""
    rows: list[dict[str, Any]] = []
    for split in splits:
        if not _touches_card(split, card_id):
            continue
        split_date = _split_date(split)
        if not split_date:
            continue
        if _is_payment_to_card(split, card_id):
            amount = _decimal_amount(split.get("amount"))
            if amount == 0:
                continue
            rows.append(
                {
                    "journal_id": split.get("journal_id"),
                    "date": split_date,
                    "description": _activity_description(split, card_id),
                    "payee": _activity_payee(split, card_id),
                    "category": (split.get("category_name") or "").strip() or None,
                    "budget": (split.get("budget_name") or "").strip() or None,
                    "kind": "payment",
                    "amount": _format_decimal(abs(amount)),
                }
            )
            continue
        activity_amount = _amount_for_card_activity(split, card_id)
        if activity_amount == 0:
            continue
        category = classify_cc_activity_category(split, interest_cats, fee_cats)
        rows.append(
            {
                "journal_id": split.get("journal_id"),
                "date": split_date,
                "description": _activity_description(split, card_id),
                "payee": _activity_payee(split, card_id),
                "category": (split.get("category_name") or "").strip() or None,
                "budget": (split.get("budget_name") or "").strip() or None,
                "kind": _activity_kind_label(category),
                "amount": _format_decimal(activity_amount),
            }
        )
    return rows


def compute_cc_history_stats(
    rows: list[dict[str, Any]],
    today: date | None = None,
) -> dict[str, Any]:
    """Aggregate CC history rows into monthly series and totals."""
    if today is None:
        today = app_clock.today()
    payment_rows = [row for row in rows if row.get("kind") == "payment"]
    current_month_has_payment = rows_have_current_month_payment(payment_rows, today)
    stats_start, stats_end = bill_history_stats_month_range(
        today,
        current_month_has_payment=current_month_has_payment,
    )
    monthly: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {
            "charges": Decimal("0"),
            "fees": Decimal("0"),
            "interest": Decimal("0"),
            "payments": Decimal("0"),
            "net_change": Decimal("0"),
        }
    )
    totals = {
        "charges": Decimal("0"),
        "fees": Decimal("0"),
        "interest": Decimal("0"),
        "payments": Decimal("0"),
        "net_change": Decimal("0"),
    }
    for row in rows:
        month_key = str(row.get("date") or "")[:7]
        if len(month_key) != 7:
            continue
        kind = row.get("kind")
        amount = _decimal_amount(row.get("amount"))
        if kind == "payment":
            bucket = "payments"
            amount = abs(amount)
        elif kind == "interest":
            bucket = "interest"
        elif kind == "fee":
            bucket = "fees"
        else:
            bucket = "charges"
        if _month_in_stats_range(month_key, stats_start, stats_end):
            monthly[month_key][bucket] += amount
            totals[bucket] += amount
    for month_key, values in monthly.items():
        net = _net_change(values["charges"], values["interest"], values["payments"])
        values["net_change"] = net
    totals["net_change"] = _net_change(
        totals["charges"],
        totals["interest"],
        totals["payments"],
    )
    monthly_series = [
        {
            "month": month,
            "charges": _format_decimal(values["charges"]),
            "fees": _format_decimal(values["fees"]),
            "interest": _format_decimal(values["interest"]),
            "payments": _format_decimal(values["payments"]),
            "net_change": _format_decimal(values["net_change"]),
        }
        for month, values in sorted(monthly.items())
    ]
    return {
        "stats_window": {"start": stats_start, "end": stats_end},
        "totals": {key: _format_decimal(value) for key, value in totals.items()},
        "monthly": monthly_series,
    }


def cc_history_date_window(today: date | None = None) -> tuple[str, str]:
    """Alias for bill history fetch window (12 months + current partial)."""
    return bill_history_date_window(today)
