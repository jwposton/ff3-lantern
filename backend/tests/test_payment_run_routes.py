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
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(data_dir):
    from main import app

    return TestClient(app)


def test_disabled_returns_404(monkeypatch, client):
    monkeypatch.delenv("FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED", raising=False)
    response = client.get("/api/payment-run")
    assert response.status_code == 404
    assert response.json()["detail"] == "Payment worksheet is not enabled."


@pytest.fixture
def payment_worksheet_env(monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED", "true")
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
    monkeypatch.setenv("FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED", "true")
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
