"""Liability discovery and display fields for payment worksheet (PAY-15, D-01–D-04)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from amortization import compute_payment_split
from loan_splits_queue import _annual_rate

_MAX_REMAINING_PAYMENTS = 600


def liability_row_key(account_id: str) -> str:
    return f"liability:{account_id}"


def is_liability_account(attrs: dict[str, Any]) -> bool:
    raw_type = (attrs.get("type") or "").lower()
    raw_role = (attrs.get("account_role") or "").replace("_", "").lower()
    if raw_role == "debt":
        return True
    return raw_type in ("liabilities", "liability") or "liabilit" in raw_type


def is_real_estate_liability(row: dict[str, Any]) -> bool:
    """Classify liability account owed as real estate (mortgage/escrow), not display names."""
    role = (row.get("account_role") or "").replace("_", "").lower()
    if role == "mortgage":
        return True
    liability_type = (row.get("liability_type") or "").lower()
    if liability_type in ("mortgage", "realestate", "real_estate"):
        return True
    return bool(row.get("has_escrow"))


def is_liability_summary(summary: dict[str, Any]) -> bool:
    raw_type = (summary.get("type") or "").lower()
    raw_role = (summary.get("role") or "").replace(" ", "").lower()
    if raw_role == "debt":
        return True
    return "liabilit" in raw_type


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def draft_planned_amount(
    loan_profile: dict[str, Any] | None,
    worksheet_profile: dict[str, Any],
) -> str:
    if loan_profile:
        match = loan_profile.get("match") or {}
        expected = match.get("expected_amount")
        if expected is not None and str(expected).strip():
            return _format_decimal(abs(Decimal(str(expected))))
    default = worksheet_profile.get("default_planned_payment")
    if default is not None and str(default).strip():
        return _format_decimal(abs(Decimal(str(default))))
    return "0.00"


def compute_liability_display_fields(
    balance: Decimal,
    loan_profile: dict[str, Any] | None,
    attrs: dict[str, Any],
    payment_amount: Decimal,
) -> dict[str, str | int | None]:
    """Return est_interest and remaining_payments; None when no profile/rate (D-04)."""
    if loan_profile is None or payment_amount <= 0:
        return {"est_interest": None, "remaining_payments": None}
    try:
        rate = _annual_rate(loan_profile, attrs)
    except ValueError:
        return {"est_interest": None, "remaining_payments": None}

    escrow = Decimal(str((loan_profile.get("split") or {}).get("escrow_amount") or "0"))
    b = abs(balance)
    try:
        split = compute_payment_split(b, rate, payment_amount, escrow)
    except ValueError:
        return {"est_interest": None, "remaining_payments": None}

    est_interest = _format_decimal(split["interest"])

    remaining = 0
    while b > Decimal("0.01") and remaining < _MAX_REMAINING_PAYMENTS:
        try:
            s = compute_payment_split(b, rate, payment_amount, escrow)
        except ValueError:
            break
        b -= s["principal"]
        remaining += 1

    return {
        "est_interest": est_interest,
        "remaining_payments": remaining if remaining > 0 else None,
    }
