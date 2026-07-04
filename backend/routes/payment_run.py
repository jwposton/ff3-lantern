"""Payment worksheet REST API (PAY-02, PAY-03)."""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import date
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
    patch_worksheet_refresh_liability_profile,
    patch_worksheet_refresh_profile,
    write_payment_worksheet_profile,
)
from payment_worksheet_bill_suggestions import (
    LOOKBACK_CHOICES,
    fetch_bill_suggestion_transactions,
    fetch_bill_suggestions,
)
from payment_worksheet_bills import (
    BillRegistrationError,
    RegisterBillBody,
    register_bill,
    serialize_bill_registry_for_edit,
    update_linked_firefly_bill,
)
from payment_worksheet_bill_history import (
    bill_history_date_window,
    compute_bill_history_stats,
)
from payment_worksheet_compute import _row_type_from_key, bill_row_key, build_worksheet_envelope
from payment_worksheet_liabilities import is_liability_account
from payment_worksheet_refresh import run_refresh

router = APIRouter()


def payment_worksheet_enabled() -> bool:
    return (
        os.environ.get("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "").strip().lower()
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


class BillGroupCreateBody(BaseModel):
    label: str
    sort_order: int = 0

    @field_validator("label")
    @classmethod
    def label_non_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("label must be non-empty")
        return stripped


class BillGroupPatchBody(BaseModel):
    label: str | None = None
    sort_order: int | None = None
    member_ids: list[int] | None = None

    @field_validator("label")
    @classmethod
    def label_non_empty_when_set(cls, value: str | None) -> str | None:
        if value is None:
            return value
        stripped = value.strip()
        if not stripped:
            raise ValueError("label must be non-empty")
        return stripped


class BillGroupMemberRow(BaseModel):
    registry_id: int
    row_label: str | None
    show_in_group: bool


class BillGroupRow(BaseModel):
    id: str
    label: str
    sort_order: int
    member_count: int
    visible_count: int
    members: list[BillGroupMemberRow]


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
    amount_due: str | None = None
    paid_at: str | None = None
    clear_paid: bool = False
    clear_planned_override: bool = False
    clear_amount_due_override: bool = False


class UpdateBillRegistryBody(BaseModel):
    worksheet_section: str | None = None
    payment_rail: str | None = None
    funding_bucket_key: str | None = None
    credit_card_account_id: str | None = None
    row_label: str | None = None
    amount_mode: str | None = None
    name: str | None = None
    amount_min: str | None = None
    amount_max: str | None = None
    repeat_freq: str | None = None


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


def _slugify_label(label: str) -> str:
    text = label.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:64].strip("-")


async def _allocate_group_id(label: str) -> str:
    base = _slugify_label(label) or "group"
    candidate = base
    suffix = 2
    while await sidecar_db.get_bill_group(candidate) is not None:
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


async def _enrich_bill_group(row: dict) -> BillGroupRow:
    members_raw = await sidecar_db.list_bill_group_members(row["id"])
    members = [BillGroupMemberRow(**member) for member in members_raw]
    return BillGroupRow(
        id=row["id"],
        label=row["label"],
        sort_order=row["sort_order"],
        member_count=len(members),
        visible_count=sum(1 for member in members if member.show_in_group),
        members=members,
    )


_BILL_GROUP_MEMBER_SECTIONS = frozenset({"bills", "liabilities"})


async def _validate_bill_group_member_ids(member_ids: list[int]) -> None:
    for registry_id in member_ids:
        row = await sidecar_db.get_worksheet_registry(registry_id)
        if row is None:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown registry id: {registry_id}",
            )
        section = row.get("worksheet_section")
        if section not in _BILL_GROUP_MEMBER_SECTIONS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Registry row {registry_id} cannot join a bill group "
                    f"(worksheet_section must be bills or liabilities)."
                ),
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
    amount_due = existing["amount_due"] if existing else "0.00"
    amount_due_override = int(existing["amount_due_override"]) if existing else 0
    paid_at = existing["paid_at"] if existing else None

    updates = body.model_dump(exclude_unset=True)
    if "planned_amount" in updates and updates["planned_amount"] is not None:
        planned_amount = _validate_amount(updates["planned_amount"], "planned_amount")
    if body.clear_planned_override:
        planned_override = 0
    elif "planned_amount" in updates and updates["planned_amount"] is not None:
        planned_override = 1

    if body.clear_amount_due_override:
        amount_due_override = 0
    elif "amount_due" in updates and updates["amount_due"] is not None:
        amount_due = _validate_amount(updates["amount_due"], "amount_due")
        amount_due_override = 1

    if body.clear_paid:
        paid_at = None
    elif "paid_at" in updates:
        paid_at = updates["paid_at"]

    await sidecar_db.upsert_worksheet_state_row(
        row_key=row_key,
        row_type=_row_type_from_key(row_key),
        month=target_month,
        planned_amount=planned_amount,
        planned_amount_override=planned_override,
        amount_due=amount_due,
        amount_due_override=amount_due_override,
        paid_at=paid_at,
    )
    return {
        "row_key": row_key,
        "month": target_month,
        "planned_amount": planned_amount,
        "amount_due": amount_due,
        "amount_due_override": bool(amount_due_override),
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


@router.get("/payment-run/bill-groups")
async def list_bill_groups_route(_: None = Depends(require_payment_worksheet)):
    rows = await sidecar_db.list_bill_groups()
    enriched = [await _enrich_bill_group(row) for row in rows]
    return {"data": [row.model_dump() for row in enriched]}


@router.post("/payment-run/bill-groups")
async def create_bill_group(
    body: BillGroupCreateBody,
    _: None = Depends(require_payment_worksheet),
):
    group_id = await _allocate_group_id(body.label)
    await sidecar_db.upsert_bill_group(
        id=group_id,
        label=body.label,
        sort_order=body.sort_order,
    )
    row = await sidecar_db.get_bill_group(group_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create group.")
    return (await _enrich_bill_group(row)).model_dump()


@router.patch("/payment-run/bill-groups/{group_id}")
async def patch_bill_group(
    group_id: str,
    body: BillGroupPatchBody,
    _: None = Depends(require_payment_worksheet),
):
    existing = await sidecar_db.get_bill_group(group_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Group not found.")
    updates = body.model_dump(exclude_unset=True)
    if "member_ids" in updates:
        member_ids = updates.pop("member_ids")
        await _validate_bill_group_member_ids(member_ids)
        await sidecar_db.replace_bill_group_members(group_id, member_ids)
    if updates:
        await sidecar_db.upsert_bill_group(
            id=group_id,
            label=updates.get("label", existing["label"]),
            sort_order=updates.get("sort_order", existing["sort_order"]),
        )
    row = await sidecar_db.get_bill_group(group_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to update group.")
    return (await _enrich_bill_group(row)).model_dump()


@router.delete("/payment-run/bill-groups/{group_id}")
async def delete_bill_group_route(
    group_id: str,
    _: None = Depends(require_payment_worksheet),
):
    existing = await sidecar_db.get_bill_group(group_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Group not found.")
    await sidecar_db.delete_bill_group(group_id)
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
    if not is_credit_card_asset(attrs) and not is_liability_account(attrs):
        raise HTTPException(
            status_code=422,
            detail="Account must be an asset credit card or liability account.",
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
    if is_credit_card_asset(attrs):
        await patch_worksheet_refresh_profile(
            target_month, account_id, merged, profile_updates
        )
    else:
        await patch_worksheet_refresh_liability_profile(
            target_month, account_id, merged, profile_updates
        )
    firefly_reference_cache.clear()
    return {"account_id": account_id, "profile": merged}


def _planned_sync_for_amount_mode(amount_mode: str) -> str:
    return "fixed" if amount_mode == "recurring" else "manual"


async def _validate_credit_card_account(
    client: FireflyClient, account_id: str
) -> None:
    try:
        account = await client.fetch_account(account_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not is_credit_card_asset(account.get("attributes", {})):
        raise HTTPException(
            status_code=422,
            detail="credit_card_account_id must be a credit card asset account.",
        )


@router.get("/payment-run/bills/{bill_id}/link-rules")
async def bill_link_rules(
    bill_id: str,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    from payment_worksheet_bills import BillRegistrationError, list_link_rules_for_bill

    try:
        data = await list_link_rules_for_bill(client, bill_id)
    except BillRegistrationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"data": data}


@router.post("/payment-run/bills/register")
async def register_bill_route(
    body: RegisterBillBody,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    if body.payment_rail == "credit_card" and body.credit_card_account_id:
        await _validate_credit_card_account(client, body.credit_card_account_id)
    try:
        return await register_bill(client, body)
    except BillRegistrationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/payment-run/bills/{registry_id}")
async def get_bill_registry(
    registry_id: int,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    existing = await sidecar_db.get_worksheet_registry(registry_id)
    if existing is None or not existing.get("firefly_bill_id"):
        raise HTTPException(status_code=404, detail="Registered bill not found.")
    try:
        firefly_bill = await client.fetch_bill(str(existing["firefly_bill_id"]))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return serialize_bill_registry_for_edit(existing, firefly_bill)


@router.put("/payment-run/bills/{registry_id}")
async def update_bill_registry(
    registry_id: int,
    body: UpdateBillRegistryBody,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    existing = await sidecar_db.get_worksheet_registry(registry_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Registry row not found.")
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return existing

    firefly_name = updates.pop("name", None)
    firefly_amount_min = updates.pop("amount_min", None)
    firefly_amount_max = updates.pop("amount_max", None)
    firefly_repeat_freq = updates.pop("repeat_freq", None)
    if firefly_name is not None and "row_label" not in updates:
        updates["row_label"] = firefly_name.strip() or None

    merged = {**existing, **updates, "id": registry_id}
    payment_rail = merged.get("payment_rail") or "bank"
    if payment_rail == "credit_card":
        card_id = (merged.get("credit_card_account_id") or "").strip()
        if not card_id:
            raise HTTPException(
                status_code=422,
                detail="credit_card_account_id is required for credit_card payment rail.",
            )
        await _validate_credit_card_account(client, card_id)
        merged["funding_bucket_key"] = None
    elif payment_rail == "bank":
        bucket_key = (merged.get("funding_bucket_key") or "").strip()
        if not bucket_key:
            raise HTTPException(
                status_code=422,
                detail="funding_bucket_key is required for bank payment rail.",
            )
        bucket = await sidecar_db.get_funding_bucket(bucket_key)
        if bucket is None:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown funding bucket: {bucket_key}",
            )
        merged["credit_card_account_id"] = None
    amount_mode = merged.get("amount_mode") or existing.get("amount_mode")
    if amount_mode:
        merged["planned_sync"] = _planned_sync_for_amount_mode(str(amount_mode))

    firefly_bill_id = existing.get("firefly_bill_id")
    if firefly_bill_id and any(
        value is not None
        for value in (
            firefly_name,
            firefly_amount_min,
            firefly_amount_max,
            firefly_repeat_freq,
        )
    ):
        try:
            await update_linked_firefly_bill(
                client,
                firefly_bill_id=str(firefly_bill_id),
                name=firefly_name,
                amount_min=firefly_amount_min,
                amount_max=firefly_amount_max,
                repeat_freq=firefly_repeat_freq,
                amount_mode=str(amount_mode or "recurring"),
            )
        except BillRegistrationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    await sidecar_db.update_worksheet_registry(registry_id, merged)
    updated = await sidecar_db.get_worksheet_registry(registry_id)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update registry row.")
    return updated


@router.delete("/payment-run/bills/{registry_id}")
async def delete_bill_registry(
    registry_id: int,
    _: None = Depends(require_payment_worksheet),
):
    existing = await sidecar_db.get_worksheet_registry(registry_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Registry row not found.")
    await sidecar_db.delete_worksheet_registry(registry_id)
    await sidecar_db.delete_worksheet_state_for_row_key(bill_row_key(registry_id))
    return {"ok": True}


@router.get("/payment-run/bills")
async def list_registered_bills(_: None = Depends(require_payment_worksheet)):
    rows = await sidecar_db.list_worksheet_registry()
    bills = [
        {
            "registry_id": row["id"],
            "row_label": row.get("row_label"),
            "firefly_bill_id": row.get("firefly_bill_id"),
            "worksheet_section": row.get("worksheet_section"),
            "payment_rail": row.get("payment_rail"),
            "amount_mode": row.get("amount_mode"),
        }
        for row in rows
        if row.get("firefly_bill_id")
    ]
    bills.sort(key=lambda bill: (bill.get("row_label") or "").casefold())
    return {"data": bills}


@router.get("/payment-run/bills/{registry_id}/history")
async def bill_history(
    registry_id: int,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    existing = await sidecar_db.get_worksheet_registry(registry_id)
    if existing is None or not existing.get("firefly_bill_id"):
        raise HTTPException(status_code=404, detail="Registered bill not found.")
    today = date.today()
    start, end = bill_history_date_window(today)
    try:
        rows = await client.fetch_bill_transactions(
            str(existing["firefly_bill_id"]), start, end
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    stats = compute_bill_history_stats(rows, today=today)
    transactions = sorted(rows, key=lambda row: row.get("date") or "", reverse=True)
    payload: dict[str, Any] = {
        "registry_id": registry_id,
        "row_label": existing.get("row_label"),
        "firefly_bill_id": existing["firefly_bill_id"],
        "window": {"start": start, "end": end},
        **stats,
        "transactions": transactions,
    }
    base = os.environ.get("FIREFLY_BASE_URL", "").strip().rstrip("/")
    if base:
        payload["firefly_base_url"] = base
    return payload


@router.get("/payment-run/available")
async def available_bills(
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    try:
        bills = await client.fetch_bills()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    registered = {
        str(row["firefly_bill_id"])
        for row in await sidecar_db.list_worksheet_registry()
        if row.get("firefly_bill_id")
    }
    available = [bill for bill in bills if str(bill.get("id")) not in registered]
    available.sort(key=lambda bill: (bill.get("name") or "").casefold())
    return {"data": available}


class DiscoverSettingsBody(BaseModel):
    ignored_categories: list[str] = []


@router.get("/payment-run/discover-settings")
async def get_discover_settings_route(
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    try:
        categories = await client.fetch_categories()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    settings = await sidecar_db.get_discover_settings()
    available = sorted(
        [{"id": str(cat["id"]), "name": cat["name"]} for cat in categories],
        key=lambda row: row["name"].casefold(),
    )
    return {
        "ignored_categories": settings["ignored_categories"],
        "available_categories": available,
        "suggested_ignored_categories": sidecar_db.DEFAULT_DISCOVER_IGNORED_CATEGORIES,
    }


@router.put("/payment-run/discover-settings")
async def put_discover_settings_route(
    body: DiscoverSettingsBody,
    _: None = Depends(require_payment_worksheet),
):
    updated = await sidecar_db.update_discover_ignored_categories(body.ignored_categories)
    return updated


@router.get("/payment-run/bill-suggestions")
async def bill_suggestions(
    lookback_months: int = 12,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    if lookback_months not in LOOKBACK_CHOICES:
        raise HTTPException(
            status_code=422,
            detail="lookback_months must be 6, 12, or 24.",
        )
    try:
        return await fetch_bill_suggestions(client, lookback_months=lookback_months)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/payment-run/bill-suggestions/{suggestion_id}/transactions")
async def bill_suggestion_transactions(
    suggestion_id: str,
    lookback_months: int = 12,
    _: None = Depends(require_payment_worksheet),
    client: FireflyClient = Depends(get_firefly_client),
):
    if lookback_months not in LOOKBACK_CHOICES:
        raise HTTPException(
            status_code=422,
            detail="lookback_months must be 6, 12, or 24.",
        )
    try:
        result = await fetch_bill_suggestion_transactions(
            client,
            suggestion_id=suggestion_id,
            lookback_months=lookback_months,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    return result
