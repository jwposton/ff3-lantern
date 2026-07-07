"""Shared helpers for liability-anchored Firefly journals (history + split inference)."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any


def decimal_amount(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def group_splits_by_journal(
    splits: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for split in splits:
        journal_id = str(split.get("journal_id") or "")
        if not journal_id:
            continue
        grouped[journal_id].append(split)
    return grouped


def liability_principal_legs(
    journal_splits: list[dict[str, Any]],
    account_id: str,
) -> list[dict[str, Any]]:
    """Splits that post a payment into this liability account.

    Most Firefly transfers use destination_id = liability. Some journals record
    the inflow on the liability leg with source_id = liability and a positive amount.
    """
    liability_id = str(account_id)
    legs: list[dict[str, Any]] = []
    for split in journal_splits:
        dest_id = str(split.get("destination_id") or "")
        source_id = str(split.get("source_id") or "")
        if dest_id == liability_id:
            legs.append(split)
            continue
        if source_id == liability_id and decimal_amount(split.get("amount")) > 0:
            legs.append(split)
    return legs


def sibling_legs(
    journal_splits: list[dict[str, Any]],
    account_id: str,
) -> list[dict[str, Any]]:
    principal = liability_principal_legs(journal_splits, account_id)
    principal_keys = {
        (
            str(split.get("transaction_journal_id") or ""),
            str(split.get("destination_id") or ""),
            str(split.get("amount") or ""),
        )
        for split in principal
    }
    siblings: list[dict[str, Any]] = []
    for split in journal_splits:
        key = (
            str(split.get("transaction_journal_id") or ""),
            str(split.get("destination_id") or ""),
            str(split.get("amount") or ""),
        )
        if key in principal_keys:
            continue
        siblings.append(split)
    return siblings


def is_expense_account(accounts: dict[str, dict[str, Any]], account_id: str) -> bool:
    acct = accounts.get(str(account_id)) or {}
    raw_type = str(acct.get("type") or "").lower()
    return raw_type in ("expense", "expense account")


def component_destinations_by_role(
    loan_profile: dict[str, Any],
) -> dict[str, str]:
    destinations: dict[str, str] = {}
    for comp in (loan_profile.get("split") or {}).get("components") or []:
        role = comp.get("role")
        if role == "principal":
            continue
        dest_id = str(comp.get("destination_account_id") or "").strip()
        if role and dest_id:
            destinations[str(role)] = dest_id
    return destinations


def payment_amounts_from_liability_journal(
    journal_splits: list[dict[str, Any]],
    *,
    account_id: str,
    sibling_destinations_by_role: dict[str, str] | None = None,
    accounts: dict[str, dict[str, Any]] | None = None,
) -> tuple[Decimal, Decimal, Decimal] | None:
    """Principal from liability legs; interest/escrow from mapped or inferred siblings."""
    legs = liability_principal_legs(journal_splits, account_id)
    if not legs:
        return None

    principal = sum(abs(decimal_amount(split.get("amount"))) for split in legs)
    interest = Decimal("0")
    escrow = Decimal("0")

    destinations = sibling_destinations_by_role or {}
    if destinations:
        interest_dest = destinations.get("interest")
        escrow_dest = destinations.get("escrow")
        for split in sibling_legs(journal_splits, account_id):
            dest_id = str(split.get("destination_id") or "")
            amount = abs(decimal_amount(split.get("amount")))
            if interest_dest and dest_id == interest_dest:
                interest += amount
            elif escrow_dest and dest_id == escrow_dest:
                escrow += amount
        return principal, interest, escrow

    siblings = sibling_legs(journal_splits, account_id)
    if not siblings:
        return principal, interest, escrow

    ranked: list[tuple[Decimal, dict[str, Any]]] = []
    for split in siblings:
        dest_id = str(split.get("destination_id") or "")
        if not dest_id:
            continue
        if accounts and dest_id == str(account_id):
            continue
        ranked.append((abs(decimal_amount(split.get("amount"))), split))
    if not ranked:
        return principal, interest, escrow

    ranked.sort(key=lambda row: row[0], reverse=True)
    interest = ranked[0][0]
    if len(ranked) > 1:
        escrow = ranked[1][0]
    return principal, interest, escrow


def journal_description(journal_splits: list[dict[str, Any]]) -> str:
    for split in journal_splits:
        desc = (split.get("description") or "").strip()
        if desc:
            return desc
    return "—"


def journal_date(journal_splits: list[dict[str, Any]]) -> str:
    for split in journal_splits:
        raw = split.get("date") or ""
        if len(raw) >= 10:
            return raw[:10]
    return ""


def count_liability_anchor_journals(
    splits: list[dict[str, Any]],
    account_id: str,
) -> int:
    count = 0
    for journal_splits in group_splits_by_journal(splits).values():
        if liability_principal_legs(journal_splits, account_id):
            count += 1
    return count
