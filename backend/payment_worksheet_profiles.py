"""Payment worksheet profile JSON embedded in Firefly asset account notes (PAY-05)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import sidecar_db
from firefly_client import FireflyClient, _normalize_account_role, _normalize_account_type

PAYMENT_WORKSHEET_MARKER = "<!-- ff3analytics:payment_worksheet.v1 -->"

DEFAULT_PROFILE: dict[str, Any] = {
    "included": True,
    "worksheet_section": "credit",
}

CLEARABLE_OPTIONAL_KEYS = (
    "funding_bucket_key",
    "credit_limit",
    "default_planned_payment",
)


def _extract_json_after_marker(notes: str) -> str | None:
    idx = notes.find(PAYMENT_WORKSHEET_MARKER)
    if idx == -1:
        return None
    rest = notes[idx + len(PAYMENT_WORKSHEET_MARKER) :].lstrip()
    if not rest.startswith("{"):
        return None
    depth = 0
    for i, ch in enumerate(rest):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return rest[: i + 1]
    return None


def _strip_profile_block(notes: str) -> str:
    idx = notes.find(PAYMENT_WORKSHEET_MARKER)
    if idx == -1:
        return notes
    before = notes[:idx].rstrip()
    suffix = notes[idx:]
    raw_json = _extract_json_after_marker(suffix)
    if raw_json is None:
        return before
    after_marker = suffix[len(PAYMENT_WORKSHEET_MARKER) :].lstrip()
    json_pos = after_marker.find(raw_json)
    after_json = after_marker[json_pos + len(raw_json) :].strip()
    parts = [p for p in (before, after_json) if p]
    return "\n\n".join(parts)


def parse_payment_worksheet_from_notes(notes: str) -> dict | None:
    if not notes:
        return None
    raw_json = _extract_json_after_marker(notes)
    if raw_json is None:
        return None
    try:
        return json.loads(raw_json)
    except json.JSONDecodeError:
        return None


def serialize_payment_worksheet_to_notes(
    profile: dict, existing_notes: str = ""
) -> str:
    base = _strip_profile_block(existing_notes or "")
    profile_json = json.dumps(profile, indent=2)
    block = f"{PAYMENT_WORKSHEET_MARKER}\n{profile_json}"
    if base:
        return f"{base}\n\n{block}"
    return block


def effective_profile_from_notes(notes: str) -> dict[str, Any]:
    """Return merged profile; cards without marker are included by default (D-05)."""
    parsed = parse_payment_worksheet_from_notes(notes)
    if parsed is None:
        return dict(DEFAULT_PROFILE)
    return {**DEFAULT_PROFILE, **parsed}


def merge_payment_worksheet_profile(
    existing: dict[str, Any] | None, updates: dict[str, Any]
) -> dict[str, Any]:
    base = dict(DEFAULT_PROFILE)
    if existing:
        base.update(existing)
    for key, value in updates.items():
        if key in CLEARABLE_OPTIONAL_KEYS:
            if value is None:
                base.pop(key, None)
            else:
                base[key] = value
        elif value is not None:
            base[key] = value
    return base


def is_credit_card_asset(attrs: dict[str, Any]) -> bool:
    acct_type = _normalize_account_type(attrs.get("type"))
    role = _normalize_account_role(attrs.get("account_role"))
    return acct_type == "Asset account" and role == "Credit card"


def is_funding_bucket_eligible_summary(summary: dict[str, Any]) -> bool:
    """True for fetch_accounts() rows that may fund a bucket (asset, not credit card)."""
    return (
        summary.get("type") == "Asset account"
        and summary.get("role") != "Credit card"
    )


def current_month_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def patch_worksheet_refresh_profile(
    month: str,
    account_id: str,
    profile: dict[str, Any],
    updates: dict[str, Any] | None = None,
) -> None:
    row = await sidecar_db.get_worksheet_refresh(month)
    if row is None:
        return
    balances = json.loads(row["balances_json"])
    credit_cards = balances.setdefault("credit_cards", {})
    if profile.get("included") is False:
        credit_cards.pop(account_id, None)
    else:
        entry = credit_cards.setdefault(account_id, {})
        if updates is not None and "funding_bucket_key" in updates:
            entry["funding_bucket_key"] = updates["funding_bucket_key"]
        elif "funding_bucket_key" in profile:
            entry["funding_bucket_key"] = profile.get("funding_bucket_key")
        if updates is not None and "credit_limit" in updates:
            entry["credit_limit"] = updates["credit_limit"]
        elif "credit_limit" in profile:
            entry["credit_limit"] = profile.get("credit_limit")
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at=row["refreshed_at"],
        balances_json=json.dumps(balances),
    )


async def write_payment_worksheet_profile(
    client: FireflyClient, account_id: str, profile: dict[str, Any]
) -> dict[str, Any]:
    account = await client.fetch_account(account_id)
    attrs = account.get("attributes", {})
    existing_notes = attrs.get("notes") or ""
    new_notes = serialize_payment_worksheet_to_notes(profile, existing_notes)
    merged = {**attrs, "notes": new_notes}
    await client.update_account(account_id, merged)
    return profile
