"""SQLite sidecar for AI suggestion cache, audit log, and payment worksheet (WRITE-05, PAY-01).

Tables:
- ai_suggestions: Phase 10 suggest cache keyed by (journal_id, model)
- audit_log: cross-automation write tracing for categorize/loan apply events
- funding_buckets, worksheet_registry, worksheet_state, worksheet_refresh,
  worksheet_bucket_balance: payment worksheet persistence (Phase 14)
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

__all__ = [
    "delete_funding_bucket",
    "get_bucket_balances_for_month",
    "get_data_dir",
    "get_db_path",
    "get_funding_bucket",
    "get_worksheet_refresh",
    "get_worksheet_state_for_month",
    "init_db",
    "is_writable",
    "list_funding_buckets",
    "log_audit",
    "get_suggestion",
    "upsert_bucket_balance",
    "upsert_funding_bucket",
    "upsert_suggestion",
    "upsert_worksheet_refresh",
    "upsert_worksheet_state_row",
]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ai_suggestions (
  journal_id TEXT NOT NULL,
  model TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (journal_id, model)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  journal_id TEXT,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS funding_buckets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  firefly_account_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS worksheet_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firefly_bill_id TEXT,
  worksheet_section TEXT,
  funding_bucket_key TEXT,
  amount_mode TEXT,
  planned_sync TEXT,
  payment_rail TEXT DEFAULT 'bank',
  counts_toward_cash_plan INTEGER DEFAULT 1,
  rule_id TEXT,
  row_label TEXT
);

CREATE TABLE IF NOT EXISTS worksheet_state (
  row_key TEXT NOT NULL,
  row_type TEXT NOT NULL,
  month TEXT NOT NULL,
  planned_amount TEXT NOT NULL DEFAULT '0.00',
  planned_amount_override INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  matched_journal_id TEXT,
  PRIMARY KEY (row_key, month)
);

CREATE TABLE IF NOT EXISTS worksheet_refresh (
  month TEXT PRIMARY KEY,
  refreshed_at TEXT NOT NULL,
  balances_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worksheet_bucket_balance (
  bucket_key TEXT NOT NULL,
  month TEXT NOT NULL,
  user_balance TEXT NOT NULL,
  user_balance_override INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, month)
);
"""


def get_data_dir() -> Path:
    return Path(os.environ.get("FF3ANALYTICS_DATA_DIR", "./data"))


def get_db_path() -> Path:
    return get_data_dir() / "ff3analytics.db"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_data_dir(data_dir: Path) -> None:
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        hint = (
            f"Cannot create or write data directory at {data_dir.resolve()!s}. "
            "Docker images use /data (bind-mount FF3ANALYTICS_DATA_PATH on the host). "
            "Pre-create the host directory with chown matching PUID/PGID (default 1000:1000). "
            "For local uvicorn outside Docker, set FF3ANALYTICS_DATA_DIR=./data."
        )
        raise PermissionError(hint) from exc


async def init_db() -> None:
    data_dir = get_data_dir()
    _ensure_data_dir(data_dir)
    async with aiosqlite.connect(get_db_path()) as db:
        await db.executescript(_SCHEMA)
        await db.commit()


async def is_writable() -> bool:
    try:
        data_dir = get_data_dir()
        _ensure_data_dir(data_dir)
        probe = data_dir / ".write_probe"
        probe.write_text("ok")
        probe.unlink(missing_ok=True)
        await init_db()
        return True
    except Exception:
        return False


async def upsert_suggestion(journal_id: str, model: str, payload_json: str) -> None:
    await init_db()
    now = _utc_now()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO ai_suggestions (journal_id, model, payload_json, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(journal_id, model) DO UPDATE SET
              payload_json = excluded.payload_json,
              created_at = excluded.created_at
            """,
            (journal_id, model, payload_json, now),
        )
        await db.commit()


async def get_suggestion(journal_id: str, model: str) -> str | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            "SELECT payload_json FROM ai_suggestions WHERE journal_id = ? AND model = ?",
            (journal_id, model),
        )
        row = await cursor.fetchone()
        return row[0] if row else None


async def log_audit(
    action: str,
    *,
    journal_id: str | None = None,
    details_json: str | None = None,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO audit_log (timestamp, action, journal_id, details_json)
            VALUES (?, ?, ?, ?)
            """,
            (_utc_now(), action, journal_id, details_json),
        )
        await db.commit()


def _row_to_funding_bucket(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "label": row["label"],
        "sort_order": row["sort_order"],
        "firefly_account_ids": json.loads(row["firefly_account_ids_json"]),
    }


async def list_funding_buckets() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, label, sort_order, firefly_account_ids_json
            FROM funding_buckets
            ORDER BY sort_order ASC, id ASC
            """
        )
        rows = await cursor.fetchall()
        return [_row_to_funding_bucket(row) for row in rows]


async def get_funding_bucket(bucket_id: str) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, label, sort_order, firefly_account_ids_json
            FROM funding_buckets
            WHERE id = ?
            """,
            (bucket_id,),
        )
        row = await cursor.fetchone()
        return _row_to_funding_bucket(row) if row else None


async def upsert_funding_bucket(
    *,
    id: str,
    label: str,
    sort_order: int,
    firefly_account_ids: list[str],
) -> None:
    await init_db()
    ids_json = json.dumps(firefly_account_ids)
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO funding_buckets (id, label, sort_order, firefly_account_ids_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              label = excluded.label,
              sort_order = excluded.sort_order,
              firefly_account_ids_json = excluded.firefly_account_ids_json
            """,
            (id, label, sort_order, ids_json),
        )
        await db.commit()


async def delete_funding_bucket(bucket_id: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("DELETE FROM funding_buckets WHERE id = ?", (bucket_id,))
        await db.commit()


async def get_worksheet_state_for_month(month: str) -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT row_key, row_type, month, planned_amount, planned_amount_override,
                   paid_at, matched_journal_id
            FROM worksheet_state
            WHERE month = ?
            ORDER BY row_key ASC
            """,
            (month,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def upsert_worksheet_state_row(
    *,
    row_key: str,
    row_type: str,
    month: str,
    planned_amount: str = "0.00",
    planned_amount_override: int = 0,
    paid_at: str | None = None,
    matched_journal_id: str | None = None,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO worksheet_state (
              row_key, row_type, month, planned_amount, planned_amount_override,
              paid_at, matched_journal_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(row_key, month) DO UPDATE SET
              row_type = excluded.row_type,
              planned_amount = excluded.planned_amount,
              planned_amount_override = excluded.planned_amount_override,
              paid_at = excluded.paid_at,
              matched_journal_id = excluded.matched_journal_id
            """,
            (
                row_key,
                row_type,
                month,
                planned_amount,
                planned_amount_override,
                paid_at,
                matched_journal_id,
            ),
        )
        await db.commit()


async def get_worksheet_refresh(month: str) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT month, refreshed_at, balances_json FROM worksheet_refresh WHERE month = ?",
            (month,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def upsert_worksheet_refresh(
    *, month: str, refreshed_at: str, balances_json: str
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO worksheet_refresh (month, refreshed_at, balances_json)
            VALUES (?, ?, ?)
            ON CONFLICT(month) DO UPDATE SET
              refreshed_at = excluded.refreshed_at,
              balances_json = excluded.balances_json
            """,
            (month, refreshed_at, balances_json),
        )
        await db.commit()


async def get_bucket_balances_for_month(month: str) -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT bucket_key, month, user_balance, user_balance_override
            FROM worksheet_bucket_balance
            WHERE month = ?
            ORDER BY bucket_key ASC
            """,
            (month,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def upsert_bucket_balance(
    *,
    bucket_key: str,
    month: str,
    user_balance: str,
    user_balance_override: int = 0,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO worksheet_bucket_balance (
              bucket_key, month, user_balance, user_balance_override
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(bucket_key, month) DO UPDATE SET
              user_balance = excluded.user_balance,
              user_balance_override = excluded.user_balance_override
            """,
            (bucket_key, month, user_balance, user_balance_override),
        )
        await db.commit()
