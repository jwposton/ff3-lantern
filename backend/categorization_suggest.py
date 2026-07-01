"""Orchestrate OpenRouter suggest with cache and concurrency cap."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx

import sidecar_db
from categorization_context import (
    SYSTEM_PROMPT,
    build_suggest_context,
    build_user_payload,
    fetch_allowlists,
    select_few_shot_examples,
)
from categorize_queue import build_pending_queue
from categorization_models import CategorizationSuggestion
from firefly_client import FireflyClient
from openrouter_client import build_http_client, suggest_category
from rule_draft_normalize import normalize_rule_draft

_SEMAPHORE = asyncio.Semaphore(3)
_PreloadedContext = tuple[
    dict[str, str],
    dict[str, str],
    list[dict[str, Any]],
]


def _default_model() -> str:
    return os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini").strip() or "openai/gpt-4o-mini"


def _suggestion_to_dict(suggestion: CategorizationSuggestion) -> dict[str, Any]:
    return suggestion.model_dump()


def _normalize_suggestion_rule(
    suggestion: CategorizationSuggestion,
    transaction: dict[str, Any],
) -> CategorizationSuggestion:
    if suggestion.rule is None:
        return suggestion
    normalized = normalize_rule_draft(
        suggestion.rule,
        description=str(transaction.get("description") or ""),
        destination_name=transaction.get("destination_name"),
        category_name=suggestion.category,
    )
    return suggestion.model_copy(update={"rule": normalized})


def _user_payload_from_preloaded(
    transaction: dict[str, Any],
    preloaded: _PreloadedContext,
) -> dict[str, Any]:
    cat_map, budget_map, flat_splits = preloaded
    few_shot = select_few_shot_examples(flat_splits, transaction)
    return build_user_payload(
        transaction,
        category_names=sorted(cat_map.keys()),
        budget_names=sorted(budget_map.keys()),
        few_shot=few_shot,
    )


async def suggest_for_journal(
    firefly: FireflyClient,
    http: httpx.AsyncClient,
    *,
    journal_id: str,
    transaction: dict[str, Any],
    start: str,
    end: str,
    model: str,
    api_key: str,
    refresh: bool = False,
    preloaded: _PreloadedContext | None = None,
) -> dict[str, Any]:
    if not refresh:
        cached = await sidecar_db.get_suggestion(journal_id, model)
        if cached:
            try:
                suggestion = CategorizationSuggestion.model_validate_json(cached)
                suggestion = _normalize_suggestion_rule(suggestion, transaction)
                if preloaded is not None:
                    cat_map, budget_map, _ = preloaded
                else:
                    cat_map, budget_map = await fetch_allowlists(firefly)
                suggestion.validate_against_allowlists(cat_map, budget_map)
            except (ValueError, json.JSONDecodeError):
                pass
            else:
                return {
                    "journal_id": journal_id,
                    "suggestion": _suggestion_to_dict(suggestion),
                    "cached": True,
                }

    if preloaded is not None:
        cat_map, budget_map, _ = preloaded
        user_payload = _user_payload_from_preloaded(transaction, preloaded)
    else:
        cat_map, budget_map, user_payload = await build_suggest_context(
            firefly, transaction, start, end
        )
    async with _SEMAPHORE:
        suggestion = await suggest_category(
            http,
            api_key=api_key,
            model=model,
            system_prompt=SYSTEM_PROMPT,
            user_payload=user_payload,
        )
    suggestion = _normalize_suggestion_rule(suggestion, transaction)
    try:
        suggestion.validate_against_allowlists(cat_map, budget_map)
    except ValueError as exc:
        return {
            "journal_id": journal_id,
            "suggestion": None,
            "cached": False,
            "error": str(exc),
        }

    payload = _suggestion_to_dict(suggestion)
    await sidecar_db.upsert_suggestion(journal_id, model, json.dumps(payload))
    return {
        "journal_id": journal_id,
        "suggestion": payload,
        "cached": False,
    }


async def suggest_batch(
    firefly: FireflyClient,
    *,
    start: str,
    end: str,
    journal_ids: list[str] | None = None,
    limit: int = 50,
    refresh: bool = False,
) -> list[dict[str, Any]]:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY not configured")
    model = _default_model()
    pending = await build_pending_queue(firefly, start, end, limit=limit)
    by_journal = {row["journal_id"]: row for row in pending}
    if journal_ids:
        targets = [jid for jid in journal_ids if jid in by_journal]
    else:
        targets = [row["journal_id"] for row in pending]

    cat_map, budget_map = await fetch_allowlists(firefly)
    flat_splits = await firefly.fetch_splits(start, end)
    preloaded: _PreloadedContext = (cat_map, budget_map, flat_splits)

    async with build_http_client() as http:

        async def _suggest_one(journal_id: str) -> dict[str, Any]:
            transaction = by_journal[journal_id]
            try:
                return await suggest_for_journal(
                    firefly,
                    http,
                    journal_id=journal_id,
                    transaction=transaction,
                    start=start,
                    end=end,
                    model=model,
                    api_key=api_key,
                    refresh=refresh,
                    preloaded=preloaded,
                )
            except Exception as exc:
                return {
                    "journal_id": journal_id,
                    "suggestion": None,
                    "cached": False,
                    "error": str(exc),
                }

        tasks = [_suggest_one(journal_id) for journal_id in targets]
        return list(await asyncio.gather(*tasks))
