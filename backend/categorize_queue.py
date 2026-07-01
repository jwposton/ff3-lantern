"""Build pending uncategorized transaction queue for AI categorization."""

from __future__ import annotations

from typing import Any

from firefly_client import FireflyClient
from transaction_normalization import is_uncategorized_for_queue

_PENDING_FIELDS = (
    "journal_id",
    "transaction_journal_id",
    "date",
    "amount",
    "description",
    "type",
    "source_name",
    "destination_name",
    "budget_name",
)


def _to_pending_row(flat: dict[str, Any]) -> dict[str, Any]:
    return {key: flat.get(key) for key in _PENDING_FIELDS}


async def build_pending_queue(
    client: FireflyClient,
    start: str,
    end: str,
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return uncategorized withdrawals/deposits sorted by date desc, journal_id."""
    cap = min(max(limit, 1), 100)
    flat = await client.fetch_splits(start, end)
    pending = [
        _to_pending_row(row)
        for row in flat
        if is_uncategorized_for_queue(row)
    ]
    pending.sort(
        key=lambda r: (r.get("date") or "", r.get("journal_id") or ""),
        reverse=True,
    )
    return pending[:cap]
