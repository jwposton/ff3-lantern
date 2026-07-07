"""Tests for credit card history aggregation (#113)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from payment_worksheet_cc_history import (
    compute_cc_history_stats,
    splits_to_cc_history_transactions,
)


def _fixture_splits() -> list[dict]:
    return [
        {
            "journal_id": "300",
            "type": "transfer",
            "amount": "500.00",
            "source_id": "1",
            "destination_id": "3",
            "source_name": "Main Checking",
            "destination_name": "Chase VISA",
            "source_type": "Asset account",
            "source_role": "Default account",
            "destination_type": "Asset account",
            "destination_role": "Credit card",
            "budget_name": None,
            "category_name": None,
            "date": "2026-07-05",
        },
        {
            "journal_id": "301",
            "type": "withdrawal",
            "amount": "89.99",
            "source_id": "3",
            "destination_id": "99",
            "source_name": "Chase VISA",
            "destination_name": "Grocery Store",
            "source_type": "Asset account",
            "source_role": "Credit card",
            "destination_type": "Expense account",
            "destination_role": None,
            "budget_name": "Groceries",
            "category_name": "Groceries",
            "date": "2026-07-10",
        },
        {
            "journal_id": "302",
            "type": "withdrawal",
            "amount": "24.50",
            "source_id": "3",
            "destination_id": "98",
            "source_name": "Chase VISA",
            "destination_name": "Interest",
            "source_type": "Asset account",
            "source_role": "Credit card",
            "destination_type": "Expense account",
            "destination_role": None,
            "budget_name": None,
            "category_name": "Credit Card Interest",
            "date": "2026-07-12",
        },
        {
            "journal_id": "303",
            "type": "withdrawal",
            "amount": "35.00",
            "source_id": "3",
            "destination_id": "97",
            "source_name": "Chase VISA",
            "destination_type": "Expense account",
            "destination_role": None,
            "budget_name": None,
            "category_name": "Late Fee(s)",
            "date": "2026-07-14",
        },
        {
            "journal_id": "200",
            "type": "transfer",
            "amount": "300.00",
            "source_id": "1",
            "destination_id": "3",
            "source_type": "Asset account",
            "source_role": "Default account",
            "destination_type": "Asset account",
            "destination_role": "Credit card",
            "date": "2026-06-01",
        },
        {
            "journal_id": "201",
            "type": "withdrawal",
            "amount": "50.00",
            "source_id": "3",
            "destination_id": "99",
            "source_type": "Asset account",
            "source_role": "Credit card",
            "destination_type": "Expense account",
            "category_name": "Groceries",
            "date": "2026-06-15",
        },
    ]


def test_splits_classify_charge_interest_fee_payment():
    rows = splits_to_cc_history_transactions(
        _fixture_splits(),
        "3",
        interest_cats=["Credit Card Interest"],
        fee_cats=["Late Fee(s)"],
    )
    kinds = {row["kind"] for row in rows}
    assert kinds == {"charge", "interest", "fee", "payment"}
    payment = next(row for row in rows if row["journal_id"] == "300")
    assert payment["kind"] == "payment"
    assert payment["amount"] == "500.00"
    grocery = next(row for row in rows if row["journal_id"] == "301")
    assert grocery["kind"] == "charge"
    assert grocery["payee"] == "Grocery Store"


def test_stats_aggregate_by_month():
    rows = splits_to_cc_history_transactions(
        _fixture_splits(),
        "3",
        interest_cats=["Credit Card Interest"],
        fee_cats=["Late Fee(s)"],
    )
    stats = compute_cc_history_stats(rows, today=date(2026, 7, 15))
    assert stats["stats_window"]["end"] == "2026-07"
    assert stats["totals"]["charges"] == "139.99"
    assert stats["totals"]["interest"] == "24.50"
    assert stats["totals"]["fees"] == "35.00"
    assert stats["totals"]["payments"] == "800.00"
    assert stats["totals"]["net_change"] == "-635.51"
    july = next(row for row in stats["monthly"] if row["month"] == "2026-07")
    assert july["charges"] == "89.99"
    assert july["payments"] == "500.00"
    june = next(row for row in stats["monthly"] if row["month"] == "2026-06")
    assert june["charges"] == "50.00"
    assert june["payments"] == "300.00"


def test_stats_respect_custom_date_range():
    rows = splits_to_cc_history_transactions(
        _fixture_splits(),
        "3",
        interest_cats=["Credit Card Interest"],
        fee_cats=["Late Fee(s)"],
    )
    stats = compute_cc_history_stats(
        rows,
        today=date(2026, 7, 15),
        range_start="2026-07-01",
        range_end="2026-07-15",
    )
    assert stats["stats_window"] == {"start": "2026-07", "end": "2026-07"}
    assert stats["totals"]["charges"] == "89.99"
    assert stats["totals"]["payments"] == "500.00"
    assert len(stats["monthly"]) == 1


def test_payment_excluded_from_charges():
    rows = splits_to_cc_history_transactions(
        _fixture_splits(),
        "3",
        interest_cats=["Credit Card Interest"],
        fee_cats=["Late Fee(s)"],
    )
    assert not any(row["kind"] == "charge" and row["journal_id"] == "300" for row in rows)


def test_empty_history():
    stats = compute_cc_history_stats([], today=date(2026, 7, 15))
    assert stats["totals"] == {
        "charges": "0.00",
        "fees": "0.00",
        "interest": "0.00",
        "payments": "0.00",
        "net_change": "0.00",
    }
    assert stats["monthly"] == []
