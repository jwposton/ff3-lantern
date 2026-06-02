"""OMNI normalization contract tests (DATA-02, D-01–D-08, D-14–D-15)."""

from __future__ import annotations

import pytest

from conftest import load_fixture

OMNI_KEYS = frozenset(
    {
        "amount",
        "type",
        "source_account",
        "source_type",
        "source_role",
        "destination_account",
        "destination_type",
        "destination_role",
        "budget",
        "category",
        "date",
    }
)


def _import_normalization():
    from transaction_normalization import (
        assign_transfer_labels,
        normalize_transactions,
        spending_withdrawal_total,
    )

    return normalize_transactions, assign_transfer_labels, spending_withdrawal_total


def test_normalize_empty_list():
    normalize_transactions, _, _ = _import_normalization()
    assert normalize_transactions([]) == []


def test_one_split_yields_one_omni_row():
    normalize_transactions, _, _ = _import_normalization()
    flat = [
        {
            "type": "withdrawal",
            "amount": "42.00",
            "source_name": "Main Checking",
            "source_type": "Asset account",
            "source_role": "Default account",
            "destination_name": "Store",
            "destination_type": "Expense account",
            "destination_role": None,
            "budget_name": "Essentials",
            "category_name": "Food",
            "date": "2024-01-15T12:00:00+00:00",
        }
    ]
    rows = normalize_transactions(flat)
    assert len(rows) == 1
    assert set(rows[0].keys()) == OMNI_KEYS
    assert rows[0]["source_account"] == "Main Checking"
    assert rows[0]["destination_account"] == "Store"


def test_amount_is_positive_string():
    normalize_transactions, _, _ = _import_normalization()
    rows = normalize_transactions(
        [{"type": "withdrawal", "amount": "-12.50", "date": "2024-01-01"}]
    )
    assert rows[0]["amount"] == "12.5"


def test_missing_budget_category_are_null():
    normalize_transactions, _, _ = _import_normalization()
    rows = normalize_transactions(
        [
            {
                "type": "withdrawal",
                "amount": "1.00",
                "budget_name": "",
                "category_name": "",
                "date": "2024-01-01",
            }
        ]
    )
    assert rows[0]["budget"] is None
    assert rows[0]["category"] is None
    assert "Undefined" not in (rows[0]["budget"], rows[0]["category"])


def test_includes_deposit_and_transfer():
    normalize_transactions, _, _ = _import_normalization()
    flat = [
        {"type": "withdrawal", "amount": "1", "date": "2024-01-01"},
        {"type": "deposit", "amount": "2", "date": "2024-01-02"},
        {
            "type": "transfer",
            "amount": "3",
            "destination_name": "Savings",
            "destination_role": "Savings",
            "date": "2024-01-03",
        },
    ]
    types = {r["type"] for r in normalize_transactions(flat)}
    assert types == {"withdrawal", "deposit", "transfer"}


def test_transfer_to_credit_card_labels():
    normalize_transactions, _, _ = _import_normalization()
    rows = normalize_transactions(
        [
            {
                "type": "transfer",
                "amount": "100",
                "destination_name": "Chase VISA",
                "destination_role": "Credit card",
                "date": "2024-01-20",
            }
        ]
    )
    assert rows[0]["budget"] == "Credit Card Payment"
    assert rows[0]["category"] == "Chase VISA Payment"


def test_transfer_non_cc_category():
    normalize_transactions, _, _ = _import_normalization()
    rows = normalize_transactions(
        [
            {
                "type": "transfer",
                "amount": "50",
                "destination_name": "Savings",
                "destination_role": "Savings",
                "date": "2024-01-01",
            }
        ]
    )
    assert rows[0]["category"] == "Transfer to Savings"


def test_date_is_yyyy_mm_dd():
    normalize_transactions, _, _ = _import_normalization()
    rows = normalize_transactions(
        [{"type": "withdrawal", "amount": "1", "date": "2024-03-05T18:30:00+00:00"}]
    )
    assert rows[0]["date"] == "2024-03-05"


def test_spending_total_within_tolerance():
    import asyncio

    import httpx
    from firefly_client import FireflyClient

    normalize_transactions, _, spending_withdrawal_total = _import_normalization()

    accounts = load_fixture("accounts.json")
    txns = load_fixture("transactions_withdrawal.json")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json=accounts)
        return httpx.Response(200, json=txns)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    flat = asyncio.run(client.fetch_splits("2024-01-01", "2024-01-31"))
    rows = normalize_transactions(flat)
    total = spending_withdrawal_total(rows)
    assert abs(total - 75.50) <= 0.01
