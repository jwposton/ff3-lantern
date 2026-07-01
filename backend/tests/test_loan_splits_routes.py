"""Tests for GET /api/loan-splits/pending (LOAN-02, LOAN-03, LOAN-07)."""

from __future__ import annotations

import copy
import json

import httpx
import pytest

from loan_profiles import serialize_loan_profile_to_notes

PROFILE = {
    "version": 1,
    "enabled": True,
    "match": {
        "description_contains": "Loan Provider",
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
                "destination_account": "Mortgage",
            },
            {
                "role": "interest",
                "type": "withdrawal",
                "destination_account_id": "88",
                "destination_account": "Interest",
            },
        ],
    },
}


def _handler_factory(monkeypatch):
    notes = serialize_loan_profile_to_notes(PROFILE, "")
    accounts = {
        "data": [
            {
                "type": "accounts",
                "id": "42",
                "attributes": {
                    "name": "Mortgage",
                    "type": "liabilities",
                    "notes": notes,
                    "current_balance": "-50000.00",
                    "interest": "6.5",
                },
            },
            {
                "type": "accounts",
                "id": "88",
                "attributes": {"name": "Interest", "type": "expense"},
            },
            {
                "type": "accounts",
                "id": "7",
                "attributes": {"name": "Checking", "type": "asset"},
            },
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }
    txns = {
        "data": [
            {
                "id": "100",
                "attributes": {
                    "description": "Loan Provider July",
                    "transactions": [
                        {
                            "transaction_journal_id": "1001",
                            "type": "transfer",
                            "amount": "-427.18",
                            "date": "2026-07-10",
                            "description": "Loan Provider July",
                            "source_id": "7",
                            "destination_id": "42",
                            "source_name": "Checking",
                            "destination_name": "Mortgage",
                        }
                    ],
                },
            },
            {
                "id": "101",
                "attributes": {
                    "description": "Loan Provider June",
                    "transactions": [
                        {
                            "transaction_journal_id": "1002",
                            "type": "transfer",
                            "amount": "-427.18",
                            "date": "2026-06-01",
                            "description": "Loan Provider June",
                            "source_id": "7",
                            "destination_id": "42",
                            "source_name": "Checking",
                            "destination_name": "Mortgage",
                        }
                    ],
                },
            },
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts" and request.method == "GET":
            return httpx.Response(200, json=accounts)
        if request.url.path.startswith("/api/v1/accounts/") and request.method == "GET":
            aid = request.url.path.rsplit("/", 1)[-1]
            for entry in accounts["data"]:
                if entry["id"] == aid:
                    return httpx.Response(200, json={"data": entry})
        if request.url.path == "/api/v1/transactions":
            return httpx.Response(200, json=txns)
        return httpx.Response(404)

    monkeypatch.setenv("FF3ANALYTICS_LOAN_SPLITS_SINCE", "2026-07-01")
    from firefly_client import FireflyClient
    from main import app
    from routes import loans as loans_mod

    app.dependency_overrides[loans_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    return app


@pytest.mark.parametrize("kw", ["pending"])
def test_pending_excludes_before_since_date(client, firefly_env, monkeypatch, kw):
    app = _handler_factory(monkeypatch)
    try:
        response = client.get(
            "/api/loan-splits/pending",
            params={"start": "2026-06-01", "end": "2026-07-31"},
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body["data"]) == 1
        assert body["data"][0]["date"] == "2026-07-10"
        assert body["meta"]["forward_only_since"] == "2026-07-01"
        preview = body["data"][0]["preview"]
        assert preview["principal"] == "156.35"
        assert preview["interest"] == "270.83"
    finally:
        app.dependency_overrides.clear()


def test_preview_no_put(client, firefly_env, monkeypatch):
    app = _handler_factory(monkeypatch)
    put_count = 0

    from firefly_client import FireflyClient
    from routes import loans as loans_mod

    original = app.dependency_overrides.get(loans_mod.get_firefly_client)
    client_inst = original()

    class _CountingClient(FireflyClient):
        async def update_transaction(self, *args, **kwargs):
            nonlocal put_count
            put_count += 1
            return await super().update_transaction(*args, **kwargs)

    counting = _CountingClient(
        transport=client_inst._transport,
        base_url=client_inst.base_url,
        api_token=client_inst.api_token,
    )
    app.dependency_overrides[loans_mod.get_firefly_client] = lambda: counting
    try:
        response = client.post(
            "/api/loan-splits/100/preview",
            params={"start": "2026-06-01", "end": "2026-07-31"},
            json={"principal": "156.35"},
        )
        assert response.status_code == 200
        assert put_count == 0
    finally:
        app.dependency_overrides.clear()


def test_apply_triggers_single_put(client, firefly_env, monkeypatch):
    app = _handler_factory(monkeypatch)
    put_count = 0

    from firefly_client import FireflyClient
    from routes import loans as loans_mod

    original = app.dependency_overrides.get(loans_mod.get_firefly_client)
    client_inst = original()

    class _CountingClient(FireflyClient):
        async def update_transaction(self, *args, **kwargs):
            nonlocal put_count
            put_count += 1
            return {"id": "100", "attributes": {}}

    counting = _CountingClient(
        transport=client_inst._transport,
        base_url=client_inst.base_url,
        api_token=client_inst.api_token,
    )
    app.dependency_overrides[loans_mod.get_firefly_client] = lambda: counting
    try:
        response = client.post(
            "/api/loan-splits/100/apply",
            json={
                "transaction_journal_id": "1001",
                "principal": "156.35",
                "interest": "270.83",
                "escrow": "0.00",
                "start": "2026-06-01",
                "end": "2026-07-31",
            },
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert put_count == 1
    finally:
        app.dependency_overrides.clear()
