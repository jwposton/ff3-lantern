"""OpenRouter client for structured categorization suggestions."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import httpx

from categorization_models import CategorizationSuggestion, SUGGESTION_JSON_SCHEMA

logger = logging.getLogger(__name__)

_DEFAULT_BASE = "https://openrouter.ai/api/v1"
_MAX_RETRIES = 2


def _base_url() -> str:
    return os.environ.get("OPENROUTER_BASE_URL", _DEFAULT_BASE).rstrip("/")


async def suggest_category(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_payload: dict[str, Any],
    schema: dict[str, Any] | None = None,
) -> CategorizationSuggestion:
    """Call OpenRouter chat/completions with json_schema response format."""
    json_schema = schema or SUGGESTION_JSON_SCHEMA
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ffanalytics.harvestwind.org",
        "X-Title": "FF3Analytics",
    }
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "categorization_suggestion",
                "strict": True,
                "schema": json_schema,
            },
        },
        "temperature": 0.2,
        "max_tokens": 512,
    }
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            response = await client.post(
                f"{_base_url()}/chat/completions",
                headers=headers,
                json=body,
                timeout=30.0,
            )
            if response.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(
                    f"retryable {response.status_code}",
                    request=response.request,
                    response=response,
                )
            response.raise_for_status()
            payload = response.json()
            usage = payload.get("usage") or {}
            logger.info(
                "OpenRouter suggest model=%s prompt_tokens=%s completion_tokens=%s",
                model,
                usage.get("prompt_tokens"),
                usage.get("completion_tokens"),
            )
            content = payload["choices"][0]["message"]["content"]
            return CategorizationSuggestion.model_validate_json(content)
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            if attempt < _MAX_RETRIES and exc.response.status_code in (
                429,
                500,
                502,
                503,
                504,
            ):
                await asyncio.sleep(2**attempt)
                continue
            raise
        except Exception as exc:
            last_exc = exc
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(2**attempt)
                continue
            raise
    raise last_exc or RuntimeError("OpenRouter suggest failed")


def build_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
