"""Tests for payment-run API routes (PAY-02, PAY-03, PAY-04, PAY-08)."""

from __future__ import annotations

import json
from datetime import date

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


def _preflight_list_response(request: httpx.Request) -> httpx.Response | None:
    path = request.url.path
    empty_page = {
        "data": [],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }
    if path == "/api/v1/rules" and request.method == "GET":
        return httpx.Response(200, json=empty_page)
    if path == "/api/v1/bills" and request.method == "GET":
        return httpx.Response(200, json=empty_page)
    return None


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
    trigger_calls: list[tuple[str, str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        preflight = _preflight_list_response(request)
        if preflight is not None:
            return preflight
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
        if path.startswith("/api/v1/rules/") and path.endswith("/trigger"):
            rule_id = path.split("/")[-2]
            trigger_calls.append(
                (rule_id, request.url.params["start"], request.url.params["end"])
            )
            return httpx.Response(204)
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
        assert len(trigger_calls) == 1
        assert trigger_calls[0][0] == "rule-api"

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


def test_get_bill_registry(monkeypatch, client, data_dir, payment_worksheet_env):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-get",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-get",
                "row_label": "Water",
            }
        )
    )

    class _FetchBillClient(FireflyClient):
        async def fetch_bill(self, bill_id: str):
            assert bill_id == "bill-get"
            return {
                "id": bill_id,
                "name": "Water",
                "amount_min": "45.00",
                "amount_max": "45.00",
                "repeat_freq": "monthly",
            }

    app.dependency_overrides[get_firefly_client] = lambda: _FetchBillClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.get(f"/api/payment-run/bills/{reg_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["registry_id"] == reg_id
        assert body["amount_min"] == "45.00"
        assert body["amount_max"] == "45.00"
        assert body["repeat_freq"] == "monthly"
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_update_bill_registry_persists_firefly_amounts(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-amt",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-amt",
                "row_label": "Internet",
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

    seen_updates: list[dict] = []

    class _UpdateBillClient(FireflyClient):
        async def fetch_bill(self, bill_id: str):
            return {
                "id": bill_id,
                "name": "Internet",
                "amount_min": "50.00",
                "amount_max": "50.00",
                "repeat_freq": "monthly",
            }

        async def update_bill(self, bill_id: str, body: dict):
            seen_updates.append({"bill_id": bill_id, "body": body})
            return {"id": bill_id, "attributes": body}

    app.dependency_overrides[get_firefly_client] = lambda: _UpdateBillClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.put(
            f"/api/payment-run/bills/{reg_id}",
            json={
                "name": "Internet",
                "amount_min": "79.99",
                "amount_max": "79.99",
            },
        )
        assert response.status_code == 200
        assert len(seen_updates) == 1
        assert seen_updates[0]["bill_id"] == "bill-amt"
        assert seen_updates[0]["body"]["amount_min"] == "79.99"
        assert seen_updates[0]["body"]["amount_max"] == "79.99"
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_update_bill_registry_rename_syncs_rule(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-ren",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-ren",
                "row_label": "Gas bill",
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

    bill_updates: list[dict] = []
    rule_updates: list[dict] = []

    class _RenameClient(FireflyClient):
        async def fetch_bill(self, bill_id: str):
            return {
                "id": bill_id,
                "name": "Gas bill",
                "amount_min": "50.00",
                "amount_max": "50.00",
                "repeat_freq": "monthly",
            }

        async def update_bill(self, bill_id: str, body: dict):
            bill_updates.append({"bill_id": bill_id, "body": body})
            return {"id": bill_id, "attributes": body}

        async def fetch_rule(self, rule_id: str):
            assert rule_id == "rule-ren"
            return {
                "id": rule_id,
                "title": "Gas bill",
                "rule_group_id": "9",
                "trigger": "store-journal",
                "active": True,
                "strict": False,
                "triggers": [
                    {"type": "description_contains", "value": "GAS", "active": True},
                ],
                "actions": [
                    {"type": "link_to_bill", "value": "Gas bill", "active": True},
                ],
            }

        async def update_rule(self, rule_id: str, body: dict):
            rule_updates.append({"rule_id": rule_id, "body": body})
            return {"id": rule_id, "title": body["title"]}

    app.dependency_overrides[get_firefly_client] = lambda: _RenameClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.put(
            f"/api/payment-run/bills/{reg_id}",
            json={"name": "Gas utility"},
        )
        assert response.status_code == 200
        assert len(bill_updates) == 1
        assert bill_updates[0]["body"]["name"] == "Gas utility"
        assert len(rule_updates) == 1
        assert rule_updates[0]["body"]["actions"][0]["value"] == "Gas utility"
        assert rule_updates[0]["body"]["title"] == "Gas utility"
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_update_bill_registry_amount_only_skips_rule(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-amt-only",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-amt-only",
                "row_label": "Internet",
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

    class _AmountOnlyClient(FireflyClient):
        async def fetch_bill(self, bill_id: str):
            return {
                "id": bill_id,
                "name": "Internet",
                "amount_min": "50.00",
                "amount_max": "50.00",
                "repeat_freq": "monthly",
            }

        async def update_bill(self, bill_id: str, body: dict):
            return {"id": bill_id, "attributes": body}

        async def fetch_rule(self, rule_id: str):
            raise AssertionError("amount-only edit must not fetch rule")

        async def update_rule(self, rule_id: str, body: dict):
            raise AssertionError("amount-only edit must not update rule")

    app.dependency_overrides[get_firefly_client] = lambda: _AmountOnlyClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.put(
            f"/api/payment-run/bills/{reg_id}",
            json={"amount_min": "79.99", "amount_max": "79.99"},
        )
        assert response.status_code == 200
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_repair_bill_link_rule(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-repair",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-repair",
                "row_label": "Water",
            }
        )
    )

    rule_updates: list[dict] = []

    class _RepairClient(FireflyClient):
        async def fetch_bill(self, bill_id: str):
            return {
                "id": bill_id,
                "name": "Water utility",
                "amount_min": "45.00",
                "amount_max": "45.00",
                "repeat_freq": "monthly",
            }

        async def fetch_rule(self, rule_id: str):
            return {
                "id": rule_id,
                "title": "Water",
                "rule_group_id": "9",
                "trigger": "store-journal",
                "active": True,
                "strict": False,
                "triggers": [],
                "actions": [
                    {"type": "link_to_bill", "value": "Water", "active": True},
                ],
            }

        async def update_rule(self, rule_id: str, body: dict):
            rule_updates.append(body)
            return {"id": rule_id, "title": body["title"]}

    app.dependency_overrides[get_firefly_client] = lambda: _RepairClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.post(f"/api/payment-run/bills/{reg_id}/repair-rule")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        assert body["rule_sync_status"] == "synced"
        assert rule_updates[0]["actions"][0]["value"] == "Water utility"
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


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
        if request.url.path == "/api/v1/bills/7" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "bills",
                        "id": "7",
                        "attributes": {
                            "name": "Electric",
                            "amount_min": "50.00",
                            "amount_max": "50.00",
                            "repeat_freq": "monthly",
                        },
                    }
                },
            )
        if request.url.path == "/api/v1/rules/rule-hist" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-hist",
                        "attributes": {
                            "title": "Electric",
                            "trigger": "store-journal",
                            "active": True,
                            "strict": False,
                            "triggers": [],
                            "actions": [
                                {
                                    "type": "link_to_bill",
                                    "value": "Electric",
                                    "active": True,
                                }
                            ],
                        },
                        "relationships": {
                            "rule_group": {
                                "data": {"type": "rule_groups", "id": "1"},
                            }
                        },
                    }
                },
            )
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
        assert body["rule_sync_status"] == "synced"
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_bill_history_syncs_drifted_row_label(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-audible",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-audible",
                "row_label": "Audible",
            }
        )
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/bills/bill-audible" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "bills",
                        "id": "bill-audible",
                        "attributes": {
                            "name": "EBook",
                            "amount_min": "14.95",
                            "amount_max": "14.95",
                            "repeat_freq": "monthly",
                        },
                    }
                },
            )
        if request.url.path == "/api/v1/rules/rule-audible" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-audible",
                        "attributes": {
                            "title": "EBook",
                            "rule_group_id": "1",
                            "triggers": [],
                            "actions": [
                                {
                                    "type": "link_to_bill",
                                    "value": "EBook",
                                    "active": True,
                                }
                            ],
                        },
                    }
                },
            )
        if (
            request.url.path == "/api/v1/bills/bill-audible/transactions"
            and request.method == "GET"
        ):
            return httpx.Response(
                200,
                json={"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}},
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
        assert body["name"] == "EBook"
        assert body["row_label"] == "EBook"
        assert body["row_label_synced"] is True
        row = asyncio.run(sidecar_db.get_worksheet_registry(reg_id))
        assert row is not None
        assert row["row_label"] == "EBook"
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


def test_credit_card_history(monkeypatch, client, data_dir, payment_worksheet_env):
    from conftest import load_fixture
    from main import app
    from routes.payment_run import get_firefly_client

    fixture = load_fixture("payment_worksheet_splits.json")
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
        if path.endswith("/accounts/3") and request.method == "GET":
            attrs = accounts_data["3"]
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "accounts",
                        "id": "3",
                        "attributes": {
                            "name": attrs["name"],
                            "type": attrs["type"],
                            "account_role": attrs.get("account_role"),
                            "current_balance": attrs["current_balance"],
                            "notes": attrs.get("notes"),
                        },
                    }
                },
            )
        if path.endswith("/transactions") and request.method == "GET":
            journals = [
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
                                "source_type": split.get("source_type"),
                                "source_role": split.get("source_role"),
                                "destination_type": split.get("destination_type"),
                                "destination_role": split.get("destination_role"),
                                "date": split["date"],
                                "category_name": split.get("category_name"),
                                "budget_name": split.get("budget_name"),
                            }
                        ]
                    },
                }
                for split in fixture["splits"]
            ]
            return httpx.Response(
                200,
                json={
                    "data": journals,
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    monkeypatch.setattr("app_clock.today", lambda: date(2026, 7, 15))

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.get("/api/payment-run/credit-cards/3/history")
        assert response.status_code == 200
        body = response.json()
        assert body["account"]["account_id"] == "3"
        assert body["account"]["name"] == "Chase VISA"
        assert body["account"]["owed"] == "1250.50"
        assert body["window"]["start"]
        assert body["stats_window"]["end"] == "2026-07"
        assert body["totals"]["charges"] == "89.99"
        assert body["totals"]["payments"] == "500.00"
        assert body["totals"]["interest"] == "24.50"
        assert body["totals"]["fees"] == "35.00"
        assert len(body["transactions"]) == 4
        assert body["transactions"][0]["date"] == "2026-07-14"
        assert body["firefly_base_url"] == "https://firefly.example"

        ranged = client.get(
            "/api/payment-run/credit-cards/3/history",
            params={"start": "2026-07-01", "end": "2026-07-15"},
        )
        assert ranged.status_code == 200
        ranged_body = ranged.json()
        assert ranged_body["window"] == {"start": "2026-07-01", "end": "2026-07-15"}
        assert ranged_body["stats_window"] == {"start": "2026-07", "end": "2026-07"}
        assert all(
            "2026-07-01" <= row["date"] <= "2026-07-15"
            for row in ranged_body["transactions"]
        )
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_credit_card_history_not_found(monkeypatch, client, data_dir, payment_worksheet_env):
    from main import app
    from routes.payment_run import get_firefly_client

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.get("/api/payment-run/credit-cards/999/history")
        assert response.status_code == 404
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_liability_history(monkeypatch, client, data_dir, payment_worksheet_env):
    from loan_profiles import serialize_loan_profile_to_notes
    from main import app
    from routes.payment_run import get_firefly_client

    profile = {
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
    notes = serialize_loan_profile_to_notes(profile, "")

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/accounts") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "accounts",
                            "id": "42",
                            "attributes": {
                                "name": "Mortgage",
                                "type": "liabilities",
                                "account_role": "mortgage",
                            },
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path.endswith("/accounts/42") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "accounts",
                        "id": "42",
                        "attributes": {
                            "name": "Mortgage",
                            "type": "liabilities",
                            "account_role": "mortgage",
                            "current_balance": "-50000.00",
                            "interest": "6.5",
                            "notes": notes,
                        },
                    }
                },
            )
        if path.endswith("/transactions") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "transactions",
                            "id": "500",
                            "attributes": {
                                "transactions": [
                                    {
                                        "type": "transfer",
                                        "amount": "-427.18",
                                        "description": "Mortgage July",
                                        "date": "2026-07-10",
                                        "source_id": "1",
                                        "destination_id": "42",
                                    }
                                ]
                            },
                        }
                    ],
                    "meta": {"pagination": {"total_pages": 1}},
                },
            )
        return httpx.Response(404)

    monkeypatch.setattr("app_clock.today", lambda: date(2026, 7, 15))

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.get("/api/payment-run/liabilities/42/history")
        assert response.status_code == 200
        body = response.json()
        assert body["account"]["account_id"] == "42"
        assert body["account"]["loan_configured"] is True
        assert body["account"]["owed"] == "50000.00"
        assert body["totals"]["total_payment"] == "427.18"
        assert len(body["transactions"]) == 1
        assert body["transactions"][0]["principal"]
        assert body["transactions"][0]["interest"]
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_liability_history_unconfigured(monkeypatch, client, data_dir, payment_worksheet_env):
    from main import app
    from routes.payment_run import get_firefly_client

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/accounts") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "accounts",
                            "id": "42",
                            "attributes": {
                                "name": "Mortgage",
                                "type": "liabilities",
                            },
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path.endswith("/accounts/42") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "accounts",
                        "id": "42",
                        "attributes": {
                            "name": "Mortgage",
                            "type": "liabilities",
                            "current_balance": "-50000.00",
                            "interest": "6.5",
                            "notes": "",
                        },
                    }
                },
            )
        if path.endswith("/transactions") and request.method == "GET":
            return httpx.Response(
                200,
                json={"data": [], "meta": {"pagination": {"total_pages": 1}}},
            )
        return httpx.Response(404)

    monkeypatch.setattr("app_clock.today", lambda: date(2026, 7, 15))

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )

    try:
        response = client.get("/api/payment-run/liabilities/42/history")
        assert response.status_code == 200
        body = response.json()
        assert body["account"]["loan_configured"] is False
        assert body["transactions"] == []
        assert body["totals"]["total_payment"] == "0.00"
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
        if request.url.path == "/api/v1/bills/empty-bill" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "bills",
                        "id": "empty-bill",
                        "attributes": {
                            "name": "New bill",
                            "amount_min": "10.00",
                            "amount_max": "10.00",
                            "repeat_freq": "monthly",
                        },
                    }
                },
            )
        if request.url.path == "/api/v1/rules/rule-empty" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-empty",
                        "attributes": {
                            "title": "New bill",
                            "trigger": "store-journal",
                            "active": True,
                            "strict": False,
                            "triggers": [],
                            "actions": [
                                {
                                    "type": "link_to_bill",
                                    "value": "New bill",
                                    "active": True,
                                }
                            ],
                        },
                        "relationships": {
                            "rule_group": {
                                "data": {"type": "rule_groups", "id": "1"},
                            }
                        },
                    }
                },
            )
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


def _spotify_transactions_payload(count: int = 12) -> dict:
    from tests.test_payment_worksheet_bill_suggestions import spotify_monthly_withdrawals

    rows = spotify_monthly_withdrawals(count)
    data = []
    for i, row in enumerate(rows):
        data.append(
            {
                "id": str(i + 1),
                "attributes": {
                    "description": row["description"],
                    "category_name": row["category_name"],
                    "transactions": [
                        {
                            "transaction_journal_id": str(1000 + i),
                            "type": row["type"],
                            "amount": f"-{row['amount']}",
                            "date": row["date"],
                            "description": row["description"],
                            "destination_name": row["destination_name"],
                            "category_name": row["category_name"],
                            "source_id": row["source_id"],
                            "destination_id": "expense-1",
                            "source_name": row["source_name"],
                        }
                    ],
                },
            }
        )
    return {"data": data, "meta": {"pagination": {"current_page": 1, "total_pages": 1}}}


def _bill_suggestions_accounts_payload() -> dict:
    return {
        "data": [
            {
                "id": "cc-paypal",
                "attributes": {
                    "name": "PayPal Credit",
                    "type": "asset",
                    "account_role": "creditCard",
                },
            },
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }


def _bill_suggestions_handler(*, transactions_status: int = 200):
    accounts = _bill_suggestions_accounts_payload()
    txns = _spotify_transactions_payload(12)
    empty_bills = {
        "data": [],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts" and request.method == "GET":
            return httpx.Response(200, json=accounts)
        if request.url.path == "/api/v1/transactions" and request.method == "GET":
            if transactions_status != 200:
                return httpx.Response(transactions_status, text="Firefly down")
            return httpx.Response(200, json=txns)
        if request.url.path == "/api/v1/bills" and request.method == "GET":
            return httpx.Response(200, json=empty_bills)
        return httpx.Response(404)

    return handler


def test_bill_suggestions_disabled_returns_404(monkeypatch, client):
    monkeypatch.delenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", raising=False)
    response = client.get("/api/payment-run/bill-suggestions")
    assert response.status_code == 404
    assert response.json()["detail"] == "Payment worksheet is not enabled."


def test_bill_suggestions_default_lookback(monkeypatch, client, data_dir, payment_worksheet_env):
    import firefly_reference_cache
    from main import app
    from routes.payment_run import get_firefly_client

    firefly_reference_cache.clear()
    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(_bill_suggestions_handler()),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.get("/api/payment-run/bill-suggestions")
        assert response.status_code == 200
        body = response.json()
        assert "data" in body
        assert isinstance(body["data"], list)
        meta = body["meta"]
        assert "withdrawals_analyzed" in meta
        assert "suggestions_count" in meta
        assert "period_start" in meta
        assert "period_end" in meta
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


@pytest.mark.parametrize("lookback", [6, 24])
def test_bill_suggestions_lookback_6_and_24(
    monkeypatch, client, data_dir, payment_worksheet_env, lookback
):
    import firefly_reference_cache
    from main import app
    from routes.payment_run import get_firefly_client

    firefly_reference_cache.clear()
    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(_bill_suggestions_handler()),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.get(
            "/api/payment-run/bill-suggestions",
            params={"lookback_months": lookback},
        )
        assert response.status_code == 200
        assert "meta" in response.json()
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_bill_suggestions_invalid_lookback_422(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import firefly_reference_cache
    from main import app
    from routes.payment_run import get_firefly_client

    firefly_reference_cache.clear()
    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(_bill_suggestions_handler()),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.get(
            "/api/payment-run/bill-suggestions",
            params={"lookback_months": 18},
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "lookback_months must be 6, 12, or 24."
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_bill_suggestions_firefly_error_502(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import firefly_reference_cache
    from main import app
    from routes.payment_run import get_firefly_client

    firefly_reference_cache.clear()
    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(_bill_suggestions_handler(transactions_status=500)),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.get("/api/payment-run/bill-suggestions")
        assert response.status_code == 502
        assert "Firefly API error 500" in response.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_bill_suggestions_no_sidecar_writes(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import firefly_reference_cache
    from main import app
    from routes.payment_run import get_firefly_client

    write_calls: list[str] = []

    def _wrap_async(name: str, original):
        async def wrapped(*args, **kwargs):
            write_calls.append(name)
            return await original(*args, **kwargs)

        return wrapped

    for fn_name in (
        "insert_worksheet_registry",
        "update_worksheet_registry",
        "delete_worksheet_registry",
        "upsert_funding_bucket",
        "delete_funding_bucket",
        "upsert_worksheet_state_row",
        "upsert_worksheet_refresh",
        "upsert_bucket_balance",
        "upsert_suggestion",
    ):
        monkeypatch.setattr(
            sidecar_db,
            fn_name,
            _wrap_async(fn_name, getattr(sidecar_db, fn_name)),
        )

    firefly_reference_cache.clear()
    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(_bill_suggestions_handler()),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = client.get("/api/payment-run/bill-suggestions")
        assert response.status_code == 200
        assert write_calls == []
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def _discover_settings_handler():
    categories_payload = {
        "data": [
            {"type": "categories", "id": "1", "attributes": {"name": "Gas"}},
            {"type": "categories", "id": "2", "attributes": {"name": "Rent"}},
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/categories" and request.method == "GET":
            return httpx.Response(200, json=categories_payload)
        return httpx.Response(404)

    return handler


def test_discover_settings_get_and_put(monkeypatch, client, data_dir, payment_worksheet_env):
    import firefly_reference_cache
    from main import app
    from routes.payment_run import get_firefly_client

    firefly_reference_cache.clear()
    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(_discover_settings_handler()),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        get_response = client.get("/api/payment-run/discover-settings")
        assert get_response.status_code == 200
        body = get_response.json()
        assert body["ignored_categories"]
        assert "Gas" in body["ignored_categories"]
        assert body["ignored_payees"] == []
        assert {row["name"] for row in body["available_categories"]} == {"Gas", "Rent"}
        assert body["suggested_ignored_categories"]

        put_response = client.put(
            "/api/payment-run/discover-settings",
            json={"ignored_categories": ["Gas", "gas", " Rent "], "ignored_payees": ["PayPal"]},
        )
        assert put_response.status_code == 200
        assert put_response.json()["ignored_categories"] == ["Gas", "Rent"]
        assert put_response.json()["ignored_payees"] == ["PayPal"]

        get_again = client.get("/api/payment-run/discover-settings")
        assert get_again.json()["ignored_categories"] == ["Gas", "Rent"]
        assert get_again.json()["ignored_payees"] == ["PayPal"]

        category_post = client.post(
            "/api/payment-run/discover-settings/ignore-category",
            json={"category": "Restaurants"},
        )
        assert category_post.status_code == 200
        assert "Restaurants" in category_post.json()["ignored_categories"]

        category_post_again = client.post(
            "/api/payment-run/discover-settings/ignore-category",
            json={"category": "restaurants"},
        )
        assert category_post_again.status_code == 200
        assert category_post_again.json()["ignored_categories"].count("Restaurants") == 1
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def _override_bill_suggestions_client(monkeypatch, handler):
    import firefly_reference_cache
    from main import app
    from routes.payment_run import get_firefly_client

    firefly_reference_cache.clear()
    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    return app, get_firefly_client


def test_suggestion_transactions_ok(monkeypatch, client, data_dir, payment_worksheet_env):
    app, get_firefly_client = _override_bill_suggestions_client(
        monkeypatch, _bill_suggestions_handler()
    )
    try:
        list_response = client.get("/api/payment-run/bill-suggestions")
        assert list_response.status_code == 200
        suggestion_id = list_response.json()["data"][0]["id"]
        response = client.get(
            f"/api/payment-run/bill-suggestions/{suggestion_id}/transactions"
        )
        assert response.status_code == 200
        body = response.json()
        assert isinstance(body["data"], list)
        assert len(body["data"]) == 12
        meta = body["meta"]
        assert meta["suggestion_id"] == suggestion_id
        assert meta["transaction_count"] == 12
        assert "period_start" in meta
        assert "period_end" in meta
        txn = body["data"][0]
        assert {"date", "amount", "description", "category", "payee", "budget"}.issubset(
            txn.keys()
        )
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_suggestion_transactions_lookback_invalid_422(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    app, get_firefly_client = _override_bill_suggestions_client(
        monkeypatch, _bill_suggestions_handler()
    )
    try:
        response = client.get(
            "/api/payment-run/bill-suggestions/sug-deadbeefcafebabe/transactions",
            params={"lookback_months": 18},
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "lookback_months must be 6, 12, or 24."
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_suggestion_transactions_not_found_404(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    app, get_firefly_client = _override_bill_suggestions_client(
        monkeypatch, _bill_suggestions_handler()
    )
    try:
        response = client.get(
            "/api/payment-run/bill-suggestions/sug-nonexistent0000/transactions"
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Suggestion not found."
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_suggestion_transactions_disabled_returns_404(monkeypatch, client):
    monkeypatch.delenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", raising=False)
    response = client.get(
        "/api/payment-run/bill-suggestions/sug-deadbeefcafebabe/transactions"
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Payment worksheet is not enabled."


def test_suggestion_transactions_firefly_error_502(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    app, get_firefly_client = _override_bill_suggestions_client(
        monkeypatch, _bill_suggestions_handler(transactions_status=500)
    )
    try:
        response = client.get(
            "/api/payment-run/bill-suggestions/sug-deadbeefcafebabe/transactions"
        )
        assert response.status_code == 502
        detail = response.json()["detail"]
        assert "Firefly API error 500" in detail
        assert "test-token" not in detail
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_bill_groups_crud(monkeypatch, client, data_dir):
    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")
    import asyncio

    async def _seed_registry() -> tuple[int, int, int]:
        await sidecar_db.init_db()
        electric_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "501",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "firefly",
                "payment_rail": "bank",
                "rule_id": "99",
                "row_label": "Electric",
                "show_in_group": True,
            }
        )
        water_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "502",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "firefly",
                "payment_rail": "bank",
                "rule_id": "100",
                "row_label": "Water",
                "show_in_group": False,
            }
        )
        credit_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "503",
                "worksheet_section": "credit",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "firefly",
                "payment_rail": "bank",
                "rule_id": "101",
                "row_label": "Card Payment",
            }
        )
        return electric_id, water_id, credit_id

    electric_id, water_id, credit_id = asyncio.run(_seed_registry())

    create = client.post(
        "/api/payment-run/bill-groups",
        json={"label": "Mobile Apps!", "sort_order": 0},
    )
    assert create.status_code == 200
    body = create.json()
    assert body["id"] == "mobile-apps"
    assert body["label"] == "Mobile Apps!"
    assert body["member_count"] == 0
    assert body["visible_count"] == 0
    assert body["members"] == []

    collision = client.post(
        "/api/payment-run/bill-groups",
        json={"label": "Mobile Apps!", "sort_order": 1},
    )
    assert collision.status_code == 200
    assert collision.json()["id"] == "mobile-apps-2"

    listed = client.get("/api/payment-run/bill-groups")
    assert listed.status_code == 200
    groups = listed.json()["data"]
    assert [group["id"] for group in groups] == ["mobile-apps", "mobile-apps-2"]
    assert all("member_count" in group for group in groups)
    assert all("visible_count" in group for group in groups)
    assert all("members" in group for group in groups)

    assigned = client.patch(
        "/api/payment-run/bill-groups/mobile-apps",
        json={"member_ids": [electric_id, water_id]},
    )
    assert assigned.status_code == 200
    assigned_body = assigned.json()
    assert assigned_body["member_count"] == 2
    assert assigned_body["visible_count"] == 1
    member_ids = {member["registry_id"] for member in assigned_body["members"]}
    assert member_ids == {electric_id, water_id}
    members_by_id = {
        member["registry_id"]: member for member in assigned_body["members"]
    }
    assert members_by_id[electric_id]["show_in_group"] is True
    assert members_by_id[water_id]["show_in_group"] is False

    replace_one = client.patch(
        "/api/payment-run/bill-groups/mobile-apps",
        json={"member_ids": [electric_id]},
    )
    assert replace_one.status_code == 200
    assert replace_one.json()["member_count"] == 1
    unlinked = asyncio.run(sidecar_db.get_worksheet_registry(water_id))
    assert unlinked is not None
    assert unlinked["bill_group_id"] is None
    assert unlinked["show_in_group"] is False

    clear_all = client.patch(
        "/api/payment-run/bill-groups/mobile-apps",
        json={"member_ids": []},
    )
    assert clear_all.status_code == 200
    assert clear_all.json()["member_count"] == 0
    cleared_electric = asyncio.run(sidecar_db.get_worksheet_registry(electric_id))
    assert cleared_electric is not None
    assert cleared_electric["bill_group_id"] is None
    assert cleared_electric["show_in_group"] is True

    reassigned = client.patch(
        "/api/payment-run/bill-groups/mobile-apps",
        json={"member_ids": [electric_id, water_id]},
    )
    assert reassigned.status_code == 200

    deleted = client.delete("/api/payment-run/bill-groups/mobile-apps")
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}

    after_delete_electric = asyncio.run(sidecar_db.get_worksheet_registry(electric_id))
    after_delete_water = asyncio.run(sidecar_db.get_worksheet_registry(water_id))
    assert after_delete_electric is not None
    assert after_delete_water is not None
    assert after_delete_electric["bill_group_id"] is None
    assert after_delete_water["bill_group_id"] is None

    remaining = client.get("/api/payment-run/bill-groups")
    assert len(remaining.json()["data"]) == 1
    assert remaining.json()["data"][0]["id"] == "mobile-apps-2"

    invalid_section = client.patch(
        "/api/payment-run/bill-groups/mobile-apps-2",
        json={"member_ids": [credit_id]},
    )
    assert invalid_section.status_code == 422

    renamed = client.patch(
        "/api/payment-run/bill-groups/mobile-apps-2",
        json={"label": "Subscriptions", "sort_order": 5},
    )
    assert renamed.status_code == 200
    assert renamed.json()["label"] == "Subscriptions"
    assert renamed.json()["sort_order"] == 5
    assert renamed.json()["id"] == "mobile-apps-2"


def test_bill_group_patch_member_ids_null_422(monkeypatch, client, data_dir):
    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")

    create = client.post(
        "/api/payment-run/bill-groups",
        json={"label": "Null Members", "sort_order": 0},
    )
    assert create.status_code == 200
    group_id = create.json()["id"]

    response = client.patch(
        f"/api/payment-run/bill-groups/{group_id}",
        json={"member_ids": None},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "member_ids must be an array when provided."


def test_registry_group_empty_bill_group_id_normalized(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-grp-empty",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-grp-empty",
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
        json={"bill_group_id": ""},
    )
    assert response.status_code == 200
    assert response.json()["bill_group_id"] is None

    row = asyncio.run(sidecar_db.get_worksheet_registry(reg_id))
    assert row is not None
    assert row["bill_group_id"] is None


def test_registry_group_show_in_group_requires_group(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-grp-show",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-grp-show",
                "row_label": "Electric",
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
        json={"show_in_group": True},
    )
    assert response.status_code == 422


def test_registry_group_unknown_group_422(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-grp-unknown",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-grp-unknown",
                "row_label": "Water",
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
        json={"bill_group_id": "missing-group"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Group not found"


def test_registry_group_section_guard_422(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    async def _seed() -> int:
        await sidecar_db.init_db()
        await sidecar_db.upsert_bill_group(
            id="utilities",
            label="Utilities",
            sort_order=0,
        )
        return await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-grp-credit",
                "worksheet_section": "credit",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-grp-credit",
                "row_label": "Card Payment",
            }
        )

    reg_id = asyncio.run(_seed())
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
        json={"bill_group_id": "utilities"},
    )
    assert response.status_code == 422


async def _seed_cross_section_group_fixture() -> tuple[int, int]:
    """Bills + liabilities registry rows; liabilities row assigned to liabilities-group."""
    await sidecar_db.init_db()
    await sidecar_db.upsert_bill_group(
        id="bills-group",
        label="Bills Group",
        sort_order=0,
    )
    await sidecar_db.upsert_bill_group(
        id="liabilities-group",
        label="Liabilities Group",
        sort_order=1,
    )
    bills_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "cross-bills",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-cross-bills",
            "row_label": "Electric",
        }
    )
    liabilities_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "cross-liab",
            "worksheet_section": "liabilities",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-cross-liab",
            "row_label": "Car loan",
        }
    )
    await sidecar_db.patch_bill_group(
        "liabilities-group",
        label="Liabilities Group",
        sort_order=1,
        member_ids=[liabilities_id],
    )
    return bills_id, liabilities_id


def test_registry_assign_cross_section_group_422(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    bills_id, _ = asyncio.run(_seed_cross_section_group_fixture())
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
        )
    )

    response = client.put(
        f"/api/payment-run/bills/{bills_id}",
        json={"bill_group_id": "liabilities-group"},
    )
    assert response.status_code == 422
    assert "worksheet section" in response.json()["detail"].casefold()


def test_register_cross_section_group_422(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    asyncio.run(_seed_cross_section_group_fixture())
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
        )
    )

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
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "bills",
                        "id": "bill-cross-reg",
                        "attributes": {"name": "Water"},
                    }
                },
            )
        if path == "/api/v1/rules" and request.method == "POST":
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-cross-reg",
                        "attributes": {"title": "Water"},
                    }
                },
            )
        if path.startswith("/api/v1/rules/") and path.endswith("/trigger"):
            return httpx.Response(204)
        return httpx.Response(404)

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    monkeypatch.setenv(
        "FF3LANTERN_PAYMENT_WORKSHEET_RULE_GROUP", "Payment worksheet"
    )

    try:
        response = client.post(
            "/api/payment-run/bills/register",
            json={
                "mode": "create_new",
                "name": "Water",
                "amount": "50.00",
                "amount_mode": "recurring",
                "repeat_freq": "monthly",
                "worksheet_section": "bills",
                "payment_rail": "bank",
                "funding_bucket_key": "checking",
                "description_contains": "WATER CO",
                "bill_group_id": "liabilities-group",
            },
        )
        assert response.status_code == 422
        assert "worksheet section" in response.json()["detail"].casefold()
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_patch_member_ids_cross_section_422(monkeypatch, client, data_dir):
    import asyncio

    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")
    bills_id, liabilities_id = asyncio.run(_seed_cross_section_group_fixture())

    response = client.patch(
        "/api/payment-run/bill-groups/bills-group",
        json={"member_ids": [bills_id, liabilities_id]},
    )
    assert response.status_code == 422
    assert "worksheet section" in response.json()["detail"].casefold()


def test_patch_member_ids_cross_section_existing_group_422(
    monkeypatch, client, data_dir
):
    import asyncio

    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")
    bills_id, liabilities_id = asyncio.run(_seed_cross_section_group_fixture())

    assigned = client.patch(
        "/api/payment-run/bill-groups/bills-group",
        json={"member_ids": [bills_id]},
    )
    assert assigned.status_code == 200

    mixed = client.patch(
        "/api/payment-run/bill-groups/bills-group",
        json={"member_ids": [bills_id, liabilities_id]},
    )
    assert mixed.status_code == 422
    assert "worksheet section" in mixed.json()["detail"].casefold()


def test_registry_group_register_with_group(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    from main import app
    from routes.payment_run import get_firefly_client

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        preflight = _preflight_list_response(request)
        if preflight is not None:
            return preflight
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
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "bills",
                        "id": "bill-reg-grp",
                        "attributes": {"name": "Electric"},
                    }
                },
            )
        if path == "/api/v1/rules" and request.method == "POST":
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-reg-grp",
                        "attributes": {"title": "Electric"},
                    }
                },
            )
        if path.startswith("/api/v1/rules/") and path.endswith("/trigger"):
            return httpx.Response(204)
        return httpx.Response(404)

    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
        )
    )
    asyncio.run(
        sidecar_db.upsert_bill_group(
            id="utilities",
            label="Utilities",
            sort_order=0,
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
                "bill_group_id": "utilities",
                "show_in_group": True,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["bill_group_id"] == "utilities"
        assert body["show_in_group"] is True
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_registry_group_put_toggles_show_in_group(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    async def _seed() -> int:
        await sidecar_db.upsert_bill_group(
            id="subscriptions",
            label="Subscriptions",
            sort_order=0,
        )
        return await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-toggle",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-toggle",
                "row_label": "Netflix",
                "bill_group_id": "subscriptions",
                "show_in_group": False,
            }
        )

    reg_id = asyncio.run(_seed())
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
        json={"show_in_group": True},
    )
    assert response.status_code == 200
    assert response.json()["show_in_group"] is True

    toggled_off = client.put(
        f"/api/payment-run/bills/{reg_id}",
        json={"show_in_group": False},
    )
    assert toggled_off.status_code == 200
    assert toggled_off.json()["show_in_group"] is False


def test_registry_group_liabilities_section_assignment(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    async def _seed() -> int:
        await sidecar_db.upsert_bill_group(
            id="loans",
            label="Loans",
            sort_order=0,
        )
        return await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-liab",
                "worksheet_section": "liabilities",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-liab",
                "row_label": "Car loan",
            }
        )

    reg_id = asyncio.run(_seed())
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
        json={"bill_group_id": "loans", "show_in_group": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["bill_group_id"] == "loans"
    assert body["show_in_group"] is True
    assert body["worksheet_section"] == "liabilities"


def test_registry_group_at_most_one_group_via_put(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    async def _seed() -> int:
        await sidecar_db.upsert_bill_group(
            id="group-a",
            label="Group A",
            sort_order=0,
        )
        await sidecar_db.upsert_bill_group(
            id="group-b",
            label="Group B",
            sort_order=1,
        )
        return await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-move",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-move",
                "row_label": "Internet",
                "bill_group_id": "group-a",
                "show_in_group": True,
            }
        )

    reg_id = asyncio.run(_seed())
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
        )
    )

    moved = client.put(
        f"/api/payment-run/bills/{reg_id}",
        json={"bill_group_id": "group-b"},
    )
    assert moved.status_code == 200
    body = moved.json()
    assert body["bill_group_id"] == "group-b"
    assert body["show_in_group"] is True

    row = asyncio.run(sidecar_db.get_worksheet_registry(reg_id))
    assert row is not None
    assert row["bill_group_id"] == "group-b"


def test_registry_put_after_group_delete_allows_unrelated_update(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    async def _seed() -> int:
        await sidecar_db.init_db()
        await sidecar_db.upsert_bill_group(
            id="utilities",
            label="Utilities",
            sort_order=0,
        )
        reg_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-dormant-show",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-dormant-show",
                "row_label": "Electric",
                "bill_group_id": "utilities",
                "show_in_group": True,
            }
        )
        await sidecar_db.replace_bill_group_members("utilities", [reg_id])
        await sidecar_db.delete_bill_group("utilities")
        return reg_id

    reg_id = asyncio.run(_seed())
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
        )
    )

    row = asyncio.run(sidecar_db.get_worksheet_registry(reg_id))
    assert row is not None
    assert row["bill_group_id"] is None
    assert row["show_in_group"] is True

    response = client.put(
        f"/api/payment-run/bills/{reg_id}",
        json={"row_label": "Electric (updated)"},
    )
    assert response.status_code == 200
    assert response.json()["row_label"] == "Electric (updated)"


def test_registry_put_unlink_requires_clearing_show_in_group(
    monkeypatch, client, data_dir, payment_worksheet_env
):
    import asyncio

    async def _seed() -> int:
        await sidecar_db.init_db()
        await sidecar_db.upsert_bill_group(
            id="utilities",
            label="Utilities",
            sort_order=0,
        )
        return await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "bill-unlink-put",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "fixed",
                "payment_rail": "bank",
                "rule_id": "rule-unlink-put",
                "row_label": "Water",
                "bill_group_id": "utilities",
                "show_in_group": True,
            }
        )

    reg_id = asyncio.run(_seed())
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
        )
    )

    blocked = client.put(
        f"/api/payment-run/bills/{reg_id}",
        json={"bill_group_id": None},
    )
    assert blocked.status_code == 422
    assert "show_in_group" in blocked.json()["detail"]

    allowed = client.put(
        f"/api/payment-run/bills/{reg_id}",
        json={"bill_group_id": None, "show_in_group": False},
    )
    assert allowed.status_code == 200
    body = allowed.json()
    assert body["bill_group_id"] is None
    assert body["show_in_group"] is False


def test_bill_groups_disabled_returns_404(monkeypatch, client):
    monkeypatch.delenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", raising=False)

    get_resp = client.get("/api/payment-run/bill-groups")
    assert get_resp.status_code == 404
    assert get_resp.json()["detail"] == "Payment worksheet is not enabled."

    post_resp = client.post(
        "/api/payment-run/bill-groups",
        json={"label": "Test"},
    )
    assert post_resp.status_code == 404
    assert post_resp.json()["detail"] == "Payment worksheet is not enabled."

    patch_resp = client.patch(
        "/api/payment-run/bill-groups/test",
        json={"label": "Test"},
    )
    assert patch_resp.status_code == 404
    assert patch_resp.json()["detail"] == "Payment worksheet is not enabled."

    delete_resp = client.delete("/api/payment-run/bill-groups/test")
    assert delete_resp.status_code == 404
    assert delete_resp.json()["detail"] == "Payment worksheet is not enabled."

