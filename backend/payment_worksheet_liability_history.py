"""Liability loan payment history aggregation for analytics pages (#114)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

import app_clock
from loan_journal_splits import (
    component_destinations_by_role,
    count_liability_anchor_journals,
    format_decimal,
    group_splits_by_journal,
    journal_date,
    journal_description,
    payment_amounts_from_liability_journal,
)
from loan_split_infer import infer_loan_profile, infer_sibling_destinations_by_role, merge_inferred_profile
from payment_worksheet_bill_history import (
    bill_history_date_window,
    bill_history_stats_month_range,
    rows_have_current_month_payment,
)


def _decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _history_row(
    *,
    journal_id: str,
    journal_splits: list[dict[str, Any]],
    payment: Decimal,
    principal: Decimal,
    interest: Decimal,
    escrow: Decimal,
) -> dict[str, Any]:
    return {
        "journal_id": journal_id,
        "date": journal_date(journal_splits),
        "description": journal_description(journal_splits),
        "amount": format_decimal(payment),
        "principal": format_decimal(principal),
        "interest": format_decimal(interest),
        "escrow": format_decimal(escrow),
    }


def build_liability_history_transactions(
    splits: list[dict[str, Any]],
    *,
    account_id: str,
    loan_profile: dict[str, Any],
    liability_attrs: dict[str, Any] | None = None,
    accounts: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Build payment rows from liability splits and sibling component lines."""
    _ = liability_attrs

    sibling_destinations = (
        component_destinations_by_role(loan_profile)
        if loan_profile.get("enabled")
        else {}
    )
    if not sibling_destinations and accounts:
        sibling_destinations = infer_sibling_destinations_by_role(
            splits,
            account_id,
            accounts,
        )

    rows: list[dict[str, Any]] = []
    for journal_id, journal_splits in group_splits_by_journal(splits).items():
        if not journal_splits:
            continue

        amounts = payment_amounts_from_liability_journal(
            journal_splits,
            account_id=account_id,
            sibling_destinations_by_role=sibling_destinations or None,
            accounts=accounts,
        )
        if amounts is None:
            continue
        principal, interest, escrow = amounts
        payment = principal + interest + escrow
        if payment <= 0:
            continue

        rows.append(
            _history_row(
                journal_id=journal_id,
                journal_splits=journal_splits,
                payment=payment,
                principal=principal,
                interest=interest,
                escrow=escrow,
            )
        )

    return rows


def compute_liability_history_stats(
    rows: list[dict[str, Any]],
    today: date | None = None,
) -> dict[str, Any]:
    """Aggregate liability payment rows into monthly series and totals."""
    if today is None:
        today = app_clock.today()
    current_month_has_payment = rows_have_current_month_payment(rows, today)
    stats_start, stats_end = bill_history_stats_month_range(
        today,
        current_month_has_payment=current_month_has_payment,
    )
    monthly: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {
            "principal": Decimal("0"),
            "interest": Decimal("0"),
            "escrow": Decimal("0"),
            "total_payment": Decimal("0"),
        }
    )
    totals = {
        "principal": Decimal("0"),
        "interest": Decimal("0"),
        "total_payment": Decimal("0"),
    }
    for row in rows:
        month_key = str(row.get("date") or "")[:7]
        if len(month_key) != 7:
            continue
        principal = _decimal_amount(row.get("principal"))
        interest = _decimal_amount(row.get("interest"))
        escrow = _decimal_amount(row.get("escrow"))
        total_payment = _decimal_amount(row.get("amount"))
        if not (stats_start <= month_key <= stats_end):
            continue
        monthly[month_key]["principal"] += principal
        monthly[month_key]["interest"] += interest
        monthly[month_key]["escrow"] += escrow
        monthly[month_key]["total_payment"] += total_payment
        totals["principal"] += principal
        totals["interest"] += interest
        totals["total_payment"] += total_payment
    monthly_series = [
        {
            "month": month,
            "principal": format_decimal(values["principal"]),
            "interest": format_decimal(values["interest"]),
            "escrow": format_decimal(values["escrow"]),
            "total_payment": format_decimal(values["total_payment"]),
        }
        for month, values in sorted(monthly.items())
    ]
    return {
        "stats_window": {"start": stats_start, "end": stats_end},
        "totals": {key: format_decimal(value) for key, value in totals.items()},
        "monthly": monthly_series,
    }


def liability_history_date_window(today: date | None = None) -> tuple[str, str]:
    """Alias for bill history fetch window (12 months + current partial)."""
    return bill_history_date_window(today)
