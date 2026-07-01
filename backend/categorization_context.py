"""Assemble suggest context: allowlists, few-shot examples, rule summaries."""

from __future__ import annotations

from typing import Any

from firefly_client import FireflyClient
from transaction_normalization import is_uncategorized_for_queue

SYSTEM_PROMPT = """You categorize personal finance transactions for Firefly III.
Use ONLY category and budget names from the allowed lists in the user message.
Never invent category or budget names.
Recommend "rule" for recurring merchants with stable description patterns.
Recommend "direct" for one-off or ambiguous transactions.
When recommendation is "rule", include a rule object:
- title: short human label for the Firefly rules list (e.g. "Amazon → Shopping", "Netflix subscription"). NOT the raw bank description, NOT the trigger needle, NOT your rationale.
- description_contains: substring from the bank description when it has a stable merchant token (e.g. "AMZN MKTP", "NETFLIX"). Use empty string when the description is generic (e.g. "POS PURCHASE") and destination_account is better.
- destination_account: Firefly payee / destination account name when it identifies the merchant (from transaction.destination_name). Use null when description_contains is sufficient.
- destination_match_type: how to match destination_account — "contains", "starts_with", "ends_with", or "is" (exact). Default "is" when destination_account is set.
- transaction_type: "withdrawal" or "deposit" when the pattern is type-specific; null otherwise.
At least one of description_contains or destination_account must be non-empty.
Output JSON matching the required schema."""


def _name_map(items: list[dict[str, Any]]) -> dict[str, str]:
    return {item["name"]: item["id"] for item in items if item.get("name")}


async def fetch_allowlists(
    client: FireflyClient,
) -> tuple[dict[str, str], dict[str, str]]:
    categories = await client.fetch_categories()
    budgets = await client.fetch_budgets()
    return _name_map(categories), _name_map(budgets)


def _is_categorized_split(flat: dict[str, Any]) -> bool:
    cat = flat.get("category_name") or flat.get("category")
    return bool(cat and str(cat).strip())


def select_few_shot_examples(
    flat_splits: list[dict[str, Any]],
    target: dict[str, Any],
    *,
    max_examples: int = 5,
) -> list[dict[str, Any]]:
    """Pick categorized rows similar by destination or description prefix."""
    target_desc = (target.get("description") or "").upper()
    target_dest = target.get("destination_name") or ""
    candidates: list[tuple[int, dict[str, Any]]] = []
    for row in flat_splits:
        if not _is_categorized_split(row) or is_uncategorized_for_queue(row):
            continue
        if row.get("journal_id") == target.get("journal_id"):
            continue
        score = 0
        desc = (row.get("description") or "").upper()
        if target_dest and row.get("destination_name") == target_dest:
            score += 3
        if target_desc and desc and (
            desc.startswith(target_desc[:8]) or target_desc.startswith(desc[:8])
        ):
            score += 2
        if score > 0:
            candidates.append(
                (
                    score,
                    {
                        "description": row.get("description"),
                        "destination_name": row.get("destination_name"),
                        "type": row.get("type"),
                        "category": row.get("category_name") or row.get("category"),
                        "budget": row.get("budget_name") or row.get("budget"),
                    },
                )
            )
    candidates.sort(key=lambda x: x[0], reverse=True)
    return [c[1] for c in candidates[:max_examples]]


def build_user_payload(
    transaction: dict[str, Any],
    *,
    category_names: list[str],
    budget_names: list[str],
    few_shot: list[dict[str, Any]],
) -> dict[str, Any]:
    """Single-transaction JSON payload — no notes or account numbers."""
    return {
        "allowed_categories": category_names,
        "allowed_budgets": budget_names,
        "few_shot_examples": few_shot,
        "transaction": {
            "journal_id": transaction.get("journal_id"),
            "description": transaction.get("description"),
            "amount": transaction.get("amount"),
            "type": transaction.get("type"),
            "destination_name": transaction.get("destination_name"),
            "source_name": transaction.get("source_name"),
            "date": transaction.get("date"),
        },
    }


async def build_suggest_context(
    client: FireflyClient,
    transaction: dict[str, Any],
    start: str,
    end: str,
) -> tuple[dict[str, str], dict[str, str], dict[str, Any]]:
    cat_map, budget_map = await fetch_allowlists(client)
    flat = await client.fetch_splits(start, end)
    few_shot = select_few_shot_examples(flat, transaction)
    payload = build_user_payload(
        transaction,
        category_names=sorted(cat_map.keys()),
        budget_names=sorted(budget_map.keys()),
        few_shot=few_shot,
    )
    return cat_map, budget_map, payload
