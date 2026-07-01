"""Tests for GET/PUT /api/loans (LOAN-01)."""

from __future__ import annotations

import copy
import json

import httpx

from loan_profiles import LOAN_PROFILE_MARKER, serialize_loan_profile_to_notes
from tests.test_firefly_write import SAMPLE_PROFILE

FULL_PROFILE = {
    **SAMPLE_PROFILE,
    "split": {
        "escrow_amount": "0.00",
        "components": [
            {
                "role": "principal",
                "type": "transfer",
                "destination_account_id": "42",
                "destination_account": "Mortgage Liability",
            },
            {
                "role": "interest",
                "type": "transfer",
                "destination_account_id": "88",
                "destination_account": "Mortgage Interest",
            },
        ],
    },
}


def _accounts_payload():
    return {
        "data": [
            {
                "type": "accounts",
                "id": "7",
                "attributes": {
                    "name": "Main Checking",
                    "type": "asset",
                    "account_role": "defaultAsset",
                },
            },
            {
                "type": "accounts",
                "id": "42",
                "attributes": {
                    "name": "Mortgage Liability",
                    "type": "liabilities",
                    "account_role": None,
                    "current_balance": "-50000.00",
                    "interest": "6.5",
                    "notes": "",
                },
            },
            {
                "type": "accounts",
                "id": "88",
                "attributes": {
                    "name": "Mortgage Interest",
                    "type": "expense",
                    "account_role": None,
                },
            },
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }


def test_get_loans_list(client, firefly_env):
    from main import app
    from routes import loans as loans_mod

    accounts = _accounts_payload()
    account_get = {
        "data": {
            "type": "accounts",
            "id": "42",
            "attributes": accounts["data"][1]["attributes"],
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts" and request.method == "GET":
            return httpx.Response(200, json=accounts)
        if request.url.path == "/api/v1/accounts/42" and request.method == "GET":
            return httpx.Response(200, json=account_get)
        return httpx.Response(404)

    from firefly_client import FireflyClient

    app.dependency_overrides[loans_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    try:
        response = client.get("/api/loans")
        assert response.status_code == 200
        body = response.json()
        assert len(body["data"]) == 1
        assert body["data"][0]["account_id"] == "42"
        assert body["data"][0]["configured"] is False
    finally:
        app.dependency_overrides.clear()


def test_put_loan_profile_roundtrip(client, firefly_env):
    from main import app
    from routes import loans as loans_mod

    accounts = _accounts_payload()
    put_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts" and request.method == "GET":
            return httpx.Response(200, json=accounts)
        if request.url.path == "/api/v1/accounts/42" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "accounts",
                        "id": "42",
                        "attributes": accounts["data"][1]["attributes"],
                    }
                },
            )
        if request.url.path == "/api/v1/accounts/42" and request.method == "PUT":
            put_bodies.append(json.loads(request.content))
            updated = copy.deepcopy(accounts["data"][1]["attributes"])
            updated["notes"] = put_bodies[-1]["notes"]
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "accounts",
                        "id": "42",
                        "attributes": updated,
                    }
                },
            )
        return httpx.Response(404)

    from firefly_client import FireflyClient

    app.dependency_overrides[loans_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    try:
        response = client.put("/api/loans/42", json=FULL_PROFILE)
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert len(put_bodies) == 1
        assert LOAN_PROFILE_MARKER in put_bodies[0]["notes"]
    finally:
        app.dependency_overrides.clear()


def test_put_loan_validation_failure_422(client, firefly_env):
    from main import app
    from routes import loans as loans_mod

    accounts = _accounts_payload()
    bad_profile = copy.deepcopy(FULL_PROFILE)
    bad_profile["split"]["components"][0]["destination_account_id"] = "88"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts" and request.method == "GET":
            return httpx.Response(200, json=accounts)
        if request.url.path == "/api/v1/accounts/42":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "accounts",
                        "id": "42",
                        "attributes": accounts["data"][1]["attributes"],
                    }
                },
            )
        return httpx.Response(404)

    from firefly_client import FireflyClient

    app.dependency_overrides[loans_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    try:
        response = client.put("/api/loans/42", json=bad_profile)
        assert response.status_code == 422
        assert "principal" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()
