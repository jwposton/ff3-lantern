"""Payment worksheet refresh orchestration (PAY-06, PAY-07, PAY-10)."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import sidecar_db
from firefly_client import FireflyClient
from loan_profiles import parse_loan_profile_from_notes
from payment_worksheet_bills import compute_bill_owed_from_firefly
from payment_worksheet_cc import classify_cc_activity_category, is_credit_card_payment_flow
from payment_worksheet_liabilities import (
    compute_liability_display_fields,
    draft_planned_amount,
    is_liability_account,
    is_liability_summary,
    liability_row_key,
)
from payment_worksheet_profiles import (
    _due_day_from_monthly_payment_date,
    current_month_key,
    effective_profile_from_notes,
)

DEFAULT_INTEREST_CATEGORIES = "Credit Card Interest"
DEFAULT_FEE_CATEGORIES = "Credit Card Fee(s),Late Fee(s)"

logger = logging.getLogger(__name__)


def _parse_category_list(env_key: str, default: str) -> list[str]:
    raw = os.environ.get(env_key, "").strip()
    source = raw if raw else default
    return [part.strip() for part in source.split(",") if part.strip()]


def interest_categories() -> list[str]:
    return _parse_category_list(
        "FF3LANTERN_PAYMENT_WORKSHEET_INTEREST_CATEGORIES",
        DEFAULT_INTEREST_CATEGORIES,
    )


def fee_categories() -> list[str]:
    return _parse_category_list(
        "FF3LANTERN_PAYMENT_WORKSHEET_FEE_CATEGORIES",
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


def _activity_fetch_start(month: str) -> str:
    """First day of the calendar month before *month* (for last-payment lookback)."""
    year = int(month[:4])
    mon = int(month[5:7])
    if mon == 1:
        return f"{year - 1}-12-01"
    return f"{year}-{mon - 1:02d}-01"


def _resolve_activity_window(
    card_splits: list[dict[str, Any]], card_id: str, month_start: str
) -> tuple[str, str | None]:
    """Anchor New/interest/fees to the latest payment in-month, else prior month, else MTD."""
    payment_dates = [
        _split_date(s)
        for s in card_splits
        if _is_payment_to_card(s, card_id) and _split_date(s)
    ]
    in_month = [d for d in payment_dates if d >= month_start]
    if in_month:
        anchor = max(in_month)
        return anchor, anchor
    before_month = [d for d in payment_dates if d < month_start]
    if before_month:
        anchor = max(before_month)
        return anchor, anchor
    return month_start, None


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


def _activity_description(split: dict[str, Any], card_id: str) -> str:
    desc = (split.get("description") or "").strip()
    if desc:
        return desc
    if split.get("source_id") == card_id:
        return (split.get("destination_name") or "").strip() or "—"
    return (split.get("source_name") or "").strip() or "—"


def _activity_kind_label(category: str) -> str:
    if category == "interest":
        return "interest"
    if category == "fee":
        return "fee"
    return "charge"


def _activity_payee(split: dict[str, Any], card_id: str) -> str | None:
    if split.get("source_id") == card_id:
        name = (split.get("destination_name") or "").strip()
    else:
        name = (split.get("source_name") or "").strip()
    return name or None


def _last_payment_amount(
    card_splits: list[dict[str, Any]],
    card_id: str,
    last_payment_date: str | None,
    fetch_start: str,
) -> str:
    """Payment amount when the anchor date falls in the prior or current month."""
    if not last_payment_date or last_payment_date < fetch_start:
        return "0.00"
    total = Decimal("0")
    for split in card_splits:
        if not _is_payment_to_card(split, card_id):
            continue
        if _split_date(split) != last_payment_date:
            continue
        total += _decimal_amount(split.get("amount"))
    return _format_decimal(total)


def _compute_cc_activity(
    splits: list[dict[str, Any]],
    card_id: str,
    month_start: str,
    fetch_start: str,
    interest_cats: list[str],
    fee_cats: list[str],
) -> dict[str, Any]:
    card_splits = [s for s in splits if _touches_card(s, card_id)]
    window_start, last_payment = _resolve_activity_window(
        card_splits, card_id, month_start
    )

    interest = Decimal("0")
    fees = Decimal("0")
    new_charges = Decimal("0")
    new_transactions: list[dict[str, str | None]] = []

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
        new_transactions.append(
            {
                "journal_id": split.get("journal_id"),
                "date": split_date,
                "description": _activity_description(split, card_id),
                "payee": _activity_payee(split, card_id),
                "category": (split.get("category_name") or "").strip() or None,
                "budget": (split.get("budget_name") or "").strip() or None,
                "kind": _activity_kind_label(category),
                "amount": _format_decimal(amount),
            }
        )

    new_transactions.sort(key=lambda row: row["date"] or "", reverse=True)
    new_total = interest + fees + new_charges
    return {
        "new_total": _format_decimal(new_total),
        "interest_accrued": _format_decimal(interest),
        "fees": _format_decimal(fees),
        "last_payment_date": last_payment,
        "last_payment_amount": _last_payment_amount(
            card_splits, card_id, last_payment, fetch_start
        ),
        "new_transactions": new_transactions,
    }


async def _included_credit_card_ids(client: FireflyClient) -> list[tuple[str, dict[str, Any]]]:
    accounts = await client.fetch_accounts()
    cards: list[tuple[str, dict[str, Any]]] = []
    for account_id, summary in accounts.items():
        if summary.get("type") != "Asset account" or summary.get("role") != "Credit card":
            continue
        full = await client.fetch_account(account_id)
        cards.append((account_id, full))
    return cards


async def _liability_accounts(client: FireflyClient) -> list[tuple[str, dict[str, Any]]]:
    accounts = await client.fetch_accounts()
    liabilities: list[tuple[str, dict[str, Any]]] = []
    for account_id, summary in accounts.items():
        if not is_liability_summary(summary):
            continue
        full = await client.fetch_account(account_id)
        attrs = full.get("attributes", {})
        if is_liability_account(attrs):
            liabilities.append((account_id, full))
    return liabilities


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

    balances: dict[str, Any] = {
        "buckets": {},
        "credit_cards": {},
        "excluded_credit_cards": {},
        "liabilities": {},
        "excluded_liabilities": {},
        "bills": {},
    }

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

    fetch_start = _activity_fetch_start(month)
    splits = await client.fetch_splits(fetch_start, today)
    cc_accounts = await _included_credit_card_ids(client)
    state_rows = {
        row["row_key"]: row
        for row in await sidecar_db.get_worksheet_state_for_month(month)
    }

    excluded_credit_cards: dict[str, Any] = {}

    for account_id, account in cc_accounts:
        attrs = account.get("attributes", {})
        notes = attrs.get("notes") or ""
        profile = effective_profile_from_notes(notes)
        if profile.get("included") is False:
            excluded_credit_cards[account_id] = {"name": attrs.get("name")}
            continue
        owed = abs(_decimal_amount(attrs.get("current_balance")))
        activity = _compute_cc_activity(
            splits, account_id, month_start, fetch_start, interest_cats, fee_cats
        )
        balances["credit_cards"][account_id] = {
            "name": attrs.get("name"),
            "credit_limit": profile.get("credit_limit"),
            "funding_bucket_key": profile.get("funding_bucket_key"),
            "payment_due_day": profile.get("payment_due_day")
            or _due_day_from_monthly_payment_date(attrs.get("monthly_payment_date")),
            "apr_percent": profile.get("apr_percent"),
            "sort_order": profile.get("sort_order"),
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

    balances["excluded_credit_cards"] = excluded_credit_cards

    excluded_liabilities: dict[str, Any] = {}
    liability_accounts = await _liability_accounts(client)

    for account_id, account in liability_accounts:
        attrs = account.get("attributes", {})
        notes = attrs.get("notes") or ""
        worksheet_profile = effective_profile_from_notes(notes)
        if worksheet_profile.get("included") is False:
            excluded_liabilities[account_id] = {"name": attrs.get("name")}
            continue

        owed = abs(_decimal_amount(attrs.get("current_balance")))
        loan_profile = parse_loan_profile_from_notes(notes)
        payment_amount = _decimal_amount(
            draft_planned_amount(loan_profile, worksheet_profile)
        )
        display = compute_liability_display_fields(
            owed, loan_profile, attrs, payment_amount
        )
        balances["liabilities"][account_id] = {
            "name": attrs.get("name"),
            "funding_bucket_key": worksheet_profile.get("funding_bucket_key"),
            "default_planned_payment": worksheet_profile.get("default_planned_payment"),
            "owed": _format_decimal(owed),
            "est_interest": display["est_interest"],
            "remaining_payments": display["remaining_payments"],
        }

        row_key = liability_row_key(account_id)
        existing_state = state_rows.get(row_key)
        if existing_state and existing_state.get("planned_amount_override"):
            continue
        planned = draft_planned_amount(loan_profile, worksheet_profile)
        await sidecar_db.upsert_worksheet_state_row(
            row_key=row_key,
            row_type="liability",
            month=month,
            planned_amount=planned,
            planned_amount_override=0,
        )

    balances["excluded_liabilities"] = excluded_liabilities

    registry_rows = await sidecar_db.list_worksheet_registry()
    for reg in registry_rows:
        bill_id = reg.get("firefly_bill_id")
        if not bill_id:
            continue
        reg_id = str(reg["id"])
        try:
            ff_bill = await client.fetch_bill(str(bill_id))
        except RuntimeError as exc:
            logger.warning(
                "Skipping registry %s: Firefly bill %s unavailable: %s",
                reg_id,
                bill_id,
                exc,
            )
            balances["bills"][reg_id] = {
                "owed": "0.00",
                "firefly_bill_id": str(bill_id),
                "name": reg.get("row_label"),
                "unavailable": True,
            }
            continue
        if reg.get("amount_mode") == "intermittent":
            owed = "0.00"
        else:
            owed = compute_bill_owed_from_firefly(
                ff_bill, amount_mode=str(reg.get("amount_mode") or "recurring")
            )
        balances["bills"][reg_id] = {
            "owed": owed,
            "firefly_bill_id": str(bill_id),
            "name": ff_bill.get("name") or reg.get("row_label"),
        }

        if reg.get("amount_mode") == "intermittent":
            continue
        # Bill planned amounts are user-entered on the worksheet; only liabilities/CC auto-draft.

    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at=refreshed_at,
        balances_json=json.dumps(balances),
    )
    return {"refreshed_at": refreshed_at, "month": month}
