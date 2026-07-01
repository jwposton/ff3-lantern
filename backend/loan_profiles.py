"""Loan profile JSON embedded in Firefly liability account notes (WRITE-04)."""

from __future__ import annotations

import json

from firefly_client import FireflyClient

LOAN_PROFILE_MARKER = "<!-- ff3analytics:loan_profile.v1 -->"


def _extract_json_after_marker(notes: str) -> str | None:
    idx = notes.find(LOAN_PROFILE_MARKER)
    if idx == -1:
        return None
    rest = notes[idx + len(LOAN_PROFILE_MARKER) :].lstrip()
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
    idx = notes.find(LOAN_PROFILE_MARKER)
    if idx == -1:
        return notes
    before = notes[:idx].rstrip()
    suffix = notes[idx:]
    raw_json = _extract_json_after_marker(suffix)
    if raw_json is None:
        return before
    after_marker = suffix[len(LOAN_PROFILE_MARKER) :].lstrip()
    json_pos = after_marker.find(raw_json)
    after_json = after_marker[json_pos + len(raw_json) :].strip()
    parts = [p for p in (before, after_json) if p]
    return "\n\n".join(parts)


def parse_loan_profile_from_notes(notes: str) -> dict | None:
    if not notes:
        return None
    raw_json = _extract_json_after_marker(notes)
    if raw_json is None:
        return None
    try:
        return json.loads(raw_json)
    except json.JSONDecodeError:
        return None


def serialize_loan_profile_to_notes(profile: dict, existing_notes: str = "") -> str:
    base = _strip_profile_block(existing_notes or "")
    profile_json = json.dumps(profile, indent=2)
    block = f"{LOAN_PROFILE_MARKER}\n{profile_json}"
    if base:
        return f"{base}\n\n{block}"
    return block


async def read_loan_profile(client: FireflyClient, account_id: str) -> dict | None:
    account = await client.fetch_account(account_id)
    notes = account.get("attributes", {}).get("notes") or ""
    return parse_loan_profile_from_notes(notes)


async def write_loan_profile(
    client: FireflyClient, account_id: str, profile: dict
) -> dict:
    account = await client.fetch_account(account_id)
    attrs = account.get("attributes", {})
    existing_notes = attrs.get("notes") or ""
    new_notes = serialize_loan_profile_to_notes(profile, existing_notes)
    merged = {**attrs, "notes": new_notes}
    await client.update_account(account_id, merged)
    return profile
