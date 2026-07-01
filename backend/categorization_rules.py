"""Rule preview, create, and opt-in backfill for AI categorization."""

from __future__ import annotations

import json
import os
from typing import Any

import sidecar_db
from categorization_apply import validate_apply_ids
from categorization_models import RuleDraft
from firefly_client import FireflyClient
from transaction_normalization import is_uncategorized_for_queue


class DuplicateRuleError(Exception):
    """Raised when a draft overlaps an existing Firefly rule."""

    def __init__(self, conflicts: list[dict[str, str]]) -> None:
        self.conflicts = conflicts
        super().__init__(f"duplicate rules: {len(conflicts)}")


def _ai_tag_name() -> str:
    return os.environ.get("FF3ANALYTICS_AI_TAG", "ai-categorized").strip() or "ai-categorized"


def _rule_group_title() -> str:
    return (
        os.environ.get("FF3ANALYTICS_RULE_GROUP", "FF3Analytics AI").strip()
        or "FF3Analytics AI"
    )


def _matches_draft(split: dict[str, Any], draft: RuleDraft) -> bool:
    needle = draft.description_contains.strip().lower()
    if not needle:
        return False
    desc = (split.get("description") or "").lower()
    if needle not in desc:
        return False
    if draft.transaction_type and split.get("type") != draft.transaction_type:
        return False
    return True


async def preview_rule_matches(
    client: FireflyClient,
    start: str,
    end: str,
    draft: RuleDraft,
) -> dict[str, int]:
    """Count splits matching draft description_contains in date range."""
    if not draft.description_contains.strip():
        raise ValueError("description_contains must be non-empty")
    splits = await client.fetch_splits(start, end)
    total = uncategorized_count = categorized_count = 0
    for split in splits:
        if not _matches_draft(split, draft):
            continue
        total += 1
        if is_uncategorized_for_queue(split):
            uncategorized_count += 1
        else:
            categorized_count += 1
    return {
        "total": total,
        "uncategorized_count": uncategorized_count,
        "categorized_count": categorized_count,
    }


async def _lookup_names(
    client: FireflyClient, category_id: str, budget_id: str | None
) -> tuple[str, str | None]:
    categories = await client.fetch_categories()
    budgets = await client.fetch_budgets()
    cat_by_id = {c["id"]: c["name"] for c in categories}
    budget_by_id = {b["id"]: b["name"] for b in budgets}
    if category_id not in cat_by_id:
        raise ValueError(f"category_id not in allowlist: {category_id}")
    category_name = cat_by_id[category_id]
    budget_name: str | None = None
    if budget_id is not None:
        if budget_id not in budget_by_id:
            raise ValueError(f"budget_id not in allowlist: {budget_id}")
        budget_name = budget_by_id[budget_id]
    return category_name, budget_name


def build_firefly_rule_body(
    draft: RuleDraft,
    category_name: str,
    budget_name: str | None,
) -> dict[str, Any]:
    """Map approved draft to Firefly POST /api/v1/rules JSON."""
    triggers: list[dict[str, str]] = [
        {"type": "description_contains", "value": draft.description_contains.strip()}
    ]
    if draft.transaction_type:
        triggers.append({"type": "transaction_type", "value": draft.transaction_type})
    actions: list[dict[str, str]] = [
        {"type": "set_category", "value": category_name},
    ]
    if budget_name:
        actions.append({"type": "set_budget", "value": budget_name})
    actions.append({"type": "add_tag", "value": _ai_tag_name()})
    return {
        "rule_group_title": _rule_group_title(),
        "title": draft.title.strip(),
        "trigger": "store-journal",
        "active": True,
        "triggers": triggers,
        "actions": actions,
    }


async def find_duplicate_rules(
    client: FireflyClient, draft: RuleDraft
) -> list[dict[str, str]]:
    """Return existing rules whose title or description_contains overlaps the draft."""
    needle = draft.description_contains.strip().lower()
    if not needle:
        return []
    rules = await client.fetch_rules()
    conflicts: list[dict[str, str]] = []
    seen: set[str] = set()
    for rule in rules:
        rule_id = rule["id"]
        if rule_id in seen:
            continue
        title = (rule.get("title") or "").lower()
        overlap = needle in title
        if not overlap:
            for trig in rule.get("triggers") or []:
                if trig.get("type") != "description_contains":
                    continue
                val = (trig.get("value") or "").lower()
                if needle in val or val in needle:
                    overlap = True
                    break
        if overlap:
            seen.add(rule_id)
            conflicts.append({"id": rule_id, "title": rule.get("title") or ""})
    return conflicts


async def create_approved_rule(
    client: FireflyClient,
    draft: RuleDraft,
    category_id: str,
    budget_id: str | None = None,
) -> dict[str, Any]:
    """Create a Firefly rule after user approval; never triggers backfill."""
    if not draft.description_contains.strip():
        raise ValueError("description_contains must be non-empty")
    await validate_apply_ids(client, category_id, budget_id)
    conflicts = await find_duplicate_rules(client, draft)
    if conflicts:
        raise DuplicateRuleError(conflicts)
    category_name, budget_name = await _lookup_names(client, category_id, budget_id)
    body = build_firefly_rule_body(draft, category_name, budget_name)
    created = await client.create_rule(body)
    await sidecar_db.log_audit(
        "categorize_rule_create",
        details_json=json.dumps(
            {
                "rule_id": created["id"],
                "title": created.get("title"),
                "description_contains": draft.description_contains,
                "category_id": category_id,
                "budget_id": budget_id,
            }
        ),
    )
    return created


async def trigger_backfill(
    client: FireflyClient,
    rule_id: str,
    start: str,
    end: str,
) -> dict[str, Any]:
    """Opt-in backfill via Firefly rule trigger endpoint."""
    result = await client.trigger_rule(rule_id, start, end)
    await sidecar_db.log_audit(
        "categorize_rule_trigger",
        details_json=json.dumps({"rule_id": rule_id, "start": start, "end": end}),
    )
    return result
