"""Credit card promotional APR window resolution (#107)."""

from __future__ import annotations

import calendar
from datetime import date
from typing import Any

PROMO_FIELD_KEYS = (
    "special_apr_percent",
    "special_apr_start",
    "special_apr_end",
)


def _month_bounds(month_key: str) -> tuple[date, date]:
    year_str, month_str = month_key.split("-", 1)
    year = int(year_str)
    month = int(month_str)
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def promo_active_for_month(month_key: str, start: str, end: str) -> bool:
    """True when the worksheet month overlaps the inclusive promo date range (D-05/D-06)."""
    month_start, month_end = _month_bounds(month_key)
    try:
        promo_start = date.fromisoformat(start)
        promo_end = date.fromisoformat(end)
    except ValueError:
        return False
    return month_start <= promo_end and month_end >= promo_start


def _promo_fields_complete(profile: dict[str, Any]) -> bool:
    for key in PROMO_FIELD_KEYS:
        value = profile.get(key)
        if value is None:
            return False
        if not str(value).strip():
            return False
    return True


def resolve_credit_card_promo(
    profile: dict[str, Any], month_key: str
) -> dict[str, bool | str | None]:
    """Resolve promo_active and effective_apr_percent for a worksheet month (D-07/D-08)."""
    apr_percent = profile.get("apr_percent")
    if not _promo_fields_complete(profile):
        return {
            "promo_active": False,
            "effective_apr_percent": apr_percent,
        }

    special_apr_percent = str(profile["special_apr_percent"])
    special_apr_start = str(profile["special_apr_start"])
    special_apr_end = str(profile["special_apr_end"])
    active = promo_active_for_month(month_key, special_apr_start, special_apr_end)
    return {
        "promo_active": active,
        "effective_apr_percent": special_apr_percent if active else apr_percent,
    }


def _normalize_promo_value(value: Any) -> Any:
    if value is not None and str(value).strip() == "":
        return None
    return value


def validate_promo_bundle(updates: dict[str, Any]) -> None:
    """Reject partial promo config; allow clearing all three fields together (D-12)."""
    for key in PROMO_FIELD_KEYS:
        if key in updates:
            updates[key] = _normalize_promo_value(updates[key])

    touched = [key for key in PROMO_FIELD_KEYS if key in updates]
    if not touched:
        return

    if len(touched) == len(PROMO_FIELD_KEYS) and all(
        updates.get(key) is None for key in PROMO_FIELD_KEYS
    ):
        return

    present = [key for key in PROMO_FIELD_KEYS if updates.get(key) is not None]
    if len(present) != len(PROMO_FIELD_KEYS):
        raise ValueError(
            "Promo rate requires all-or-nothing: special_apr_percent, "
            "special_apr_start, and special_apr_end must be set together."
        )
