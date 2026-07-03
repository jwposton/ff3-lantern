"""Payment worksheet REST API (PAY-02, PAY-03)."""

from __future__ import annotations

import json
import os
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

import firefly_reference_cache
import sidecar_db
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from firefly_client import FireflyClient
from payment_worksheet_profiles import (
    current_month_key,
    effective_profile_from_notes,
    is_credit_card_asset,
    is_funding_bucket_eligible_summary,
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


async def _validate_bucket_firefly_account_ids(
    client: FireflyClient, account_ids: list[str]
) -> None:
    if not account_ids:
        return
    accounts = await client.fetch_accounts()
    for account_id in account_ids:
        summary = accounts.get(account_id)
        if summary is None:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown Firefly account id: {account_id}",
            )
        if not is_funding_bucket_eligible_summary(summary):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Account {account_id} cannot fund a bucket; "
                    "use checking or savings asset accounts only."
                ),
            )


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
    apr_percent: str | None = None
    payment_due_day: str | None = None
    sort_order: int | None = None


_PROFILE_FIELD_KEYS = frozenset(
    {
        "included",
        "worksheet_section",
        "funding_bucket_key",
        "credit_limit",
        "default_planned_payment",
        "apr_percent",
        "payment_due_day",
        "sort_order",
    }
)


def _validate_due_day(value: str) -> str:
    try:
        day = int(str(value).strip())
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid payment_due_day") from None
    if day < 1 or day > 31:
        raise HTTPException(
            status_code=422, detail="payment_due_day must be between 1 and 31."
        )
    return str(day)


class BucketBalanceBody(BaseModel):
    user_balance: str
    reset_to_reported: bool = False


class RowStateBody(BaseModel):
    planned_amount: str | None = None
    paid_at: str | None = None
    clear_paid: bool = False


def _validate_month(month: str) -> str:
    if len(month) != 7 or month[4] != "-":
        raise HTTPException(status_code=422, detail="month must be YYYY-MM.")
    return month


def _validate_amount(value: str, field_name: str) -> str:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail=f"invalid {field_name}") from None
    return f"{amount.quantize(Decimal('0.01'))}"


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
    target_month = _validate_month(month or current_month_key())
    envelope = await build_worksheet_envelope(target_month)
    base = os.environ.get("FIREFLY_BASE_URL", "").strip().rstrip("/")
    if base:
        envelope["firefly_base_url"] = base
    return envelope


@router.put("/payment-run/buckets/{bucket_id}/balance")
async def update_bucket_balance(
    bucket_id: str,
    body: BucketBalanceBody,
    month: str | None = None,
    _: None = Depends(require_payment_worksheet),
):
    target_month = _validate_month(month or current_month_key())
    existing_bucket = await sidecar_db.get_funding_bucket(bucket_id)
    if existing_bucket is None:
        raise HTTPException(status_code=404, detail="Bucket not found.")

    if body.reset_to_reported:
        refresh_row = await sidecar_db.get_worksheet_refresh(target_month)
        if refresh_row is None:
            user_balance = "0.00"
        else:
            balances = json.loads(refresh_row["balances_json"])
            reported = (
                balances.get("buckets", {})
                .get(bucket_id, {})
                .get("reported_balance", "0.00")
            )
            user_balance = str(reported)
        user_balance_override = 0
    else:
        user_balance = _validate_amount(body.user_balance, "user_balance")
        user_balance_override = 1

    await sidecar_db.upsert_bucket_balance(
        bucket_key=bucket_id,
        month=target_month,
        user_balance=user_balance,
        user_balance_override=user_balance_override,
    )
    return {
        "bucket_key": bucket_id,
        "month": target_month,
        "user_balance": user_balance,
        "user_balance_override": bool(user_balance_override),
    }


@router.put("/payment-run/rows/{row_key}")
async def update_row_state(
    row_key: str,
    body: RowStateBody,
    month: str | None = None,
    _: None = Depends(require_payment_worksheet),
):
    target_month = _validate_month(month or current_month_key())
    existing_rows = await sidecar_db.get_worksheet_state_for_month(target_month)
    existing = next((row for row in existing_rows if row["row_key"] == row_key), None)

    planned_amount = existing["planned_amount"] if existing else "0.00"
    planned_override = (
        int(existing["planned_amount_override"]) if existing else 0
    )
    paid_at = existing["paid_at"] if existing else None

    updates = body.model_dump(exclude_unset=True)
    if "planned_amount" in updates and updates["planned_amount"] is not None:
        planned_amount = _validate_amount(updates["planned_amount"], "planned_amount")
        planned_override = 1

    if body.clear_paid:
        paid_at = None
    elif "paid_at" in updates:
        paid_at = updates["paid_at"]

    await sidecar_db.upsert_worksheet_state_row(
        row_key=row_key,
        row_type="credit_card",
        month=target_month,
        planned_amount=planned_amount,
        planned_amount_override=planned_override,
        paid_at=paid_at,
    )
    return {
        "row_key": row_key,
        "month": target_month,
        "planned_amount": planned_amount,
        "paid_at": paid_at,
    }


@router.post("/payment-run/refresh")
async def refresh_payment_worksheet(
    month: str | None = None,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    target_month = month or current_month_key()
    _validate_month(target_month)
    return await run_refresh(client, target_month)


@router.get("/payment-run/buckets")
async def list_buckets(_: None = Depends(require_payment_worksheet)):
    rows = await sidecar_db.list_funding_buckets()
    return {"data": [_row_from_db(row).model_dump() for row in rows]}


@router.post("/payment-run/buckets")
async def create_bucket(
    body: FundingBucketBody,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    bucket_id = (body.id or "").strip() or uuid.uuid4().hex
    await _validate_bucket_firefly_account_ids(client, body.firefly_account_ids)
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
    client: FireflyClient = Depends(get_firefly_client),
):
    existing = await sidecar_db.get_funding_bucket(bucket_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Bucket not found.")
    await _validate_bucket_firefly_account_ids(client, body.firefly_account_ids)
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
    month: str | None = None,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    target_month = _validate_month(month or current_month_key())
    account = await client.fetch_account(account_id)
    attrs = account.get("attributes", {})
    if not is_credit_card_asset(attrs):
        raise HTTPException(
            status_code=422, detail="Account must be an asset credit card."
        )
    existing_notes = attrs.get("notes") or ""
    existing_profile = parse_payment_worksheet_from_notes(existing_notes)
    updates = body.model_dump(exclude_unset=True)
    profile_updates = {
        key: value for key, value in updates.items() if key in _PROFILE_FIELD_KEYS
    }
    if (
        profile_updates.get("payment_due_day") is not None
        and str(profile_updates["payment_due_day"]).strip() != ""
    ):
        profile_updates["payment_due_day"] = _validate_due_day(
            str(profile_updates["payment_due_day"])
        )
    if (
        profile_updates.get("apr_percent") is not None
        and str(profile_updates["apr_percent"]).strip() != ""
    ):
        profile_updates["apr_percent"] = _validate_amount(
            str(profile_updates["apr_percent"]), "apr_percent"
        )
    merged = merge_payment_worksheet_profile(existing_profile, profile_updates)
    try:
        await write_payment_worksheet_profile(
            client,
            account_id,
            merged,
            None,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    await patch_worksheet_refresh_profile(
        target_month, account_id, merged, profile_updates
    )
    firefly_reference_cache.clear()
    return {"account_id": account_id, "profile": merged}
