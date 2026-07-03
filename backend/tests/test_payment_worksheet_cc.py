"""Tests for credit card payment flow detection (PAY-07)."""

from __future__ import annotations

import pytest

from payment_worksheet_cc import (
    SERVER_CC_PAYMENT_BUDGET,
    classify_cc_activity_category,
    is_credit_card_payment_flow,
)

# Ported from frontend/src/test/fixtures/omniRows.ts


def _omni_to_split(row: dict) -> dict:
    return {
        "budget_name": row.get("budget"),
        "type": row.get("type"),
        "source_type": row.get("source_type"),
        "source_role": row.get("source_role"),
        "destination_type": row.get("destination_type"),
        "destination_role": row.get("destination_role"),
        "category_name": row.get("category"),
    }


CREDIT_CARD_PAYMENT_TRANSFER = {
    "amount": "200.00",
    "type": "transfer",
    "source_type": "Asset account",
    "source_role": "Default account",
    "destination_type": "Asset account",
    "destination_role": "Credit card",
    "budget": "Credit Card Payment",
    "category": "Chase VISA Payment",
}

CREDIT_CARD_PAYMENT_TRANSFER_NO_BUDGET = {
    "amount": "200.00",
    "type": "transfer",
    "source_type": "Asset account",
    "source_role": "Default account",
    "destination_type": "Asset account",
    "destination_role": "Credit card",
    "budget": None,
    "category": None,
}

CREDIT_CARD_PAYMENT_TRANSFER_MISSING_ROLE = {
    "amount": "350.00",
    "type": "transfer",
    "source_type": "Asset account",
    "source_role": "Default account",
    "destination_type": "Asset account",
    "destination_role": None,
    "budget": None,
    "category": None,
}

MAIN_CHECKING_WITHDRAWAL = {
    "amount": "45.00",
    "type": "withdrawal",
    "source_type": "Asset account",
    "source_role": "Default account",
    "destination_type": "Expense account",
    "destination_role": None,
    "budget": None,
    "category": "Groceries",
}


@pytest.mark.parametrize(
    "row,expected",
    [
        (CREDIT_CARD_PAYMENT_TRANSFER, True),
        (CREDIT_CARD_PAYMENT_TRANSFER_NO_BUDGET, True),
        (CREDIT_CARD_PAYMENT_TRANSFER_MISSING_ROLE, True),
        (MAIN_CHECKING_WITHDRAWAL, False),
    ],
)
def test_is_credit_card_payment_flow_parity(row, expected):
    assert is_credit_card_payment_flow(_omni_to_split(row)) is expected


def test_budget_name_credit_card_payment():
    split = {"budget_name": SERVER_CC_PAYMENT_BUDGET, "type": "withdrawal"}
    assert is_credit_card_payment_flow(split) is True


def test_non_transfer_returns_false():
    split = {
        "budget_name": None,
        "type": "withdrawal",
        "source_type": "Asset account",
        "source_role": "Default account",
        "destination_type": "Asset account",
        "destination_role": "Credit card",
    }
    assert is_credit_card_payment_flow(split) is False


def test_classify_interest():
    assert (
        classify_cc_activity_category(
            {"category_name": "Credit Card Interest"},
            ["Credit Card Interest"],
            ["Late Fee"],
        )
        == "interest"
    )


def test_classify_fee_case_insensitive():
    assert (
        classify_cc_activity_category(
            {"category_name": "late fee"},
            ["Credit Card Interest"],
            ["Late Fee", "Credit Card Fee"],
        )
        == "fee"
    )


def test_classify_other():
    assert (
        classify_cc_activity_category(
            {"category_name": "Groceries"},
            ["Credit Card Interest"],
            ["Late Fee"],
        )
        == "other"
    )


def test_classify_at_most_one_bucket():
    """Interest wins when both lists could match (D-13)."""
    assert (
        classify_cc_activity_category(
            {"category_name": "Credit Card Interest"},
            ["Credit Card Interest"],
            ["Credit Card Interest"],
        )
        == "interest"
    )
