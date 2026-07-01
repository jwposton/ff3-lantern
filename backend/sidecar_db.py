"""SQLite sidecar for AI suggestion cache and write audit log (WRITE-05).

Tables:
- ai_suggestions: Phase 10 suggest cache keyed by (journal_id, model)
- audit_log: cross-automation write tracing for categorize/loan apply events
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

__all__ = [
    "get_data_dir",
    "get_db_path",
    "init_db",
    "is_writable",
    "upsert_suggestion",
    "get_suggestion",
    "log_audit",
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
"""


def get_data_dir() -> Path:
    return Path(os.environ.get("FF3ANALYTICS_DATA_DIR", "./data"))


def get_db_path() -> Path:
    return get_data_dir() / "ff3analytics.db"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def init_db() -> None:
    data_dir = get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(get_db_path()) as db:
        await db.executescript(_SCHEMA)
        await db.commit()


async def is_writable() -> bool:
    try:
        data_dir = get_data_dir()
        data_dir.mkdir(parents=True, exist_ok=True)
        probe = data_dir / ".write_probe"
        probe.write_text("ok")
        probe.unlink(missing_ok=True)
        await init_db()
        return True
    except OSError:
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
