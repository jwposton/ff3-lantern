"""Tests for payment worksheet refresh service (PAY-06, PAY-07, PAY-10)."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal

import httpx
import pytest

import sidecar_db
from conftest import load_fixture
from firefly_client import FireflyClient
from payment_worksheet_refresh import run_refresh


@pytest.fixture
def payment_worksheet_env(monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED", "true")
    monkeypatch.setenv("FIREFLY_BASE_URL", "https://firefly.example")
    monkeypatch.setenv("FIREFLY_API_TOKEN", "test-token")
    monkeypatch.delenv(
        "FF3ANALYTICS_PAYMENT_WORKSHEET_INTEREST_CATEGORIES", raising=False
    )
    monkeypatch.delenv(
        "FF3ANALYTICS_PAYMENT_WORKSHEET_FEE_CATEGORIES", raising=False
    )


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    return tmp_path


def _fixture() -> dict:
    return load_fixture("payment_worksheet_splits.json")


def _build_client(fixture: dict) -> FireflyClient:
    accounts_data = fixture["accounts"]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/accounts") and request.method == "GET":
            data = [
                {
                    "type": "accounts",
                    "id": aid,
                    "attributes": {
                        "name": attrs["name"],
                        "type": attrs["type"],
                        "account_role": attrs.get("account_role"),
                    },
                }
                for aid, attrs in accounts_data.items()
            ]
            return httpx.Response(
                200,
                json={
                    "data": data,
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        for aid, attrs in accounts_data.items():
            if path == f"/api/v1/accounts/{aid}" and request.method == "GET":
                return httpx.Response(
                    200,
                    json={"data": {"id": aid, "attributes": attrs}},
                )
        if path.endswith("/transactions") and request.method == "GET":
            journals = []
            for split in fixture["splits"]:
                journals.append(
                    {
                        "type": "transactions",
                        "id": split["journal_id"],
                        "attributes": {
                            "transactions": [
                                {
                                    "type": split["type"],
                                    "amount": split["amount"],
                                    "source_id": split["source_id"],
                                    "destination_id": split["destination_id"],
                                    "source_name": split.get("source_name"),
                                    "destination_name": split.get("destination_name"),
                                    "date": split["date"],
                                    "category_name": split.get("category_name"),
                                    "budget_name": split.get("budget_name"),
                                }
                            ]
                        },
                    }
                )
            return httpx.Response(
                200,
                json={
                    "data": journals,
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    return FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )


@pytest.mark.asyncio
async def test_refresh_balances(data_dir, payment_worksheet_env):
    fixture = _fixture()
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    client = _build_client(fixture)
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    result = await run_refresh(client, month)

    row = await sidecar_db.get_worksheet_refresh(month)
    assert row is not None
    balances = json.loads(row["balances_json"])
    assert balances["buckets"]["checking"]["reported_balance"] == "5000.00"
    cc = balances["credit_cards"]["3"]
    assert cc["owed"] == "1250.50"
    assert result["month"] == month
    assert "refreshed_at" in result


@pytest.mark.asyncio
async def test_cc_activity(data_dir, payment_worksheet_env):
    fixture = _fixture()
    client = _build_client(fixture)
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    await run_refresh(client, month)

    balances = json.loads((await sidecar_db.get_worksheet_refresh(month))["balances_json"])
    cc = balances["credit_cards"]["3"]
    # Window after 2026-07-05 payment: grocery + interest + fee (not the $500 payment)
    assert Decimal(cc["new_total"]) == Decimal("149.49")
    assert Decimal(cc["interest_accrued"]) == Decimal("24.50")
    assert Decimal(cc["fees"]) == Decimal("35.00")
    assert cc["last_payment_date"] == "2026-07-05"
    assert Decimal(cc["last_payment_amount"]) == Decimal("500.00")


@pytest.mark.asyncio
async def test_cc_activity_prior_month_payment(data_dir, payment_worksheet_env):
    """Last payment before month start still opens the activity window."""
    fixture = _fixture()
    fixture = {
        **fixture,
        "splits": [
            {
                "journal_id": "290",
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
                "date": "2026-06-20",
            },
            {
                "journal_id": "291",
                "type": "withdrawal",
                "amount": "40.00",
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
                "date": "2026-06-25",
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
                "destination_name": "Fees",
                "source_type": "Asset account",
                "source_role": "Credit card",
                "destination_type": "Expense account",
                "destination_role": None,
                "budget_name": None,
                "category_name": "Late Fee(s)",
                "date": "2026-07-14",
            },
        ],
    }
    client = _build_client(fixture)

    await run_refresh(client, "2026-07")

    balances = json.loads(
        (await sidecar_db.get_worksheet_refresh("2026-07"))["balances_json"]
    )
    cc = balances["credit_cards"]["3"]
    assert cc["last_payment_date"] == "2026-06-20"
    assert Decimal(cc["last_payment_amount"]) == Decimal("500.00")
    # June grocery after payment + July activity (89.99 + 24.50 + 35.00)
    assert Decimal(cc["new_total"]) == Decimal("189.49")
    assert Decimal(cc["interest_accrued"]) == Decimal("24.50")
    assert Decimal(cc["fees"]) == Decimal("35.00")


@pytest.mark.asyncio
async def test_cc_activity_current_month_payment_resets_window(
    data_dir, payment_worksheet_env
):
    """A payment this month anchors New; prior-month charges are excluded."""
    fixture = _fixture()
    fixture = {
        **fixture,
        "splits": [
            {
                "journal_id": "290",
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
                "date": "2026-06-20",
            },
            {
                "journal_id": "291",
                "type": "withdrawal",
                "amount": "40.00",
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
                "date": "2026-06-25",
            },
            *fixture["splits"],
        ],
    }
    client = _build_client(fixture)

    await run_refresh(client, "2026-07")

    balances = json.loads(
        (await sidecar_db.get_worksheet_refresh("2026-07"))["balances_json"]
    )
    cc = balances["credit_cards"]["3"]
    assert cc["last_payment_date"] == "2026-07-05"
    assert Decimal(cc["last_payment_amount"]) == Decimal("500.00")
    # July payment resets window — June grocery excluded
    assert Decimal(cc["new_total"]) == Decimal("149.49")


@pytest.mark.asyncio
async def test_user_balance_preserved(data_dir, payment_worksheet_env):
    fixture = _fixture()
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    await sidecar_db.upsert_bucket_balance(
        bucket_key="checking",
        month=month,
        user_balance="4800.00",
        user_balance_override=1,
    )

    client = _build_client(fixture)
    await run_refresh(client, month)

    rows = await sidecar_db.get_bucket_balances_for_month(month)
    checking = next(r for r in rows if r["bucket_key"] == "checking")
    assert checking["user_balance"] == "4800.00"
    assert checking["user_balance_override"] == 1


@pytest.mark.asyncio
async def test_refresh_snapshots_profile_fields(data_dir, payment_worksheet_env):
    fixture = _fixture()
    client = _build_client(fixture)
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    await run_refresh(client, month)

    balances = json.loads((await sidecar_db.get_worksheet_refresh(month))["balances_json"])
    cc = balances["credit_cards"]["3"]
    assert cc["name"] == "Chase VISA"
    assert cc["credit_limit"] == "10000.00"
    assert cc["funding_bucket_key"] == "checking"


@pytest.mark.asyncio
async def test_refresh_seeds_planned_amount(data_dir, payment_worksheet_env):
    fixture = _fixture()
    client = _build_client(fixture)
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    await run_refresh(client, month)

    rows = await sidecar_db.get_worksheet_state_for_month(month)
    cc_row = next(r for r in rows if r["row_key"] == "cc:3")
    assert cc_row["planned_amount"] == "200.00"
    assert cc_row["planned_amount_override"] == 0
