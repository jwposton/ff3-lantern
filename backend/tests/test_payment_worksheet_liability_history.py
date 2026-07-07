"""Tests for liability history aggregation (#114)."""

from __future__ import annotations

from datetime import date

from loan_profiles import serialize_loan_profile_to_notes
from payment_worksheet_liability_history import (
    build_liability_history_transactions,
    compute_liability_history_stats,
)

LOAN_PROFILE = {
    "version": 1,
    "enabled": True,
    "match": {
        "type": "transfer",
        "description_contains": "Mortgage",
        "expected_amount": "427.18",
        "amount_tolerance": "0.50",
        "max_per_month": 1,
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

ACCOUNTS = {
    "42": {"name": "Mortgage", "type": "liabilities", "role": None},
    "88": {"name": "Mortgage Interest", "type": "expense", "role": None},
    "99": {"name": "Other", "type": "expense", "role": None},
}


def _splits() -> list[dict]:
    return [
        {
            "journal_id": "500",
            "type": "transfer",
            "amount": "-427.18",
            "description": "Mortgage July",
            "date": "2026-07-10",
            "source_id": "1",
            "destination_id": "42",
        },
        {
            "journal_id": "501",
            "type": "transfer",
            "amount": "-427.18",
            "description": "Mortgage June",
            "date": "2026-06-10",
            "source_id": "1",
            "destination_id": "42",
        },
        {
            "journal_id": "502",
            "type": "transfer",
            "amount": "-100.00",
            "description": "Other transfer",
            "date": "2026-07-11",
            "source_id": "1",
            "destination_id": "99",
        },
    ]


def _liability_attrs() -> dict:
    return {
        "name": "Mortgage",
        "type": "liabilities",
        "current_balance": "-50000.00",
        "interest": "6.5",
        "notes": serialize_loan_profile_to_notes(LOAN_PROFILE, ""),
    }


def test_build_transactions_from_principal_destination_splits():
    rows = build_liability_history_transactions(
        _splits(),
        account_id="42",
        loan_profile=LOAN_PROFILE,
        liability_attrs=_liability_attrs(),
    )
    assert len(rows) == 2
    assert rows[0]["date"] == "2026-07-10"
    assert rows[0]["amount"] == "427.18"
    assert rows[0]["principal"] == "427.18"
    assert rows[0]["interest"] == "0.00"


def test_multi_split_journal_uses_sibling_destinations():
    splits = [
        {
            "journal_id": "600",
            "type": "transfer",
            "amount": "156.35",
            "description": "Mortgage July",
            "date": "2026-07-10",
            "source_id": "1",
            "destination_id": "42",
        },
        {
            "journal_id": "600",
            "type": "withdrawal",
            "amount": "270.83",
            "description": "Mortgage July",
            "date": "2026-07-10",
            "source_id": "1",
            "destination_id": "88",
        },
    ]
    profile = {
        **LOAN_PROFILE,
        "split": {
            **LOAN_PROFILE["split"],
            "components": [
                {
                    "role": "principal",
                    "type": "transfer",
                    "destination_account_id": "42",
                },
                {
                    "role": "interest",
                    "type": "withdrawal",
                    "destination_account_id": "88",
                },
            ],
        },
    }
    rows = build_liability_history_transactions(
        splits,
        account_id="42",
        loan_profile=profile,
        liability_attrs=_liability_attrs(),
    )
    assert len(rows) == 1
    assert rows[0]["amount"] == "427.18"
    assert rows[0]["principal"] == "156.35"
    assert rows[0]["interest"] == "270.83"


def test_unconfigured_profile_infers_interest_from_expense_siblings():
    splits = [
        {
            "journal_id": "600",
            "type": "transfer",
            "amount": "156.35",
            "description": "Mortgage July",
            "date": "2026-07-10",
            "source_id": "1",
            "destination_id": "42",
        },
        {
            "journal_id": "600",
            "type": "withdrawal",
            "amount": "270.83",
            "description": "Mortgage July",
            "date": "2026-07-10",
            "source_id": "1",
            "destination_id": "88",
        },
    ]
    rows = build_liability_history_transactions(
        splits,
        account_id="42",
        loan_profile={"enabled": False},
        liability_attrs=_liability_attrs(),
        accounts=ACCOUNTS,
    )
    assert len(rows) == 1
    assert rows[0]["principal"] == "156.35"
    assert rows[0]["interest"] == "270.83"


def test_unconfigured_profile_still_returns_liability_only_payments():
    rows = build_liability_history_transactions(
        _splits(),
        account_id="42",
        loan_profile={"enabled": False},
        liability_attrs=_liability_attrs(),
        accounts=ACCOUNTS,
    )
    assert len(rows) == 2
    assert rows[0]["principal"] == "427.18"
    assert rows[0]["interest"] == "0.00"


def test_ignores_journals_without_liability_split():
    splits = [
        {
            "journal_id": "700",
            "type": "withdrawal",
            "amount": "270.83",
            "description": "Interest only",
            "date": "2026-07-10",
            "source_id": "1",
            "destination_id": "88",
        },
    ]
    rows = build_liability_history_transactions(
        splits,
        account_id="42",
        loan_profile=LOAN_PROFILE,
        liability_attrs=_liability_attrs(),
        accounts=ACCOUNTS,
    )
    assert rows == []


def test_stats_aggregate_principal_and_interest():
    rows = build_liability_history_transactions(
        _splits(),
        account_id="42",
        loan_profile=LOAN_PROFILE,
        liability_attrs=_liability_attrs(),
    )
    stats = compute_liability_history_stats(rows, today=date(2026, 7, 15))
    assert stats["totals"]["total_payment"] == "854.36"
    assert stats["totals"]["principal"] == "854.36"
    assert len(stats["monthly"]) == 2


def test_empty_history():
    stats = compute_liability_history_stats([], today=date(2026, 7, 15))
    assert stats["totals"] == {
        "principal": "0.00",
        "interest": "0.00",
        "total_payment": "0.00",
    }
    assert stats["monthly"] == []
