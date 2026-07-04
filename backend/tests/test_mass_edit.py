"""Tests for mass edit apply and transactions routes."""

from __future__ import annotations

import json

import httpx
import pytest

from conftest import load_fixture
from mass_edit_apply import build_mass_edit_mutate_fn


def test_mass_edit_mutate_fn_sets_category_and_budget():
    attrs = load_fixture("transactions_put_roundtrip.json")["data"]["attributes"]
    mutate = build_mass_edit_mutate_fn("5001", category_id="99", budget_id="5")
    updated = mutate(attrs)
    split = updated["transactions"][0]
    assert split["category_id"] == "99"
    assert split["budget_id"] == "5"
    assert updated["transactions"][1]["category_id"] == "10"


def test_mass_edit_mutate_fn_clear_budget():
    attrs = load_fixture("transactions_put_roundtrip.json")["data"]["attributes"]
    mutate = build_mass_edit_mutate_fn("5001", clear_budget=True)
    updated = mutate(attrs)
    assert updated["transactions"][0]["budget_id"] is None


def test_mass_edit_mutate_fn_requires_change():
    with pytest.raises(ValueError, match="at least one"):
        build_mass_edit_mutate_fn("5001")


def test_transactions_meta(client, firefly_env, monkeypatch):
    import routes.transactions as tx_mod
    from main import app

    class _MetaClient:
        async def fetch_categories(self):
            return [{"id": "1", "name": "Food"}]

        async def fetch_budgets(self):
            return [{"id": "2", "name": "Essentials"}]

    app.dependency_overrides[tx_mod.get_firefly_client] = lambda: _MetaClient()
    try:
        response = client.get("/api/transactions/meta")
        assert response.status_code == 200
        body = response.json()
        assert body["categories"][0]["name"] == "Food"
        assert body["budgets"][0]["name"] == "Essentials"
    finally:
        app.dependency_overrides.clear()


def test_mass_edit_route_applies(client, firefly_env, monkeypatch, tmp_path):
    import routes.transactions as tx_mod
    from main import app

    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    get_payload = load_fixture("transactions_put_roundtrip.json")
    put_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal put_count
        if request.url.path == "/api/v1/categories":
            return httpx.Response(200, json={"data": [{"id": "99", "attributes": {"name": "Food"}}]})
        if request.url.path == "/api/v1/budgets":
            return httpx.Response(200, json={"data": [{"id": "5", "attributes": {"name": "Essentials"}}]})
        if request.url.path == "/api/v1/transactions/500" and request.method == "GET":
            return httpx.Response(200, json=get_payload)
        if request.url.path == "/api/v1/transactions/500" and request.method == "PUT":
            put_count += 1
            return httpx.Response(200, json=get_payload)
        return httpx.Response(404)

    from firefly_client import FireflyClient

    app.dependency_overrides[tx_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(handler)
    )
    try:
        response = client.post(
            "/api/transactions/mass-edit",
            json={
                "targets": [
                    {"journal_id": "500", "transaction_journal_id": "5001"},
                ],
                "category_id": "99",
                "budget_id": "5",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["applied"] == 1
        assert body["failed"] == 0
        assert put_count == 1
    finally:
        app.dependency_overrides.clear()


def test_mass_edit_route_422_without_changes(client, firefly_env):
    response = client.post(
        "/api/transactions/mass-edit",
        json={
            "targets": [
                {"journal_id": "500", "transaction_journal_id": "5001"},
            ],
        },
    )
    assert response.status_code == 422
