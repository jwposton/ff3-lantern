"""Orchestrate OpenRouter suggest with cache and concurrency cap."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx

import sidecar_db
from categorization_context import SYSTEM_PROMPT, build_suggest_context, fetch_allowlists
from categorize_queue import build_pending_queue
from categorization_models import CategorizationSuggestion
from firefly_client import FireflyClient
from openrouter_client import build_http_client, suggest_category

_SEMAPHORE = asyncio.Semaphore(3)


def _default_model() -> str:
    return os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini").strip() or "openai/gpt-4o-mini"


def _suggestion_to_dict(suggestion: CategorizationSuggestion) -> dict[str, Any]:
    return suggestion.model_dump()


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
) -> dict[str, Any]:
    if not refresh:
        cached = await sidecar_db.get_suggestion(journal_id, model)
        if cached:
            try:
                suggestion = CategorizationSuggestion.model_validate_json(cached)
                cat_map, budget_map, _ = await fetch_allowlists(firefly)
                suggestion.validate_against_allowlists(cat_map, budget_map)
            except (ValueError, json.JSONDecodeError):
                pass
            else:
                return {
                    "journal_id": journal_id,
                    "suggestion": _suggestion_to_dict(suggestion),
                    "cached": True,
                }

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

    results: list[dict[str, Any]] = []
    async with build_http_client() as http:
        for journal_id in targets:
            transaction = by_journal[journal_id]
            try:
                result = await suggest_for_journal(
                    firefly,
                    http,
                    journal_id=journal_id,
                    transaction=transaction,
                    start=start,
                    end=end,
                    model=model,
                    api_key=api_key,
                    refresh=refresh,
                )
            except Exception as exc:
                result = {
                    "journal_id": journal_id,
                    "suggestion": None,
                    "cached": False,
                    "error": str(exc),
                }
            results.append(result)
    return results
