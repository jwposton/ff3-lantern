"""Apply user-approved categorization writes to Firefly."""

from __future__ import annotations

import json
import os
from copy import deepcopy
from typing import Any

import sidecar_db
from firefly_client import FireflyClient


def _ai_tag_name() -> str:
    return os.environ.get("FF3ANALYTICS_AI_TAG", "ai-categorized").strip() or "ai-categorized"


def categorize_ignore_tag() -> str:
    return (
        os.environ.get("FF3ANALYTICS_CATEGORIZE_IGNORE_TAG", "categorize-ignore").strip()
        or "categorize-ignore"
    )


def parse_split_tags(split: dict[str, Any]) -> list[str]:
    """Normalize Firefly split tags to a list of strings."""
    existing = split.get("tags")
    if existing is None:
        return []
    if isinstance(existing, str):
        return [part.strip() for part in existing.split(",") if part.strip()]
    if isinstance(existing, list):
        return [str(t) for t in existing]
    return []


def is_categorize_ignored(split: dict[str, Any]) -> bool:
    return categorize_ignore_tag() in parse_split_tags(split)


def _merge_tags(split: dict[str, Any], tag: str) -> None:
    """Merge tag onto a Firefly transaction split."""
    tags = parse_split_tags(split)
    if tag not in tags:
        tags.append(tag)
    split["tags"] = tags


def build_apply_mutate_fn(
    transaction_journal_id: str,
    category_id: str,
    budget_id: str | None,
) -> Any:
    """Return mutate_fn for FireflyClient.update_transaction."""

    def mutate(attrs: dict[str, Any]) -> dict[str, Any]:
        updated = deepcopy(attrs)
        found = False
        for split in updated.get("transactions", []):
            if str(split.get("transaction_journal_id")) == str(transaction_journal_id):
                split["category_id"] = category_id
                if budget_id is not None:
                    split["budget_id"] = budget_id
                _merge_tags(split, _ai_tag_name())
                found = True
        if not found:
            raise ValueError(
                f"transaction_journal_id {transaction_journal_id} not found in journal"
            )
        return updated

    return mutate


def build_ignore_mutate_fn(transaction_journal_id: str) -> Any:
    """Return mutate_fn that tags one split with the categorize-ignore tag."""

    tag = categorize_ignore_tag()

    def mutate(attrs: dict[str, Any]) -> dict[str, Any]:
        updated = deepcopy(attrs)
        found = False
        for split in updated.get("transactions", []):
            if str(split.get("transaction_journal_id")) == str(transaction_journal_id):
                _merge_tags(split, tag)
                found = True
        if not found:
            raise ValueError(
                f"transaction_journal_id {transaction_journal_id} not found in journal"
            )
        return updated

    return mutate


async def apply_ignore(
    client: FireflyClient,
    group_id: str,
    transaction_journal_id: str,
) -> dict[str, Any]:
    """Tag a split so it is excluded from the categorize pending queue."""
    mutate = build_ignore_mutate_fn(transaction_journal_id)
    result = await client.update_transaction(group_id, mutate)
    await sidecar_db.log_audit(
        "categorize_ignore",
        journal_id=group_id,
        details_json=json.dumps(
            {"transaction_journal_id": transaction_journal_id, "tag": categorize_ignore_tag()}
        ),
    )
    return result


async def apply_category(
    client: FireflyClient,
    group_id: str,
    transaction_journal_id: str,
    category_id: str,
    budget_id: str | None = None,
    *,
    model: str | None = None,
) -> dict[str, Any]:
    """Write category/budget to one split and tag it with FF3ANALYTICS_AI_TAG."""
    mutate = build_apply_mutate_fn(transaction_journal_id, category_id, budget_id)
    result = await client.update_transaction(group_id, mutate)
    await sidecar_db.log_audit(
        "categorize_apply",
        journal_id=group_id,
        details_json=json.dumps(
            {
                "category_id": category_id,
                "budget_id": budget_id,
                "transaction_journal_id": transaction_journal_id,
                "model": model or os.environ.get("OPENROUTER_MODEL", ""),
            }
        ),
    )
    return result


async def validate_apply_ids(
    client: FireflyClient,
    category_id: str,
    budget_id: str | None,
) -> None:
    categories = await client.fetch_categories()
    budgets = await client.fetch_budgets()
    allowed_cats = {c["id"] for c in categories}
    allowed_budgets = {b["id"] for b in budgets}
    if category_id not in allowed_cats:
        raise ValueError(f"category_id not in allowlist: {category_id}")
    if budget_id is not None and budget_id not in allowed_budgets:
        raise ValueError(f"budget_id not in allowlist: {budget_id}")
