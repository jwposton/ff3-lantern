"""Tests for loan profile schema validation (LOAN-01)."""

from __future__ import annotations

import pytest

from loan_profile_validate import validate_profile

ACCOUNTS = {
    "7": {"name": "Main Checking", "type": "Asset account", "role": "Default account"},
    "42": {"name": "Mortgage", "type": "Liabilities account", "role": None},
    "88": {"name": "Mortgage Interest", "type": "Expense account", "role": None},
    "99": {"name": "Wrong Expense", "type": "Expense account", "role": None},
}


def _valid_profile() -> dict:
    return {
        "version": 1,
        "enabled": True,
        "match": {
            "description_contains": "Loan Provider",
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
                    "destination_account": "Mortgage",
                },
                {
                    "role": "interest",
                    "type": "transfer",
                    "destination_account_id": "88",
                    "destination_account": "Mortgage Interest",
                },
            ],
        },
    }


def test_valid_profile_passes():
    result = validate_profile(_valid_profile(), ACCOUNTS)
    assert result["enabled"] is True
    assert result["match"]["expected_amount"] == "427.18"


def test_missing_description_contains_raises():
    profile = _valid_profile()
    del profile["match"]["description_contains"]
    with pytest.raises(ValueError, match="description_contains"):
        validate_profile(profile, ACCOUNTS)


def test_principal_with_expense_account_raises():
    profile = _valid_profile()
    profile["split"]["components"][0]["destination_account_id"] = "99"
    with pytest.raises(ValueError, match="principal"):
        validate_profile(profile, ACCOUNTS)


def test_interest_with_liability_account_raises():
    profile = _valid_profile()
    profile["split"]["components"][1]["destination_account_id"] = "42"
    with pytest.raises(ValueError, match="interest"):
        validate_profile(profile, ACCOUNTS)


def test_expected_amount_parsed_as_decimal_string():
    profile = _valid_profile()
    profile["match"]["expected_amount"] = "1000.5"
    profile["match"]["amount_tolerance"] = "1"
    result = validate_profile(profile, ACCOUNTS)
    assert result["match"]["expected_amount"] == "1000.50"
    assert result["match"]["amount_tolerance"] == "1.00"


def test_escrow_destination_required_when_escrow_amount_positive():
    profile = _valid_profile()
    profile["split"]["escrow_amount"] = "100.00"
    profile["split"]["components"].append(
        {
            "role": "escrow",
            "type": "withdrawal",
            "destination_account_id": "",
            "destination_account": "",
        }
    )
    with pytest.raises(ValueError, match="escrow destination"):
        validate_profile(profile, ACCOUNTS)


def test_escrow_component_optional_when_escrow_zero():
    profile = _valid_profile()
    profile["split"]["components"].append(
        {
            "role": "escrow",
            "type": "withdrawal",
            "destination_account_id": "",
            "destination_account": "",
        }
    )
    result = validate_profile(profile, ACCOUNTS)
    assert result["split"]["escrow_amount"] == "0.00"


def test_disabled_profile_skips_component_requirements():
    profile = _valid_profile()
    profile["enabled"] = False
    profile["split"]["components"] = []
    result = validate_profile(profile, ACCOUNTS)
    assert result["enabled"] is False


def test_oversized_profile_rejected():
    profile = _valid_profile()
    profile["notes"] = "x" * 20000
    with pytest.raises(ValueError, match="16KB"):
        validate_profile(profile, ACCOUNTS)


def test_withdrawal_match_allows_principal_withdrawal_to_liability():
    profile = _valid_profile()
    profile["match"]["type"] = "withdrawal"
    profile["split"]["components"][0]["type"] = "withdrawal"
    profile["split"]["components"][1]["type"] = "withdrawal"
    result = validate_profile(profile, ACCOUNTS)
    assert result["match"]["type"] == "withdrawal"


def test_component_type_must_match_match_type():
    profile = _valid_profile()
    profile["split"]["components"][1]["type"] = "withdrawal"
    with pytest.raises(ValueError, match="must match match.type"):
        validate_profile(profile, ACCOUNTS)
