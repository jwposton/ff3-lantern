"""Tests for payment worksheet compute envelope (PAY-04, PAY-09, PAY-11)."""

from __future__ import annotations

import asyncio
import json

import pytest

import sidecar_db
from payment_worksheet_compute import (
    build_worksheet_envelope,
    cc_row_key,
    compute_bucket_rollups,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    return tmp_path


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
        buckets, refresh_snapshot, bucket_balances, cc_rows, []
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
    result = compute_bucket_rollups(buckets, refresh_snapshot, [], cc_rows, [])
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
