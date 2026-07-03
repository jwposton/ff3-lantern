"""OpenRouter client for structured JSON completions."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel

from categorization_models import CategorizationSuggestion, SUGGESTION_JSON_SCHEMA

logger = logging.getLogger(__name__)

_DEFAULT_BASE = "https://openrouter.ai/api/v1"
_MAX_RETRIES = 2

TModel = TypeVar("TModel", bound=BaseModel)


def _base_url() -> str:
    return os.environ.get("OPENROUTER_BASE_URL", _DEFAULT_BASE).rstrip("/")


async def complete_json_schema(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_content: str,
    schema_name: str,
    schema: dict[str, Any],
    response_model: type[TModel],
    max_tokens: int = 512,
    temperature: float = 0.2,
) -> TModel:
    """Call OpenRouter chat/completions with json_schema response format."""
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
            {"role": "user", "content": user_content},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": True,
                "schema": schema,
            },
        },
        "temperature": temperature,
        "max_tokens": max_tokens,
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
                "OpenRouter complete model=%s schema=%s prompt_tokens=%s completion_tokens=%s",
                model,
                schema_name,
                usage.get("prompt_tokens"),
                usage.get("completion_tokens"),
            )
            content = payload["choices"][0]["message"]["content"]
            return response_model.model_validate_json(content)
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
        except httpx.TransportError as exc:
            last_exc = exc
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(2**attempt)
                continue
            raise
    raise last_exc or RuntimeError("OpenRouter complete failed")


async def suggest_category(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_payload: dict[str, Any],
    schema: dict[str, Any] | None = None,
) -> CategorizationSuggestion:
    """Call OpenRouter for a categorization suggestion."""
    json_schema = schema or SUGGESTION_JSON_SCHEMA
    return await complete_json_schema(
        client,
        api_key=api_key,
        model=model,
        system_prompt=system_prompt,
        user_content=json.dumps(user_payload),
        schema_name="categorization_suggestion",
        schema=json_schema,
        response_model=CategorizationSuggestion,
    )


def build_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
