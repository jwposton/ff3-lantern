"""Tests for loan split profile inference."""

from __future__ import annotations

from loan_split_infer import infer_loan_profile, merge_inferred_profile

ACCOUNTS = {
    "7": {"name": "Checking", "type": "asset", "role": "defaultAsset"},
    "42": {"name": "Mortgage", "type": "liabilities", "role": None},
    "88": {"name": "Mortgage Interest", "type": "expense", "role": None},
}


def _split_history() -> list[dict]:
    return [
        {
            "journal_id": "600",
            "type": "transfer",
            "amount": "156.35",
            "description": "Loan Provider July",
            "date": "2026-07-10",
            "source_id": "7",
            "destination_id": "42",
            "category_name": "Loan Payment",
        },
        {
            "journal_id": "600",
            "type": "withdrawal",
            "amount": "270.83",
            "description": "Loan Provider July",
            "date": "2026-07-10",
            "source_id": "7",
            "destination_id": "88",
            "category_name": "Loan Interest",
        },
        {
            "journal_id": "601",
            "type": "transfer",
            "amount": "160.00",
            "description": "Loan Provider June",
            "date": "2026-06-10",
            "source_id": "7",
            "destination_id": "42",
            "category_name": "Loan Payment",
        },
        {
            "journal_id": "601",
            "type": "withdrawal",
            "amount": "267.18",
            "description": "Loan Provider June",
            "date": "2026-06-10",
            "source_id": "7",
            "destination_id": "88",
            "category_name": "Loan Interest",
        },
    ]


def test_infer_loan_profile_from_split_history():
    profile = infer_loan_profile(
        _split_history(),
        account_id="42",
        liability_name="Mortgage",
        accounts=ACCOUNTS,
    )
    assert profile is not None
    assert profile["match"]["description_contains"] == "Loan Provider"
    assert profile["match"]["source_account_id"] == "7"
    components = {comp["role"]: comp for comp in profile["split"]["components"]}
    assert components["principal"]["destination_account_id"] == "42"
    assert components["interest"]["destination_account_id"] == "88"
    assert components["principal"]["category"] == "Loan Payment"
    assert components["interest"]["category"] == "Loan Interest"


def test_merge_inferred_profile_fills_missing_interest_destination():
    inferred = infer_loan_profile(
        _split_history(),
        account_id="42",
        liability_name="Mortgage",
        accounts=ACCOUNTS,
    )
    existing = {
        "version": 1,
        "enabled": True,
        "match": {"description_contains": "Custom"},
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
                    "destination_account_id": "",
                    "destination_account": "",
                },
            ],
        },
    }
    merged = merge_inferred_profile(existing, inferred or {})
    by_role = {comp["role"]: comp for comp in merged["split"]["components"]}
    assert merged["match"]["description_contains"] == "Custom"
    assert by_role["interest"]["destination_account_id"] == "88"
    assert by_role["interest"]["category"] == "Loan Interest"


def test_merge_inferred_profile_fills_missing_category_on_existing_destination():
    inferred = infer_loan_profile(
        _split_history(),
        account_id="42",
        liability_name="Mortgage",
        accounts=ACCOUNTS,
    )
    existing = {
        "version": 1,
        "enabled": True,
        "match": {"description_contains": "Custom"},
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
    merged = merge_inferred_profile(existing, inferred or {})
    by_role = {comp["role"]: comp for comp in merged["split"]["components"]}
    assert by_role["principal"]["category"] == "Loan Payment"
    assert by_role["interest"]["category"] == "Loan Interest"


def test_infer_escrow_destination_amount_and_shared_budget():
    accounts = {
        **ACCOUNTS,
        "99": {"name": "Escrow", "type": "expense", "role": None},
    }
    splits = [
        {
            "journal_id": "700",
            "type": "transfer",
            "amount": "500.00",
            "description": "Mortgage July",
            "date": "2026-07-10",
            "source_id": "7",
            "destination_id": "42",
            "category_name": "Mortgage",
            "budget_name": "House",
        },
        {
            "journal_id": "700",
            "type": "withdrawal",
            "amount": "300.00",
            "description": "Mortgage July",
            "date": "2026-07-10",
            "source_id": "7",
            "destination_id": "88",
            "category_name": "Mortgage Interest",
            "budget_name": "House",
        },
        {
            "journal_id": "700",
            "type": "withdrawal",
            "amount": "350.00",
            "description": "Mortgage July",
            "date": "2026-07-10",
            "source_id": "7",
            "destination_id": "99",
            "category_name": "Escrow",
            "budget_name": "House",
        },
        {
            "journal_id": "701",
            "type": "transfer",
            "amount": "500.00",
            "description": "Mortgage June",
            "date": "2026-06-10",
            "source_id": "7",
            "destination_id": "42",
            "budget_name": "House",
        },
        {
            "journal_id": "701",
            "type": "withdrawal",
            "amount": "310.00",
            "description": "Mortgage June",
            "date": "2026-06-10",
            "source_id": "7",
            "destination_id": "88",
            "budget_name": "House",
        },
        {
            "journal_id": "701",
            "type": "withdrawal",
            "amount": "340.00",
            "description": "Mortgage June",
            "date": "2026-06-10",
            "source_id": "7",
            "destination_id": "99",
            "budget_name": "House",
        },
    ]
    profile = infer_loan_profile(
        splits,
        account_id="42",
        liability_name="Mortgage",
        accounts=accounts,
    )
    assert profile is not None
    components = {comp["role"]: comp for comp in profile["split"]["components"]}
    assert components["escrow"]["destination_account_id"] == "99"
    assert profile["split"]["escrow_amount"] == "345.00"
    assert profile["split"]["budget"] == "House"
    assert components["principal"]["budget"] is None
    assert components["interest"]["budget"] is None


def test_infer_per_role_budget_overrides_when_budgets_differ():
    splits = [
        {
            "journal_id": "800",
            "type": "transfer",
            "amount": "156.35",
            "description": "Loan Provider July",
            "date": "2026-07-10",
            "source_id": "7",
            "destination_id": "42",
            "budget_name": "Debt",
        },
        {
            "journal_id": "800",
            "type": "withdrawal",
            "amount": "270.83",
            "description": "Loan Provider July",
            "date": "2026-07-10",
            "source_id": "7",
            "destination_id": "88",
            "budget_name": "Interest",
        },
    ]
    profile = infer_loan_profile(
        splits,
        account_id="42",
        liability_name="Mortgage",
        accounts=ACCOUNTS,
    )
    assert profile is not None
    components = {comp["role"]: comp for comp in profile["split"]["components"]}
    assert profile["split"]["budget"] is None
    assert components["principal"]["budget"] == "Debt"
    assert components["interest"]["budget"] == "Interest"
