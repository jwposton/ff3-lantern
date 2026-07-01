"""Categorize API — pending queue, meta, suggest, apply."""

from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from categorize_queue import build_pending_queue
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
