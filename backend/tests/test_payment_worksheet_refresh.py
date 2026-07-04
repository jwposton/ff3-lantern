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
from loan_profiles import serialize_loan_profile_to_notes
from payment_worksheet_compute import bill_row_key
from payment_worksheet_liabilities import liability_row_key
from payment_worksheet_refresh import run_refresh

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


@pytest.fixture
def payment_worksheet_env(monkeypatch):
    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")
    monkeypatch.setenv("FIREFLY_BASE_URL", "https://firefly.example")
    monkeypatch.setenv("FIREFLY_API_TOKEN", "test-token")
    monkeypatch.delenv(
        "FF3LANTERN_PAYMENT_WORKSHEET_INTEREST_CATEGORIES", raising=False
    )
    monkeypatch.delenv(
        "FF3LANTERN_PAYMENT_WORKSHEET_FEE_CATEGORIES", raising=False
    )


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
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
    txns = cc["new_transactions"]
    assert len(txns) == 3
    assert sum(Decimal(t["amount"]) for t in txns) == Decimal("149.49")
    kinds = {t["kind"] for t in txns}
    assert kinds == {"charge", "interest", "fee"}
    grocery = next(t for t in txns if t["journal_id"] == "301")
    assert grocery["payee"] == "Grocery Store"
    assert grocery["budget"] == "Groceries"


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


def _liability_fixture() -> dict:
    fixture = _fixture()
    mortgage_notes = serialize_loan_profile_to_notes(LOAN_PROFILE, "")
    fixture = {
        **fixture,
        "accounts": {
            **fixture["accounts"],
            "42": {
                "name": "Mortgage",
                "type": "liabilities",
                "account_role": "mortgage",
                "current_balance": "-50000.00",
                "interest": "6.5",
                "notes": mortgage_notes,
            },
        },
    }
    return fixture


@pytest.mark.asyncio
async def test_liability_autodraft(data_dir, payment_worksheet_env):
    fixture = _liability_fixture()
    client = _build_client(fixture)
    month = "2026-07"

    await run_refresh(client, month)

    rows = await sidecar_db.get_worksheet_state_for_month(month)
    liability_row = next(r for r in rows if r["row_key"] == liability_row_key("42"))
    assert liability_row["planned_amount"] == "427.18"
    assert liability_row["planned_amount_override"] == 0

    balances = json.loads((await sidecar_db.get_worksheet_refresh(month))["balances_json"])
    assert "42" in balances["liabilities"]
    assert balances["liabilities"]["42"]["owed"] == "50000.00"
    assert balances["liabilities"]["42"]["est_interest"] is not None


@pytest.mark.asyncio
async def test_liability_override_preserved(data_dir, payment_worksheet_env):
    fixture = _liability_fixture()
    client = _build_client(fixture)
    month = "2026-07"
    row_key = liability_row_key("42")
    await sidecar_db.upsert_worksheet_state_row(
        row_key=row_key,
        row_type="liability",
        month=month,
        planned_amount="999.00",
        planned_amount_override=1,
    )

    await run_refresh(client, month)

    rows = await sidecar_db.get_worksheet_state_for_month(month)
    liability_row = next(r for r in rows if r["row_key"] == row_key)
    assert liability_row["planned_amount"] == "999.00"
    assert liability_row["planned_amount_override"] == 1


@pytest.mark.asyncio
async def test_excluded_liability(data_dir, payment_worksheet_env):
    fixture = _liability_fixture()
    exclude_notes = (
        "<!-- ff3analytics:payment_worksheet.v1 -->\n"
        '{"included": false}'
    )
    fixture["accounts"]["42"]["notes"] = (
        fixture["accounts"]["42"]["notes"] + "\n\n" + exclude_notes
    )
    client = _build_client(fixture)
    month = "2026-07"

    await run_refresh(client, month)

    balances = json.loads((await sidecar_db.get_worksheet_refresh(month))["balances_json"])
    assert "42" not in balances["liabilities"]
    assert balances["excluded_liabilities"]["42"]["name"] == "Mortgage"


def _build_client_with_bills(fixture: dict, bills: dict[str, dict]) -> FireflyClient:
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
        for bill_id, bill in bills.items():
            if path == f"/api/v1/bills/{bill_id}" and request.method == "GET":
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "id": bill_id,
                            "attributes": {
                                "name": bill["name"],
                                "amount_min": bill["amount_min"],
                                "amount_max": bill.get("amount_max"),
                                "repeat_freq": bill.get("repeat_freq", "monthly"),
                            },
                        }
                    },
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
async def test_refresh_bill_owed(data_dir, payment_worksheet_env):
    fixture = _fixture()
    bills = {
        "bill-99": {
            "name": "Electric",
            "amount_min": "89.50",
            "amount_max": "89.50",
        }
    }
    client = _build_client_with_bills(fixture, bills)
    reg_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "bill-99",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-1",
            "row_label": "Electric",
        }
    )
    intermittent_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "bill-99",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "intermittent",
            "planned_sync": "manual",
            "payment_rail": "bank",
            "rule_id": "rule-2",
            "row_label": "Heating oil",
        }
    )
    month = "2026-07"

    await run_refresh(client, month)

    balances = json.loads((await sidecar_db.get_worksheet_refresh(month))["balances_json"])
    assert balances["bills"][str(reg_id)]["owed"] == "89.50"
    assert balances["bills"][str(intermittent_id)]["owed"] == "0.00"

    rows = await sidecar_db.get_worksheet_state_for_month(month)
    intermittent_rows = [
        r for r in rows if r["row_key"] == bill_row_key(intermittent_id)
    ]
    assert not intermittent_rows


@pytest.mark.asyncio
async def test_refresh_recurring_bill_owed_uses_min_max_average(data_dir, payment_worksheet_env):
    fixture = _fixture()
    bills = {
        "bill-range": {
            "name": "Electric",
            "amount_min": "80.00",
            "amount_max": "120.00",
        }
    }
    client = _build_client_with_bills(fixture, bills)
    reg_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "bill-range",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-1",
            "row_label": "Electric",
        }
    )
    month = "2026-07"

    await run_refresh(client, month)

    balances = json.loads((await sidecar_db.get_worksheet_refresh(month))["balances_json"])
    assert balances["bills"][str(reg_id)]["owed"] == "100.00"


@pytest.mark.asyncio
async def test_refresh_skips_stale_registry_bill(data_dir, payment_worksheet_env):
    fixture = _fixture()
    bills = {
        "bill-good": {
            "name": "Electric",
            "amount_min": "120.00",
        },
    }
    client = _build_client_with_bills(fixture, bills)
    good_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "bill-good",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-good",
            "row_label": "Electric",
        }
    )
    stale_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "bill-missing",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-stale",
            "row_label": "Old bill",
        }
    )
    month = "2026-07"

    result = await run_refresh(client, month)

    assert result["month"] == month
    balances = json.loads((await sidecar_db.get_worksheet_refresh(month))["balances_json"])
    assert balances["bills"][str(good_id)]["owed"] == "120.00"
    assert balances["bills"][str(stale_id)]["unavailable"] is True
    assert balances["bills"][str(stale_id)]["owed"] == "0.00"
