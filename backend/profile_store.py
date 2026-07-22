"""Unified read/write seam for worksheet and loan profiles (Phase 32, D-09–D-12)."""

from __future__ import annotations

from typing import Any

import sidecar_db
from firefly_client import FireflyClient
from loan_profiles import _strip_profile_block as _strip_loan_profile_block
from loan_profiles import parse_loan_profile_from_notes
from loan_profile_validate import validate_profile
from payment_worksheet_liabilities import is_liability_account
from payment_worksheet_profiles import (
    CLEARABLE_OPTIONAL_KEYS,
    DEFAULT_PROFILE,
    _strip_profile_block as _strip_worksheet_profile_block,
    is_credit_card_asset,
    merge_payment_worksheet_profile,
    parse_payment_worksheet_from_notes,
    PAYMENT_WORKSHEET_LEGACY_MARKER,
    PAYMENT_WORKSHEET_MARKER,
    serialize_payment_worksheet_to_notes,
)
from payment_worksheet_promo import validate_promo_bundle

_PROMO_KEYS = frozenset(
    {"special_apr_percent", "special_apr_start", "special_apr_end"}
)


def _utc_now_iso() -> str:
    from datetime import datetime, timezone

    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _worksheet_profile_from_sidecar_row(row: dict[str, Any]) -> dict[str, Any]:
    result = dict(DEFAULT_PROFILE)
    result.update(row)
    result.pop("migrated_at", None)
    return result


async def _maybe_backfill_worksheet_profile(
    account_id: str,
    profile: dict[str, Any],
    *,
    is_liability: bool,
) -> None:
    existing = (
        await sidecar_db.get_liability_worksheet_profile(account_id)
        if is_liability
        else await sidecar_db.get_cc_worksheet_profile(account_id)
    )
    if existing is not None:
        return
    migrated_at = _utc_now_iso()
    stored = {k: v for k, v in profile.items() if k != "worksheet_section"}
    if is_liability:
        await sidecar_db.upsert_liability_worksheet_profile(
            account_id, stored, migrated_at=migrated_at
        )
    else:
        await sidecar_db.upsert_cc_worksheet_profile(
            account_id, stored, migrated_at=migrated_at
        )


async def _maybe_backfill_loan_profile(account_id: str, profile: dict[str, Any]) -> None:
    existing = await sidecar_db.get_loan_profile(account_id)
    if existing is not None:
        return
    await sidecar_db.upsert_loan_profile(
        account_id, profile, migrated_at=_utc_now_iso()
    )


async def get_cc_worksheet_profile(
    account_id: str, notes: str
) -> dict[str, Any]:
    row = await sidecar_db.get_cc_worksheet_profile(account_id)
    if row is not None:
        return _worksheet_profile_from_sidecar_row(row)
    parsed = parse_payment_worksheet_from_notes(notes)
    if parsed is None:
        return dict(DEFAULT_PROFILE)
    merged = {**DEFAULT_PROFILE, **parsed}
    await _maybe_backfill_worksheet_profile(account_id, merged, is_liability=False)
    return merged


async def get_liability_worksheet_profile(
    account_id: str, notes: str
) -> dict[str, Any]:
    row = await sidecar_db.get_liability_worksheet_profile(account_id)
    if row is not None:
        return _worksheet_profile_from_sidecar_row(row)
    parsed = parse_payment_worksheet_from_notes(notes)
    if parsed is None:
        return dict(DEFAULT_PROFILE)
    merged = {**DEFAULT_PROFILE, **parsed}
    await _maybe_backfill_worksheet_profile(account_id, merged, is_liability=True)
    return merged


async def get_loan_profile(account_id: str, notes: str) -> dict[str, Any] | None:
    row = await sidecar_db.get_loan_profile(account_id)
    if row is not None:
        row.pop("migrated_at", None)
        return row
    parsed = parse_loan_profile_from_notes(notes)
    if parsed is None:
        return None
    await _maybe_backfill_loan_profile(account_id, parsed)
    return parsed


async def save_cc_worksheet_profile(
    client: FireflyClient,
    account_id: str,
    attrs: dict[str, Any],
    updates: dict[str, Any],
) -> dict[str, Any]:
    is_cc = is_credit_card_asset(attrs)
    is_liab = is_liability_account(attrs)
    if not is_cc and not is_liab:
        raise ValueError("account is not a credit card or liability")

    existing_row = (
        await sidecar_db.get_cc_worksheet_profile(account_id)
        if is_cc
        else await sidecar_db.get_liability_worksheet_profile(account_id)
    )
    notes = attrs.get("notes") or ""
    notes_fallback = (
        None if existing_row is not None else parse_payment_worksheet_from_notes(notes)
    )
    base = existing_row or notes_fallback
    merged = merge_payment_worksheet_profile(base, updates)
    if _PROMO_KEYS.intersection(updates):
        validate_promo_bundle(updates)

    if is_cc:
        await sidecar_db.upsert_cc_worksheet_profile(account_id, merged)
    else:
        liability_profile = {
            key: merged.get(key)
            for key in ("included", "funding_bucket_key", "default_planned_payment")
        }
        await sidecar_db.upsert_liability_worksheet_profile(account_id, liability_profile)

    account = await client.fetch_account(account_id)
    account_attrs = account.get("attributes", {})
    existing_notes = account_attrs.get("notes") or ""
    stripped = _strip_worksheet_profile_block(existing_notes)
    if stripped != existing_notes:
        merged_attrs = {**account_attrs, "notes": stripped}
        await client.update_account(account_id, merged_attrs)
    return merged


async def save_loan_profile(
    client: FireflyClient,
    account_id: str,
    profile: dict[str, Any],
    *,
    accounts_by_id: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized = validate_profile(profile, accounts_by_id or {})
    await sidecar_db.upsert_loan_profile(account_id, normalized)

    account = await client.fetch_account(account_id)
    account_attrs = account.get("attributes", {})
    existing_notes = account_attrs.get("notes") or ""
    stripped = _strip_loan_profile_block(existing_notes)
    if stripped != existing_notes:
        merged_attrs = {**account_attrs, "notes": stripped}
        await client.update_account(account_id, merged_attrs)
    return normalized
