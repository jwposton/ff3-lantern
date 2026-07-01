"""Categorize API — pending queue, meta, suggest, apply."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from categorize_queue import build_pending_queue
from categorization_suggest import suggest_batch
from firefly_client import FireflyClient

router = APIRouter()


def get_firefly_client() -> FireflyClient:
    return FireflyClient()


def _is_set(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def _parse_date_range(start: str, end: str) -> tuple[str, str]:
    try:
        start_dt = datetime.strptime(start, "%Y-%m-%d").date()
        end_dt = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(
            status_code=422, detail="Dates must be in YYYY-MM-DD format."
        ) from None
    if start_dt > end_dt:
        raise HTTPException(status_code=422, detail="start must be on or before end.")
    if (end_dt - start_dt).days > 1095:
        raise HTTPException(
            status_code=422, detail="Date range cannot exceed 3 years."
        )
    return start, end


@router.get("/categorize/pending")
async def get_categorize_pending(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    limit: int = Query(50, ge=1, le=100),
    client: FireflyClient = Depends(get_firefly_client),
):
    _parse_date_range(start, end)
    try:
        data = await build_pending_queue(client, start, end, limit=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly III transactions: {exc}",
        ) from exc
    return {
        "data": data,
        "meta": {"count": len(data), "start": start, "end": end, "limit": limit},
    }


@router.get("/categorize/meta")
async def get_categorize_meta(
    client: FireflyClient = Depends(get_firefly_client),
):
    try:
        categories = await client.fetch_categories()
        budgets = await client.fetch_budgets()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly metadata: {exc}",
        ) from exc
    default_model = os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini").strip()
    return {
        "openrouter_configured": _is_set("OPENROUTER_API_KEY"),
        "categories": categories,
        "budgets": budgets,
        "default_model": default_model or "openai/gpt-4o-mini",
    }


class SuggestRequest(BaseModel):
    journal_ids: list[str] | None = None
    start: str | None = None
    end: str | None = None
    limit: int = Field(default=50, ge=1, le=100)
    refresh: bool = False


@router.post("/categorize/suggest")
async def post_categorize_suggest(
    body: SuggestRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    if not _is_set("OPENROUTER_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="OPENROUTER_API_KEY is not configured; suggest is unavailable.",
        )
    if not body.start or not body.end:
        raise HTTPException(
            status_code=422,
            detail="start and end dates are required for suggest.",
        )
    _parse_date_range(body.start, body.end)
    try:
        data = await suggest_batch(
            client,
            start=body.start,
            end=body.end,
            journal_ids=body.journal_ids,
            limit=body.limit,
            refresh=body.refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Suggest failed: {exc}",
        ) from exc
    return {"data": data}
