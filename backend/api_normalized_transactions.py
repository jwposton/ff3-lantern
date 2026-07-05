"""GET /api/normalized_transactions — date-scoped OMNI feed."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from firefly_client import FireflyClient, firefly_public_base_url
from transaction_normalization import normalize_transactions

router = APIRouter()


def get_firefly_client() -> FireflyClient:
    return FireflyClient()


@router.get("/normalized_transactions")
async def get_normalized_transactions(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    client: FireflyClient = Depends(get_firefly_client),
):
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
    try:
        flat = await client.fetch_splits(start, end)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly III transactions: {exc}",
        ) from exc
    try:
        data = normalize_transactions(flat)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Normalization failed: {exc}"
        ) from exc
    return {
        "data": data,
        "firefly_base_url": firefly_public_base_url(),
        "meta": {"count": len(data), "start": start, "end": end},
    }
