"""Loan profile REST API (LOAN-01)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from decimal import Decimal

from firefly_client import FireflyClient
from loan_matcher import amount_outside_tolerance
from loan_profile_validate import validate_profile
from loan_profiles import parse_loan_profile_from_notes, write_loan_profile
from loan_splits import apply_loan_split, apply_penny_adjust_to_amounts
from loan_splits_queue import build_pending_loan_splits, find_pending_match

router = APIRouter()


def _parse_date_range(start: str, end: str) -> tuple[str, str]:
    from datetime import datetime

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


def get_firefly_client() -> FireflyClient:
    return FireflyClient()


def _is_liability_account(attrs: dict[str, Any]) -> bool:
    raw_type = (attrs.get("type") or "").lower()
    raw_role = (attrs.get("account_role") or "").replace("_", "").lower()
    if raw_role == "debt":
        return True
    return raw_type in ("liabilities", "liability") or "liabilit" in raw_type


def _is_liability_row(acct: dict[str, Any]) -> bool:
    raw_type = (acct.get("type") or "").lower()
    raw_role = (acct.get("role") or "").replace(" ", "").lower()
    if raw_role == "debt":
        return True
    return "liabilit" in raw_type


def _is_expense_row(acct: dict[str, Any]) -> bool:
    raw_type = (acct.get("type") or "").lower()
    return raw_type in ("expense", "expense account")


def _is_asset_row(acct: dict[str, Any]) -> bool:
    raw_type = (acct.get("type") or "").lower()
    return "asset" in raw_type


def _account_option(account_id: str, acct: dict[str, Any]) -> dict[str, str | None]:
    return {
        "id": account_id,
        "name": acct.get("name") or account_id,
        "type": acct.get("type"),
        "role": acct.get("role"),
    }


def _account_row(account_id: str, attrs: dict[str, Any], profile: dict | None) -> dict:
    return {
        "account_id": account_id,
        "name": attrs.get("name"),
        "profile": profile,
        "enabled": bool(profile and profile.get("enabled")),
        "configured": profile is not None,
    }


@router.get("/loans")
async def get_loans(client: FireflyClient = Depends(get_firefly_client)):
    try:
        accounts = await client.fetch_accounts()
        rows = []
        for aid, summary in accounts.items():
            if not _is_liability_row(summary):
                continue
            acct = await client.fetch_account(aid)
            attrs = acct.get("attributes", {})
            notes = attrs.get("notes") or ""
            profile = parse_loan_profile_from_notes(notes)
            rows.append(_account_row(aid, attrs, profile))
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly accounts: {exc}",
        ) from exc
    return {"data": rows}


@router.get("/loans/meta")
async def get_loans_meta(client: FireflyClient = Depends(get_firefly_client)):
    try:
        accounts = await client.fetch_accounts()
        categories = await client.fetch_categories()
        budgets = await client.fetch_budgets()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly reference data: {exc}",
        ) from exc
    liabilities = [
        _account_option(aid, acct)
        for aid, acct in accounts.items()
        if _is_liability_row(acct)
    ]
    expenses = [
        _account_option(aid, acct)
        for aid, acct in accounts.items()
        if _is_expense_row(acct)
    ]
    assets = [
        _account_option(aid, acct)
        for aid, acct in accounts.items()
        if _is_asset_row(acct)
    ]
    liabilities.sort(key=lambda row: row["name"].lower())
    expenses.sort(key=lambda row: row["name"].lower())
    assets.sort(key=lambda row: row["name"].lower())
    categories.sort(key=lambda row: row["name"].lower())
    budgets.sort(key=lambda row: row["name"].lower())
    return {
        "liability_accounts": liabilities,
        "expense_accounts": expenses,
        "asset_accounts": assets,
        "categories": categories,
        "budgets": budgets,
    }


@router.get("/loans/{account_id}")
async def get_loan(
    account_id: str, client: FireflyClient = Depends(get_firefly_client)
):
    try:
        acct = await client.fetch_account(account_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly account: {exc}",
        ) from exc
    attrs = acct.get("attributes", {})
    if not _is_liability_account(attrs):
        raise HTTPException(status_code=404, detail="Account is not a liability.")
    notes = attrs.get("notes") or ""
    profile = parse_loan_profile_from_notes(notes)
    return {
        "account_id": account_id,
        "name": attrs.get("name"),
        "current_balance": attrs.get("current_balance"),
        "interest": attrs.get("interest"),
        "profile": profile,
        "enabled": bool(profile and profile.get("enabled")),
    }


class LoanProfileBody(BaseModel):
    version: int = 1
    enabled: bool = True
    match: dict[str, Any]
    split: dict[str, Any]
    rate_override: str | None = None
    notes: str | None = None


@router.put("/loans/{account_id}")
async def put_loan(
    account_id: str,
    body: LoanProfileBody,
    client: FireflyClient = Depends(get_firefly_client),
):
    try:
        acct = await client.fetch_account(account_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly account: {exc}",
        ) from exc
    attrs = acct.get("attributes", {})
    if not _is_liability_account(attrs):
        raise HTTPException(status_code=404, detail="Account is not a liability.")
    try:
        accounts = await client.fetch_accounts()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch Firefly accounts: {exc}",
        ) from exc
    profile_dict = body.model_dump(exclude_none=True)
    try:
        validated = validate_profile(profile_dict, accounts)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        await write_loan_profile(client, account_id, validated)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to save loan profile: {exc}",
        ) from exc
    return {"ok": True, "profile": validated}


@router.get("/loan-splits/pending")
async def get_loan_splits_pending(
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
    client: FireflyClient = Depends(get_firefly_client),
):
    _parse_date_range(start, end)
    try:
        data, meta = await build_pending_loan_splits(client, start, end)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to build loan splits queue: {exc}",
        ) from exc
    return {"data": data, "meta": meta}


class LoanSplitAmounts(BaseModel):
    principal: str | None = None
    interest: str | None = None
    escrow: str | None = None


class LoanSplitApplyRequest(BaseModel):
    transaction_journal_id: str
    principal: str
    interest: str
    escrow: str = "0.00"
    start: str
    end: str


def _validate_amount_sum(
    flat_split: dict[str, Any], amounts: dict[str, str]
) -> dict[str, Decimal]:
    payment = abs(Decimal(str(flat_split.get("amount") or "0")))
    adjusted = apply_penny_adjust_to_amounts(amounts, payment)
    total = sum(adjusted.values())
    if abs(total - payment) > Decimal("0.01"):
        raise HTTPException(
            status_code=422,
            detail=f"Component amounts must sum to payment ({payment:.2f}).",
        )
    return adjusted


@router.post("/loan-splits/{group_id}/preview")
async def post_loan_split_preview(
    group_id: str,
    body: LoanSplitAmounts,
    start: str = Query(...),
    end: str = Query(...),
    client: FireflyClient = Depends(get_firefly_client),
):
    _parse_date_range(start, end)
    try:
        match = await find_pending_match(client, group_id, start, end)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if match is None:
        raise HTTPException(status_code=404, detail="Pending loan split not found.")
    _item, profile, flat_split = match
    base = _item.get("preview") or {}
    merged = {
        "principal": body.principal or base.get("principal"),
        "interest": body.interest or base.get("interest"),
        "escrow": body.escrow or base.get("escrow") or "0.00",
    }
    adjusted = _validate_amount_sum(flat_split, merged)
    return {
        "amounts": {k: f"{v:.2f}" for k, v in adjusted.items()},
        "warnings": [w for w in [amount_outside_tolerance(flat_split, profile)] if w],
    }


@router.post("/loan-splits/{group_id}/apply")
async def post_loan_split_apply(
    group_id: str,
    body: LoanSplitApplyRequest,
    client: FireflyClient = Depends(get_firefly_client),
):
    _parse_date_range(body.start, body.end)
    try:
        match = await find_pending_match(client, group_id, body.start, body.end)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if match is None:
        raise HTTPException(status_code=404, detail="Pending loan split not found.")
    _item, profile, flat_split = match
    if str(flat_split.get("transaction_journal_id")) != str(body.transaction_journal_id):
        raise HTTPException(
            status_code=422, detail="transaction_journal_id does not match pending split."
        )
    amounts = {
        "principal": body.principal,
        "interest": body.interest,
        "escrow": body.escrow,
    }
    adjusted = _validate_amount_sum(flat_split, amounts)
    str_amounts = {k: f"{v:.2f}" for k, v in adjusted.items()}
    try:
        result = await apply_loan_split(
            client,
            group_id,
            body.transaction_journal_id,
            profile,
            flat_split,
            str_amounts,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": True, "journal_id": result.get("id") or group_id}
