"""Rule preview, create, and opt-in backfill for AI categorization."""

from __future__ import annotations

import json
import os
from typing import Any

import sidecar_db
from categorization_apply import validate_apply_ids
from categorization_models import DestinationMatchType, RuleDraft, validate_rule_triggers
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


def _firefly_destination_trigger_type(match_type: DestinationMatchType) -> str:
    mapping: dict[DestinationMatchType, str] = {
        "contains": "destination_account_contains",
        "starts_with": "destination_account_starts",
        "ends_with": "destination_account_ends",
        "is": "destination_account_is",
    }
    return mapping[match_type]


def _destination_matches(
    dest_name: str, needle: str, match_type: DestinationMatchType
) -> bool:
    haystack = dest_name.strip()
    n = needle.strip()
    if not n:
        return True
    if match_type == "is":
        return haystack == n
    haystack_lower = haystack.lower()
    n_lower = n.lower()
    if match_type == "contains":
        return n_lower in haystack_lower
    if match_type == "starts_with":
        return haystack_lower.startswith(n_lower)
    if match_type == "ends_with":
        return haystack_lower.endswith(n_lower)
    return False


def _destination_trigger_overlap(
    draft_type: DestinationMatchType,
    draft_val: str,
    trig_type: str,
    trig_val: str,
) -> bool:
    d = draft_val.strip().lower()
    t = trig_val.strip().lower()
    if not d or not t:
        return False
    if d == t:
        return True
    if d in t or t in d:
        if draft_type == "contains" or trig_type == "destination_account_contains":
            return True
        if draft_type == "is" and trig_type == "destination_account_is":
            return False
        if trig_type == "destination_account_is" and draft_type == "contains":
            return d == t or d in t or t in d
        if draft_type == "is" and trig_type == "destination_account_contains":
            return d in t or t in d
    if draft_type == "starts_with" and trig_type == "destination_account_starts":
        return d.startswith(t) or t.startswith(d)
    if draft_type == "ends_with" and trig_type == "destination_account_ends":
        return d.endswith(t) or t.endswith(d)
    return False


def _matches_draft(split: dict[str, Any], draft: RuleDraft) -> bool:
    if draft.transaction_type and split.get("type") != draft.transaction_type:
        return False
    desc_needle = draft.description_contains.strip().lower()
    dest_needle = (draft.destination_account or "").strip()
    desc_ok = True
    dest_ok = True
    if desc_needle:
        desc = (split.get("description") or "").lower()
        desc_ok = desc_needle in desc
    if dest_needle:
        dest_name = (split.get("destination_name") or "").strip()
        dest_ok = _destination_matches(
            dest_name, dest_needle, draft.destination_match_type
        )
    if desc_needle and dest_needle:
        return desc_ok and dest_ok
    return desc_ok and dest_ok


async def preview_rule_matches(
    client: FireflyClient,
    start: str,
    end: str,
    draft: RuleDraft,
) -> dict[str, int]:
    """Count splits matching draft triggers in date range."""
    validate_rule_triggers(draft)
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
    triggers: list[dict[str, Any]] = []
    if draft.description_contains.strip():
        triggers.append(
            {
                "type": "description_contains",
                "value": draft.description_contains.strip(),
                "active": True,
            }
        )
    if (draft.destination_account or "").strip():
        triggers.append(
            {
                "type": _firefly_destination_trigger_type(draft.destination_match_type),
                "value": draft.destination_account.strip(),
                "active": True,
            }
        )
    if draft.transaction_type:
        triggers.append(
            {
                "type": "transaction_type",
                "value": draft.transaction_type,
                "active": True,
            }
        )
    actions: list[dict[str, Any]] = [
        {"type": "set_category", "value": category_name, "active": True},
    ]
    if budget_name:
        actions.append({"type": "set_budget", "value": budget_name, "active": True})
    actions.append({"type": "add_tag", "value": _ai_tag_name(), "active": True})
    return {
        "rule_group_title": _rule_group_title(),
        "title": draft.title.strip(),
        "trigger": "store-journal",
        "active": True,
        "strict": len(triggers) > 1,
        "triggers": triggers,
        "actions": actions,
    }


async def find_duplicate_rules(
    client: FireflyClient, draft: RuleDraft
) -> list[dict[str, str]]:
    """Return existing rules whose title or description_contains overlaps the draft."""
    needle = draft.description_contains.strip().lower()
    dest_needle = (draft.destination_account or "").strip().lower()
    title_lower = draft.title.strip().lower()
    if not needle and not dest_needle:
        return []
    rules = await client.fetch_rules()
    conflicts: list[dict[str, str]] = []
    seen: set[str] = set()
    for rule in rules:
        rule_id = rule["id"]
        if rule_id in seen:
            continue
        title = (rule.get("title") or "").lower()
        overlap = False
        if title_lower and title == title_lower:
            overlap = True
        elif needle in title:
            overlap = True
        if not overlap:
            for trig in rule.get("triggers") or []:
                trig_type = trig.get("type") or ""
                val = (trig.get("value") or "").lower()
                if needle and trig_type == "description_contains" and (
                    needle in val or val in needle
                ):
                    overlap = True
                    break
                if dest_needle and trig_type.startswith("destination_account") and (
                    _destination_trigger_overlap(
                        draft.destination_match_type,
                        draft.destination_account or "",
                        trig_type,
                        trig.get("value") or "",
                    )
                ):
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
    validate_rule_triggers(draft)
    await validate_apply_ids(client, category_id, budget_id)
    conflicts = await find_duplicate_rules(client, draft)
    if conflicts:
        raise DuplicateRuleError(conflicts)
    category_name, budget_name = await _lookup_names(client, category_id, budget_id)
    body = build_firefly_rule_body(draft, category_name, budget_name)
    group_title = body.pop("rule_group_title")
    body["rule_group_id"] = await client.ensure_rule_group(group_title)
    created = await client.create_rule(body)
    await sidecar_db.log_audit(
        "categorize_rule_create",
        details_json=json.dumps(
            {
                "rule_id": created["id"],
                "title": created.get("title"),
                "description_contains": draft.description_contains,
                "destination_account": draft.destination_account,
                "destination_match_type": draft.destination_match_type,
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
