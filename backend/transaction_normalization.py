"""Normalize flat Firefly splits into OMNI reporting rows."""

from __future__ import annotations

import re
from typing import Any

_DIGIT_RUN = re.compile(r"\d+")
_PUNCT_RUN = re.compile(r"[^\w\s]+", re.UNICODE)
_WHITESPACE = re.compile(r"\s+")


def description_fingerprint(description: str) -> str:
    """Normalize merchant description for queue grouping (not rule triggers)."""
    if not description or not description.strip():
        return ""
    text = description.lower()
    if "*" in text:
        text = text.split("*", 1)[0]
    text = _DIGIT_RUN.sub(" ", text)
    text = _PUNCT_RUN.sub(" ", text)
    text = _WHITESPACE.sub(" ", text).strip()
    return text

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
    dest_type = row.get("destination_type") or ""
    dest_name = row.get("destination_account") or ""
    source_type = row.get("source_type") or ""
    source_role = row.get("source_role") or ""

    is_cc = dest_role == "Credit card"
    if (
        not is_cc
        and dest_type == "Asset account"
        and dest_role not in ("Default account", "Savings")
        and source_type == "Asset account"
        and source_role in ("Default account", "Savings")
    ):
        is_cc = True

    if is_cc:
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


def _empty_to_none(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _preview_normalized_category(flat_split: dict[str, Any]) -> str | None:
    """Category after OMNI normalization (including transfer pseudo-labels)."""
    budget = _empty_to_none(flat_split.get("budget_name") or flat_split.get("budget"))
    category = _empty_to_none(
        flat_split.get("category_name") or flat_split.get("category")
    )
    record: dict[str, Any] = {
        "type": flat_split.get("type"),
        "source_type": flat_split.get("source_type"),
        "source_role": flat_split.get("source_role"),
        "destination_account": flat_split.get("destination_name")
        or flat_split.get("destination_account"),
        "destination_type": flat_split.get("destination_type"),
        "destination_role": flat_split.get("destination_role"),
        "budget": budget if budget else None,
        "category": category if category else None,
    }
    return assign_transfer_labels(record).get("category")


def is_uncategorized_for_queue(flat_split: dict[str, Any]) -> bool:
    """True when a withdrawal/deposit lacks category and is not transfer-like."""
    tx_type = flat_split.get("type")
    if tx_type not in ("withdrawal", "deposit"):
        return False
    cat = flat_split.get("category_name") or flat_split.get("category")
    if _empty_to_none(cat) is not None:
        return False
    if _preview_normalized_category(flat_split):
        return False
    return True


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
