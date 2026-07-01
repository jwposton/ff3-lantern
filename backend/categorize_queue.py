"""Build pending uncategorized transaction queue for AI categorization."""

from __future__ import annotations

from typing import Any

from firefly_client import FireflyClient
from categorization_apply import is_categorize_ignored
from transaction_normalization import description_fingerprint, is_uncategorized_for_queue

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


def _is_categorize_queue_row(flat: dict[str, Any]) -> bool:
    """Withdrawals missing category and/or budget — deposits are excluded."""
    if is_categorize_ignored(flat):
        return False
    if (flat.get("type") or "").lower() != "withdrawal":
        return False
    return is_uncategorized_for_queue(flat)


async def build_pending_queue(
    client: FireflyClient,
    start: str,
    end: str,
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return withdrawals missing category and/or budget, sorted by date desc."""
    cap = min(max(limit, 1), 100)
    flat = await client.fetch_splits(start, end)
    pending = [
        _to_pending_row(row)
        for row in flat
        if _is_categorize_queue_row(row)
    ]
    pending.sort(
        key=lambda r: (r.get("date") or "", r.get("journal_id") or ""),
        reverse=True,
    )
    return pending[:cap]


async def build_grouped_pending_queue(
    client: FireflyClient,
    start: str,
    end: str,
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Bucket pending rows by description fingerprint, sorted by group size desc."""
    pending = await build_pending_queue(client, start, end, limit=limit)
    buckets: dict[str, list[dict[str, Any]]] = {}
    for row in pending:
        fp = description_fingerprint(row.get("description") or "")
        buckets.setdefault(fp, []).append(row)

    groups: list[dict[str, Any]] = []
    for fp, rows in buckets.items():
        rows_sorted = sorted(
            rows,
            key=lambda r: (r.get("date") or "", r.get("journal_id") or ""),
            reverse=True,
        )
        groups.append(
            {
                "fingerprint": fp,
                "count": len(rows_sorted),
                "sample_description": rows_sorted[0].get("description") or "",
                "journal_ids": [r["journal_id"] for r in rows_sorted],
                "rows": rows_sorted,
            }
        )
    groups.sort(key=lambda g: (-g["count"], g["fingerprint"]))
    return groups
