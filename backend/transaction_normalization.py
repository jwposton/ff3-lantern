"""Normalize flat Firefly splits into OMNI reporting rows."""

from __future__ import annotations

from typing import Any

OMNI_KEYS = (
    "amount",
    "type",
    "source_account",
    "source_type",
    "source_role",
    "destination_account",
    "destination_type",
    "destination_role",
    "budget",
    "category",
    "date",
)


def assign_transfer_labels(row: dict[str, Any]) -> dict[str, Any]:
    """Apply OMNI §8 transfer pseudo-labels (D-07, D-08)."""
    if row.get("type") != "transfer":
        return row
    dest_role = row.get("destination_role") or ""
    dest_name = row.get("destination_account") or ""
    if dest_role == "Credit card":
        row["budget"] = "Credit Card Payment"
        row["category"] = f"{dest_name} Payment"
    else:
        row["category"] = f"Transfer to {dest_name}"
    return row


def normalize_transactions(flat_splits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert flat Firefly splits to OMNI rows plus journal_id (D-01–D-06, D-11)."""
    out: list[dict[str, Any]] = []
    for tx in flat_splits:
        amount = tx.get("amount")
        if amount is not None:
            amount = str(abs(float(amount)))
        budget = tx.get("budget_name") or tx.get("budget")
        category = tx.get("category_name") or tx.get("category")
        raw_journal_id = tx.get("journal_id")
        journal_id = raw_journal_id if raw_journal_id else None
        record = {
            "journal_id": journal_id,
            "amount": amount,
            "type": tx.get("type"),
            "source_account": tx.get("source_name") or tx.get("source_account"),
            "source_type": tx.get("source_type"),
            "source_role": tx.get("source_role"),
            "destination_account": tx.get("destination_name")
            or tx.get("destination_account"),
            "destination_type": tx.get("destination_type"),
            "destination_role": tx.get("destination_role"),
            "budget": budget if budget else None,
            "category": category if category else None,
            "date": (tx.get("date") or "")[:10],
        }
        out.append(assign_transfer_labels(record))
    return out


def spending_withdrawal_total(rows: list[dict[str, Any]]) -> float:
    """Sum withdrawal amounts from asset non-credit-card sources (D-14)."""
    total = 0.0
    for row in rows:
        if row.get("type") != "withdrawal":
            continue
        if row.get("source_type") != "Asset account":
            continue
        if row.get("source_role") == "Credit card":
            continue
        amount = row.get("amount")
        if amount is None:
            continue
        total += float(amount)
    return total
