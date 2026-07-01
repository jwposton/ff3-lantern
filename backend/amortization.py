"""Per-payment amortization split calculation (LOAN-03, LOAN-08)."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

LOAN_BALANCE_SEMANTICS = "pre_payment"
_PENNY = Decimal("0.01")


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(_PENNY, rounding=ROUND_HALF_UP)


def apply_penny_adjustment(
    components: dict[str, Decimal], payment_amount: Decimal
) -> dict[str, Decimal]:
    """Adjust last non-zero component so principal+interest+escrow equals payment."""
    result = {k: _quantize(v) for k, v in components.items()}
    total = sum(result.values())
    diff = _quantize(payment_amount) - total
    if diff == 0:
        return result
    adjust_order = ("escrow", "principal", "interest")
    for key in adjust_order:
        if key in result and result[key] != 0:
            result[key] = _quantize(result[key] + diff)
            break
    return result


def compute_payment_split(
    balance: Decimal,
    annual_rate: Decimal,
    payment_amount: Decimal,
    escrow_amount: Decimal = Decimal("0"),
) -> dict[str, Decimal]:
    """Return principal, interest, escrow for one payment."""
    balance = abs(balance)
    payment_amount = abs(payment_amount)
    escrow_amount = abs(escrow_amount)
    monthly_interest = _quantize(balance * (annual_rate / Decimal("12")))
    principal = payment_amount - monthly_interest - escrow_amount
    if principal < 0:
        raise ValueError("principal would be negative")
    components = apply_penny_adjustment(
        {
            "principal": principal,
            "interest": monthly_interest,
            "escrow": escrow_amount,
        },
        payment_amount,
    )
    return components


def balance_for_interest_calc(
    account_attrs: dict[str, Any], payment_amount: Decimal
) -> Decimal:
    """Balance used for interest calc per LOAN-06 fixture (pre_payment semantics)."""
    if LOAN_BALANCE_SEMANTICS != "pre_payment":
        raise ValueError("LOAN_BALANCE_SEMANTICS must be pre_payment")
    raw = account_attrs.get("current_balance")
    if raw is None:
        raise ValueError("account missing current_balance")
    return abs(Decimal(str(raw)))
