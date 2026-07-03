"""Payment worksheet REST API (PAY-02, PAY-03)."""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException

from firefly_client import FireflyClient

router = APIRouter()


def payment_worksheet_enabled() -> bool:
    return (
        os.environ.get("FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED", "").strip().lower()
        in ("1", "true", "yes")
    )


def require_payment_worksheet() -> None:
    if not payment_worksheet_enabled():
        raise HTTPException(
            status_code=404, detail="Payment worksheet is not enabled."
        )


def get_firefly_client() -> FireflyClient:
    return FireflyClient()


@router.get("/payment-run")
async def get_payment_run_stub(_: None = Depends(require_payment_worksheet)):
    return {"ok": True}
