"""Payment worksheet refresh orchestration (PAY-06, PAY-07, PAY-10)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import sidecar_db
from firefly_client import FireflyClient
from payment_worksheet_cc import classify_cc_activity_category, is_credit_card_payment_flow
from payment_worksheet_profiles import (
    current_month_key,
    effective_profile_from_notes,
)

DEFAULT_INTEREST_CATEGORIES = "Credit Card Interest"
DEFAULT_FEE_CATEGORIES = "Credit Card Fee(s),Late Fee(s)"


def _parse_category_list(env_key: str, default: str) -> list[str]:
    raw = os.environ.get(env_key, "").strip()
    source = raw if raw else default
    return [part.strip() for part in source.split(",") if part.strip()]


def interest_categories() -> list[str]:
    return _parse_category_list(
        "FF3ANALYTICS_PAYMENT_WORKSHEET_INTEREST_CATEGORIES",
        DEFAULT_INTEREST_CATEGORIES,
    )


def fee_categories() -> list[str]:
    return _parse_category_list(
        "FF3ANALYTICS_PAYMENT_WORKSHEET_FEE_CATEGORIES",
        DEFAULT_FEE_CATEGORIES,
    )


def cc_row_key(account_id: str) -> str:
    return f"cc:{account_id}"


def _decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _split_date(split: dict[str, Any]) -> str:
    raw = split.get("date") or ""
    return raw[:10] if len(raw) >= 10 else raw


def _touches_card(split: dict[str, Any], card_id: str) -> bool:
    return split.get("source_id") == card_id or split.get("destination_id") == card_id


def _is_payment_to_card(split: dict[str, Any], card_id: str) -> bool:
    return (
        split.get("destination_id") == card_id
        and is_credit_card_payment_flow(split)
    )


def _amount_for_card_activity(split: dict[str, Any], card_id: str) -> Decimal:
    amount = _decimal_amount(split.get("amount"))
    if split.get("source_id") == card_id:
        return amount
    if split.get("destination_id") == card_id:
        return -amount
    return Decimal("0")


def _find_last_payment_date(
    splits: list[dict[str, Any]], card_id: str
) -> str | None:
    payment_dates = [
        _split_date(s)
        for s in splits
        if _is_payment_to_card(s, card_id) and _split_date(s)
    ]
    return max(payment_dates) if payment_dates else None


def _compute_cc_activity(
    splits: list[dict[str, Any]],
    card_id: str,
    month_start: str,
    interest_cats: list[str],
    fee_cats: list[str],
) -> dict[str, str | None]:
    card_splits = [s for s in splits if _touches_card(s, card_id)]
    last_payment = _find_last_payment_date(card_splits, card_id)
    window_start = month_start
    if last_payment and last_payment > window_start:
        window_start = last_payment

    interest = Decimal("0")
    fees = Decimal("0")
    new_charges = Decimal("0")

    for split in card_splits:
        split_date = _split_date(split)
        if not split_date or split_date < window_start:
            continue
        if _is_payment_to_card(split, card_id):
            continue
        amount = _amount_for_card_activity(split, card_id)
        if amount == 0:
            continue
        category = classify_cc_activity_category(split, interest_cats, fee_cats)
        if category == "interest":
            interest += amount
        elif category == "fee":
            fees += amount
        else:
            new_charges += amount

    new_total = interest + fees + new_charges
    return {
        "new_total": _format_decimal(new_total),
        "interest_accrued": _format_decimal(interest),
        "fees": _format_decimal(fees),
        "last_payment_date": last_payment,
    }


async def _included_credit_card_ids(client: FireflyClient) -> list[tuple[str, dict[str, Any]]]:
    accounts = await client.fetch_accounts()
    included: list[tuple[str, dict[str, Any]]] = []
    for account_id, summary in accounts.items():
        if summary.get("type") != "Asset account" or summary.get("role") != "Credit card":
            continue
        full = await client.fetch_account(account_id)
        notes = full.get("attributes", {}).get("notes") or ""
        profile = effective_profile_from_notes(notes)
        if profile.get("included") is False:
            continue
        included.append((account_id, full))
    return included


async def run_refresh(
    client: FireflyClient, month: str | None = None
) -> dict[str, str]:
    month = month or current_month_key()
    month_start = f"{month}-01"
    today = datetime.now(timezone.utc).date().isoformat()
    refreshed_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )

    buckets = await sidecar_db.list_funding_buckets()
    interest_cats = interest_categories()
    fee_cats = fee_categories()

    balances: dict[str, Any] = {"buckets": {}, "credit_cards": {}}

    for bucket in buckets:
        reported = Decimal("0")
        for account_id in bucket["firefly_account_ids"]:
            acct = await client.fetch_account(account_id)
            reported += abs(_decimal_amount(acct.get("attributes", {}).get("current_balance")))
        balances["buckets"][bucket["id"]] = {
            "reported_balance": _format_decimal(reported),
        }

        existing_rows = await sidecar_db.get_bucket_balances_for_month(month)
        existing = next(
            (r for r in existing_rows if r["bucket_key"] == bucket["id"]), None
        )
        if existing and existing.get("user_balance_override"):
            continue
        await sidecar_db.upsert_bucket_balance(
            bucket_key=bucket["id"],
            month=month,
            user_balance=_format_decimal(reported),
            user_balance_override=0,
        )

    splits = await client.fetch_splits(month_start, today)
    cc_accounts = await _included_credit_card_ids(client)
    state_rows = {
        row["row_key"]: row
        for row in await sidecar_db.get_worksheet_state_for_month(month)
    }

    for account_id, account in cc_accounts:
        attrs = account.get("attributes", {})
        notes = attrs.get("notes") or ""
        profile = effective_profile_from_notes(notes)
        owed = abs(_decimal_amount(attrs.get("current_balance")))
        activity = _compute_cc_activity(
            splits, account_id, month_start, interest_cats, fee_cats
        )
        balances["credit_cards"][account_id] = {
            "name": attrs.get("name"),
            "credit_limit": profile.get("credit_limit"),
            "funding_bucket_key": profile.get("funding_bucket_key"),
            "owed": _format_decimal(owed),
            **activity,
        }

        row_key = cc_row_key(account_id)
        existing_state = state_rows.get(row_key)
        if existing_state and existing_state.get("planned_amount_override"):
            continue
        default_planned = profile.get("default_planned_payment")
        if default_planned:
            await sidecar_db.upsert_worksheet_state_row(
                row_key=row_key,
                row_type="credit_card",
                month=month,
                planned_amount=str(default_planned),
                planned_amount_override=0,
            )
        elif existing_state is None:
            await sidecar_db.upsert_worksheet_state_row(
                row_key=row_key,
                row_type="credit_card",
                month=month,
                planned_amount="0.00",
                planned_amount_override=0,
            )

    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at=refreshed_at,
        balances_json=json.dumps(balances),
    )
    return {"refreshed_at": refreshed_at, "month": month}
