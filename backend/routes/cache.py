"""Cache control endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

import firefly_reference_cache
from auth.dependencies import require_permission

router = APIRouter()


@router.post("/cache/clear")
async def clear_reference_cache(
    _: int = Depends(require_permission("ops_cache", "write")),
) -> dict[str, bool]:
    firefly_reference_cache.clear()
    return {"ok": True}
