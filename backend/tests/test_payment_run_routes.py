"""Tests for payment-run API routes (PAY-02, PAY-03, PAY-04, PAY-08)."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

import sidecar_db
from firefly_client import FireflyClient
from payment_worksheet_profiles import current_month_key


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(data_dir):
    from main import app

    return TestClient(app)


def test_disabled_returns_404(monkeypatch, client):
    monkeypatch.delenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", raising=False)
    response = client.get("/api/payment-run")
    assert response.status_code == 404
    assert response.json()["detail"] == "Payment worksheet is not enabled."


@pytest.fixture
def payment_worksheet_env(monkeypatch):
    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")
    monkeypatch.setenv("FIREFLY_BASE_URL", "https://firefly.example")
    monkeypatch.setenv("FIREFLY_API_TOKEN", "test-token")


async def _seed_worksheet_snapshot(month: str) -> None:
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    balances = {
        "buckets": {"checking": {"reported_balance": "5000.00"}},
        "credit_cards": {
            "cc1": {
                "name": "Chase VISA",
                "credit_limit": "10000.00",
                "funding_bucket_key": "checking",
                "owed": "1200.00",
                "new_total": "100.00",
                "interest_accrued": "20.00",
                "fees": "0.00",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )
    await sidecar_db.upsert_worksheet_state_row(
        row_key="cc:cc1",
        row_type="credit_card",
        month=month,
        planned_amount="400.00",
        planned_amount_override=0,
    )


def test_get_worksheet(monkeypatch, client, data_dir, payment_worksheet_env):
    month = current_month_key()
    import asyncio

    asyncio.run(_seed_worksheet_snapshot(month))

    response = client.get("/api/payment-run", params={"month": month})
    assert response.status_code == 200
    body = response.json()
    assert body["month"] == month
    assert body["refreshed_at"] == "2026-07-03T12:00:00Z"
    assert len(body["credit_cards"]) == 1
    assert body["credit_cards"][0]["account_id"] == "cc1"
    assert body["credit_cards"][0]["planned_amount"] == "400.00"
    assert body["buckets"][0]["id"] == "checking"
    assert "shortfall" in body
    assert "totals" in body
    assert body["firefly_base_url"] == "https://firefly.example"


def test_get_worksheet_does_not_call_firefly(monkeypatch, client, data_dir, payment_worksheet_env):
    month = current_month_key()
    import asyncio

    asyncio.run(_seed_worksheet_snapshot(month))

    from routes import payment_run as payment_run_mod

    class _FireflyGuard(FireflyClient):
        async def fetch_accounts(self, *args, **kwargs):
            raise AssertionError("GET /payment-run must not call Firefly")

        async def fetch_account(self, *args, **kwargs):
            raise AssertionError("GET /payment-run must not call Firefly")

    def _guarded_client():
        return _FireflyGuard(
            transport=httpx.MockTransport(lambda r: httpx.Response(500)),
            base_url="https://firefly.example",
            api_token="tok",
        )

    from main import app

    app.dependency_overrides[payment_run_mod.get_firefly_client] = _guarded_client
    try:
        response = client.get("/api/payment-run", params={"month": month})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert len(response.json()["credit_cards"]) == 1


def test_put_worksheet_updates_get_envelope(monkeypatch, client, data_dir, payment_worksheet_env):
    month = current_month_key()
    import asyncio

    asyncio.run(_seed_worksheet_snapshot(month))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/cc1" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc1",
                        "attributes": {
                            "name": "Chase VISA",
                            "type": "asset",
                            "account_role": "creditCard",
                            "notes": "",
                        },
                    }
                },
            )
        if request.url.path == "/api/v1/accounts/cc1" and request.method == "PUT":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc1",
                        "attributes": json.loads(request.content),
                    }
                },
            )
        return httpx.Response(404)

    from routes import payment_run as payment_run_mod
    from main import app

    app.dependency_overrides[payment_run_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    try:
        put_response = client.put(
            "/api/payment-run/accounts/cc1/worksheet",
            params={"month": month},
            json={"funding_bucket_key": "checking"},
        )
        assert put_response.status_code == 200

        get_response = client.get("/api/payment-run", params={"month": month})
        assert get_response.status_code == 200
        body = get_response.json()
        assert body["credit_cards"][0]["funding_bucket_key"] == "checking"
        assert body["buckets"][0]["planned_outflows"] == "400.00"

        exclude_response = client.put(
            "/api/payment-run/accounts/cc1/worksheet",
            params={"month": month},
            json={"included": False},
        )
        assert exclude_response.status_code == 200

        after_exclude = client.get("/api/payment-run", params={"month": month})
        assert after_exclude.json()["credit_cards"] == []
        assert after_exclude.json()["excluded_credit_cards"][0]["account_id"] == "cc1"
    finally:
        app.dependency_overrides.clear()


def test_put_worksheet_ccasset_account_sanitizes_firefly_body(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    month = current_month_key()
    import asyncio

    asyncio.run(_seed_worksheet_snapshot(month))

    async def _add_cc9_stub() -> None:
        row = await sidecar_db.get_worksheet_refresh(month)
        balances = json.loads(row["balances_json"])
        balances["credit_cards"]["cc9"] = {
            "name": "Amex",
            "owed": "500.00",
            "new_total": "50.00",
            "interest_accrued": "0.00",
            "fees": "0.00",
        }
        await sidecar_db.upsert_worksheet_refresh(
            month=month,
            refreshed_at=row["refreshed_at"],
            balances_json=json.dumps(balances),
        )

    asyncio.run(_add_cc9_stub())
    put_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/cc9" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc9",
                        "attributes": {
                            "name": "Amex",
                            "type": "asset",
                            "account_role": "ccAsset",
                            "notes": "",
                            "liability_type": "loan",
                            "interest": None,
                        },
                    }
                },
            )
        if request.url.path == "/api/v1/accounts/cc9" and request.method == "PUT":
            put_bodies.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc9",
                        "attributes": put_bodies[-1],
                    }
                },
            )
        return httpx.Response(404)

    from routes import payment_run as payment_run_mod
    from main import app

    app.dependency_overrides[payment_run_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    try:
        put_response = client.put(
            "/api/payment-run/accounts/cc9/worksheet",
            params={"month": month},
            json={"credit_limit": "15000.00", "funding_bucket_key": "checking"},
        )
        assert put_response.status_code == 200
        assert put_bodies
        assert put_bodies[0]["credit_card_type"] == "monthlyFull"
        assert "liability_type" not in put_bodies[0]

        get_response = client.get("/api/payment-run", params={"month": month})
        cards = get_response.json()["credit_cards"]
        cc9 = next(row for row in cards if row["account_id"] == "cc9")
        assert cc9["credit_limit"] == "15000.00"
        assert cc9["funding_bucket_key"] == "checking"
    finally:
        app.dependency_overrides.clear()


def test_put_worksheet_respects_month_param(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    view_month = "2026-06"
    utc_month = "2026-07"
    monkeypatch.setattr(
        "routes.payment_run.current_month_key", lambda: utc_month
    )
    import asyncio

    asyncio.run(_seed_worksheet_snapshot(view_month))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/cc1" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc1",
                        "attributes": {
                            "name": "Chase VISA",
                            "type": "asset",
                            "account_role": "creditCard",
                            "notes": "",
                        },
                    }
                },
            )
        if request.url.path == "/api/v1/accounts/cc1" and request.method == "PUT":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc1",
                        "attributes": json.loads(request.content),
                    }
                },
            )
        return httpx.Response(404)

    from routes import payment_run as payment_run_mod
    from main import app

    app.dependency_overrides[payment_run_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    try:
        put_response = client.put(
            "/api/payment-run/accounts/cc1/worksheet",
            params={"month": view_month},
            json={"funding_bucket_key": "savings"},
        )
        assert put_response.status_code == 200

        view_row = asyncio.run(sidecar_db.get_worksheet_refresh(view_month))
        assert view_row is not None
        view_balances = json.loads(view_row["balances_json"])
        assert (
            view_balances["credit_cards"]["cc1"]["funding_bucket_key"] == "savings"
        )

        utc_row = asyncio.run(sidecar_db.get_worksheet_refresh(utc_month))
        assert utc_row is None

        get_response = client.get("/api/payment-run", params={"month": view_month})
        assert get_response.status_code == 200
        assert get_response.json()["credit_cards"][0]["funding_bucket_key"] == "savings"
    finally:
        app.dependency_overrides.clear()


def test_put_worksheet_clears_bucket_unassign(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    month = current_month_key()
    import asyncio

    from payment_worksheet_profiles import (
        PAYMENT_WORKSHEET_MARKER,
        parse_payment_worksheet_from_notes,
    )

    asyncio.run(_seed_worksheet_snapshot(month))

    put_bodies: list[dict] = []
    notes_state = {"notes": ""}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/cc1" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc1",
                        "attributes": {
                            "name": "Chase VISA",
                            "type": "asset",
                            "account_role": "creditCard",
                            "notes": notes_state["notes"],
                        },
                    }
                },
            )
        if request.url.path == "/api/v1/accounts/cc1" and request.method == "PUT":
            body = json.loads(request.content)
            put_bodies.append(body)
            notes_state["notes"] = body.get("notes", "")
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc1",
                        "attributes": body,
                    }
                },
            )
        return httpx.Response(404)

    from routes import payment_run as payment_run_mod
    from main import app

    app.dependency_overrides[payment_run_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    try:
        assign_response = client.put(
            "/api/payment-run/accounts/cc1/worksheet",
            json={"funding_bucket_key": "checking"},
        )
        assert assign_response.status_code == 200

        after_assign = client.get("/api/payment-run", params={"month": month})
        assert after_assign.status_code == 200
        assert after_assign.json()["credit_cards"][0]["funding_bucket_key"] == "checking"

        unassign_response = client.put(
            "/api/payment-run/accounts/cc1/worksheet",
            json={"funding_bucket_key": None},
        )
        assert unassign_response.status_code == 200

        after_unassign = client.get("/api/payment-run", params={"month": month})
        assert after_unassign.status_code == 200
        assert after_unassign.json()["credit_cards"][0]["funding_bucket_key"] is None

        assert len(put_bodies) == 2
        last_notes = put_bodies[-1].get("notes", "")
        assert PAYMENT_WORKSHEET_MARKER in last_notes
        parsed = parse_payment_worksheet_from_notes(last_notes)
        assert parsed is not None
        assert "funding_bucket_key" not in parsed
    finally:
        app.dependency_overrides.clear()


def test_put_row_state(monkeypatch, client, data_dir, payment_worksheet_env):
    month = current_month_key()
    import asyncio

    asyncio.run(_seed_worksheet_snapshot(month))

    before = client.get("/api/payment-run", params={"month": month}).json()
    remaining_before = before["buckets"][0]["remaining"]

    put_planned = client.put(
        "/api/payment-run/rows/cc:cc1",
        params={"month": month},
        json={"planned_amount": "900.00"},
    )
    assert put_planned.status_code == 200

    after_planned = client.get("/api/payment-run", params={"month": month}).json()
    assert after_planned["credit_cards"][0]["planned_amount"] == "900.00"
    assert after_planned["buckets"][0]["planned_outflows"] == "900.00"

    put_paid = client.put(
        "/api/payment-run/rows/cc:cc1",
        params={"month": month},
        json={"paid_at": "2026-07-15T12:00:00Z"},
    )
    assert put_paid.status_code == 200

    after_paid = client.get("/api/payment-run", params={"month": month}).json()
    assert after_paid["credit_cards"][0]["paid_at"] == "2026-07-15T12:00:00Z"
    assert after_paid["buckets"][0]["remaining"] == after_planned["buckets"][0]["remaining"]

    clear_planned = client.put(
        "/api/payment-run/rows/cc:cc1",
        params={"month": month},
        json={"planned_amount": "0.00", "clear_planned_override": True},
    )
    assert clear_planned.status_code == 200

    after_clear = client.get("/api/payment-run", params={"month": month}).json()
    card = after_clear["credit_cards"][0]
    assert card["planned_amount"] == "0.00"
    assert card["planned_amount_override"] is False
    assert after_clear["buckets"][0]["planned_outflows"] == "0.00"


def test_put_bucket_balance(monkeypatch, client, data_dir, payment_worksheet_env):
    month = current_month_key()
    import asyncio

    asyncio.run(_seed_worksheet_snapshot(month))

    put_balance = client.put(
        "/api/payment-run/buckets/checking/balance",
        params={"month": month},
        json={"user_balance": "4500.00"},
    )
    assert put_balance.status_code == 200

    after = client.get("/api/payment-run", params={"month": month}).json()
    checking = after["buckets"][0]
    assert checking["user_balance"] == "4500.00"
    assert checking["user_balance_override"] is True

    reset = client.put(
        "/api/payment-run/buckets/checking/balance",
        params={"month": month},
        json={"user_balance": "0.00", "reset_to_reported": True},
    )
    assert reset.status_code == 200

    after_reset = client.get("/api/payment-run", params={"month": month}).json()
    assert after_reset["buckets"][0]["user_balance"] == "5000.00"
    assert after_reset["buckets"][0]["user_balance_override"] is False


def test_bucket_crud(monkeypatch, client):
    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")
    monkeypatch.setenv("FIREFLY_BASE_URL", "https://firefly.example")
    monkeypatch.setenv("FIREFLY_API_TOKEN", "test-token")

    import firefly_reference_cache
    from main import app
    from routes.payment_run import get_firefly_client

    firefly_reference_cache.clear()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts") and request.method == "GET":
            data = [
                {
                    "type": "accounts",
                    "id": aid,
                    "attributes": {
                        "name": name,
                        "type": "asset",
                        "account_role": role,
                    },
                }
                for aid, name, role in [
                    ("7", "Checking", "defaultAsset"),
                    ("8", "Savings", "defaultAsset"),
                    ("10", "Extra", "defaultAsset"),
                    ("3", "Chase VISA", "creditCard"),
                ]
            ]
            return httpx.Response(
                200,
                json={
                    "data": data,
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    mock_client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    app.dependency_overrides[get_firefly_client] = lambda: mock_client

    try:
        create_savings = client.post(
            "/api/payment-run/buckets",
            json={
                "id": "savings",
                "label": "Savings",
                "sort_order": 0,
                "firefly_account_ids": ["10"],
            },
        )
        assert create_savings.status_code == 200
        assert create_savings.json()["id"] == "savings"

        create_checking = client.post(
            "/api/payment-run/buckets",
            json={
                "id": "checking",
                "label": "Checking",
                "sort_order": 1,
                "firefly_account_ids": ["7", "8"],
            },
        )
        assert create_checking.status_code == 200

        listed = client.get("/api/payment-run/buckets")
        assert listed.status_code == 200
        data = listed.json()["data"]
        assert [bucket["id"] for bucket in data] == ["savings", "checking"]

        updated = client.put(
            "/api/payment-run/buckets/checking",
            json={
                "label": "Primary Checking",
                "sort_order": 1,
                "firefly_account_ids": ["7", "8"],
            },
        )
        assert updated.status_code == 200
        assert updated.json()["label"] == "Primary Checking"

        after_update = client.get("/api/payment-run/buckets")
        checking = next(
            bucket for bucket in after_update.json()["data"] if bucket["id"] == "checking"
        )
        assert checking["label"] == "Primary Checking"

        deleted = client.delete("/api/payment-run/buckets/savings")
        assert deleted.status_code == 200

        remaining = client.get("/api/payment-run/buckets")
        assert len(remaining.json()["data"]) == 1
        assert remaining.json()["data"][0]["id"] == "checking"

        invalid = client.post(
            "/api/payment-run/buckets",
            json={
                "id": "bad",
                "label": "Bad",
                "sort_order": 2,
                "firefly_account_ids": [""],
            },
        )
        assert invalid.status_code == 422

        cc_rejected = client.post(
            "/api/payment-run/buckets",
            json={
                "id": "cc-bucket",
                "label": "Bad CC",
                "sort_order": 3,
                "firefly_account_ids": ["3"],
            },
        )
        assert cc_rejected.status_code == 422
        assert "cannot fund a bucket" in cc_rejected.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)
        firefly_reference_cache.clear()


def test_get_worksheet_bills(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    from payment_worksheet_compute import bill_row_key

    async def _seed() -> int:
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
            "buckets": {"checking": {"reported_balance": "5000.00"}},
            "credit_cards": {},
            "liabilities": {},
            "excluded_liabilities": {},
            "bills": {
                str(reg_id): {
                    "owed": "99.00",
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
        await sidecar_db.upsert_worksheet_state_row(
            row_key=bill_row_key(reg_id),
            row_type="bill",
            month="2026-07",
            planned_amount="99.00",
            planned_amount_override=0,
        )
        return reg_id

    reg_id = asyncio.run(_seed())
    response = client.get("/api/payment-run", params={"month": "2026-07"})
    assert response.status_code == 200
    body = response.json()
    assert len(body["bills"]) == 1
    assert body["bills"][0]["row_key"] == bill_row_key(reg_id)
    assert body["bills"][0]["amount_due"] == "99.00"
    assert body["section_subtotals"]["bills"]["due"] == "99.00"
    assert body["grand_totals"]["due"] == "99.00"
    assert body["grand_totals"]["planned_cash"] == "99.00"


def test_register_bill(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    bill_posts: list[dict] = []
    rule_posts: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/rule-groups" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "rule-groups",
                            "id": "1",
                            "attributes": {"title": "Payment worksheet"},
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path == "/api/v1/bills" and request.method == "POST":
            bill_posts.append(json.loads(request.content.decode()))
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "bills",
                        "id": "bill-api",
                        "attributes": {"name": bill_posts[-1]["name"]},
                    }
                },
            )
        if path == "/api/v1/rules" and request.method == "POST":
            rule_posts.append(json.loads(request.content.decode()))
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-api",
                        "attributes": {"title": rule_posts[-1]["title"]},
                    }
                },
            )
        return httpx.Response(404)

    mock_client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    app.dependency_overrides[get_firefly_client] = lambda: mock_client
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
        )
    )
    monkeypatch.setenv(
        "FF3LANTERN_PAYMENT_WORKSHEET_RULE_GROUP", "Payment worksheet"
    )

    try:
        response = client.post(
            "/api/payment-run/bills/register",
            json={
                "mode": "create_new",
                "name": "Electric",
                "amount": "99.00",
                "amount_mode": "recurring",
                "repeat_freq": "monthly",
                "worksheet_section": "bills",
                "payment_rail": "bank",
                "funding_bucket_key": "checking",
                "description_contains": "POWER CO",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["firefly_bill_id"] == "bill-api"
        assert body["rule_id"] == "rule-api"
        assert body["counts_toward_cash_plan"] is True
        assert len(bill_posts) == 1
        assert len(rule_posts) == 1

        duplicate = client.post(
            "/api/payment-run/bills/register",
            json={
                "mode": "link_existing",
                "name": "Electric",
                "amount": "99.00",
                "amount_mode": "recurring",
                "worksheet_section": "bills",
                "payment_rail": "bank",
                "funding_bucket_key": "checking",
                "description_contains": "POWER CO",
                "firefly_bill_id": "bill-api",
            },
        )
        assert duplicate.status_code == 422
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_available_bills(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/bills" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "bills",
                            "id": "1",
                            "attributes": {
                                "name": "Water",
                                "amount_min": "50.00",
                                "repeat_freq": "monthly",
                            },
                        },
                        {
                            "type": "bills",
                            "id": "2",
                            "attributes": {
                                "name": "Internet",
                                "amount_min": "80.00",
                                "repeat_freq": "monthly",
                            },
                        },
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "1",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "r1",
                "row_label": "Water",
            }
        )
    )

    try:
        response = client.get("/api/payment-run/available")
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data) == 1
        assert data[0]["id"] == "2"
        assert data[0]["name"] == "Internet"
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_update_bill_registry(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-upd",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-upd",
                "row_label": "Gas",
            }
        )
    )
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
        )
    )
    response = client.put(
        f"/api/payment-run/bills/{reg_id}",
        json={
            "worksheet_section": "liabilities",
            "row_label": "Gas bill",
            "amount_mode": "intermittent",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["worksheet_section"] == "liabilities"
    assert body["row_label"] == "Gas bill"
    assert body["amount_mode"] == "intermittent"
    assert body["planned_sync"] == "manual"
    assert body["firefly_bill_id"] == "bill-upd"


def test_delete_bill_registry(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    class _DeleteGuard(FireflyClient):
        async def fetch_bills(self, *args, **kwargs):
            raise AssertionError("DELETE must not call Firefly")

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-del",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-del",
                "row_label": "Trash",
            }
        )
    )
    app.dependency_overrides[get_firefly_client] = lambda: _DeleteGuard(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.delete(f"/api/payment-run/bills/{reg_id}")
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert asyncio.run(sidecar_db.get_worksheet_registry(reg_id)) is None
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_bills_disabled(monkeypatch, client):
    monkeypatch.delenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", raising=False)
    list_response = client.get("/api/payment-run/bills")
    assert list_response.status_code == 404
    assert list_response.json()["detail"] == "Payment worksheet is not enabled."
    history_response = client.get("/api/payment-run/bills/1/history")
    assert history_response.status_code == 404
    assert history_response.json()["detail"] == "Payment worksheet is not enabled."


def test_list_registered_bills(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    async def _seed() -> tuple[int, int, int]:
        bank_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-bank",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-bank",
                "row_label": "Electric",
            }
        )
        cc_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-cc",
                "worksheet_section": "bills",
                "credit_card_account_id": "cc1",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "credit_card",
                "rule_id": "rule-cc",
                "row_label": "Internet",
            }
        )
        unregistered_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": None,
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-pending",
                "row_label": "Pending",
            }
        )
        return bank_id, cc_id, unregistered_id

    bank_id, cc_id, unregistered_id = asyncio.run(_seed())

    from main import app
    from routes.payment_run import get_firefly_client

    class _ListGuard(FireflyClient):
        async def fetch_bills(self, *args, **kwargs):
            raise AssertionError("GET /payment-run/bills must not call Firefly")

    app.dependency_overrides[get_firefly_client] = lambda: _ListGuard(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.get("/api/payment-run/bills")
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data) == 2
        labels = [row["row_label"] for row in data]
        assert labels == ["Electric", "Internet"]
        bank_row = next(row for row in data if row["registry_id"] == bank_id)
        cc_row = next(row for row in data if row["registry_id"] == cc_id)
        assert bank_row["payment_rail"] == "bank"
        assert bank_row["firefly_bill_id"] == "bill-bank"
        assert cc_row["payment_rail"] == "credit_card"
        assert cc_row["firefly_bill_id"] == "bill-cc"
        assert not any(row["registry_id"] == unregistered_id for row in data)
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_bill_history(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "7",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-hist",
                "row_label": "Electric",
            }
        )
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/bills/7/transactions" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "transactions",
                            "id": "200",
                            "attributes": {
                                "description": "Jan payment",
                                "transactions": [
                                    {
                                        "type": "withdrawal",
                                        "amount": "-100.00",
                                        "destination_name": "Utility Co",
                                        "date": "2026-01-15",
                                        "description": "Jan payment",
                                        "transaction_journal_id": "2001",
                                    }
                                ],
                            },
                        },
                        {
                            "type": "transactions",
                            "id": "201",
                            "attributes": {
                                "description": "Feb payment",
                                "transactions": [
                                    {
                                        "type": "withdrawal",
                                        "amount": "-50.00",
                                        "destination_name": "Utility Co",
                                        "date": "2026-02-10",
                                        "description": "Feb payment",
                                        "transaction_journal_id": "2002",
                                    }
                                ],
                            },
                        },
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.get(f"/api/payment-run/bills/{reg_id}/history")
        assert response.status_code == 200
        body = response.json()
        assert body["registry_id"] == reg_id
        assert body["row_label"] == "Electric"
        assert body["firefly_bill_id"] == "7"
        assert body["window"]["start"]
        assert body["window"]["end"]
        assert body["total"] == "150.00"
        assert body["calendar_average"] == "12.50"
        assert body["active_month_average"] == "75.00"
        assert body["active_month_count"] == 2
        assert len(body["transactions"]) == 2
        assert body["transactions"][0]["date"] == "2026-02-10"
        assert body["transactions"][1]["date"] == "2026-01-15"
        assert body["firefly_base_url"] == "https://firefly.example"
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_bill_history_not_found(monkeypatch, client, data_dir, payment_worksheet_env):
    from main import app
    from routes.payment_run import get_firefly_client

    firefly_called = {"value": False}

    def handler(request: httpx.Request) -> httpx.Response:
        firefly_called["value"] = True
        return httpx.Response(404)

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.get("/api/payment-run/bills/99999/history")
        assert response.status_code == 404
        assert response.json()["detail"] == "Registered bill not found."
        assert firefly_called["value"] is False
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_empty_history(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "empty-bill",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-empty",
                "row_label": "New bill",
            }
        )
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if (
            request.url.path == "/api/v1/bills/empty-bill/transactions"
            and request.method == "GET"
        ):
            return httpx.Response(
                200,
                json={
                    "data": [],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.get(f"/api/payment-run/bills/{reg_id}/history")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == "0.00"
        assert body["calendar_average"] == "0.00"
        assert body["active_month_average"] == "0.00"
        assert body["active_month_count"] == 0
        assert body["transactions"] == []
        assert body["monthly_totals"] == []
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_delete_bill_registry_cleans_worksheet_state(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    from main import app
    from payment_worksheet_compute import bill_row_key
    from routes.payment_run import get_firefly_client

    class _DeleteGuard(FireflyClient):
        async def fetch_bills(self, *args, **kwargs):
            raise AssertionError("DELETE must not call Firefly")

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-del-state",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-del-state",
                "row_label": "State cleanup",
            }
        )
    )
    asyncio.run(
        sidecar_db.upsert_worksheet_state_row(
            row_key=bill_row_key(reg_id),
            row_type="bill",
            month="2026-07",
            planned_amount="25.00",
        )
    )
    app.dependency_overrides[get_firefly_client] = lambda: _DeleteGuard(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.delete(f"/api/payment-run/bills/{reg_id}")
        assert response.status_code == 200
        rows = asyncio.run(sidecar_db.get_worksheet_state_for_month("2026-07"))
        assert not [r for r in rows if r["row_key"] == bill_row_key(reg_id)]
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)

