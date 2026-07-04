"""Apply loan payment splits to Firefly (LOAN-05, LOAN-08)."""

from __future__ import annotations

import json
import os
from copy import deepcopy
from decimal import Decimal
from typing import Any

import sidecar_db
from amortization import apply_penny_adjustment
from firefly_client import FireflyClient


def _loan_tag() -> str:
    return os.environ.get("FF3LANTERN_LOAN_TAG", "loan-split").strip() or "loan-split"


def apply_penny_adjust_to_amounts(
    amounts: dict[str, str | Decimal], payment: Decimal
) -> dict[str, Decimal]:
    dec = {k: Decimal(str(v)) for k, v in amounts.items()}
    return apply_penny_adjustment(dec, abs(payment))


def _component_amounts(profile: dict[str, Any], amounts: dict[str, Decimal]) -> list[tuple[dict, Decimal]]:
    rows: list[tuple[dict, Decimal]] = []
    for comp in (profile.get("split") or {}).get("components") or []:
        role = comp.get("role")
        if role not in amounts:
            continue
        value = amounts[role]
        if value > 0:
            rows.append((comp, value))
    return rows


def _split_transaction_type(profile: dict[str, Any], flat_split: dict[str, Any]) -> str:
    """Firefly requires every split in a group to share the same transaction type."""
    return (
        (profile.get("match") or {}).get("type")
        or flat_split.get("type")
        or "transfer"
    )


def build_split_transactions(
    profile: dict[str, Any],
    flat_split: dict[str, Any],
    amounts: dict[str, Decimal],
) -> list[dict[str, Any]]:
    """Build Firefly transaction split dicts from profile components."""
    source_name = flat_split.get("source_name")
    source_id = flat_split.get("source_id")
    description = flat_split.get("description") or ""
    date = flat_split.get("date")
    budget = (profile.get("split") or {}).get("budget")
    txn_type = _split_transaction_type(profile, flat_split)
    txns: list[dict[str, Any]] = []
    for comp, amount in _component_amounts(profile, amounts):
        role = comp.get("role")
        dest_name = comp.get("destination_account")
        dest_id = comp.get("destination_account_id")
        entry: dict[str, Any] = {
            "type": txn_type,
            "amount": f"{amount:.2f}",
            "date": date,
            "description": description,
            "source_name": source_name,
            "destination_name": dest_name,
        }
        if source_id:
            entry["source_id"] = source_id
        if dest_id:
            entry["destination_id"] = dest_id
        comp_budget = comp.get("budget") or budget
        if comp_budget:
            entry["budget_name"] = comp_budget
        if comp.get("category"):
            entry["category_name"] = comp["category"]
        if role == "principal" and flat_split.get("transaction_journal_id"):
            entry["transaction_journal_id"] = flat_split["transaction_journal_id"]
        txns.append(entry)
    return txns


async def apply_loan_split(
    client: FireflyClient,
    group_id: str,
    transaction_journal_id: str,
    profile: dict[str, Any],
    flat_split: dict[str, Any],
    amounts: dict[str, str | Decimal],
) -> dict[str, Any]:
    payment = abs(Decimal(str(flat_split.get("amount") or "0")))
    adjusted = apply_penny_adjust_to_amounts(amounts, payment)
    new_splits = build_split_transactions(profile, flat_split, adjusted)
    if not new_splits:
        raise ValueError("no split components to apply")

    def mutate(attrs: dict[str, Any]) -> dict[str, Any]:
        updated = deepcopy(attrs)
        updated["transactions"] = new_splits
        tags = updated.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        tag = _loan_tag()
        if tag not in tags:
            tags.append(tag)
        updated["tags"] = tags
        return updated

    result = await client.update_transaction(group_id, mutate)
    await sidecar_db.log_audit(
        "loan_split_apply",
        journal_id=group_id,
        details_json=json.dumps(
            {
                "transaction_journal_id": transaction_journal_id,
                "profile_account_id": profile.get("_account_id")
                or profile.get("account_id"),
                "amounts": {k: str(v) for k, v in adjusted.items()},
            }
        ),
    )
    return result
