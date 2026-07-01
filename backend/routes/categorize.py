"""Categorize API — pending queue, meta, suggest, apply."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from categorize_queue import build_grouped_pending_queue, build_pending_queue
from categorization_apply import apply_category, apply_ignore, validate_apply_ids
from categorization_models import RuleDraft
from categorization_rules import (
    DuplicateRuleError,
    create_approved_rule,
    preview_rule_matches,
    trigger_backfill,
)
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
    group_by_fingerprint: bool = Query(False),
    client: FireflyClient = Depends(get_firefly_client),
):
    _parse_date_range(start, end)
    try:
        if group_by_fingerprint:
            groups = await build_grouped_pending_queue(
                client, start, end, limit=limit
            )
        else:
            data = await build_pending_queue(client, start, end, limit=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly III transactions: {exc}",
        ) from exc
    if group_by_fingerprint:
        row_count = sum(g["count"] for g in groups)
        return {
            "data": groups,
            "meta": {
                "count": row_count,
                "group_count": len(groups),
                "grouped": True,
                "start": start,
                "end": end,
                "limit": limit,
            },
        }
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


class ApplyRequest(BaseModel):
    category_id: str
    transaction_journal_id: str
    budget_id: str | None = None


class IgnoreRequest(BaseModel):
    transaction_journal_id: str


@router.post("/categorize/{journal_id}/apply")
async def post_categorize_apply(
    journal_id: str,
    body: ApplyRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    try:
        await validate_apply_ids(client, body.category_id, body.budget_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        await apply_category(
            client,
            journal_id,
            body.transaction_journal_id,
            body.category_id,
            body.budget_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Firefly apply failed: {exc}",
        ) from exc
    return {"ok": True, "journal_id": journal_id}


@router.post("/categorize/{journal_id}/ignore")
async def post_categorize_ignore(
    journal_id: str,
    body: IgnoreRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    try:
        await apply_ignore(client, journal_id, body.transaction_journal_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Firefly ignore failed: {exc}",
        ) from exc
    return {"ok": True, "journal_id": journal_id}


class RulePreviewRequest(BaseModel):
    start: str
    end: str
    rule: RuleDraft


class RuleCreateRequest(BaseModel):
    start: str
    end: str
    rule: RuleDraft
    category_id: str
    budget_id: str | None = None


class RuleTriggerRequest(BaseModel):
    start: str
    end: str


@router.post("/categorize/rules/preview")
async def post_categorize_rules_preview(
    body: RulePreviewRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    _parse_date_range(body.start, body.end)
    try:
        counts = await preview_rule_matches(
            client, body.start, body.end, body.rule
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Rule preview failed: {exc}",
        ) from exc
    return {"data": counts}


@router.post("/categorize/rules")
async def post_categorize_rules_create(
    body: RuleCreateRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    _parse_date_range(body.start, body.end)
    try:
        created = await create_approved_rule(
            client,
            body.rule,
            body.category_id,
            body.budget_id,
        )
    except DuplicateRuleError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": "Duplicate rule", "existing_rules": exc.conflicts},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Rule create failed: {exc}",
        ) from exc
    return {"data": {"rule_id": created["id"], "title": created.get("title")}}


@router.post("/categorize/rules/{rule_id}/trigger")
async def post_categorize_rules_trigger(
    rule_id: str,
    body: RuleTriggerRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    _parse_date_range(body.start, body.end)
    try:
        await trigger_backfill(client, rule_id, body.start, body.end)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Rule trigger failed: {exc}",
        ) from exc
    return {"ok": True, "rule_id": rule_id}
