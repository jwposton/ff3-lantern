"""Payment worksheet profile JSON embedded in Firefly asset account notes (PAY-05)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import sidecar_db
from firefly_client import FireflyClient, _normalize_account_role, _normalize_account_type

PAYMENT_WORKSHEET_MARKER = "<!-- ff3lantern:payment_worksheet.v1 -->"
PAYMENT_WORKSHEET_LEGACY_MARKER = "<!-- ff3analytics:payment_worksheet.v1 -->"
_PAYMENT_WORKSHEET_MARKERS = (PAYMENT_WORKSHEET_MARKER, PAYMENT_WORKSHEET_LEGACY_MARKER)

DEFAULT_PROFILE: dict[str, Any] = {
    "included": True,
    "worksheet_section": "credit",
}

CLEARABLE_OPTIONAL_KEYS = (
    "funding_bucket_key",
    "credit_limit",
    "default_planned_payment",
    "apr_percent",
    "payment_due_day",
    "sort_order",
)


def _due_day_from_monthly_payment_date(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        try:
            day = int(text[8:10])
        except ValueError:
            return None
        if 1 <= day <= 31:
            return str(day)
    if text.isdigit():
        day = int(text)
        if 1 <= day <= 31:
            return str(day)
    return None


def _find_marker(notes: str) -> tuple[str, int] | None:
    found: tuple[str, int] | None = None
    for marker in _PAYMENT_WORKSHEET_MARKERS:
        idx = notes.find(marker)
        if idx != -1 and (found is None or idx < found[1]):
            found = (marker, idx)
    return found


def _extract_json_after_marker(notes: str) -> str | None:
    found = _find_marker(notes)
    if found is None:
        return None
    marker, idx = found
    rest = notes[idx + len(marker) :].lstrip()
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


def _strip_marker_block(notes: str, marker: str) -> str:
    idx = notes.find(marker)
    if idx == -1:
        return notes
    before = notes[:idx].rstrip()
    suffix = notes[idx:]
    raw_json = _extract_json_after_marker(suffix)
    if raw_json is None:
        return before
    after_marker = suffix[len(marker) :].lstrip()
    json_pos = after_marker.find(raw_json)
    after_json = after_marker[json_pos + len(raw_json) :].strip()
    parts = [p for p in (before, after_json) if p]
    return "\n\n".join(parts)


def _strip_profile_block(notes: str) -> str:
    result = notes
    for marker in _PAYMENT_WORKSHEET_MARKERS:
        result = _strip_marker_block(result, marker)
    return result


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
        balances: dict[str, Any] = {
            "buckets": {},
            "credit_cards": {},
            "excluded_credit_cards": {},
        }
        refreshed_at = (
            datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        )
    else:
        balances = json.loads(row["balances_json"])
        refreshed_at = row["refreshed_at"]
    credit_cards = balances.setdefault("credit_cards", {})
    excluded = balances.setdefault("excluded_credit_cards", {})
    if profile.get("included") is False:
        prior = credit_cards.pop(account_id, None)
        excluded[account_id] = {
            "name": (prior or {}).get("name"),
        }
    else:
        prior_meta = excluded.pop(account_id, {})
        entry = credit_cards.setdefault(account_id, {})
        if prior_meta.get("name") and not entry.get("name"):
            entry["name"] = prior_meta.get("name")
        if updates is not None and "funding_bucket_key" in updates:
            entry["funding_bucket_key"] = updates["funding_bucket_key"]
        elif "funding_bucket_key" in profile:
            entry["funding_bucket_key"] = profile.get("funding_bucket_key")
        if updates is not None and "credit_limit" in updates:
            entry["credit_limit"] = updates["credit_limit"]
        elif "credit_limit" in profile:
            entry["credit_limit"] = profile.get("credit_limit")
        if updates is not None and "default_planned_payment" in updates:
            entry["default_planned_payment"] = updates["default_planned_payment"]
        elif "default_planned_payment" in profile:
            entry["default_planned_payment"] = profile.get("default_planned_payment")
        if updates is not None and "apr_percent" in updates:
            entry["apr_percent"] = updates["apr_percent"]
        elif "apr_percent" in profile:
            entry["apr_percent"] = profile.get("apr_percent")
        if updates is not None and "payment_due_day" in updates:
            entry["payment_due_day"] = updates["payment_due_day"]
        elif "payment_due_day" in profile:
            entry["payment_due_day"] = profile.get("payment_due_day")
        if updates is not None and "sort_order" in updates:
            entry["sort_order"] = updates["sort_order"]
        elif "sort_order" in profile:
            entry["sort_order"] = profile.get("sort_order")
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at=refreshed_at,
        balances_json=json.dumps(balances),
    )


async def patch_worksheet_refresh_liability_profile(
    month: str,
    account_id: str,
    profile: dict[str, Any],
    updates: dict[str, Any] | None = None,
) -> None:
    """Patch liability rows in the refresh snapshot (not credit_cards)."""
    row = await sidecar_db.get_worksheet_refresh(month)
    if row is None:
        balances: dict[str, Any] = {
            "buckets": {},
            "liabilities": {},
            "excluded_liabilities": {},
        }
        refreshed_at = (
            datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        )
    else:
        balances = json.loads(row["balances_json"])
        refreshed_at = row["refreshed_at"]

    # Remove mistaken entries from credit card snapshot (legacy bug).
    balances.setdefault("credit_cards", {}).pop(account_id, None)
    balances.setdefault("excluded_credit_cards", {}).pop(account_id, None)

    liabilities = balances.setdefault("liabilities", {})
    excluded = balances.setdefault("excluded_liabilities", {})
    if profile.get("included") is False:
        prior = liabilities.pop(account_id, None)
        excluded[account_id] = {
            "name": (prior or {}).get("name"),
        }
    else:
        prior_meta = excluded.pop(account_id, {})
        entry = liabilities.setdefault(account_id, {})
        if prior_meta.get("name") and not entry.get("name"):
            entry["name"] = prior_meta.get("name")
        if updates is not None and "funding_bucket_key" in updates:
            entry["funding_bucket_key"] = updates["funding_bucket_key"]
        elif "funding_bucket_key" in profile:
            entry["funding_bucket_key"] = profile.get("funding_bucket_key")
        if updates is not None and "default_planned_payment" in updates:
            entry["default_planned_payment"] = updates["default_planned_payment"]
        elif "default_planned_payment" in profile:
            entry["default_planned_payment"] = profile.get("default_planned_payment")
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at=refreshed_at,
        balances_json=json.dumps(balances),
    )


async def write_payment_worksheet_profile(
    client: FireflyClient,
    account_id: str,
    profile: dict[str, Any],
    account_updates: dict[str, Any] | None = None,
) -> dict[str, Any]:
    account = await client.fetch_account(account_id)
    attrs = account.get("attributes", {})
    existing_notes = attrs.get("notes") or ""
    new_notes = serialize_payment_worksheet_to_notes(profile, existing_notes)
    merged = {**attrs, "notes": new_notes}
    if account_updates:
        for key, value in account_updates.items():
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
    await client.update_account(account_id, merged)
    return profile
