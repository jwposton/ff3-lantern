"""Tests for payment worksheet liability helpers (PAY-15, D-04)."""

from __future__ import annotations

from decimal import Decimal

from loan_profiles import serialize_loan_profile_to_notes
from payment_worksheet_liabilities import (
    compute_liability_display_fields,
    is_liability_account,
    is_real_estate_liability,
    liability_row_key,
)

LOAN_PROFILE = {
    "version": 1,
    "enabled": True,
    "match": {
        "description_contains": "Mortgage",
        "expected_amount": "427.18",
        "amount_tolerance": "0.50",
    },
    "split": {
        "escrow_amount": "0.00",
        "components": [
            {
                "role": "principal",
                "type": "transfer",
                "destination_account_id": "42",
            },
        ],
    },
}


def test_liability_row_key():
    assert liability_row_key("42") == "liability:42"


def test_is_liability_account_types():
    assert is_liability_account({"type": "liabilities", "account_role": "default"})
    assert is_liability_account({"type": "Liability account", "account_role": "mortgage"})
    assert is_liability_account({"type": "asset", "account_role": "debt"})
    assert not is_liability_account({"type": "asset", "account_role": "creditCard"})


def test_is_real_estate_liability_classification():
    assert is_real_estate_liability({"account_role": "Mortgage account"})
    assert is_real_estate_liability({"account_role": "mortgage"})
    assert is_real_estate_liability({"account_type": "mortgage"})
    assert is_real_estate_liability({"liability_type": "Mortgage"})
    assert is_real_estate_liability({"has_escrow": True})
    assert not is_real_estate_liability(
        {"account_role": "debt", "account_type": "liabilities"}
    )


def test_compute_liability_display_fields_with_profile():
    attrs = {
        "type": "liabilities",
        "current_balance": "-50000.00",
        "interest": "6.5",
    }
    notes = serialize_loan_profile_to_notes(LOAN_PROFILE, "")
    attrs["notes"] = notes
    result = compute_liability_display_fields(
        Decimal("50000.00"),
        LOAN_PROFILE,
        attrs,
        Decimal("427.18"),
    )
    assert result["est_interest"] is not None
    assert Decimal(result["est_interest"]) > 0
    assert result["remaining_payments"] is not None
    assert result["remaining_payments"] > 0


def test_compute_liability_display_fields_no_rate():
    result = compute_liability_display_fields(
        Decimal("50000.00"),
        LOAN_PROFILE,
        {"type": "liabilities", "current_balance": "-50000.00"},
        Decimal("427.18"),
    )
    assert result["est_interest"] is None
    assert result["remaining_payments"] is None


def test_compute_liability_display_fields_no_profile():
    attrs = {
        "type": "liabilities",
        "current_balance": "-50000.00",
        "interest": "6.5",
    }
    result = compute_liability_display_fields(
        Decimal("50000.00"),
        None,
        attrs,
        Decimal("427.18"),
    )
    assert result["est_interest"] is None
    assert result["remaining_payments"] is None
