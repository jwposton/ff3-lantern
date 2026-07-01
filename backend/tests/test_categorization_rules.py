"""Tests for rule preview, create, and trigger logic."""

from __future__ import annotations

import ast
import json
from pathlib import Path

import httpx
import pytest

from categorization_models import RuleDraft
from categorization_rules import (
    DuplicateRuleError,
    build_firefly_rule_body,
    create_approved_rule,
    find_duplicate_rules,
    preview_rule_matches,
    trigger_backfill,
)
from firefly_client import FireflyClient


def test_build_firefly_rule_body_includes_active_and_tag(monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_RULE_GROUP", "Test Group")
    monkeypatch.setenv("FF3ANALYTICS_AI_TAG", "ai-tagged")
    draft = RuleDraft(
        title="Amazon",
        description_contains="AMZN MKTP",
        transaction_type="withdrawal",
    )
    body = build_firefly_rule_body(draft, "Shopping", "Discretionary")
    assert body["active"] is True
    assert body["trigger"] == "store-journal"
    assert body["rule_group_title"] == "Test Group"
    assert body["triggers"] == [
        {"type": "description_contains", "value": "AMZN MKTP", "active": True},
        {"type": "transaction_type", "value": "withdrawal", "active": True},
    ]
    assert body["strict"] is True
    assert body["actions"] == [
        {"type": "set_category", "value": "Shopping", "active": True},
        {"type": "set_budget", "value": "Discretionary", "active": True},
        {"type": "add_tag", "value": "ai-tagged", "active": True},
    ]


def test_build_firefly_rule_body_destination_account_trigger(monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_RULE_GROUP", "Test Group")
    draft = RuleDraft(
        title="Safeway → Groceries",
        description_contains="",
        destination_account="Safeway",
        transaction_type="withdrawal",
    )
    body = build_firefly_rule_body(draft, "Groceries", None)
    assert body["triggers"] == [
        {"type": "destination_account_is", "value": "Safeway", "active": True},
        {"type": "transaction_type", "value": "withdrawal", "active": True},
    ]


@pytest.mark.parametrize(
    ("match_type", "firefly_type", "needle"),
    [
        ("contains", "destination_account_contains", "Amazon"),
        ("starts_with", "destination_account_starts", "AMZN"),
        ("ends_with", "destination_account_ends", "Prime"),
    ],
)
def test_build_firefly_rule_body_destination_match_types(
    monkeypatch, match_type, firefly_type, needle
):
    monkeypatch.setenv("FF3ANALYTICS_RULE_GROUP", "Test Group")
    draft = RuleDraft(
        title="Amazon",
        description_contains="",
        destination_account=needle,
        destination_match_type=match_type,
    )
    body = build_firefly_rule_body(draft, "Shopping", None)
    assert body["triggers"] == [
        {"type": firefly_type, "value": needle, "active": True},
    ]


@pytest.mark.asyncio
async def test_preview_rule_matches_destination_contains():
    splits = [
        {
            "type": "withdrawal",
            "description": "POS PURCHASE",
            "destination_name": "Amazon Marketplace",
            "category_name": None,
        },
        {
            "type": "withdrawal",
            "description": "POS PURCHASE",
            "destination_name": "Netflix",
            "category_name": None,
        },
    ]

    class _Client:
        async def fetch_splits(self, start, end):
            return splits

    draft = RuleDraft(
        title="Amazon payee",
        description_contains="",
        destination_account="Amazon",
        destination_match_type="contains",
    )
    result = await preview_rule_matches(_Client(), "2024-01-01", "2024-01-31", draft)
    assert result == {"total": 1, "uncategorized_count": 1, "categorized_count": 0}


@pytest.mark.asyncio
async def test_preview_rule_matches_destination_starts_with():
    splits = [
        {
            "type": "withdrawal",
            "description": "DEBIT",
            "destination_name": "Safeway #123",
            "category_name": None,
        },
        {
            "type": "withdrawal",
            "description": "DEBIT",
            "destination_name": "Whole Foods",
            "category_name": None,
        },
    ]

    class _Client:
        async def fetch_splits(self, start, end):
            return splits

    draft = RuleDraft(
        title="Safeway",
        description_contains="",
        destination_account="Safe",
        destination_match_type="starts_with",
    )
    result = await preview_rule_matches(_Client(), "2024-01-01", "2024-01-31", draft)
    assert result["total"] == 1


@pytest.mark.asyncio
async def test_find_duplicate_rules_by_destination_contains():
    class _Client:
        async def fetch_rules(self):
            return [
                {
                    "id": "12",
                    "title": "Amazon payee",
                    "triggers": [
                        {
                            "type": "destination_account_contains",
                            "value": "amazon",
                        }
                    ],
                }
            ]

    draft = RuleDraft(
        title="New Amazon",
        description_contains="",
        destination_account="Amazon",
        destination_match_type="contains",
    )
    conflicts = await find_duplicate_rules(_Client(), draft)
    assert len(conflicts) == 1
    assert conflicts[0]["id"] == "12"


@pytest.mark.asyncio
async def test_preview_rule_matches_counts():
    splits = [
        {
            "type": "withdrawal",
            "description": "AMZN MKTP US",
            "category_name": None,
        },
        {
            "type": "withdrawal",
            "description": "amzn mktp order",
            "category_name": "Shopping",
        },
        {
            "type": "withdrawal",
            "description": "SAFEWAY",
            "category_name": None,
        },
    ]

    class _Client:
        async def fetch_splits(self, start, end):
            return splits

    draft = RuleDraft(
        title="Amazon",
        description_contains="AMZN",
        transaction_type="withdrawal",
    )
    result = await preview_rule_matches(_Client(), "2024-01-01", "2024-01-31", draft)
    assert result == {"total": 2, "uncategorized_count": 1, "categorized_count": 1}


@pytest.mark.asyncio
async def test_find_duplicate_rules_ignores_short_title_substring_of_needle():
    """Existing short titles must not block when only title-in-needle would match."""
    class _Client:
        async def fetch_rules(self):
            return [
                {
                    "id": "9",
                    "title": "Pay",
                    "triggers": [],
                }
            ]

    draft = RuleDraft(
        title="Vendor payment",
        description_contains="Payment to Vendor",
        transaction_type=None,
    )
    conflicts = await find_duplicate_rules(_Client(), draft)
    assert conflicts == []


@pytest.mark.asyncio
async def test_find_duplicate_rules_by_trigger():
    class _Client:
        async def fetch_rules(self):
            return [
                {
                    "id": "5",
                    "title": "Grocery rule",
                    "triggers": [
                        {"type": "description_contains", "value": "AMZN MKTP"}
                    ],
                }
            ]

    draft = RuleDraft(
        title="New Amazon",
        description_contains="amzn mktp",
        transaction_type=None,
    )
    conflicts = await find_duplicate_rules(_Client(), draft)
    assert len(conflicts) == 1
    assert conflicts[0]["id"] == "5"


@pytest.mark.asyncio
async def test_create_approved_rule_posts_and_audits(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    posted: list[dict] = []

    class _Client:
        async def fetch_categories(self):
            return [{"id": "1", "name": "Shopping"}]

        async def fetch_budgets(self):
            return [{"id": "2", "name": "Fun"}]

        async def fetch_rules(self):
            return []

        async def ensure_rule_group(self, title):
            return "3"

        async def create_rule(self, body):
            posted.append(body)
            return {"id": "99", "title": body["title"]}

    draft = RuleDraft(
        title="Amazon",
        description_contains="AMZN",
        transaction_type="withdrawal",
    )
    created = await create_approved_rule(_Client(), draft, "1", "2")
    assert created["id"] == "99"
    assert posted[0]["active"] is True
    assert posted[0]["rule_group_id"] == "3"
    assert "rule_group_title" not in posted[0]


@pytest.mark.asyncio
async def test_create_duplicate_raises():
    class _Client:
        async def fetch_categories(self):
            return [{"id": "1", "name": "Shopping"}]

        async def fetch_budgets(self):
            return []

        async def fetch_rules(self):
            return [{"id": "7", "title": "AMZN rule", "triggers": []}]

    draft = RuleDraft(
        title="Amazon dup",
        description_contains="AMZN",
        transaction_type=None,
    )
    with pytest.raises(DuplicateRuleError):
        await create_approved_rule(_Client(), draft, "1")


@pytest.mark.asyncio
async def test_trigger_backfill_audits(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    triggered: list[tuple[str, str, str]] = []

    class _Client:
        async def trigger_rule(self, rule_id, start, end):
            triggered.append((rule_id, start, end))
            return {"ok": True}

    await trigger_backfill(_Client(), "42", "2024-01-01", "2024-01-31")
    assert triggered == [("42", "2024-01-01", "2024-01-31")]


def test_suggest_pipeline_does_not_import_rule_writes():
    """Approval invariant: AI suggest path must not call rule create/trigger."""
    backend = Path(__file__).resolve().parent.parent
    for rel in ("categorization_suggest.py", "openrouter_client.py"):
        source = (backend / rel).read_text(encoding="utf-8")
        tree = ast.parse(source)
        names = {
            node.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Name)
        }
        assert "create_rule" not in names
        assert "trigger_rule" not in names
        assert "create_approved_rule" not in names
        assert "trigger_backfill" not in names
