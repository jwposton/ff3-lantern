"""Loan profile REST API (LOAN-01)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from firefly_client import FireflyClient
from loan_profile_validate import validate_profile
from loan_profiles import parse_loan_profile_from_notes, write_loan_profile
from loan_splits_queue import build_pending_loan_splits

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
