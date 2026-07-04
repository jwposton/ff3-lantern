"""Loan profile JSON embedded in Firefly liability account notes (WRITE-04)."""

from __future__ import annotations

import json

from firefly_client import FireflyClient

LOAN_PROFILE_MARKER = "<!-- ff3lantern:loan_profile.v1 -->"
LOAN_PROFILE_LEGACY_MARKER = "<!-- ff3analytics:loan_profile.v1 -->"
_LOAN_PROFILE_MARKERS = (LOAN_PROFILE_MARKER, LOAN_PROFILE_LEGACY_MARKER)


def _find_marker(notes: str) -> tuple[str, int] | None:
    found: tuple[str, int] | None = None
    for marker in _LOAN_PROFILE_MARKERS:
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
    for marker in _LOAN_PROFILE_MARKERS:
        result = _strip_marker_block(result, marker)
    return result


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
