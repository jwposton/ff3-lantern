"""Payment worksheet REST API (PAY-02, PAY-03)."""

from __future__ import annotations

import os
import uuid

import firefly_reference_cache
import sidecar_db
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from firefly_client import FireflyClient
from payment_worksheet_profiles import (
    current_month_key,
    effective_profile_from_notes,
    is_credit_card_asset,
    merge_payment_worksheet_profile,
    parse_payment_worksheet_from_notes,
    patch_worksheet_refresh_profile,
    write_payment_worksheet_profile,
)
from payment_worksheet_compute import build_worksheet_envelope
from payment_worksheet_refresh import run_refresh

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


class PaymentWorksheetBody(BaseModel):
    included: bool | None = None
    worksheet_section: str | None = None
    funding_bucket_key: str | None = None
    credit_limit: str | None = None
    default_planned_payment: str | None = None
    sort_order: int | None = None


def _row_from_db(row: dict) -> FundingBucketRow:
    return FundingBucketRow(
        id=row["id"],
        label=row["label"],
        sort_order=row["sort_order"],
        firefly_account_ids=row["firefly_account_ids"],
    )


@router.get("/payment-run")
async def get_payment_worksheet(
    month: str | None = None,
    _: None = Depends(require_payment_worksheet),
):
    target_month = month or current_month_key()
    if len(target_month) != 7 or target_month[4] != "-":
        raise HTTPException(status_code=422, detail="month must be YYYY-MM.")
    return await build_worksheet_envelope(target_month)


@router.post("/payment-run/refresh")
async def refresh_payment_worksheet(
    month: str | None = None,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    target_month = month or current_month_key()
    if len(target_month) != 7 or target_month[4] != "-":
        raise HTTPException(status_code=422, detail="month must be YYYY-MM.")
    return await run_refresh(client, target_month)


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


@router.put("/payment-run/accounts/{account_id}/worksheet")
async def update_account_worksheet(
    account_id: str,
    body: PaymentWorksheetBody,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    account = await client.fetch_account(account_id)
    attrs = account.get("attributes", {})
    if not is_credit_card_asset(attrs):
        raise HTTPException(
            status_code=422, detail="Account must be an asset credit card."
        )
    existing_notes = attrs.get("notes") or ""
    existing_profile = parse_payment_worksheet_from_notes(existing_notes)
    updates = body.model_dump(exclude_unset=True)
    merged = merge_payment_worksheet_profile(existing_profile, updates)
    await write_payment_worksheet_profile(client, account_id, merged)
    await patch_worksheet_refresh_profile(current_month_key(), account_id, merged)
    firefly_reference_cache.clear()
    return {"account_id": account_id, "profile": merged}
