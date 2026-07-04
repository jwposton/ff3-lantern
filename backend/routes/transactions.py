"""Transaction Explorer API — meta and mass edit."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from firefly_client import FireflyClient
from mass_edit_apply import apply_mass_edit_batch

router = APIRouter()


def get_firefly_client() -> FireflyClient:
    return FireflyClient()


class MassEditTarget(BaseModel):
    journal_id: str
    transaction_journal_id: str


class MassEditApplyRequest(BaseModel):
    targets: list[MassEditTarget] = Field(..., min_length=1, max_length=500)
    category_id: str | None = None
    budget_id: str | None = None
    clear_budget: bool = False


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
    return {
        "categories": categories,
        "budgets": budgets,
    }


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
