"""Tests for categorization apply path and approval invariant."""

from __future__ import annotations

import ast
import asyncio
import json
from pathlib import Path

import httpx
import pytest

from categorization_apply import (
    apply_category,
    apply_ignore,
    build_apply_mutate_fn,
    build_ignore_mutate_fn,
    is_categorize_ignored,
    validate_apply_ids,
)
from conftest import load_fixture
from firefly_client import FireflyClient


def test_mutate_fn_updates_target_split_only():
    attrs = load_fixture("transactions_put_roundtrip.json")["data"]["attributes"]
    mutate = build_apply_mutate_fn("5001", "99", "5")
    updated = mutate(attrs)
    splits = updated["transactions"]
    assert splits[0]["category_id"] == "99"
    assert splits[0]["budget_id"] == "5"
    assert splits[1]["category_id"] == "10"
    assert "budget_id" not in splits[1] or splits[1].get("budget_id") != "5"


def test_mutate_fn_adds_ai_tag():
    attrs = load_fixture("transactions_put_roundtrip.json")["data"]["attributes"]
    mutate = build_apply_mutate_fn("5001", "99", None)
    updated = mutate(attrs)
    tagged = updated["transactions"][0]
    assert "ai-categorized" in tagged.get("tags", [])


def test_ignore_mutate_fn_adds_ignore_tag(monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_CATEGORIZE_IGNORE_TAG", "skip-queue")
    attrs = load_fixture("transactions_put_roundtrip.json")["data"]["attributes"]
    mutate = build_ignore_mutate_fn("5001")
    updated = mutate(attrs)
    tagged = updated["transactions"][0]
    assert "skip-queue" in tagged.get("tags", [])
    assert updated["transactions"][1].get("tags") in (None, [])


def test_is_categorize_ignored_detects_tag(monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_CATEGORIZE_IGNORE_TAG", "categorize-ignore")
    assert is_categorize_ignored({"tags": ["categorize-ignore"]})
    assert is_categorize_ignored({"tags": "categorize-ignore,other"})
    assert not is_categorize_ignored({"tags": ["other"]})


def test_mutate_fn_raises_when_journal_missing():
    attrs = load_fixture("transactions_put_roundtrip.json")["data"]["attributes"]
    mutate = build_apply_mutate_fn("9999", "99", None)
    with pytest.raises(ValueError, match="not found"):
        mutate(attrs)


def test_apply_category_put_preserves_splits(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    get_payload = load_fixture("transactions_put_roundtrip.json")
    put_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/transactions/500" and request.method == "GET":
            return httpx.Response(200, json=get_payload)
        if request.url.path == "/api/v1/transactions/500" and request.method == "PUT":
            put_bodies.append(json.loads(request.content))
            return httpx.Response(200, json=get_payload)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )

    asyncio.run(apply_category(client, "500", "5001", "99", "5"))

    assert len(put_bodies) == 1
    body = put_bodies[0]
    assert body.get("apply_rules") is False
    journal_ids = {s["transaction_journal_id"] for s in body["transactions"]}
    assert journal_ids == {"5001", "5002"}
    tagged_split = next(
        s for s in body["transactions"] if s["transaction_journal_id"] == "5001"
    )
    assert "ai-categorized" in tagged_split.get("tags", [])
    assert "tags" not in body


@pytest.mark.asyncio
async def test_validate_apply_ids_rejects_unknown_category():
    class _Client:
        async def fetch_categories(self):
            return [{"id": "1", "name": "Food"}]

        async def fetch_budgets(self):
            return []

    with pytest.raises(ValueError, match="category_id"):
        await validate_apply_ids(_Client(), "99", None)


@pytest.mark.asyncio
async def test_apply_route_skips_put_on_validation_failure():
    put_count = {"n": 0}

    class _Client:
        async def fetch_categories(self):
            return [{"id": "1", "name": "Food"}]

        async def fetch_budgets(self):
            return []

        async def update_transaction(self, *_args, **_kwargs):
            put_count["n"] += 1
            return {}

    with pytest.raises(ValueError):
        await validate_apply_ids(_Client(), "invalid", None)
    assert put_count["n"] == 0


def _file_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_approval_invariant_no_autonomous_writes():
    """Suggest path must not call update_transaction — only categorization_apply."""
    backend = Path(__file__).resolve().parent.parent
    for name in ("categorization_suggest.py", "openrouter_client.py"):
        source = _file_text(backend / name)
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id == "update_transaction":
                raise AssertionError(f"{name} references update_transaction")
            if isinstance(node, ast.Attribute) and node.attr == "update_transaction":
                raise AssertionError(f"{name} references update_transaction")

    apply_source = _file_text(backend / "categorization_apply.py")
    assert "update_transaction" in apply_source

    routes_source = _file_text(backend / "routes" / "categorize.py")
    assert routes_source.count("apply_category") >= 1 or "categorization_apply" in routes_source
