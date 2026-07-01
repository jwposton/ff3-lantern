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


def test_pending_grouped_by_fingerprint(client, firefly_env, monkeypatch):
    from main import app
    from routes import categorize as cat_mod

    async def _grouped(*_args, **_kwargs):
        return [
            {
                "fingerprint": "amzn mktp us",
                "count": 2,
                "sample_description": "AMZN MKTP",
                "journal_ids": ["1", "2"],
                "rows": [
                    {
                        "journal_id": "1",
                        "transaction_journal_id": "10",
                        "date": "2024-06-02",
                        "amount": "-5.00",
                        "description": "AMZN MKTP",
                        "type": "withdrawal",
                        "source_name": "Checking",
                        "destination_name": "Amazon",
                        "budget_name": None,
                    },
                    {
                        "journal_id": "2",
                        "transaction_journal_id": "11",
                        "date": "2024-06-01",
                        "amount": "-3.00",
                        "description": "amzn mktp",
                        "type": "withdrawal",
                        "source_name": "Checking",
                        "destination_name": "Amazon",
                        "budget_name": None,
                    },
                ],
            }
        ]

    class _StubClient:
        base_url = "https://firefly.example"

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: _StubClient()
    monkeypatch.setattr(
        cat_mod, "build_grouped_pending_queue", _grouped
    )
    try:
        response = client.get(
            "/api/categorize/pending",
            params={
                "start": "2024-06-01",
                "end": "2024-06-30",
                "group_by_fingerprint": "true",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["meta"]["grouped"] is True
        assert body["meta"]["group_count"] == 1
        assert body["data"][0]["fingerprint"] == "amzn mktp us"
        assert body["data"][0]["journal_ids"] == ["1", "2"]
    finally:
        app.dependency_overrides.clear()


def test_pending_flat_unchanged_without_group_param(client, firefly_env, monkeypatch):
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

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: _StubClient()
    monkeypatch.setattr(cat_mod, "build_pending_queue", _pending)
    try:
        response = client.get(
            "/api/categorize/pending",
            params={"start": "2024-06-01", "end": "2024-06-30"},
        )
        assert response.status_code == 200
        body = response.json()
        assert "grouped" not in body["meta"]
        assert len(body["data"]) == 1
        assert "journal_id" in body["data"][0]
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


def test_rules_preview_returns_counts(client, firefly_env, monkeypatch):
    from main import app
    from routes import categorize as cat_mod

    async def _preview(*_args, **_kwargs):
        return {"total": 5, "uncategorized_count": 2, "categorized_count": 3}

    class _StubClient:
        pass

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: _StubClient()
    monkeypatch.setattr(cat_mod, "preview_rule_matches", _preview)
    try:
        response = client.post(
            "/api/categorize/rules/preview",
            json={
                "start": "2024-06-01",
                "end": "2024-06-30",
                "rule": {
                    "title": "Amazon",
                    "description_contains": "AMZN",
                    "transaction_type": "withdrawal",
                },
            },
        )
        assert response.status_code == 200
        assert response.json()["data"]["uncategorized_count"] == 2
    finally:
        app.dependency_overrides.clear()


def test_rules_create_returns_rule_id(client, firefly_env, monkeypatch):
    from main import app
    from routes import categorize as cat_mod

    async def _create(*_args, **_kwargs):
        return {"id": "88", "title": "Amazon"}

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: object()
    monkeypatch.setattr(cat_mod, "create_approved_rule", _create)
    try:
        response = client.post(
            "/api/categorize/rules",
            json={
                "start": "2024-06-01",
                "end": "2024-06-30",
                "category_id": "1",
                "rule": {
                    "title": "Amazon",
                    "description_contains": "AMZN",
                    "transaction_type": None,
                },
            },
        )
        assert response.status_code == 200
        assert response.json()["data"]["rule_id"] == "88"
    finally:
        app.dependency_overrides.clear()


def test_rules_create_duplicate_409(client, firefly_env, monkeypatch):
    from categorization_rules import DuplicateRuleError
    from main import app
    from routes import categorize as cat_mod

    async def _create(*_args, **_kwargs):
        raise DuplicateRuleError([{"id": "7", "title": "Existing"}])

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: object()
    monkeypatch.setattr(cat_mod, "create_approved_rule", _create)
    try:
        response = client.post(
            "/api/categorize/rules",
            json={
                "start": "2024-06-01",
                "end": "2024-06-30",
                "category_id": "1",
                "rule": {
                    "title": "Amazon",
                    "description_contains": "AMZN",
                    "transaction_type": None,
                },
            },
        )
        assert response.status_code == 409
        assert response.json()["detail"]["existing_rules"][0]["id"] == "7"
    finally:
        app.dependency_overrides.clear()


def test_rules_trigger_endpoint(client, firefly_env, monkeypatch):
    from main import app
    from routes import categorize as cat_mod

    triggered: list[str] = []

    async def _trigger(_client, rule_id, start, end):
        triggered.append(rule_id)

    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: object()
    monkeypatch.setattr(cat_mod, "trigger_backfill", _trigger)
    try:
        response = client.post(
            "/api/categorize/rules/55/trigger",
            json={"start": "2024-06-01", "end": "2024-06-30"},
        )
        assert response.status_code == 200
        assert triggered == ["55"]
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


def test_ignore_route_success(client, firefly_env, monkeypatch):
    from main import app
    from routes import categorize as cat_mod

    ignored: list[tuple[str, str]] = []

    async def _apply_ignore(_client, group_id, transaction_journal_id):
        ignored.append((group_id, transaction_journal_id))
        return {"ok": True}

    class _StubClient:
        pass

    monkeypatch.setattr(cat_mod, "apply_ignore", _apply_ignore)
    app.dependency_overrides[cat_mod.get_firefly_client] = lambda: _StubClient()
    try:
        response = client.post(
            "/api/categorize/100/ignore",
            json={"transaction_journal_id": "1001"},
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert ignored == [("100", "1001")]
    finally:
        app.dependency_overrides.clear()
