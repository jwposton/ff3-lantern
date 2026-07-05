"""Payment worksheet compute from sidecar snapshots only (PAY-04, PAY-09, PAY-11, PAY-14–PAY-16)."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import sidecar_db
from payment_worksheet_liabilities import is_real_estate_liability, liability_row_key


def cc_row_key(account_id: str) -> str:
    return f"cc:{account_id}"


def bill_row_key(registry_id: int | str) -> str:
    return f"bill:{registry_id}"


def credit_card_display_sort_key(row: dict[str, Any]) -> tuple[int, str, str]:
    raw = row.get("sort_order")
    try:
        order = int(raw) if raw is not None else 999_999
    except (TypeError, ValueError):
        order = 999_999
    return (order, (row.get("name") or "").casefold(), str(row["account_id"]))


def bill_row_display_sort_key(row: dict[str, Any]) -> tuple[int, str, int]:
    """Cash monthly → cash intermittent → credit monthly → credit intermittent."""
    rail = (row.get("payment_rail") or "bank").strip()
    mode = (row.get("amount_mode") or "recurring").strip()
    is_credit = rail == "credit_card"
    is_intermittent = mode == "intermittent"
    if not is_credit and not is_intermittent:
        group = 0
    elif not is_credit and is_intermittent:
        group = 1
    elif is_credit and not is_intermittent:
        group = 2
    else:
        group = 3
    label = (row.get("row_label") or "").casefold()
    return (group, label, int(row["registry_id"]))


def _decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _resolve_amount_due(
    state: dict[str, Any],
    *,
    refresh_default: str,
    planned_default: str | None = None,
) -> tuple[str, bool]:
    """Worksheet amount due: override from state, else planned (liabilities) or refresh (bills)."""
    if state.get("amount_due_override"):
        return state.get("amount_due", refresh_default), True
    if planned_default is not None:
        return planned_default, False
    return refresh_default, False


def _row_type_from_key(row_key: str) -> str:
    prefix = row_key.split(":", 1)[0]
    if prefix == "bill":
        return "bill"
    if prefix == "liability":
        return "liability"
    return "credit_card"


def _add_outflow(
    outflow_by_bucket: dict[str, Decimal],
    bucket_key: str | None,
    amount: Decimal,
    counts_toward: bool,
) -> None:
    if not bucket_key or not counts_toward or amount == 0:
        return
    outflow_by_bucket[bucket_key] = outflow_by_bucket.get(bucket_key, Decimal("0")) + amount


def compute_bucket_rollups(
    buckets: list[dict[str, Any]],
    refresh_snapshot: dict[str, Any] | None,
    bucket_balances: list[dict[str, Any]],
    cc_rows: list[dict[str, Any]],
    bill_rows: list[dict[str, Any]],
    liability_rows: list[dict[str, Any]],
    worksheet_state: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compute per-bucket rollups and footer totals from sidecar data."""
    del worksheet_state

    refresh_buckets = (refresh_snapshot or {}).get("buckets", {})
    balance_by_key = {row["bucket_key"]: row for row in bucket_balances}

    outflow_by_bucket: dict[str, Decimal] = {}
    for card in cc_rows:
        _add_outflow(
            outflow_by_bucket,
            card.get("funding_bucket_key"),
            _decimal_amount(card.get("planned_amount")),
            True,
        )
    for bill in bill_rows:
        _add_outflow(
            outflow_by_bucket,
            bill.get("funding_bucket_key"),
            _decimal_amount(bill.get("planned_amount")),
            bool(bill.get("counts_toward_cash_plan")),
        )
    for liability in liability_rows:
        if liability.get("account_id"):
            _add_outflow(
                outflow_by_bucket,
                liability.get("funding_bucket_key"),
                _decimal_amount(liability.get("planned_amount")),
                True,
            )

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


def compute_section_subtotals(
    bills: list[dict[str, Any]],
    liabilities: list[dict[str, Any]],
    credit_cards: list[dict[str, Any]],
) -> dict[str, Any]:
    bills_due = Decimal("0")
    bills_planned = Decimal("0")
    on_card_informational = Decimal("0")
    for row in bills:
        amount_due = _decimal_amount(row.get("amount_due"))
        bills_due += amount_due
        if row.get("payment_rail") == "credit_card":
            on_card_informational += amount_due
        if row.get("counts_toward_cash_plan"):
            bills_planned += _decimal_amount(row.get("planned_amount"))

    liabilities_owed = Decimal("0")
    liabilities_due = Decimal("0")
    liabilities_planned = Decimal("0")
    for row in liabilities:
        liabilities_due += _decimal_amount(row.get("amount_due"))
        if row.get("account_id"):
            liabilities_owed += _decimal_amount(row.get("owed"))
            liabilities_planned += _decimal_amount(row.get("planned_amount"))
        elif row.get("counts_toward_cash_plan"):
            liabilities_planned += _decimal_amount(row.get("planned_amount"))

    cc_planned = sum(
        (_decimal_amount(card.get("planned_amount")) for card in credit_cards),
        Decimal("0"),
    )

    bills_subtotal: dict[str, str] = {
        "owed": "0.00",
        "due": _format_decimal(bills_due),
        "planned_cash": _format_decimal(bills_planned),
    }
    if on_card_informational > 0:
        bills_subtotal["on_card_informational"] = _format_decimal(on_card_informational)

    return {
        "bills": bills_subtotal,
        "liabilities": {
            "owed": _format_decimal(liabilities_owed),
            "due": _format_decimal(liabilities_due),
            "planned_cash": _format_decimal(liabilities_planned),
        },
        "credit_cards": {
            "planned_cash": _format_decimal(cc_planned),
        },
    }


def _planned_credit_total(
    bills: list[dict[str, Any]],
    liabilities: list[dict[str, Any]],
) -> Decimal:
    total = Decimal("0")
    for row in bills:
        if not row.get("counts_toward_cash_plan"):
            total += _decimal_amount(row.get("planned_amount"))
    for row in liabilities:
        if row.get("account_id"):
            continue
        if not row.get("counts_toward_cash_plan"):
            total += _decimal_amount(row.get("planned_amount"))
    return total


def _due_by_rail(
    bills: list[dict[str, Any]],
    liabilities: list[dict[str, Any]],
) -> tuple[Decimal, Decimal]:
    due_cash = Decimal("0")
    due_credit = Decimal("0")
    for row in bills:
        amount_due = _decimal_amount(row.get("amount_due"))
        if row.get("payment_rail") == "credit_card":
            due_credit += amount_due
        else:
            due_cash += amount_due
    for row in liabilities:
        amount_due = _decimal_amount(row.get("amount_due"))
        if row.get("payment_rail") == "credit_card":
            due_credit += amount_due
        else:
            due_cash += amount_due
    return due_cash, due_credit


def _liability_owed_breakdown(
    liabilities: list[dict[str, Any]],
) -> tuple[Decimal, Decimal, Decimal]:
    total = Decimal("0")
    real_estate = Decimal("0")
    loans = Decimal("0")
    for row in liabilities:
        if not row.get("account_id"):
            continue
        owed = _decimal_amount(row.get("owed"))
        total += owed
        if is_real_estate_liability(row):
            real_estate += owed
        else:
            loans += owed
    return total, real_estate, loans


def compute_grand_totals(
    bills: list[dict[str, Any]],
    liabilities: list[dict[str, Any]],
    credit_cards: list[dict[str, Any]],
) -> dict[str, Any]:
    section_subtotals = compute_section_subtotals(bills, liabilities, credit_cards)
    cc_owed = sum(
        (_decimal_amount(card.get("owed")) for card in credit_cards),
        Decimal("0"),
    )
    liabilities_owed, real_estate_owed, loans_owed = _liability_owed_breakdown(
        liabilities
    )
    owed = cc_owed + liabilities_owed
    due_cash, due_credit = _due_by_rail(bills, liabilities)
    due = due_cash + due_credit
    planned_cash = (
        _decimal_amount(section_subtotals["credit_cards"]["planned_cash"])
        + _decimal_amount(section_subtotals["bills"]["planned_cash"])
        + _decimal_amount(section_subtotals["liabilities"]["planned_cash"])
    )
    planned_credit = _planned_credit_total(bills, liabilities)
    planned_total = planned_cash + planned_credit

    owed_breakdown: dict[str, str] = {
        "liabilities": _format_decimal(liabilities_owed),
        "revolving": _format_decimal(cc_owed),
    }
    if real_estate_owed > 0:
        owed_breakdown["real_estate"] = _format_decimal(real_estate_owed)
    if loans_owed > 0:
        owed_breakdown["loans"] = _format_decimal(loans_owed)

    return {
        "owed": _format_decimal(owed),
        "due": _format_decimal(due),
        "planned_cash": _format_decimal(planned_cash),
        "planned_total": _format_decimal(planned_total),
        "breakdown": {
            "owed": owed_breakdown,
            "due": {
                "cash": _format_decimal(due_cash),
                "credit": _format_decimal(due_credit),
            },
            "planned": {
                "cash": _format_decimal(planned_cash),
                "credit": _format_decimal(planned_credit),
            },
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
        # Skip profile-only stubs mistakenly stored for non-card accounts.
        if "new_total" not in snapshot and "owed" not in snapshot:
            continue
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
                "sort_order": snapshot.get("sort_order"),
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

    cards.sort(key=credit_card_display_sort_key)
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


def _assemble_excluded_liabilities(
    refresh_snapshot: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if refresh_snapshot is None:
        return []
    excluded = refresh_snapshot.get("excluded_liabilities") or {}
    rows = [
        {
            "account_id": account_id,
            "name": meta.get("name"),
        }
        for account_id, meta in excluded.items()
    ]
    rows.sort(key=lambda row: (row.get("name") or "", row["account_id"]))
    return rows


def _assemble_liability_accounts(
    refresh_snapshot: dict[str, Any] | None,
    worksheet_state: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if refresh_snapshot is None:
        return []
    state_by_key = {row["row_key"]: row for row in worksheet_state}
    rows: list[dict[str, Any]] = []
    for account_id, snapshot in refresh_snapshot.get("liabilities", {}).items():
        row_key = liability_row_key(account_id)
        state = state_by_key.get(row_key, {})
        planned_amount = state.get("planned_amount", "0.00")
        amount_due, amount_due_override = _resolve_amount_due(
            state,
            refresh_default=planned_amount,
            planned_default=planned_amount,
        )
        rows.append(
            {
                "account_id": account_id,
                "row_key": row_key,
                "name": snapshot.get("name"),
                "funding_bucket_key": snapshot.get("funding_bucket_key"),
                "default_planned_payment": snapshot.get("default_planned_payment"),
                "owed": snapshot.get("owed", "0.00"),
                "amount_due": amount_due,
                "amount_due_override": amount_due_override,
                "est_interest": snapshot.get("est_interest"),
                "remaining_payments": snapshot.get("remaining_payments"),
                "account_role": snapshot.get("account_role"),
                "liability_type": snapshot.get("liability_type"),
                "has_escrow": bool(snapshot.get("has_escrow")),
                "planned_amount": planned_amount,
                "planned_amount_override": bool(state.get("planned_amount_override")),
                "paid_at": state.get("paid_at"),
            }
        )
    rows.sort(key=lambda row: (row.get("name") or "", row["account_id"]))
    return rows


def _assemble_bill_rows(
    registry_rows: list[dict[str, Any]],
    refresh_snapshot: dict[str, Any] | None,
    worksheet_state: list[dict[str, Any]],
    worksheet_section: str,
) -> list[dict[str, Any]]:
    if refresh_snapshot is None:
        return []
    state_by_key = {row["row_key"]: row for row in worksheet_state}
    bills_snapshot = refresh_snapshot.get("bills") or {}
    rows: list[dict[str, Any]] = []
    for reg in registry_rows:
        if reg.get("worksheet_section") != worksheet_section:
            continue
        reg_id = reg["id"]
        row_key = bill_row_key(reg_id)
        state = state_by_key.get(row_key, {})
        snap = bills_snapshot.get(str(reg_id), {})
        refresh_due = snap.get("owed", "0.00")
        amount_due, amount_due_override = _resolve_amount_due(
            state,
            refresh_default=refresh_due,
        )
        rows.append(
            {
                "registry_id": reg_id,
                "row_key": row_key,
                "row_label": reg.get("row_label") or snap.get("name"),
                "firefly_bill_id": reg.get("firefly_bill_id"),
                "amount_due": amount_due,
                "amount_due_override": amount_due_override,
                "planned_amount": state.get("planned_amount", "0.00"),
                "planned_amount_override": bool(state.get("planned_amount_override")),
                "paid_at": state.get("paid_at"),
                "payment_rail": reg.get("payment_rail"),
                "counts_toward_cash_plan": bool(reg.get("counts_toward_cash_plan")),
                "funding_bucket_key": reg.get("funding_bucket_key"),
                "credit_card_account_id": reg.get("credit_card_account_id"),
                "amount_mode": reg.get("amount_mode"),
                "worksheet_section": reg.get("worksheet_section"),
                "bill_group_id": reg.get("bill_group_id"),
                "show_in_group": bool(reg.get("show_in_group")),
            }
        )
    rows.sort(key=bill_row_display_sort_key)
    return rows


async def _slim_bill_groups_for_worksheet() -> list[dict[str, Any]]:
    groups = await sidecar_db.list_bill_groups()
    result: list[dict[str, Any]] = []
    for row in groups:
        members = await sidecar_db.list_bill_group_members(row["id"])
        result.append(
            {
                "id": row["id"],
                "label": row["label"],
                "sort_order": row["sort_order"],
                "member_count": len(members),
                "visible_count": sum(1 for member in members if member["show_in_group"]),
            }
        )
    return result


async def build_worksheet_envelope(month: str) -> dict[str, Any]:
    """Assemble worksheet JSON from sidecar only — never calls Firefly (D-07)."""
    buckets = await sidecar_db.list_funding_buckets()
    registry_rows = await sidecar_db.list_worksheet_registry()
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
    excluded_liabilities = _assemble_excluded_liabilities(refresh_snapshot)
    liability_accounts = _assemble_liability_accounts(refresh_snapshot, worksheet_state)
    bills = _assemble_bill_rows(registry_rows, refresh_snapshot, worksheet_state, "bills")
    bill_liabilities = _assemble_bill_rows(
        registry_rows, refresh_snapshot, worksheet_state, "liabilities"
    )
    liabilities = liability_accounts + bill_liabilities

    rollups = compute_bucket_rollups(
        buckets,
        refresh_snapshot,
        bucket_balances,
        credit_cards,
        bills + bill_liabilities,
        liability_accounts,
        worksheet_state,
    )
    section_subtotals = compute_section_subtotals(bills, liabilities, credit_cards)
    grand_totals = compute_grand_totals(bills, liabilities, credit_cards)
    bill_groups = await _slim_bill_groups_for_worksheet()

    return {
        "month": month,
        "refreshed_at": refreshed_at,
        "buckets": rollups["buckets"],
        "credit_cards": credit_cards,
        "excluded_credit_cards": excluded_credit_cards,
        "bills": bills,
        "liabilities": liabilities,
        "excluded_liabilities": excluded_liabilities,
        "bill_groups": bill_groups,
        "section_subtotals": section_subtotals,
        "grand_totals": grand_totals,
        "shortfall": rollups["shortfall"],
        "totals": rollups["totals"],
    }
