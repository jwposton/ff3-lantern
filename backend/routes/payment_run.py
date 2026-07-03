"""Payment worksheet REST API (PAY-02, PAY-03)."""

from __future__ import annotations

import os
import uuid

import sidecar_db
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

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


class FundingBucketBody(BaseModel):
    id: str | None = None
    label: str
    sort_order: int = 0
    firefly_account_ids: list[str] = []

    @field_validator("label")
    @classmethod
    def label_non_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("label must be non-empty")
        return stripped

    @field_validator("firefly_account_ids")
    @classmethod
    def firefly_account_ids_non_empty_strings(cls, value: list[str]) -> list[str]:
        for account_id in value:
            if not isinstance(account_id, str) or not account_id.strip():
                raise ValueError("firefly_account_ids must be non-empty strings")
        return value


class FundingBucketRow(BaseModel):
    id: str
    label: str
    sort_order: int
    firefly_account_ids: list[str]


def _row_from_db(row: dict) -> FundingBucketRow:
    return FundingBucketRow(
        id=row["id"],
        label=row["label"],
        sort_order=row["sort_order"],
        firefly_account_ids=row["firefly_account_ids"],
    )


@router.get("/payment-run")
async def get_payment_run_stub(_: None = Depends(require_payment_worksheet)):
    return {"ok": True}


@router.get("/payment-run/buckets")
async def list_buckets(_: None = Depends(require_payment_worksheet)):
    rows = await sidecar_db.list_funding_buckets()
    return {"data": [_row_from_db(row).model_dump() for row in rows]}


@router.post("/payment-run/buckets")
async def create_bucket(
    body: FundingBucketBody,
    _: None = Depends(require_payment_worksheet),
):
    bucket_id = (body.id or "").strip() or uuid.uuid4().hex
    await sidecar_db.upsert_funding_bucket(
        id=bucket_id,
        label=body.label,
        sort_order=body.sort_order,
        firefly_account_ids=body.firefly_account_ids,
    )
    row = await sidecar_db.get_funding_bucket(bucket_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create bucket.")
    return _row_from_db(row).model_dump()


@router.put("/payment-run/buckets/{bucket_id}")
async def update_bucket(
    bucket_id: str,
    body: FundingBucketBody,
    _: None = Depends(require_payment_worksheet),
):
    existing = await sidecar_db.get_funding_bucket(bucket_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Bucket not found.")
    await sidecar_db.upsert_funding_bucket(
        id=bucket_id,
        label=body.label,
        sort_order=body.sort_order,
        firefly_account_ids=body.firefly_account_ids,
    )
    row = await sidecar_db.get_funding_bucket(bucket_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to update bucket.")
    return _row_from_db(row).model_dump()


@router.delete("/payment-run/buckets/{bucket_id}")
async def delete_bucket(
    bucket_id: str,
    _: None = Depends(require_payment_worksheet),
):
    existing = await sidecar_db.get_funding_bucket(bucket_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Bucket not found.")
    await sidecar_db.delete_funding_bucket(bucket_id)
    return {"ok": True}
