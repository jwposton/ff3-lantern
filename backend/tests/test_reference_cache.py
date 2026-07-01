"""Tests for Firefly reference data cache and clear endpoint."""

import asyncio
import time

import httpx

import firefly_reference_cache
from firefly_client import FireflyClient
from tests.conftest import load_fixture


def test_ttl_defaults_to_two_hours(monkeypatch):
    monkeypatch.delenv("FIREFLY_REFERENCE_CACHE_TTL_SECONDS", raising=False)
    assert firefly_reference_cache.ttl_seconds() == 7200


def test_ttl_env_override(monkeypatch):
    monkeypatch.setenv("FIREFLY_REFERENCE_CACHE_TTL_SECONDS", "60")
    assert firefly_reference_cache.ttl_seconds() == 60


def test_cache_expires_after_ttl(monkeypatch):
    monkeypatch.setenv("FIREFLY_REFERENCE_CACHE_TTL_SECONDS", "1")
    firefly_reference_cache.set("accounts", {"1": {"name": "Checking"}})
    assert firefly_reference_cache.get("accounts") is not None
    time.sleep(1.05)
    assert firefly_reference_cache.get("accounts") is None


def test_clear_removes_all_entries():
    firefly_reference_cache.set("accounts", {})
    firefly_reference_cache.set("categories", [])
    firefly_reference_cache.clear()
    assert firefly_reference_cache.get("accounts") is None
    assert firefly_reference_cache.get("categories") is None


def test_accounts_cached_across_clients():
    request_count = 0
    accounts_payload = load_fixture("accounts.json")

    def counting_handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        if request.url.path.endswith("/accounts"):
            request_count += 1
            return httpx.Response(200, json=accounts_payload)
        return httpx.Response(
            200,
            json={"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}},
        )

    transport = httpx.MockTransport(counting_handler)
    client_a = FireflyClient(
        transport=transport,
        base_url="https://firefly.example",
        api_token="tok",
    )
    client_b = FireflyClient(
        transport=transport,
        base_url="https://firefly.example",
        api_token="tok",
    )
    asyncio.run(client_a.fetch_accounts())
    asyncio.run(client_b.fetch_accounts())
    assert request_count == 1


def test_categories_and_budgets_cached():
    request_count = {"categories": 0, "budgets": 0}

    def counting_handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/categories"):
            request_count["categories"] += 1
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "1", "attributes": {"name": "Food"}}],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path.endswith("/budgets"):
            request_count["budgets"] += 1
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "2", "attributes": {"name": "Groceries"}}],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(counting_handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    asyncio.run(client.fetch_categories())
    asyncio.run(client.fetch_categories())
    asyncio.run(client.fetch_budgets())
    asyncio.run(client.fetch_budgets())
    assert request_count == {"categories": 1, "budgets": 1}


def test_clear_endpoint_invalidates_reference_cache(client, firefly_env, monkeypatch):
    request_count = 0
    accounts_payload = load_fixture("accounts.json")

    def counting_handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        if request.url.path.endswith("/accounts"):
            request_count += 1
            return httpx.Response(200, json=accounts_payload)
        if request.url.path.endswith("/transactions"):
            return httpx.Response(
                200,
                json={"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}},
            )
        return httpx.Response(404)

    import api_normalized_transactions as api_mod
    from main import app

    app.dependency_overrides[api_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(counting_handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        params = {"start": "2024-01-01", "end": "2024-01-31"}
        assert client.get("/api/normalized_transactions", params=params).status_code == 200
        assert client.get("/api/normalized_transactions", params=params).status_code == 200
        assert request_count == 1

        assert client.post("/api/cache/clear").json() == {"ok": True}

        assert client.get("/api/normalized_transactions", params=params).status_code == 200
        assert request_count == 2
    finally:
        app.dependency_overrides.clear()
