"""Application clock — pin \"today\" for public demo via FF3LANTERN_DEMO_ANCHOR_DATE."""

from __future__ import annotations

import os
from datetime import date, datetime, timezone

_ANCHOR_RAW = os.environ.get("FF3LANTERN_DEMO_ANCHOR_DATE", "").strip() or None


def demo_anchor_date_str() -> str | None:
    """ISO date (YYYY-MM-DD) when demo clock is active, else None."""
    return _ANCHOR_RAW


def demo_anchor_date() -> date | None:
    if not _ANCHOR_RAW:
        return None
    return date.fromisoformat(_ANCHOR_RAW)


def today() -> date:
    anchor = demo_anchor_date()
    return anchor if anchor is not None else date.today()


def now_utc() -> datetime:
    anchor = demo_anchor_date()
    if anchor is not None:
        return datetime(
            anchor.year, anchor.month, anchor.day, 12, 0, 0, tzinfo=timezone.utc
        )
    return datetime.now(timezone.utc)


def current_month_key() -> str:
    return today().strftime("%Y-%m")
