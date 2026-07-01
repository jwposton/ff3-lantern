"""Build pending loan split queue (LOAN-02, LOAN-03, LOAN-07)."""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any

from amortization import balance_for_interest_calc, compute_payment_split
from firefly_client import FireflyClient
from loan_matcher import amount_outside_tolerance, find_matching_profile
from loan_profiles import parse_loan_profile_from_notes


def _forward_only_since() -> str:
    return os.environ.get("FF3ANALYTICS_LOAN_SPLITS_SINCE", "2026-07-01").strip()


def _is_liability_row(acct: dict[str, Any]) -> bool:
    raw_type = (acct.get("type") or "").lower()
    raw_role = (acct.get("role") or "").replace(" ", "").lower()
    if raw_role == "debt":
        return True
    return "liabilit" in raw_type


def _principal_component(profile: dict[str, Any]) -> dict[str, Any] | None:
    for comp in (profile.get("split") or {}).get("components") or []:
        if comp.get("role") == "principal":
            return comp
    return None


def _annual_rate(profile: dict[str, Any], liability_attrs: dict[str, Any]) -> Decimal:
    override = profile.get("rate_override")
    if override is not None and str(override).strip():
        return Decimal(str(override)) / Decimal("100")
    interest = liability_attrs.get("interest")
    if interest is None:
        raise ValueError("missing interest rate on liability account")
    return Decimal(str(interest)) / Decimal("100")


async def load_enabled_loan_profiles(client: FireflyClient) -> list[dict[str, Any]]:
    accounts = await client.fetch_accounts()
    profiles: list[dict[str, Any]] = []
    for aid, summary in accounts.items():
        if not _is_liability_row(summary):
            continue
        acct = await client.fetch_account(aid)
        attrs = acct.get("attributes", {})
        profile = parse_loan_profile_from_notes(attrs.get("notes") or "")
        if profile and profile.get("enabled"):
            enriched = dict(profile)
            enriched["_account_id"] = aid
            enriched["account_id"] = aid
            profiles.append(enriched)
    return profiles


def _annotate_split_counts(flat_splits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for row in flat_splits:
        jid = str(row.get("journal_id") or "")
        counts[jid] = counts.get(jid, 0) + 1
    annotated: list[dict[str, Any]] = []
    for row in flat_splits:
        copy = dict(row)
        jid = str(row.get("journal_id") or "")
        copy["split_count"] = counts.get(jid, 1)
        annotated.append(copy)
    return annotated


async def build_pending_loan_splits(
    client: FireflyClient,
    start: str,
    end: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    since = _forward_only_since()
    flat = await client.fetch_splits(start, end)
    flat = _annotate_split_counts(flat)
    flat = [row for row in flat if (row.get("date") or "") >= since]
    profiles = await load_enabled_loan_profiles(client)
    month_counts: dict[str, int] = {}
    pending: list[dict[str, Any]] = []
    for row in flat:
        profile = find_matching_profile(row, profiles, month_counts)
        if profile is None:
            continue
        month = (row.get("date") or "")[:7]
        pid = str(profile.get("_account_id") or "")
        key = f"{pid}:{month}"
        month_counts[key] = month_counts.get(key, 0) + 1
        principal_comp = _principal_component(profile)
        if principal_comp is None:
            continue
        liability_id = str(principal_comp.get("destination_account_id"))
        liability = await client.fetch_account(liability_id)
        liability_attrs = liability.get("attributes", {})
        payment = abs(Decimal(str(row.get("amount") or "0")))
        escrow = Decimal(str((profile.get("split") or {}).get("escrow_amount") or "0"))
        balance = balance_for_interest_calc(liability_attrs, payment)
        rate = _annual_rate(profile, liability_attrs)
        split_amounts = compute_payment_split(balance, rate, payment, escrow)
        warning = amount_outside_tolerance(row, profile)
        pending.append(
            {
                "journal_id": row.get("journal_id"),
                "transaction_journal_id": row.get("transaction_journal_id"),
                "description": row.get("description"),
                "amount": f"{payment:.2f}",
                "date": row.get("date"),
                "profile_account_id": pid,
                "preview": {
                    "principal": f"{split_amounts['principal']:.2f}",
                    "interest": f"{split_amounts['interest']:.2f}",
                    "escrow": f"{split_amounts['escrow']:.2f}",
                },
                "warning": warning,
            }
        )
    meta = {
        "count": len(pending),
        "start": start,
        "end": end,
        "forward_only_since": since,
    }
    return pending, meta
