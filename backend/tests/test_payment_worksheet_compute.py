"""Tests for payment worksheet compute envelope (PAY-04, PAY-09, PAY-11)."""

from __future__ import annotations

import asyncio
import json

import pytest

import sidecar_db
from payment_worksheet_compute import (
    build_worksheet_envelope,
    bill_row_key,
    cc_row_key,
    compute_bucket_rollups,
    compute_grand_totals,
    compute_section_subtotals,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    return tmp_path


def test_bill_row_key():
    assert bill_row_key(7) == "bill:7"
    assert bill_row_key("7") == "bill:7"


def test_cc_row_key():
    assert cc_row_key("42") == "cc:42"


def test_compute_rollups():
    buckets = [
        {"id": "checking", "label": "Checking", "sort_order": 0, "firefly_account_ids": []},
        {"id": "savings", "label": "Savings", "sort_order": 1, "firefly_account_ids": []},
    ]
    refresh_snapshot = {
        "buckets": {
            "checking": {"reported_balance": "5000.00"},
            "savings": {"reported_balance": "2000.00"},
        },
        "credit_cards": {},
    }
    bucket_balances = [
        {
            "bucket_key": "checking",
            "month": "2026-07",
            "user_balance": "4800.00",
            "user_balance_override": 1,
        },
    ]
    cc_rows = [
        {
            "account_id": "cc1",
            "funding_bucket_key": "checking",
            "planned_amount": "1200.00",
            "paid_at": None,
        },
        {
            "account_id": "cc2",
            "funding_bucket_key": None,
            "planned_amount": "500.00",
            "paid_at": None,
        },
        {
            "account_id": "cc3",
            "funding_bucket_key": "checking",
            "planned_amount": "800.00",
            "paid_at": "2026-07-15T12:00:00Z",
        },
    ]
    result = compute_bucket_rollups(
        buckets, refresh_snapshot, bucket_balances, cc_rows, [], [], []
    )
    checking = next(b for b in result["buckets"] if b["id"] == "checking")
    savings = next(b for b in result["buckets"] if b["id"] == "savings")

    assert checking["reported_balance"] == "5000.00"
    assert checking["user_balance"] == "4800.00"
    assert checking["user_balance_override"] is True
    assert checking["planned_outflows"] == "2000.00"
    assert checking["remaining"] == "2800.00"

    assert savings["reported_balance"] == "2000.00"
    assert savings["user_balance"] == "2000.00"
    assert savings["planned_outflows"] == "0.00"
    assert savings["remaining"] == "2000.00"

    assert result["totals"]["reported_balance"] == "7000.00"
    assert result["totals"]["user_balance"] == "6800.00"
    assert result["totals"]["remaining"] == "4800.00"
    assert result["shortfall"] is False


def test_shortfall():
    buckets = [
        {"id": "checking", "label": "Checking", "sort_order": 0, "firefly_account_ids": []},
    ]
    refresh_snapshot = {
        "buckets": {"checking": {"reported_balance": "1000.00"}},
        "credit_cards": {},
    }
    cc_rows = [
        {
            "account_id": "cc1",
            "funding_bucket_key": "checking",
            "planned_amount": "1500.00",
            "paid_at": None,
        },
    ]
    result = compute_bucket_rollups(buckets, refresh_snapshot, [], cc_rows, [], [], [])
    checking = result["buckets"][0]
    assert checking["remaining"] == "-500.00"
    assert result["shortfall"] is True


@pytest.mark.asyncio
async def test_build_worksheet_envelope_no_refresh(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    envelope = await build_worksheet_envelope("2026-07")
    assert envelope["month"] == "2026-07"
    assert envelope["refreshed_at"] is None
    assert envelope["credit_cards"] == []
    assert envelope["excluded_credit_cards"] == []
    assert len(envelope["buckets"]) == 1
    assert envelope["buckets"][0]["reported_balance"] == "0.00"
    assert envelope["shortfall"] is False


@pytest.mark.asyncio
async def test_build_worksheet_envelope_with_refresh(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    balances = {
        "buckets": {"checking": {"reported_balance": "3000.00"}},
        "credit_cards": {
            "cc1": {
                "name": "Chase VISA",
                "credit_limit": "10000.00",
                "funding_bucket_key": "checking",
                "owed": "1200.00",
                "new_total": "150.00",
                "interest_accrued": "25.00",
                "fees": "0.00",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )
    await sidecar_db.upsert_worksheet_state_row(
        row_key="cc:cc1",
        row_type="credit_card",
        month="2026-07",
        planned_amount="500.00",
        planned_amount_override=1,
        paid_at="2026-07-10T00:00:00Z",
    )

    envelope = await build_worksheet_envelope("2026-07")
    assert envelope["refreshed_at"] == "2026-07-03T12:00:00Z"
    assert len(envelope["credit_cards"]) == 1
    card = envelope["credit_cards"][0]
    assert card["account_id"] == "cc1"
    assert card["name"] == "Chase VISA"
    assert card["planned_amount"] == "500.00"
    assert card["paid_at"] == "2026-07-10T00:00:00Z"
    assert card["new_transactions"] == []
    assert envelope["buckets"][0]["planned_outflows"] == "500.00"


def test_section_subtotals():
    bills = [
        {
            "owed": "100.00",
            "planned_amount": "80.00",
            "counts_toward_cash_plan": True,
            "payment_rail": "bank",
        },
        {
            "owed": "50.00",
            "planned_amount": "25.00",
            "counts_toward_cash_plan": False,
            "payment_rail": "credit_card",
        },
    ]
    liabilities = [
        {
            "account_id": "m1",
            "owed": "50000.00",
            "planned_amount": "427.18",
        },
        {
            "owed": "200.00",
            "planned_amount": "0.00",
            "counts_toward_cash_plan": False,
            "payment_rail": "credit_card",
        },
    ]
    credit_cards = [{"planned_amount": "400.00", "owed": "1200.00"}]
    result = compute_section_subtotals(bills, liabilities, credit_cards)
    assert result["bills"]["owed"] == "150.00"
    assert result["bills"]["planned_cash"] == "80.00"
    assert result["bills"]["on_card_informational"] == "50.00"
    assert result["liabilities"]["owed"] == "50200.00"
    assert result["liabilities"]["planned_cash"] == "427.18"
    assert result["credit_cards"]["planned_cash"] == "400.00"
    assert "owed" not in result["credit_cards"]


def test_cc_rail_excluded():
    buckets = [
        {"id": "checking", "label": "Checking", "sort_order": 0, "firefly_account_ids": []},
    ]
    refresh_snapshot = {"buckets": {"checking": {"reported_balance": "5000.00"}}, "credit_cards": {}}
    cc_rows = [
        {
            "account_id": "cc1",
            "funding_bucket_key": "checking",
            "planned_amount": "200.00",
        },
    ]
    bill_rows = [
        {
            "funding_bucket_key": "checking",
            "planned_amount": "150.00",
            "counts_toward_cash_plan": False,
            "payment_rail": "credit_card",
        },
    ]
    liability_rows = [
        {
            "account_id": "m1",
            "funding_bucket_key": "checking",
            "planned_amount": "100.00",
        },
    ]
    result = compute_bucket_rollups(
        buckets, refresh_snapshot, [], cc_rows, bill_rows, liability_rows, []
    )
    checking = result["buckets"][0]
    assert checking["planned_outflows"] == "300.00"


def test_grand_totals_includes_cc_owed():
    credit_cards = [
        {"owed": "1200.00", "planned_amount": "400.00"},
        {"owed": "800.00", "planned_amount": "200.00"},
    ]
    section_subtotals = {
        "bills": {"owed": "150.00", "planned_cash": "80.00"},
        "liabilities": {"owed": "50000.00", "planned_cash": "427.18"},
        "credit_cards": {"planned_cash": "600.00"},
    }
    result = compute_grand_totals(credit_cards, section_subtotals)
    assert result["owed"] == "52150.00"
    assert result["planned_cash"] == "1107.18"


@pytest.mark.asyncio
async def test_build_worksheet_envelope_with_bills(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    reg_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "bill-1",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-1",
            "row_label": "Electric",
        }
    )
    balances = {
        "buckets": {"checking": {"reported_balance": "3000.00"}},
        "credit_cards": {},
        "liabilities": {},
        "excluded_liabilities": {},
        "bills": {
            str(reg_id): {
                "owed": "125.50",
                "firefly_bill_id": "bill-1",
                "name": "Electric",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    envelope = await build_worksheet_envelope("2026-07")
    assert len(envelope["bills"]) == 1
    bill = envelope["bills"][0]
    assert bill["row_key"] == bill_row_key(reg_id)
    assert bill["owed"] == "125.50"
    assert bill["row_label"] == "Electric"
    assert envelope["section_subtotals"]["bills"]["owed"] == "125.50"
    assert envelope["grand_totals"]["owed"] == "125.50"


@pytest.mark.asyncio
async def test_bill_rows_sorted_cash_then_credit_monthly_before_intermittent(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    specs = [
        ("CC Intermittent", "credit_card", "intermittent"),
        ("Cash Monthly", "bank", "recurring"),
        ("Credit Monthly", "credit_card", "recurring"),
        ("Cash Intermittent", "bank", "intermittent"),
    ]
    reg_ids: list[int] = []
    bills_snapshot: dict[str, dict[str, str]] = {}
    for index, (label, rail, mode) in enumerate(specs):
        reg_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": f"bill-{index}",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": mode,
                "planned_sync": "fixed" if mode == "recurring" else "manual",
                "payment_rail": rail,
                "rule_id": f"rule-{index}",
                "row_label": label,
                "credit_card_account_id": "card-1" if rail == "credit_card" else None,
            }
        )
        reg_ids.append(reg_id)
        bills_snapshot[str(reg_id)] = {
            "owed": "10.00",
            "firefly_bill_id": f"bill-{index}",
            "name": label,
        }

    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(
            {
                "buckets": {"checking": {"reported_balance": "3000.00"}},
                "credit_cards": {},
                "liabilities": {},
                "excluded_liabilities": {},
                "bills": bills_snapshot,
            }
        ),
    )

    envelope = await build_worksheet_envelope("2026-07")
    labels = [row["row_label"] for row in envelope["bills"]]
    assert labels == [
        "Cash Monthly",
        "Cash Intermittent",
        "Credit Monthly",
        "CC Intermittent",
    ]
