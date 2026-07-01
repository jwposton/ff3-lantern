"""Cache control endpoints."""

from __future__ import annotations

from fastapi import APIRouter

import firefly_reference_cache

router = APIRouter()


@router.post("/cache/clear")
async def clear_reference_cache() -> dict[str, bool]:
    firefly_reference_cache.clear()
    return {"ok": True}
