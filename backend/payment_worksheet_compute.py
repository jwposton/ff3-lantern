"""Payment worksheet compute from sidecar snapshots only (PAY-04, PAY-09, PAY-11)."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import sidecar_db


def cc_row_key(account_id: str) -> str:
    return f"cc:{account_id}"


def _decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def compute_bucket_rollups(
    buckets: list[dict[str, Any]],
    refresh_snapshot: dict[str, Any] | None,
    bucket_balances: list[dict[str, Any]],
    cc_rows: list[dict[str, Any]],
    worksheet_state: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compute per-bucket rollups and footer totals from sidecar data."""
    del worksheet_state  # merged into cc_rows by build_worksheet_envelope

    refresh_buckets = (refresh_snapshot or {}).get("buckets", {})
    balance_by_key = {row["bucket_key"]: row for row in bucket_balances}

    outflow_by_bucket: dict[str, Decimal] = {}
    for card in cc_rows:
        bucket_key = card.get("funding_bucket_key")
        if not bucket_key:
            continue
        planned = _decimal_amount(card.get("planned_amount"))
        outflow_by_bucket[bucket_key] = outflow_by_bucket.get(bucket_key, Decimal("0")) + planned

    bucket_rows: list[dict[str, Any]] = []
    total_reported = Decimal("0")
    total_user = Decimal("0")
    total_remaining = Decimal("0")
    shortfall = False

    for bucket in buckets:
        bucket_id = bucket["id"]
        reported_raw = refresh_buckets.get(bucket_id, {}).get("reported_balance", "0.00")
        reported = _decimal_amount(reported_raw)

        balance_row = balance_by_key.get(bucket_id)
        if balance_row is not None:
            user_balance = _decimal_amount(balance_row["user_balance"])
            user_override = bool(balance_row.get("user_balance_override"))
        else:
            user_balance = reported
            user_override = False

        planned_outflows = outflow_by_bucket.get(bucket_id, Decimal("0"))
        remaining = user_balance - planned_outflows
        if remaining < 0:
            shortfall = True

        total_reported += reported
        total_user += user_balance
        total_remaining += remaining

        bucket_rows.append(
            {
                "id": bucket_id,
                "label": bucket["label"],
                "sort_order": bucket["sort_order"],
                "firefly_account_ids": bucket.get("firefly_account_ids") or [],
                "reported_balance": _format_decimal(reported),
                "user_balance": _format_decimal(user_balance),
                "user_balance_override": user_override,
                "planned_outflows": _format_decimal(planned_outflows),
                "remaining": _format_decimal(remaining),
            }
        )

    return {
        "buckets": bucket_rows,
        "shortfall": shortfall,
        "totals": {
            "reported_balance": _format_decimal(total_reported),
            "user_balance": _format_decimal(total_user),
            "remaining": _format_decimal(total_remaining),
        },
    }


def _assemble_credit_cards(
    refresh_snapshot: dict[str, Any] | None,
    worksheet_state: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if refresh_snapshot is None:
        return []

    state_by_key = {row["row_key"]: row for row in worksheet_state}
    cards: list[dict[str, Any]] = []

    for account_id, snapshot in refresh_snapshot.get("credit_cards", {}).items():
        row_key = cc_row_key(account_id)
        state = state_by_key.get(row_key, {})
        cards.append(
            {
                "account_id": account_id,
                "row_key": row_key,
                "name": snapshot.get("name"),
                "credit_limit": snapshot.get("credit_limit"),
                "funding_bucket_key": snapshot.get("funding_bucket_key"),
                "default_planned_payment": snapshot.get("default_planned_payment"),
                "apr_percent": snapshot.get("apr_percent"),
                "payment_due_day": snapshot.get("payment_due_day"),
                "owed": snapshot.get("owed", "0.00"),
                "new_total": snapshot.get("new_total", "0.00"),
                "interest_accrued": snapshot.get("interest_accrued", "0.00"),
                "fees": snapshot.get("fees", "0.00"),
                "last_payment_date": snapshot.get("last_payment_date"),
                "last_payment_amount": snapshot.get("last_payment_amount", "0.00"),
                "new_transactions": snapshot.get("new_transactions") or [],
                "planned_amount": state.get("planned_amount", "0.00"),
                "planned_amount_override": bool(state.get("planned_amount_override")),
                "paid_at": state.get("paid_at"),
            }
        )

    cards.sort(key=lambda row: (row.get("name") or "", row["account_id"]))
    return cards


def _assemble_excluded_credit_cards(
    refresh_snapshot: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if refresh_snapshot is None:
        return []
    excluded = refresh_snapshot.get("excluded_credit_cards") or {}
    rows = [
        {
            "account_id": account_id,
            "name": meta.get("name"),
        }
        for account_id, meta in excluded.items()
    ]
    rows.sort(key=lambda row: (row.get("name") or "", row["account_id"]))
    return rows


async def build_worksheet_envelope(month: str) -> dict[str, Any]:
    """Assemble worksheet JSON from sidecar only — never calls Firefly (D-07)."""
    buckets = await sidecar_db.list_funding_buckets()
    refresh_row = await sidecar_db.get_worksheet_refresh(month)
    worksheet_state = await sidecar_db.get_worksheet_state_for_month(month)
    bucket_balances = await sidecar_db.get_bucket_balances_for_month(month)

    refresh_snapshot: dict[str, Any] | None = None
    refreshed_at: str | None = None
    if refresh_row is not None:
        refreshed_at = refresh_row["refreshed_at"]
        refresh_snapshot = json.loads(refresh_row["balances_json"])

    credit_cards = _assemble_credit_cards(refresh_snapshot, worksheet_state)
    excluded_credit_cards = _assemble_excluded_credit_cards(refresh_snapshot)
    rollups = compute_bucket_rollups(
        buckets,
        refresh_snapshot,
        bucket_balances,
        credit_cards,
        worksheet_state,
    )

    return {
        "month": month,
        "refreshed_at": refreshed_at,
        "buckets": rollups["buckets"],
        "credit_cards": credit_cards,
        "excluded_credit_cards": excluded_credit_cards,
        "shortfall": rollups["shortfall"],
        "totals": rollups["totals"],
    }
