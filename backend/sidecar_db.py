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
    "delete_worksheet_registry",
    "delete_worksheet_state_for_row_key",
    "get_bucket_balances_for_month",
    "get_data_dir",
    "get_db_path",
    "get_discover_settings",
    "get_funding_bucket",
    "get_worksheet_refresh",
    "get_worksheet_registry",
    "get_worksheet_state_for_month",
    "init_db",
    "insert_worksheet_registry",
    "is_writable",
    "list_funding_buckets",
    "list_worksheet_registry",
    "log_audit",
    "get_suggestion",
    "update_discover_ignored_categories",
    "update_worksheet_registry",
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

CREATE TABLE IF NOT EXISTS worksheet_bill_groups (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
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
  row_label TEXT,
  bill_group_id TEXT,
  show_in_group INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS worksheet_state (
  row_key TEXT NOT NULL,
  row_type TEXT NOT NULL,
  month TEXT NOT NULL,
  planned_amount TEXT NOT NULL DEFAULT '0.00',
  planned_amount_override INTEGER NOT NULL DEFAULT 0,
  amount_due TEXT NOT NULL DEFAULT '0.00',
  amount_due_override INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS discover_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ignored_categories_json TEXT NOT NULL DEFAULT '[]',
  defaults_version INTEGER NOT NULL DEFAULT 0
);
"""


_LEGACY_DB_FILENAME = "ff3analytics.db"
_DB_FILENAME = "ff3lantern.db"

DEFAULT_DISCOVER_IGNORED_CATEGORIES: list[str] = [
    "Gas",
    "Groceries",
    "Restaurants",
    "Restraunts",
    "Fast Food",
    "Coffee",
    "Shopping",
]


def get_data_dir() -> Path:
    return Path(os.environ.get("FF3LANTERN_DATA_DIR", "./data"))


def get_db_path() -> Path:
    return get_data_dir() / _DB_FILENAME


def _migrate_legacy_db_if_needed(data_dir: Path) -> None:
    legacy = data_dir / _LEGACY_DB_FILENAME
    current = data_dir / _DB_FILENAME
    if legacy.exists() and not current.exists():
        legacy.rename(current)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_data_dir(data_dir: Path) -> None:
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        hint = (
            f"Cannot create or write data directory at {data_dir.resolve()!s}. "
            "Docker images use /data (bind-mount FF3LANTERN_DATA_PATH on the host). "
            "Pre-create the host directory with chown matching PUID/PGID (default 1000:1000). "
            "For local uvicorn outside Docker, set FF3LANTERN_DATA_DIR=./data."
        )
        raise PermissionError(hint) from exc


async def init_db() -> None:
    data_dir = get_data_dir()
    _ensure_data_dir(data_dir)
    _migrate_legacy_db_if_needed(data_dir)
    async with aiosqlite.connect(get_db_path()) as db:
        await db.executescript(_SCHEMA)
        try:
            await db.execute(
                "ALTER TABLE worksheet_registry ADD COLUMN credit_card_account_id TEXT"
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                "ALTER TABLE worksheet_state ADD COLUMN owed TEXT NOT NULL DEFAULT '0.00'"
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                "ALTER TABLE worksheet_state ADD COLUMN owed_override INTEGER NOT NULL DEFAULT 0"
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                "ALTER TABLE worksheet_state ADD COLUMN amount_due TEXT NOT NULL DEFAULT '0.00'"
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                "ALTER TABLE worksheet_state ADD COLUMN amount_due_override INTEGER NOT NULL DEFAULT 0"
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                """
                UPDATE worksheet_state
                SET amount_due = owed,
                    amount_due_override = owed_override
                WHERE amount_due_override = 0 AND owed_override = 1
                """
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                "ALTER TABLE discover_settings ADD COLUMN defaults_version INTEGER NOT NULL DEFAULT 0"
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS worksheet_bill_groups (
                  id TEXT PRIMARY KEY,
                  label TEXT NOT NULL,
                  sort_order INTEGER NOT NULL DEFAULT 0
                )
                """
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                """
                ALTER TABLE worksheet_registry ADD COLUMN bill_group_id TEXT
                REFERENCES worksheet_bill_groups(id) ON DELETE SET NULL
                """
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                "ALTER TABLE worksheet_registry ADD COLUMN show_in_group INTEGER NOT NULL DEFAULT 0"
            )
        except aiosqlite.OperationalError:
            pass
        cursor = await db.execute("PRAGMA table_info(discover_settings)")
        discover_columns = {row[1] for row in await cursor.fetchall()}
        if "defaults_version" in discover_columns:
            await db.execute(
                """
                INSERT OR IGNORE INTO discover_settings (id, ignored_categories_json, defaults_version)
                VALUES (1, ?, 1)
                """,
                (json.dumps(DEFAULT_DISCOVER_IGNORED_CATEGORIES),),
            )
            await db.execute(
                """
                UPDATE discover_settings
                SET ignored_categories_json = ?,
                    defaults_version = 1
                WHERE id = 1
                  AND defaults_version = 0
                  AND ignored_categories_json = '[]'
                """,
                (json.dumps(DEFAULT_DISCOVER_IGNORED_CATEGORIES),),
            )
        else:
            await db.execute(
                """
                INSERT OR IGNORE INTO discover_settings (id, ignored_categories_json)
                VALUES (1, ?)
                """,
                (json.dumps(DEFAULT_DISCOVER_IGNORED_CATEGORIES),),
            )
            await db.execute(
                """
                UPDATE discover_settings
                SET ignored_categories_json = ?
                WHERE id = 1
                  AND ignored_categories_json = '[]'
                """,
                (json.dumps(DEFAULT_DISCOVER_IGNORED_CATEGORIES),),
            )
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


def _counts_toward_cash_plan(payment_rail: str | None) -> int:
    return 0 if (payment_rail or "").strip().lower() == "credit_card" else 1


def _row_to_worksheet_registry(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "firefly_bill_id": row["firefly_bill_id"],
        "worksheet_section": row["worksheet_section"],
        "funding_bucket_key": row["funding_bucket_key"],
        "amount_mode": row["amount_mode"],
        "planned_sync": row["planned_sync"],
        "payment_rail": row["payment_rail"],
        "counts_toward_cash_plan": bool(row["counts_toward_cash_plan"]),
        "rule_id": row["rule_id"],
        "row_label": row["row_label"],
        "credit_card_account_id": row["credit_card_account_id"],
    }


_REGISTRY_SELECT = """
    SELECT id, firefly_bill_id, worksheet_section, funding_bucket_key,
           amount_mode, planned_sync, payment_rail, counts_toward_cash_plan,
           rule_id, row_label, credit_card_account_id
    FROM worksheet_registry
"""


async def list_worksheet_registry() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            f"{_REGISTRY_SELECT} ORDER BY id ASC"
        )
        rows = await cursor.fetchall()
        return [_row_to_worksheet_registry(row) for row in rows]


async def get_worksheet_registry(registry_id: int) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            f"{_REGISTRY_SELECT} WHERE id = ?",
            (registry_id,),
        )
        row = await cursor.fetchone()
        return _row_to_worksheet_registry(row) if row else None


async def insert_worksheet_registry(data: dict[str, Any]) -> int:
    await init_db()
    payment_rail = data.get("payment_rail") or "bank"
    counts = _counts_toward_cash_plan(payment_rail)
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            INSERT INTO worksheet_registry (
              firefly_bill_id, worksheet_section, funding_bucket_key,
              amount_mode, planned_sync, payment_rail, counts_toward_cash_plan,
              rule_id, row_label, credit_card_account_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.get("firefly_bill_id"),
                data.get("worksheet_section"),
                data.get("funding_bucket_key"),
                data.get("amount_mode"),
                data.get("planned_sync"),
                payment_rail,
                counts,
                data.get("rule_id"),
                data.get("row_label"),
                data.get("credit_card_account_id"),
            ),
        )
        await db.commit()
        return cursor.lastrowid


async def update_worksheet_registry(registry_id: int, data: dict[str, Any]) -> None:
    await init_db()
    existing = await get_worksheet_registry(registry_id)
    if existing is None:
        return
    merged = {**existing, **data, "id": registry_id}
    payment_rail = merged.get("payment_rail") or "bank"
    counts = _counts_toward_cash_plan(payment_rail)
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            UPDATE worksheet_registry SET
              firefly_bill_id = ?,
              worksheet_section = ?,
              funding_bucket_key = ?,
              amount_mode = ?,
              planned_sync = ?,
              payment_rail = ?,
              counts_toward_cash_plan = ?,
              rule_id = ?,
              row_label = ?,
              credit_card_account_id = ?
            WHERE id = ?
            """,
            (
                merged.get("firefly_bill_id"),
                merged.get("worksheet_section"),
                merged.get("funding_bucket_key"),
                merged.get("amount_mode"),
                merged.get("planned_sync"),
                payment_rail,
                counts,
                merged.get("rule_id"),
                merged.get("row_label"),
                merged.get("credit_card_account_id"),
                registry_id,
            ),
        )
        await db.commit()


async def delete_worksheet_registry(registry_id: int) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "DELETE FROM worksheet_registry WHERE id = ?",
            (registry_id,),
        )
        await db.commit()


async def delete_worksheet_state_for_row_key(row_key: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "DELETE FROM worksheet_state WHERE row_key = ?",
            (row_key,),
        )
        await db.commit()


async def get_worksheet_state_for_month(month: str) -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT row_key, row_type, month, planned_amount, planned_amount_override,
                   amount_due, amount_due_override, paid_at, matched_journal_id
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
    amount_due: str | None = None,
    amount_due_override: int | None = None,
    paid_at: str | None = None,
    matched_journal_id: str | None = None,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT planned_amount, planned_amount_override, amount_due, amount_due_override,
                   paid_at, matched_journal_id
            FROM worksheet_state
            WHERE row_key = ? AND month = ?
            """,
            (row_key, month),
        )
        existing = await cursor.fetchone()
        final_amount_due = (
            amount_due if amount_due is not None else (existing[2] if existing else "0.00")
        )
        final_amount_due_override = (
            amount_due_override
            if amount_due_override is not None
            else (existing[3] if existing else 0)
        )
        await db.execute(
            """
            INSERT INTO worksheet_state (
              row_key, row_type, month, planned_amount, planned_amount_override,
              amount_due, amount_due_override, paid_at, matched_journal_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(row_key, month) DO UPDATE SET
              row_type = excluded.row_type,
              planned_amount = excluded.planned_amount,
              planned_amount_override = excluded.planned_amount_override,
              amount_due = excluded.amount_due,
              amount_due_override = excluded.amount_due_override,
              paid_at = excluded.paid_at,
              matched_journal_id = excluded.matched_journal_id
            """,
            (
                row_key,
                row_type,
                month,
                planned_amount,
                planned_amount_override,
                final_amount_due,
                final_amount_due_override,
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


async def get_discover_settings() -> dict[str, Any]:
    """Return persisted bill-discover settings (single-row sidecar config)."""
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT ignored_categories_json FROM discover_settings WHERE id = 1"
        )
        row = await cursor.fetchone()
        if row is None:
            return {"ignored_categories": []}
        try:
            categories = json.loads(row["ignored_categories_json"])
        except json.JSONDecodeError:
            categories = []
        if not isinstance(categories, list):
            categories = []
        cleaned = [
            str(name).strip()
            for name in categories
            if name is not None and str(name).strip()
        ]
        return {"ignored_categories": cleaned}


async def update_discover_ignored_categories(categories: list[str]) -> dict[str, Any]:
    """Replace operator-selected categories excluded from bill discovery."""
    await init_db()
    cleaned: list[str] = []
    seen: set[str] = set()
    for name in categories:
        text = str(name).strip()
        if not text:
            continue
        folded = text.casefold()
        if folded in seen:
            continue
        seen.add(folded)
        cleaned.append(text)
    payload = json.dumps(cleaned)
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO discover_settings (id, ignored_categories_json)
            VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET
              ignored_categories_json = excluded.ignored_categories_json
            """,
            (payload,),
        )
        await db.commit()
    return {"ignored_categories": cleaned}
