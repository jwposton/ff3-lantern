"""Tests for GET /api/categorize/pending and /api/categorize/meta."""

from __future__ import annotations

import httpx


def test_pending_missing_dates_422(client, firefly_env):
    assert client.get("/api/categorize/pending").status_code == 422


def test_pending_invalid_date_422(client, firefly_env):
    response = client.get(
        "/api/categorize/pending",
        params={"start": "bad", "end": "2024-01-31"},
    )
    assert response.status_code == 422
    assert "YYYY-MM-DD" in response.json()["detail"]


def test_pending_start_after_end_422(client, firefly_env):
    response = client.get(
        "/api/categorize/pending",
        params={"start": "2024-02-01", "end": "2024-01-01"},
    )
    assert response.status_code == 422


def test_pending_success(client, firefly_env, monkeypatch):
    from firefly_client import FireflyClient
    from main import app
    from routes import categorize as cat_mod

    async def _pending(*_args, **_kwargs):
        return [
            {
                "journal_id": "1",
                "transaction_journal_id": "10",
                "date": "2024-06-01",
                "amount": "-5.00",
                "description": "TEST",
                "type": "withdrawal",
                "source_name": "Checking",
                "destination_name": "Store",
                "budget_name": None,
            }
        ]

    class _StubClient:
        base_url = "https://firefly.example"

        fetch_splits = _pending

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: _StubClient()
    try:
        response = client.get(
            "/api/categorize/pending",
            params={"start": "2024-06-01", "end": "2024-06-30", "limit": 10},
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body["data"]) == 1
        assert body["meta"]["count"] == 1
        assert body["meta"]["limit"] == 10
    finally:
        app.dependency_overrides.clear()


def test_meta_openrouter_flag(client, firefly_env, monkeypatch):
    from main import app
    from routes import categorize as cat_mod

    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    class _StubClient:
        async def fetch_categories(self):
            return [{"id": "1", "name": "Groceries"}]

        async def fetch_budgets(self):
            return [{"id": "2", "name": "Food"}]

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: _StubClient()
    try:
        response = client.get("/api/categorize/meta")
        assert response.status_code == 200
        body = response.json()
        assert body["openrouter_configured"] is False
        assert body["categories"] == [{"id": "1", "name": "Groceries"}]
        assert body["budgets"] == [{"id": "2", "name": "Food"}]
        assert body["default_model"] == "openai/gpt-4o-mini"
    finally:
        app.dependency_overrides.clear()


def test_meta_openrouter_configured(client, firefly_env, monkeypatch):
    from main import app
    from routes import categorize as cat_mod

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    monkeypatch.setenv("OPENROUTER_MODEL", "anthropic/claude-3-haiku")

    class _StubClient:
        async def fetch_categories(self):
            return []

        async def fetch_budgets(self):
            return []

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: _StubClient()
    try:
        response = client.get("/api/categorize/meta")
        body = response.json()
        assert body["openrouter_configured"] is True
        assert body["default_model"] == "anthropic/claude-3-haiku"
    finally:
        app.dependency_overrides.clear()
