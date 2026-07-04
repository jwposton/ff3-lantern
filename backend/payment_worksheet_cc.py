"""Credit card payment flow detection and activity classification (PAY-07)."""

from __future__ import annotations

from typing import Any, Literal

from firefly_client import _normalize_account_role, _normalize_account_type

SERVER_CC_PAYMENT_BUDGET = "Credit Card Payment"

ActivityCategory = Literal["interest", "fee", "other"]


def _normalize_account_type_local(raw: str | None) -> str | None:
    return _normalize_account_type(raw)


def _normalize_account_role_local(raw: str | None) -> str | None:
    return _normalize_account_role(raw)


def _is_bank_account(type_: str | None, role: str | None) -> bool:
    if _normalize_account_type_local(type_) != "Asset account":
        return False
    normalized_role = _normalize_account_role_local(role)
    if normalized_role == "Credit card":
        return False
    if normalized_role is None:
        return True
    return normalized_role in ("Default account", "Savings")


def _is_credit_card(type_: str | None, role: str | None) -> bool:
    return (
        _normalize_account_type_local(type_) == "Asset account"
        and _normalize_account_role_local(role) == "Credit card"
    )


def _is_spending_bank_account(type_: str | None, role: str | None) -> bool:
    if _normalize_account_type_local(type_) != "Asset account":
        return False
    normalized_role = _normalize_account_role_local(role)
    return normalized_role in ("Default account", "Savings")


def is_credit_card_payment_flow(split: dict[str, Any]) -> bool:
    """Match frontend isCreditCardPaymentFlow semantics."""
    budget_name = split.get("budget_name")
    if budget_name == SERVER_CC_PAYMENT_BUDGET:
        return True

    if split.get("type") != "transfer":
        return False
    if not _is_bank_account(split.get("source_type"), split.get("source_role")):
        return False

    if _is_credit_card(split.get("destination_type"), split.get("destination_role")):
        return True

    return (
        _normalize_account_type_local(split.get("destination_type"))
        == "Asset account"
        and not _is_spending_bank_account(
            split.get("destination_type"), split.get("destination_role")
        )
    )


def classify_cc_activity_category(
    split: dict[str, Any],
    interest_cats: list[str],
    fee_cats: list[str],
) -> ActivityCategory:
    """Classify split into interest, fee, or other (D-11, D-13)."""
    name = (split.get("category_name") or "").strip()
    if not name:
        return "other"
    lower = name.lower()
    for cat in interest_cats:
        if lower == cat.strip().lower():
            return "interest"
    for cat in fee_cats:
        if lower == cat.strip().lower():
            return "fee"
    return "other"
