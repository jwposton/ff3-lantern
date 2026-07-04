"""Tests for bill suggestion AI explain (DISC-27–DISC-30, #35)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from bill_suggestion_explain_models import (
    EXPLAIN_JSON_SCHEMA,
    EXPLAIN_SYSTEM_PROMPT,
    BillSuggestionExplainResponse,
)
from payment_worksheet_bill_suggestions import (
    build_bill_suggestions,
    build_explain_user_payload,
    explain_suggestion,
    fetch_bill_suggestion_explain,
    find_suggestion_by_id,
)


def _engine_kwargs(*, ignored_categories: list[str] | None = None) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "accounts": empty_accounts(),
        "firefly_bills": [],
        "registry_rows": [],
        "period_start": "2025-07-01",
        "period_end": "2026-07-01",
    }
    if ignored_categories is not None:
        kwargs["ignored_categories"] = ignored_categories
    return kwargs


def empty_accounts() -> dict[str, dict[str, Any]]:
    return {
        "cc-paypal": {
            "id": "cc-paypal",
            "name": "PayPal Credit",
            "type": "Asset account",
            "role": "Credit card",
        },
        "checking": {
            "id": "checking",
            "name": "Checking",
            "type": "Asset account",
            "role": "Default asset",
        },
    }


def low_confidence_quarterly(count: int = 2) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    dates = ["2025-01-15", "2025-04-18"]
    for i in range(count):
        rows.append({
            "type": "withdrawal",
            "amount": "15.00",
            "date": dates[i],
            "destination_name": "Quarterly Sub Co",
            "description": "Subscription renewal",
            "category_name": "Professional Services",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows

ICLOUD_EXAMPLE: dict[str, Any] = {
    "suggestion_id": "dest:apple-services:cat:cloud-storage:amt:1009",
    "display_name": "iCloud+ 2TB",
    "service_guess": "Apple iCloud+ storage subscription",
    "amount_mode_rationale": (
        "Fixed $10.09 monthly charge consistent across 12 occurrences."
    ),
    "rule_hints": {
        "destination_account": "Apple Services",
        "category_name": "Cloud Storage",
        "amount_exactly": "10.09",
    },
    "rationale": (
        "Recurring monthly withdrawal from Apple Services with cloud storage "
        "category and ICLOUD sample descriptions."
    ),
    "confidence_note": (
        "Medium confidence; matches opaque Apple Services cluster pattern."
    ),
}


def test_explain_response_parses_example():
    body = BillSuggestionExplainResponse.model_validate(ICLOUD_EXAMPLE)
    assert body.suggestion_id == "dest:apple-services:cat:cloud-storage:amt:1009"
    assert body.display_name == "iCloud+ 2TB"
    assert body.rule_hints.destination_account == "Apple Services"


def test_explain_json_schema_required():
    required = EXPLAIN_JSON_SCHEMA["required"]
    assert "suggestion_id" in required
    assert "display_name" in required
    assert "service_guess" in required
    assert "amount_mode_rationale" in required
    assert "rule_hints" in required
    assert "rationale" in required
    assert "confidence_note" in required
    rule_hints = EXPLAIN_JSON_SCHEMA["properties"]["rule_hints"]
    assert rule_hints["additionalProperties"] is False
    assert set(rule_hints["required"]) == {
        "destination_account",
        "category_name",
        "amount_exactly",
    }
    assert EXPLAIN_JSON_SCHEMA["additionalProperties"] is False


def test_explain_system_prompt_constraints():
    prompt = EXPLAIN_SYSTEM_PROMPT.casefold()
    assert "display-only" in prompt or "display only" in prompt
    assert "auto-register" in prompt or "auto register" in prompt
    assert "metrics" in prompt or "provided" in prompt


def test_find_suggestion_by_id_found():
    splits = low_confidence_quarterly(2)
    result = build_bill_suggestions(splits, **_engine_kwargs())
    suggestion_id = result["data"][0]["id"]
    found = find_suggestion_by_id(
        splits,
        suggestion_id=suggestion_id,
        **_engine_kwargs(),
    )
    assert found is not None
    assert found["id"] == suggestion_id
    assert found["status"] == "review"


def test_find_suggestion_by_id_not_found():
    splits = low_confidence_quarterly(2)
    found = find_suggestion_by_id(
        splits,
        suggestion_id="bogus:missing:id",
        **_engine_kwargs(),
    )
    assert found is None


def test_build_explain_user_payload():
    splits = low_confidence_quarterly(2)
    result = build_bill_suggestions(splits, **_engine_kwargs())
    suggestion = result["data"][0]
    payload = build_explain_user_payload(suggestion, lookback_months=12)
    assert payload["suggestion_id"] == suggestion["id"]
    assert payload["merchant"] == suggestion["merchant"]
    assert payload["destination_name"] == suggestion["register_prefill"]["destination_account"]
    assert payload["cluster"] == suggestion.get("cluster")
    assert "metrics" in payload
    assert payload["metrics"]["status"] == suggestion["status"]
    assert payload["metrics"]["confidence"] == suggestion["confidence"]
    assert isinstance(payload["reasons"], list)
    assert len(payload["sample_descriptions"]) <= 5
    assert payload["lookback_months"] == 12


def test_payload_supplements_samples(monkeypatch):
    splits = low_confidence_quarterly(2)
    result = build_bill_suggestions(splits, **_engine_kwargs())
    suggestion = result["data"][0]
    suggestion["sample_descriptions"] = ["Only one sample"]

    extra_txns = [
        {"description": "Extra txn A"},
        {"description": "Extra txn B"},
        {"description": "Extra txn C"},
        {"description": "Extra txn D"},
    ]

    def fake_find(*_args, **_kwargs):
        return extra_txns

    monkeypatch.setattr(
        "payment_worksheet_bill_suggestions.find_suggestion_transactions",
        fake_find,
    )

    payload = build_explain_user_payload(
        suggestion,
        lookback_months=12,
        splits=splits,
        **_engine_kwargs(),
    )
    assert len(payload["sample_descriptions"]) <= 5
    assert "Only one sample" in payload["sample_descriptions"]
    assert "Extra txn A" in payload["sample_descriptions"]


@pytest.mark.asyncio
async def test_explain_not_found_no_openrouter(monkeypatch):
    calls = {"n": 0}

    async def fake_complete(*_args, **_kwargs):
        calls["n"] += 1
        return BillSuggestionExplainResponse.model_validate(ICLOUD_EXAMPLE)

    monkeypatch.setattr(
        "payment_worksheet_bill_suggestions.complete_json_schema",
        fake_complete,
    )

    result = await explain_suggestion(
        http=None,  # type: ignore[arg-type]
        api_key="sk-test",
        suggestion=None,
        lookback_months=12,
    )
    assert result is None
    assert calls["n"] == 0


@pytest.mark.asyncio
async def test_explain_success_mocked(monkeypatch):
    splits = low_confidence_quarterly(2)
    envelope = build_bill_suggestions(splits, **_engine_kwargs())
    suggestion = envelope["data"][0]
    expected_id = suggestion["id"]

    async def fake_complete(*_args, **_kwargs):
        return BillSuggestionExplainResponse.model_validate(
            {**ICLOUD_EXAMPLE, "suggestion_id": expected_id}
        )

    monkeypatch.setattr(
        "payment_worksheet_bill_suggestions.complete_json_schema",
        fake_complete,
    )

    result = await explain_suggestion(
        http=None,  # type: ignore[arg-type]
        api_key="sk-test",
        suggestion=suggestion,
        lookback_months=12,
    )
    assert result is not None
    assert result.suggestion_id == expected_id


@pytest.mark.asyncio
async def test_explain_uses_model_env(monkeypatch):
    splits = low_confidence_quarterly(2)
    suggestion = build_bill_suggestions(splits, **_engine_kwargs())["data"][0]
    captured: dict[str, Any] = {}

    async def fake_complete(_http, *, model, **_kwargs):
        captured["model"] = model
        return BillSuggestionExplainResponse.model_validate(
            {**ICLOUD_EXAMPLE, "suggestion_id": suggestion["id"]}
        )

    monkeypatch.setattr(
        "payment_worksheet_bill_suggestions.complete_json_schema",
        fake_complete,
    )
    monkeypatch.setenv("OPENROUTER_MODEL", "anthropic/claude-3.5-sonnet")

    await explain_suggestion(
        http=None,  # type: ignore[arg-type]
        api_key="sk-test",
        suggestion=suggestion,
        lookback_months=12,
    )
    assert captured["model"] == "anthropic/claude-3.5-sonnet"

    await explain_suggestion(
        http=None,  # type: ignore[arg-type]
        api_key="sk-test",
        suggestion=suggestion,
        lookback_months=12,
        model="openai/gpt-4o-mini",
    )
    assert captured["model"] == "openai/gpt-4o-mini"


@pytest.mark.asyncio
async def test_fetch_bill_suggestion_explain_wrapper(monkeypatch):
    class FakeClient:
        async def fetch_splits(self, *_args, **_kwargs):
            return low_confidence_quarterly(2)

        async def fetch_accounts(self):
            return empty_accounts()

        async def fetch_bills(self):
            return []

    envelope = build_bill_suggestions(low_confidence_quarterly(2), **_engine_kwargs())
    suggestion_id = envelope["data"][0]["id"]

    async def fake_explain(*_args, **_kwargs):
        return BillSuggestionExplainResponse.model_validate(
            {**ICLOUD_EXAMPLE, "suggestion_id": suggestion_id}
        )

    monkeypatch.setattr(
        "payment_worksheet_bill_suggestions.explain_suggestion",
        fake_explain,
    )
    monkeypatch.setattr(
        "payment_worksheet_bill_suggestions.sidecar_db.list_worksheet_registry",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        "payment_worksheet_bill_suggestions.sidecar_db.get_discover_settings",
        AsyncMock(return_value={"ignored_categories": []}),
    )

    missing = await fetch_bill_suggestion_explain(
        FakeClient(),
        http=None,  # type: ignore[arg-type]
        api_key="sk-test",
        suggestion_id="missing-id",
        lookback_months=12,
    )
    assert missing is None

    found = await fetch_bill_suggestion_explain(
        FakeClient(),
        http=None,  # type: ignore[arg-type]
        api_key="sk-test",
        suggestion_id=suggestion_id,
        lookback_months=12,
    )
    assert found is not None
    assert found["suggestion_id"] == suggestion_id
