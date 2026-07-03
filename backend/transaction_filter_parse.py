"""Parse natural language into Transaction Explorer filter JSON."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from firefly_client import FireflyClient
from openrouter_client import build_http_client, complete_json_schema
from transaction_filter_models import (
    FILTER_PARSE_JSON_SCHEMA,
    ExplorerFilterDraft,
)
from transaction_filter_normalize import (
    normalize_explorer_filter_draft,
    try_deterministic_search_query,
)

FILTER_PARSE_SYSTEM_PROMPT = """You convert plain-language transaction search requests into structured filter JSON for FF3Analytics Transaction Explorer.

Rules:
- Output ONLY fields relevant to the user's request; leave others at defaults (empty string, null, false, empty array).
- category, budget, and account values MUST be exact strings from the provided allowlists when used.
- Do not invent category, budget, or account names.
- Date range is already set by the app (start/end in the user payload); do not add date fields.
- search: use for merchant names, keywords, and broad "find X" requests (e.g. "spotify", "spotify charges", "all transactions with spotify" -> search: "spotify"). For OR queries use one search string with " or " between terms (e.g. "Patreon or CFBDB"). This matches the app's general search box across all fields.
- Do NOT put broad merchant/keyword text in description_contains or destination_account.
- description_contains: ONLY when the user explicitly asks to filter by description, payee, or memo text (e.g. "description contains AMZN").
- destination_account: ONLY when the user explicitly filters by payee/destination account name as a field.
- uncategorized_only=true when the user asks for uncategorized or missing category rows.
- amount_exact is a decimal string like "42.50" when the user specifies an exact amount. amount_min and amount_max are decimal strings for inclusive ranges (e.g. "over 500" -> amount_min "500.00"; "under 20" -> amount_max "20.00"; "between 50 and 100" or "amount between 50 and 100" or "value between 50 and 100" -> amount_min and amount_max). Phrases like "amount", "value", "between X and Y" refer to transaction dollar amounts — never put those words in search. Combine amount filters with search only for real merchant/category keywords (amount AND any search term must match).
- rationale: one short sentence explaining the filter choices.
"""


def filter_parse_model() -> str:
    override = os.environ.get("OPENROUTER_FILTER_MODEL", "").strip()
    if override:
        return override
    return os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini").strip() or "openai/gpt-4o-mini"


async def build_filter_parse_context(client: FireflyClient) -> dict[str, Any]:
    categories = await client.fetch_categories()
    budgets = await client.fetch_budgets()
    accounts = await client.fetch_accounts()
    source_accounts = sorted(
        {
            acct["name"]
            for acct in accounts.values()
            if acct.get("name") and acct.get("type") == "Asset account"
        }
    )
    return {
        "categories": [c["name"] for c in categories if c.get("name")],
        "budgets": [b["name"] for b in budgets if b.get("name")],
        "source_accounts": source_accounts,
    }


def draft_to_filter_state(draft: ExplorerFilterDraft) -> dict[str, Any]:
    return {
        "categories": draft.categories,
        "budget": draft.budget,
        "account": draft.account,
        "search": draft.search,
        "description_contains": draft.description_contains,
        "destination_account": draft.destination_account or "",
        "destination_match_type": draft.destination_match_type,
        "transaction_type": draft.transaction_type,
        "amount_exact": draft.amount_exact or "",
        "amount_min": draft.amount_min or "",
        "amount_max": draft.amount_max or "",
        "uncategorized_only": draft.uncategorized_only,
    }


async def parse_filter_query(
    client: FireflyClient,
    http: httpx.AsyncClient,
    *,
    query: str,
    start: str,
    end: str,
    api_key: str,
    model: str | None = None,
) -> dict[str, Any]:
    """Return filter state dict and rationale from natural language."""
    trimmed = query.strip()
    if not trimmed:
        raise ValueError("query must not be empty")

    deterministic = try_deterministic_search_query(trimmed)
    if deterministic is not None:
        return {
            "filter": draft_to_filter_state(deterministic),
            "rationale": deterministic.rationale,
        }

    context = await build_filter_parse_context(client)
    user_payload = {
        "query": trimmed,
        "date_range": {"start": start, "end": end},
        "allowlists": context,
    }
    draft = await complete_json_schema(
        http,
        api_key=api_key,
        model=model or filter_parse_model(),
        system_prompt=FILTER_PARSE_SYSTEM_PROMPT,
        user_content=json.dumps(user_payload),
        schema_name="explorer_filter",
        schema=FILTER_PARSE_JSON_SCHEMA,
        response_model=ExplorerFilterDraft,
        max_tokens=384,
        temperature=0.1,
    )
    draft = normalize_explorer_filter_draft(draft, trimmed)
    return {
        "filter": draft_to_filter_state(draft),
        "rationale": draft.rationale,
    }
