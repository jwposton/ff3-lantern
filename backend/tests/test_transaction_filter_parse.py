"""Tests for AI filter parse."""

from __future__ import annotations

import json

import httpx
import pytest

from transaction_filter_models import ExplorerFilterDraft
from transaction_filter_parse import draft_to_filter_state, filter_parse_model


def test_draft_to_filter_state():
    draft = ExplorerFilterDraft(
        categories=["Food"],
        description_contains="AMZN",
        uncategorized_only=True,
        rationale="Amazon uncategorized",
    )
    state = draft_to_filter_state(draft)
    assert state["categories"] == ["Food"]
    assert state["description_contains"] == "AMZN"
    assert state["uncategorized_only"] is True
    assert state["destination_account"] == ""


def test_filter_parse_model_falls_back_to_openrouter_model(monkeypatch):
    monkeypatch.delenv("OPENROUTER_FILTER_MODEL", raising=False)
    monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    assert filter_parse_model() == "openai/gpt-4o-mini"


def test_filter_parse_model_override(monkeypatch):
    monkeypatch.setenv("OPENROUTER_FILTER_MODEL", "google/gemini-2.0-flash-001:free")
    assert filter_parse_model() == "google/gemini-2.0-flash-001:free"


@pytest.mark.asyncio
async def test_build_filter_parse_context_uses_account_dict_values():
    from transaction_filter_parse import build_filter_parse_context

    class _Client:
        async def fetch_categories(self):
            return [{"id": "1", "name": "Food"}]

        async def fetch_budgets(self):
            return [{"id": "2", "name": "Essentials"}]

        async def fetch_accounts(self):
            return {
                "10": {"name": "Main Checking", "type": "Asset account"},
                "11": {"name": "Grocery Store", "type": "Expense account"},
            }

    context = await build_filter_parse_context(_Client())
    assert context["source_accounts"] == ["Main Checking"]
    assert context["categories"] == ["Food"]


@pytest.mark.asyncio
async def test_parse_filter_route(client, firefly_env, monkeypatch):
    import routes.transactions as tx_mod
    from main import app

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")

    class _Client:
        async def fetch_categories(self):
            return [{"id": "1", "name": "Food"}]

        async def fetch_budgets(self):
            return [{"id": "2", "name": "Essentials"}]

        async def fetch_accounts(self):
            return [{"name": "Main Checking", "type": "Asset account"}]

    captured: dict = {}

    async def fake_parse(client, http, **kwargs):
        captured.update(kwargs)
        return {
            "filter": draft_to_filter_state(
                ExplorerFilterDraft(
                    description_contains="AMZN",
                    rationale="Amazon purchases",
                )
            ),
            "rationale": "Amazon purchases",
        }

    monkeypatch.setattr(tx_mod, "parse_filter_query", fake_parse)
    app.dependency_overrides[tx_mod.get_firefly_client] = lambda: _Client()
    try:
        response = client.post(
            "/api/transactions/parse-filter",
            json={
                "query": "Amazon purchases",
                "start": "2024-01-01",
                "end": "2024-01-31",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["data"]["filter"]["description_contains"] == "AMZN"
        assert body["data"]["rationale"] == "Amazon purchases"
        assert captured["query"] == "Amazon purchases"
    finally:
        app.dependency_overrides.clear()


def test_parse_filter_route_503_without_key(client, firefly_env, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    response = client.post(
        "/api/transactions/parse-filter",
        json={
            "query": "Amazon",
            "start": "2024-01-01",
            "end": "2024-01-31",
        },
    )
    assert response.status_code == 503
