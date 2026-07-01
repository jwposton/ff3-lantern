"""Loan payment fingerprint matching (LOAN-02)."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


def _decimal(value: str | Decimal | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _month_key(date_str: str | None) -> str | None:
    if not date_str or len(date_str) < 7:
        return None
    return date_str[:7]


def match_split_to_profile(
    flat_split: dict[str, Any],
    profile: dict[str, Any],
    *,
    month_counts: dict[str, int] | None = None,
) -> bool:
    """Return True when flat split matches profile fingerprint."""
    if not profile.get("enabled"):
        return False
    split_count = flat_split.get("split_count", 1)
    try:
        split_count = int(split_count)
    except (TypeError, ValueError):
        split_count = 1
    if split_count > 1:
        return False
    match_cfg = profile.get("match") or {}
    expected_type = match_cfg.get("type") or "transfer"
    if (flat_split.get("type") or "").lower() != expected_type.lower():
        return False
    needle = (match_cfg.get("description_contains") or "").lower()
    haystack = (flat_split.get("description") or "").lower()
    if needle and needle not in haystack:
        return False
    expected = _decimal(match_cfg.get("expected_amount"))
    tolerance = _decimal(match_cfg.get("amount_tolerance")) or Decimal("0")
    amount = _decimal(flat_split.get("amount"))
    if expected is not None and amount is not None:
        if abs(abs(amount) - abs(expected)) > tolerance:
            return False
    source_id = match_cfg.get("source_account_id")
    if source_id and str(flat_split.get("source_id") or "") != str(source_id):
        return False
    import_dest = match_cfg.get("import_destination_account_id")
    if import_dest and str(flat_split.get("destination_id") or "") != str(import_dest):
        return False
    max_per_month = match_cfg.get("max_per_month")
    if max_per_month is not None and month_counts is not None:
        month = _month_key(flat_split.get("date"))
        profile_id = str(profile.get("_account_id") or profile.get("account_id") or "")
        key = f"{profile_id}:{month}"
        if month and month_counts.get(key, 0) >= int(max_per_month):
            return False
    return True


def find_matching_profile(
    flat_split: dict[str, Any],
    profiles: list[dict[str, Any]],
    month_counts: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    for profile in profiles:
        if match_split_to_profile(flat_split, profile, month_counts=month_counts):
            return profile
    return None


def amount_outside_tolerance(flat_split: dict[str, Any], profile: dict[str, Any]) -> bool:
    """True when description matches but amount is outside tolerance (review tier)."""
    match_cfg = profile.get("match") or {}
    needle = (match_cfg.get("description_contains") or "").lower()
    haystack = (flat_split.get("description") or "").lower()
    if needle and needle not in haystack:
        return False
    expected = _decimal(match_cfg.get("expected_amount"))
    tolerance = _decimal(match_cfg.get("amount_tolerance")) or Decimal("0")
    amount = _decimal(flat_split.get("amount"))
    if expected is None or amount is None:
        return False
    return abs(abs(amount) - abs(expected)) > tolerance
