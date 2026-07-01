"""Tests for OpenRouter suggest pipeline, allowlist gate, and cache."""

from __future__ import annotations

import json

import httpx
import pytest

from categorization_context import (
    build_user_payload,
    select_few_shot_examples,
)
from categorization_models import CategorizationSuggestion, RuleDraft, SUGGESTION_JSON_SCHEMA
from conftest import load_fixture
from firefly_client import FireflyClient
from openrouter_client import suggest_category


def test_model_parses_direct_suggestion():
    suggestion = CategorizationSuggestion.model_validate(
        {
            "category": "Groceries",
            "budget": "Food",
            "confidence": 0.9,
            "recommendation": "direct",
            "rule": None,
            "rationale": "Matches Safeway pattern",
        }
    )
    assert suggestion.recommendation == "direct"


def test_suggestion_json_schema_rule_includes_transaction_type_in_required():
    rule_schema = SUGGESTION_JSON_SCHEMA["properties"]["rule"]
    assert "transaction_type" in rule_schema["required"]
    assert "destination_account" in rule_schema["required"]
    assert "destination_match_type" in rule_schema["required"]


def test_model_requires_rule_when_recommendation_rule():
    with pytest.raises(ValueError):
        CategorizationSuggestion.model_validate(
            {
                "category": "Shopping",
                "budget": None,
                "confidence": 0.8,
                "recommendation": "rule",
                "rule": None,
                "rationale": "Recurring",
            }
        )


def test_validate_against_allowlists_pass():
    ref = load_fixture("categorization_reference.json")
    suggestion = CategorizationSuggestion(
        category=ref["near_miss"]["valid_category"],
        budget="Food",
        confidence=0.85,
        recommendation="direct",
        rationale="test",
    )
    cats = {name: str(i) for i, name in enumerate(ref["categories"])}
    budgets = {name: str(i) for i, name in enumerate(ref["budgets"])}
    cat_id, budget_id = suggestion.validate_against_allowlists(cats, budgets)
    assert cat_id is not None
    assert budget_id is not None


def test_validate_against_allowlists_near_miss():
    ref = load_fixture("categorization_reference.json")
    suggestion = CategorizationSuggestion(
        category=ref["near_miss"]["invalid_category"],
        budget=None,
        confidence=0.85,
        recommendation="direct",
        rationale="test",
    )
    cats = {name: str(i) for i, name in enumerate(ref["categories"])}
    with pytest.raises(ValueError, match="allowlist"):
        suggestion.validate_against_allowlists(cats, {})


@pytest.mark.asyncio
async def test_openrouter_client_parses_response():
    valid = {
        "category": "Groceries",
        "budget": "Food",
        "confidence": 0.9,
        "recommendation": "direct",
        "rule": None,
        "rationale": "Grocery store",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(valid)}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 50},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await suggest_category(
            client,
            api_key="sk-test",
            model="openai/gpt-4o-mini",
            system_prompt="test",
            user_payload={"transaction": {"description": "SAFEWAY"}},
        )
    assert result.category == "Groceries"


@pytest.mark.asyncio
async def test_openrouter_retries_on_429():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={"error": "rate limit"})
        valid = {
            "category": "Groceries",
            "budget": None,
            "confidence": 0.8,
            "recommendation": "direct",
            "rule": None,
            "rationale": "ok",
        }
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(valid)}}], "usage": {}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await suggest_category(
            client,
            api_key="sk-test",
            model="openai/gpt-4o-mini",
            system_prompt="test",
            user_payload={},
        )
    assert result.category == "Groceries"
    assert calls["n"] == 2


def test_context_payload_excludes_sensitive_fields():
    payload = build_user_payload(
        {
            "journal_id": "1",
            "description": "AMZN",
            "amount": "-10",
            "type": "withdrawal",
            "destination_name": "Amazon",
            "source_name": "Checking",
            "date": "2024-06-01",
            "notes": "secret note",
        },
        category_names=["Shopping"],
        budget_names=["Household"],
        few_shot=[],
    )
    assert "rule_summaries" not in payload
    tx = payload["transaction"]
    assert "notes" not in tx
    assert "source_name" in tx


def test_few_shot_selects_destination_match():
    target = {
        "journal_id": "99",
        "description": "AMZN MKTP",
        "destination_name": "Amazon",
    }
    splits = [
        {
            "journal_id": "1",
            "description": "AMZN MKTP US",
            "destination_name": "Amazon",
            "category_name": "Shopping",
            "budget_name": "Fun",
            "type": "withdrawal",
        },
        {
            "journal_id": "2",
            "description": "NETFLIX",
            "destination_name": "Netflix",
            "category_name": "Entertainment",
            "budget_name": "Subscriptions",
            "type": "withdrawal",
        },
    ]
    examples = select_few_shot_examples(splits, target)
    assert len(examples) == 1
    assert examples[0]["category"] == "Shopping"


@pytest.mark.asyncio
async def test_suggest_batch_uses_cache(monkeypatch, tmp_path):
    import categorization_suggest as suggest_mod
    import sidecar_db

    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    await sidecar_db.init_db()

    call_count = {"n": 0}
    valid = {
        "category": "Shopping",
        "budget": "Household",
        "confidence": 0.9,
        "recommendation": "direct",
        "rule": None,
        "rationale": "Amazon",
    }

    async def mock_suggest(*_args, **_kwargs):
        call_count["n"] += 1
        return CategorizationSuggestion.model_validate(valid)

    async def mock_context(*_args, **_kwargs):
        return ({"Shopping": "1"}, {"Household": "2"}, {"transaction": {}})

    class _Firefly:
        async def fetch_splits(self, start, end):
            return [
                {
                    "journal_id": "1",
                    "transaction_journal_id": "10",
                    "type": "withdrawal",
                    "category_name": None,
                    "description": "AMZN",
                    "destination_name": "Amazon",
                    "date": "2024-06-01",
                    "amount": "-5",
                    "source_name": "Checking",
                }
            ]

        async def fetch_categories(self):
            return [{"id": "1", "name": "Shopping"}]

        async def fetch_budgets(self):
            return [{"id": "2", "name": "Household"}]

        async def fetch_rules(self):
            return []

    monkeypatch.setattr(suggest_mod, "suggest_category", mock_suggest)
    monkeypatch.setattr(suggest_mod, "build_suggest_context", mock_context)

    results = await suggest_mod.suggest_batch(
        _Firefly(), start="2024-06-01", end="2024-06-30", journal_ids=["1"]
    )
    assert results[0]["cached"] is False
    results2 = await suggest_mod.suggest_batch(
        _Firefly(), start="2024-06-01", end="2024-06-30", journal_ids=["1"]
    )
    assert results2[0]["cached"] is True
    assert call_count["n"] == 1


@pytest.mark.asyncio
async def test_allowlist_failure_not_cached(monkeypatch, tmp_path):
    import categorization_suggest as suggest_mod
    import sidecar_db

    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    await sidecar_db.init_db()

    async def mock_suggest(*_args, **_kwargs):
        return CategorizationSuggestion(
            category="Grocery",
            budget=None,
            confidence=0.5,
            recommendation="direct",
            rationale="bad",
        )

    async def mock_context(*_args, **_kwargs):
        return ({"Groceries": "1"}, {}, {"transaction": {}})

    class _Firefly:
        async def fetch_splits(self, start, end):
            return [
                {
                    "journal_id": "1",
                    "type": "withdrawal",
                    "category_name": None,
                    "description": "X",
                    "date": "2024-06-01",
                }
            ]

        async def fetch_categories(self):
            return [{"id": "1", "name": "Groceries"}]

        async def fetch_budgets(self):
            return []

        async def fetch_rules(self):
            return []

    monkeypatch.setattr(suggest_mod, "suggest_category", mock_suggest)
    monkeypatch.setattr(suggest_mod, "build_suggest_context", mock_context)

    results = await suggest_mod.suggest_batch(
        _Firefly(), start="2024-06-01", end="2024-06-30", journal_ids=["1"]
    )
    assert results[0]["error"]
    cached = await sidecar_db.get_suggestion("1", suggest_mod._default_model())
    assert cached is None


def test_get_pending_does_not_call_suggest_on_load():
    """CAT-02: GET pending handler must not invoke suggest."""
    import inspect
    from routes import categorize as cat_routes

    source = inspect.getsource(cat_routes.get_categorize_pending)
    assert "suggest" not in source.lower()
