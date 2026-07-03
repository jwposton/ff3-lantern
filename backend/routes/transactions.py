"""Transaction Explorer API — meta, mass edit, and AI filter parse."""

from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from firefly_client import FireflyClient
from mass_edit_apply import apply_mass_edit_batch
from openrouter_client import build_http_client
from transaction_filter_parse import filter_parse_model, parse_filter_query

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


class MassEditTarget(BaseModel):
    journal_id: str
    transaction_journal_id: str


class MassEditApplyRequest(BaseModel):
    targets: list[MassEditTarget] = Field(..., min_length=1, max_length=500)
    category_id: str | None = None
    budget_id: str | None = None
    clear_budget: bool = False


class ParseFilterRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    start: str
    end: str


@router.get("/transactions/meta")
async def get_transactions_meta(
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
        "categories": categories,
        "budgets": budgets,
        "openrouter_configured": _is_set("OPENROUTER_API_KEY"),
        "default_model": default_model or "openai/gpt-4o-mini",
        "filter_parse_model": filter_parse_model(),
    }


@router.post("/transactions/parse-filter")
async def post_transactions_parse_filter(
    body: ParseFilterRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    if not _is_set("OPENROUTER_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="OPENROUTER_API_KEY is not configured; filter parse is unavailable.",
        )
    _parse_date_range(body.start, body.end)
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    try:
        async with build_http_client() as http:
            result = await parse_filter_query(
                client,
                http,
                query=body.query,
                start=body.start,
                end=body.end,
                api_key=api_key,
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Filter parse failed: {exc}",
        ) from exc
    return {"data": result}


@router.post("/transactions/mass-edit")
async def post_transactions_mass_edit(
    body: MassEditApplyRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    if body.category_id is None and body.budget_id is None and not body.clear_budget:
        raise HTTPException(
            status_code=422,
            detail="Set category_id, budget_id, and/or clear_budget.",
        )
    try:
        result = await apply_mass_edit_batch(
            client,
            [t.model_dump() for t in body.targets],
            category_id=body.category_id,
            budget_id=body.budget_id,
            clear_budget=body.clear_budget,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Mass edit failed: {exc}",
        ) from exc
    if result["failed"] > 0:
        return JSONResponse(status_code=207, content=result)
    return result
