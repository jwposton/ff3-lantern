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
from typing import TYPE_CHECKING, Any

import aiosqlite

if TYPE_CHECKING:
    from lantern_config_bundle import LanternConfigBundleV1


class ConflictError(Exception):
    """Raised when an insert would conflict with an existing row."""


DURABLE_TABLES: tuple[str, ...] = (
    "funding_buckets",
    "worksheet_registry",
    "worksheet_bill_groups",
    "external_links",
    "worksheet_account_links",
    "discover_settings",
    "cc_worksheet_profiles",
    "liability_worksheet_profiles",
    "loan_profiles",
    "loan_profile_split_components",
    "profile_migration_meta",
)

__all__ = [
    "ConflictError",
    "DURABLE_TABLES",
    "count_durable_rows",
    "count_external_link_dependents",
    "delete_bill_group",
    "delete_external_link",
    "delete_funding_bucket",
    "delete_worksheet_account_link",
    "delete_worksheet_registry",
    "delete_worksheet_state_for_row_key",
    "delete_cc_worksheet_profile",
    "delete_liability_worksheet_profile",
    "delete_loan_profile",
    "get_bill_group",
    "get_bucket_balances_for_month",
    "get_cc_worksheet_profile",
    "get_data_dir",
    "get_db_path",
    "get_discover_settings",
    "get_external_link",
    "get_external_links_by_ids",
    "get_funding_bucket",
    "get_liability_worksheet_profile",
    "get_loan_profile",
    "get_profile_migration_meta",
    "get_worksheet_account_link",
    "get_worksheet_refresh",
    "get_worksheet_registry",
    "get_worksheet_state_for_month",
    "import_durable_config_conn",
    "init_db",
    "insert_external_link_if_absent",
    "insert_worksheet_registry",
    "is_writable",
    "list_bill_group_members",
    "list_bill_groups",
    "list_cc_worksheet_profiles",
    "list_external_links",
    "list_funding_buckets",
    "list_liability_worksheet_profiles",
    "list_loan_profiles",
    "list_worksheet_account_links",
    "list_worksheet_registry",
    "log_audit",
    "get_suggestion",
    "insert_bill_group_if_absent",
    "patch_bill_group",
    "patch_external_link",
    "replace_bill_group_members",
    "add_discover_ignored_category",
    "add_discover_ignored_payee",
    "update_discover_ignored_categories",
    "update_discover_settings",
    "update_worksheet_registry",
    "upsert_bill_group",
    "upsert_bucket_balance",
    "upsert_cc_worksheet_profile",
    "upsert_funding_bucket",
    "upsert_liability_worksheet_profile",
    "upsert_loan_profile",
    "upsert_profile_migration_meta",
    "upsert_suggestion",
    "upsert_worksheet_account_link",
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
  firefly_account_ids_json TEXT NOT NULL DEFAULT '[]',
  external_link_id TEXT REFERENCES external_links(id)
);

CREATE TABLE IF NOT EXISTS external_links (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worksheet_account_links (
  account_id TEXT PRIMARY KEY,
  external_link_id TEXT REFERENCES external_links(id)
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
  bill_group_id TEXT REFERENCES worksheet_bill_groups(id) ON DELETE SET NULL,
  show_in_group INTEGER NOT NULL DEFAULT 0,
  external_link_id TEXT REFERENCES external_links(id)
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
  ignored_payees_json TEXT NOT NULL DEFAULT '[]',
  defaults_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cc_worksheet_profiles (
  firefly_account_id TEXT PRIMARY KEY,
  included INTEGER NOT NULL DEFAULT 1,
  funding_bucket_key TEXT,
  credit_limit TEXT,
  default_planned_payment TEXT,
  apr_percent TEXT,
  special_apr_percent TEXT,
  special_apr_start TEXT,
  special_apr_end TEXT,
  payment_due_day TEXT,
  sort_order INTEGER,
  migrated_at TEXT
);

CREATE TABLE IF NOT EXISTS liability_worksheet_profiles (
  firefly_account_id TEXT PRIMARY KEY,
  included INTEGER NOT NULL DEFAULT 1,
  funding_bucket_key TEXT,
  default_planned_payment TEXT,
  migrated_at TEXT
);

CREATE TABLE IF NOT EXISTS loan_profiles (
  firefly_account_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  match_type TEXT NOT NULL,
  match_description_contains TEXT NOT NULL,
  match_expected_amount TEXT NOT NULL,
  match_amount_tolerance TEXT NOT NULL DEFAULT '0.50',
  match_source_account_id TEXT,
  match_source_account TEXT,
  match_import_destination_account_id TEXT,
  match_import_destination_account TEXT,
  match_max_per_month INTEGER,
  split_escrow_amount TEXT NOT NULL DEFAULT '0.00',
  split_budget TEXT,
  rate_override TEXT,
  profile_notes TEXT,
  migrated_at TEXT
);

CREATE TABLE IF NOT EXISTS loan_profile_split_components (
  firefly_account_id TEXT NOT NULL,
  component_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  destination_account_id TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  category TEXT,
  budget TEXT,
  PRIMARY KEY (firefly_account_id, component_index),
  FOREIGN KEY (firefly_account_id) REFERENCES loan_profiles(firefly_account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_migration_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ran_at TEXT,
  accounts_scanned INTEGER,
  accounts_migrated INTEGER
);

CREATE TABLE IF NOT EXISTS lantern_roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lantern_role_permissions (
  role_id INTEGER NOT NULL,
  resource TEXT NOT NULL,
  level TEXT NOT NULL,
  actions_json TEXT,
  PRIMARY KEY (role_id, resource)
);

CREATE TABLE IF NOT EXISTS lantern_users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  oidc_sub TEXT UNIQUE,
  display_name TEXT,
  role_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  must_change_password INTEGER,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS lantern_refresh_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS lantern_access_log (
  id INTEGER PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_id INTEGER,
  actor_user_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS lantern_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES lantern_users(id),
  refresh_token_id INTEGER NOT NULL REFERENCES lantern_refresh_tokens(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
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
                "ALTER TABLE discover_settings ADD COLUMN ignored_payees_json TEXT NOT NULL DEFAULT '[]'"
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
        try:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS external_links (
                  id TEXT PRIMARY KEY,
                  label TEXT NOT NULL,
                  url TEXT NOT NULL
                )
                """
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS worksheet_account_links (
                  account_id TEXT PRIMARY KEY,
                  external_link_id TEXT REFERENCES external_links(id)
                )
                """
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                """
                ALTER TABLE worksheet_registry ADD COLUMN external_link_id TEXT
                REFERENCES external_links(id)
                """
            )
        except aiosqlite.OperationalError:
            pass
        try:
            await db.execute(
                """
                ALTER TABLE funding_buckets ADD COLUMN external_link_id TEXT
                REFERENCES external_links(id)
                """
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
        "external_link_id": row["external_link_id"],
    }


async def list_funding_buckets() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, label, sort_order, firefly_account_ids_json, external_link_id
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
            SELECT id, label, sort_order, firefly_account_ids_json, external_link_id
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
    external_link_id: str | None = None,
) -> None:
    await init_db()
    ids_json = json.dumps(firefly_account_ids)
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO funding_buckets (
              id, label, sort_order, firefly_account_ids_json, external_link_id
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              label = excluded.label,
              sort_order = excluded.sort_order,
              firefly_account_ids_json = excluded.firefly_account_ids_json,
              external_link_id = excluded.external_link_id
            """,
            (id, label, sort_order, ids_json, external_link_id),
        )
        await db.commit()


async def delete_funding_bucket(bucket_id: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("DELETE FROM funding_buckets WHERE id = ?", (bucket_id,))
        await db.commit()


def _row_to_bill_group(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "label": row["label"],
        "sort_order": row["sort_order"],
    }


async def list_bill_groups() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, label, sort_order
            FROM worksheet_bill_groups
            ORDER BY sort_order ASC, label ASC
            """
        )
        rows = await cursor.fetchall()
        return [_row_to_bill_group(row) for row in rows]


async def get_bill_group(group_id: str) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, label, sort_order
            FROM worksheet_bill_groups
            WHERE id = ?
            """,
            (group_id,),
        )
        row = await cursor.fetchone()
        return _row_to_bill_group(row) if row else None


async def upsert_bill_group(
    *,
    id: str,
    label: str,
    sort_order: int,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await _upsert_bill_group_conn(db, id=id, label=label, sort_order=sort_order)
        await db.commit()


async def _upsert_bill_group_conn(
    db: aiosqlite.Connection,
    *,
    id: str,
    label: str,
    sort_order: int,
) -> None:
    await db.execute(
        """
        INSERT INTO worksheet_bill_groups (id, label, sort_order)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          sort_order = excluded.sort_order
        """,
        (id, label, sort_order),
    )


async def insert_bill_group_if_absent(
    *,
    id: str,
    label: str,
    sort_order: int,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        try:
            await db.execute(
                """
                INSERT INTO worksheet_bill_groups (id, label, sort_order)
                VALUES (?, ?, ?)
                """,
                (id, label, sort_order),
            )
            await db.commit()
        except aiosqlite.IntegrityError as exc:
            raise ConflictError(f"Bill group id already exists: {id}") from exc


async def patch_bill_group(
    group_id: str,
    *,
    label: str,
    sort_order: int,
    member_ids: list[int] | None = None,
) -> None:
    """Atomically update group metadata and optionally replace members."""
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        if member_ids is not None:
            await _replace_bill_group_members_conn(db, group_id, member_ids)
        await _upsert_bill_group_conn(
            db, id=group_id, label=label, sort_order=sort_order
        )
        await db.commit()


async def list_bill_group_members(group_id: str) -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, row_label, show_in_group
            FROM worksheet_registry
            WHERE bill_group_id = ?
            ORDER BY row_label ASC
            """,
            (group_id,),
        )
        rows = await cursor.fetchall()
        return [
            {
                "registry_id": row["id"],
                "row_label": row["row_label"],
                "show_in_group": bool(row["show_in_group"]),
            }
            for row in rows
        ]


async def _replace_bill_group_members_conn(
    db: aiosqlite.Connection,
    group_id: str,
    member_ids: list[int],
) -> None:
    if member_ids:
        placeholders = ", ".join("?" for _ in member_ids)
        await db.execute(
            f"""
            UPDATE worksheet_registry
            SET bill_group_id = NULL
            WHERE bill_group_id = ? AND id NOT IN ({placeholders})
            """,
            (group_id, *member_ids),
        )
        for member_id in member_ids:
            await db.execute(
                """
                UPDATE worksheet_registry
                SET bill_group_id = ?
                WHERE id = ?
                """,
                (group_id, member_id),
            )
    else:
        await db.execute(
            """
            UPDATE worksheet_registry
            SET bill_group_id = NULL
            WHERE bill_group_id = ?
            """,
            (group_id,),
        )


async def replace_bill_group_members(
    group_id: str, member_ids: list[int]
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await _replace_bill_group_members_conn(db, group_id, member_ids)
        await db.commit()


async def delete_bill_group(group_id: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            UPDATE worksheet_registry
            SET bill_group_id = NULL
            WHERE bill_group_id = ?
            """,
            (group_id,),
        )
        await db.execute(
            "DELETE FROM worksheet_bill_groups WHERE id = ?",
            (group_id,),
        )
        await db.commit()


def _row_to_external_link(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "label": row["label"],
        "url": row["url"],
    }


async def list_external_links() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, label, url
            FROM external_links
            ORDER BY label ASC
            """
        )
        rows = await cursor.fetchall()
        return [_row_to_external_link(row) for row in rows]


async def get_external_link(link_id: str) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, label, url
            FROM external_links
            WHERE id = ?
            """,
            (link_id,),
        )
        row = await cursor.fetchone()
        return _row_to_external_link(row) if row else None


async def insert_external_link_if_absent(
    *,
    id: str,
    label: str,
    url: str,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        try:
            await db.execute(
                """
                INSERT INTO external_links (id, label, url)
                VALUES (?, ?, ?)
                """,
                (id, label, url),
            )
            await db.commit()
        except aiosqlite.IntegrityError as exc:
            raise ConflictError(f"External link id already exists: {id}") from exc


async def patch_external_link(
    link_id: str,
    *,
    label: str,
    url: str,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            UPDATE external_links
            SET label = ?, url = ?
            WHERE id = ?
            """,
            (label, url, link_id),
        )
        await db.commit()


async def delete_external_link(link_id: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("DELETE FROM external_links WHERE id = ?", (link_id,))
        await db.commit()


async def get_external_links_by_ids(ids: list[str]) -> dict[str, dict[str, Any]]:
    if not ids:
        return {}
    await init_db()
    placeholders = ", ".join("?" for _ in ids)
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            f"""
            SELECT id, label, url
            FROM external_links
            WHERE id IN ({placeholders})
            """,
            ids,
        )
        rows = await cursor.fetchall()
        return {row["id"]: _row_to_external_link(row) for row in rows}


async def count_external_link_dependents(link_id: str) -> dict[str, int]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        bills_cursor = await db.execute(
            """
            SELECT COUNT(*) FROM worksheet_registry
            WHERE external_link_id = ? AND worksheet_section = 'bills'
            """,
            (link_id,),
        )
        bills_row = await bills_cursor.fetchone()
        liabilities_cursor = await db.execute(
            """
            SELECT COUNT(*) FROM worksheet_registry
            WHERE external_link_id = ? AND worksheet_section = 'liabilities'
            """,
            (link_id,),
        )
        liabilities_row = await liabilities_cursor.fetchone()
        buckets_cursor = await db.execute(
            """
            SELECT COUNT(*) FROM funding_buckets
            WHERE external_link_id = ?
            """,
            (link_id,),
        )
        buckets_row = await buckets_cursor.fetchone()
        accounts_cursor = await db.execute(
            """
            SELECT COUNT(*) FROM worksheet_account_links
            WHERE external_link_id = ?
            """,
            (link_id,),
        )
        accounts_row = await accounts_cursor.fetchone()
    return {
        "bills": int(bills_row[0]) if bills_row else 0,
        "liabilities": int(liabilities_row[0]) if liabilities_row else 0,
        "buckets": int(buckets_row[0]) if buckets_row else 0,
        "accounts": int(accounts_row[0]) if accounts_row else 0,
    }


def _row_to_worksheet_account_link(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "account_id": row["account_id"],
        "external_link_id": row["external_link_id"],
    }


async def get_worksheet_account_link(account_id: str) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT account_id, external_link_id
            FROM worksheet_account_links
            WHERE account_id = ?
            """,
            (account_id,),
        )
        row = await cursor.fetchone()
        return _row_to_worksheet_account_link(row) if row else None


async def list_worksheet_account_links() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT account_id, external_link_id
            FROM worksheet_account_links
            ORDER BY account_id ASC
            """
        )
        rows = await cursor.fetchall()
        return [_row_to_worksheet_account_link(row) for row in rows]


async def upsert_worksheet_account_link(
    account_id: str,
    external_link_id: str | None,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        if external_link_id is None:
            await db.execute(
                "DELETE FROM worksheet_account_links WHERE account_id = ?",
                (account_id,),
            )
        else:
            await db.execute(
                """
                INSERT INTO worksheet_account_links (account_id, external_link_id)
                VALUES (?, ?)
                ON CONFLICT(account_id) DO UPDATE SET
                  external_link_id = excluded.external_link_id
                """,
                (account_id, external_link_id),
            )
        await db.commit()


async def delete_worksheet_account_link(account_id: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "DELETE FROM worksheet_account_links WHERE account_id = ?",
            (account_id,),
        )
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
        "bill_group_id": row["bill_group_id"],
        "show_in_group": bool(row["show_in_group"]),
        "external_link_id": row["external_link_id"],
    }


_REGISTRY_SELECT = """
    SELECT id, firefly_bill_id, worksheet_section, funding_bucket_key,
           amount_mode, planned_sync, payment_rail, counts_toward_cash_plan,
           rule_id, row_label, credit_card_account_id, bill_group_id, show_in_group,
           external_link_id
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
    show_in_group = 1 if data.get("show_in_group") else 0
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            INSERT INTO worksheet_registry (
              firefly_bill_id, worksheet_section, funding_bucket_key,
              amount_mode, planned_sync, payment_rail, counts_toward_cash_plan,
              rule_id, row_label, credit_card_account_id, bill_group_id, show_in_group,
              external_link_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                data.get("bill_group_id"),
                show_in_group,
                data.get("external_link_id"),
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
    show_in_group = 1 if merged.get("show_in_group") else 0
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
              credit_card_account_id = ?,
              bill_group_id = ?,
              show_in_group = ?,
              external_link_id = ?
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
                merged.get("bill_group_id"),
                show_in_group,
                merged.get("external_link_id"),
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


def _dedupe_string_list(values: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for name in values:
        text = str(name).strip()
        if not text:
            continue
        folded = text.casefold()
        if folded in seen:
            continue
        seen.add(folded)
        cleaned.append(text)
    return cleaned


async def get_discover_settings() -> dict[str, Any]:
    """Return persisted bill-discover settings (single-row sidecar config)."""
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT ignored_categories_json, ignored_payees_json FROM discover_settings WHERE id = 1"
        )
        row = await cursor.fetchone()
        if row is None:
            return {"ignored_categories": [], "ignored_payees": []}
        try:
            categories = json.loads(row["ignored_categories_json"])
        except json.JSONDecodeError:
            categories = []
        if not isinstance(categories, list):
            categories = []
        try:
            payees = json.loads(row["ignored_payees_json"])
        except (json.JSONDecodeError, KeyError, TypeError):
            payees = []
        if not isinstance(payees, list):
            payees = []
        return {
            "ignored_categories": _dedupe_string_list(categories),
            "ignored_payees": _dedupe_string_list(payees),
        }


async def update_discover_settings(
    *,
    ignored_categories: list[str] | None = None,
    ignored_payees: list[str] | None = None,
) -> dict[str, Any]:
    """Replace operator-selected discover filters (omit a field to preserve it)."""
    await init_db()
    current = await get_discover_settings()
    next_categories = (
        _dedupe_string_list(ignored_categories)
        if ignored_categories is not None
        else current["ignored_categories"]
    )
    next_payees = (
        _dedupe_string_list(ignored_payees)
        if ignored_payees is not None
        else current["ignored_payees"]
    )
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO discover_settings (id, ignored_categories_json, ignored_payees_json)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              ignored_categories_json = excluded.ignored_categories_json,
              ignored_payees_json = excluded.ignored_payees_json
            """,
            (json.dumps(next_categories), json.dumps(next_payees)),
        )
        await db.commit()
    return {
        "ignored_categories": next_categories,
        "ignored_payees": next_payees,
    }


async def update_discover_ignored_categories(categories: list[str]) -> dict[str, Any]:
    """Replace operator-selected categories excluded from bill discovery."""
    result = await update_discover_settings(ignored_categories=categories)
    return {"ignored_categories": result["ignored_categories"]}


async def add_discover_ignored_category(category: str) -> dict[str, Any]:
    """Append one category to the ignore list (idempotent)."""
    current = await get_discover_settings()
    text = str(category).strip()
    if not text:
        return {"ignored_categories": current["ignored_categories"], "ignored_category": ""}
    folded = text.casefold()
    if any(name.casefold() == folded for name in current["ignored_categories"]):
        existing = next(
            name for name in current["ignored_categories"] if name.casefold() == folded
        )
        return {
            "ignored_categories": current["ignored_categories"],
            "ignored_category": existing,
        }
    updated = await update_discover_settings(
        ignored_categories=[*current["ignored_categories"], text],
    )
    return {
        "ignored_categories": updated["ignored_categories"],
        "ignored_category": text,
    }


async def add_discover_ignored_payee(payee: str) -> dict[str, Any]:
    """Append one payee to the ignore list (idempotent)."""
    current = await get_discover_settings()
    text = str(payee).strip()
    if not text:
        return {"ignored_payees": current["ignored_payees"], "ignored_payee": ""}
    folded = text.casefold()
    if any(name.casefold() == folded for name in current["ignored_payees"]):
        existing = next(
            name for name in current["ignored_payees"] if name.casefold() == folded
        )
        return {
            "ignored_payees": current["ignored_payees"],
            "ignored_payee": existing,
        }
    updated = await update_discover_settings(
        ignored_payees=[*current["ignored_payees"], text],
    )
    return {
        "ignored_payees": updated["ignored_payees"],
        "ignored_payee": text,
    }


async def count_durable_rows() -> dict[str, int]:
    """Return row counts for each durable sidecar table (D-15)."""
    await init_db()
    counts: dict[str, int] = {}
    async with aiosqlite.connect(get_db_path()) as db:
        for table in DURABLE_TABLES:
            cursor = await db.execute(f"SELECT COUNT(*) FROM {table}")
            row = await cursor.fetchone()
            counts[table] = int(row[0]) if row else 0
    return counts


async def _insert_external_link_conn(
    db: aiosqlite.Connection,
    *,
    id: str,
    label: str,
    url: str,
) -> None:
    await db.execute(
        """
        INSERT INTO external_links (id, label, url)
        VALUES (?, ?, ?)
        """,
        (id, label, url),
    )


async def _insert_funding_bucket_conn(
    db: aiosqlite.Connection,
    *,
    id: str,
    label: str,
    sort_order: int,
    firefly_account_ids: list[str],
    external_link_id: str | None = None,
) -> None:
    await db.execute(
        """
        INSERT INTO funding_buckets (
          id, label, sort_order, firefly_account_ids_json, external_link_id
        )
        VALUES (?, ?, ?, ?, ?)
        """,
        (id, label, sort_order, json.dumps(firefly_account_ids), external_link_id),
    )


async def _insert_bill_group_conn(
    db: aiosqlite.Connection,
    *,
    id: str,
    label: str,
    sort_order: int,
) -> None:
    await db.execute(
        """
        INSERT INTO worksheet_bill_groups (id, label, sort_order)
        VALUES (?, ?, ?)
        """,
        (id, label, sort_order),
    )


async def _insert_worksheet_registry_conn(
    db: aiosqlite.Connection,
    data: dict[str, Any],
) -> None:
    payment_rail = data.get("payment_rail") or "bank"
    counts = _counts_toward_cash_plan(payment_rail)
    show_in_group = 1 if data.get("show_in_group") else 0
    await db.execute(
        """
        INSERT INTO worksheet_registry (
          firefly_bill_id, worksheet_section, funding_bucket_key,
          amount_mode, planned_sync, payment_rail, counts_toward_cash_plan,
          rule_id, row_label, credit_card_account_id, bill_group_id, show_in_group,
          external_link_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            data.get("bill_group_id"),
            show_in_group,
            data.get("external_link_id"),
        ),
    )


async def _insert_worksheet_account_link_conn(
    db: aiosqlite.Connection,
    account_id: str,
    external_link_id: str,
) -> None:
    await db.execute(
        """
        INSERT INTO worksheet_account_links (account_id, external_link_id)
        VALUES (?, ?)
        """,
        (account_id, external_link_id),
    )


async def _insert_discover_settings_conn(
    db: aiosqlite.Connection,
    *,
    ignored_categories: list[str],
    ignored_payees: list[str],
) -> None:
    await db.execute(
        """
        INSERT INTO discover_settings (id, ignored_categories_json, ignored_payees_json)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          ignored_categories_json = excluded.ignored_categories_json,
          ignored_payees_json = excluded.ignored_payees_json
        """,
        (json.dumps(ignored_categories), json.dumps(ignored_payees)),
    )


async def _insert_cc_worksheet_profile_conn(
    db: aiosqlite.Connection,
    account_id: str,
    profile: dict[str, Any],
) -> None:
    included = 1 if profile.get("included", True) else 0
    await db.execute(
        """
        INSERT INTO cc_worksheet_profiles (
          firefly_account_id, included, funding_bucket_key, credit_limit,
          default_planned_payment, apr_percent, special_apr_percent,
          special_apr_start, special_apr_end, payment_due_day, sort_order,
          migrated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id,
            included,
            profile.get("funding_bucket_key"),
            profile.get("credit_limit"),
            profile.get("default_planned_payment"),
            profile.get("apr_percent"),
            profile.get("special_apr_percent"),
            profile.get("special_apr_start"),
            profile.get("special_apr_end"),
            profile.get("payment_due_day"),
            profile.get("sort_order"),
            profile.get("migrated_at"),
        ),
    )


async def _insert_liability_worksheet_profile_conn(
    db: aiosqlite.Connection,
    account_id: str,
    profile: dict[str, Any],
) -> None:
    included = 1 if profile.get("included", True) else 0
    await db.execute(
        """
        INSERT INTO liability_worksheet_profiles (
          firefly_account_id, included, funding_bucket_key,
          default_planned_payment, migrated_at
        )
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            account_id,
            included,
            profile.get("funding_bucket_key"),
            profile.get("default_planned_payment"),
            profile.get("migrated_at"),
        ),
    )


async def _insert_loan_profile_conn(
    db: aiosqlite.Connection,
    account_id: str,
    profile: dict[str, Any],
) -> None:
    match = profile.get("match") or {}
    split = profile.get("split") or {}
    components = split.get("components") or []
    enabled = 1 if profile.get("enabled", True) else 0
    await db.execute(
        """
        INSERT INTO loan_profiles (
          firefly_account_id, version, enabled, match_type,
          match_description_contains, match_expected_amount,
          match_amount_tolerance, match_source_account_id,
          match_source_account, match_import_destination_account_id,
          match_import_destination_account, match_max_per_month,
          split_escrow_amount, split_budget, rate_override, profile_notes,
          migrated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id,
            profile.get("version", 1),
            enabled,
            match.get("type", "transfer"),
            match.get("description_contains", ""),
            match.get("expected_amount", "0.00"),
            match.get("amount_tolerance", "0.50"),
            match.get("source_account_id"),
            match.get("source_account"),
            match.get("import_destination_account_id"),
            match.get("import_destination_account"),
            match.get("max_per_month"),
            split.get("escrow_amount", "0.00"),
            split.get("budget"),
            profile.get("rate_override"),
            profile.get("notes"),
            profile.get("migrated_at"),
        ),
    )
    for index, comp in enumerate(components):
        await db.execute(
            """
            INSERT INTO loan_profile_split_components (
              firefly_account_id, component_index, role, type,
              destination_account_id, destination_account, category, budget
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                account_id,
                index,
                comp.get("role"),
                comp.get("type"),
                comp.get("destination_account_id"),
                comp.get("destination_account"),
                comp.get("category"),
                comp.get("budget"),
            ),
        )


async def import_durable_config_conn(
    db: aiosqlite.Connection,
    bundle: LanternConfigBundleV1,
) -> None:
    """Insert durable sidecar rows in dependency order (D-18). Caller owns txn/commit."""
    for link in bundle.external_links:
        await _insert_external_link_conn(
            db, id=link.id, label=link.label, url=link.url
        )

    for bucket in bundle.funding_buckets:
        await _insert_funding_bucket_conn(
            db,
            id=bucket.id,
            label=bucket.label,
            sort_order=bucket.sort_order,
            firefly_account_ids=bucket.firefly_account_ids,
            external_link_id=bucket.external_link_id,
        )

    for group in bundle.worksheet_bill_groups:
        await _insert_bill_group_conn(
            db, id=group.id, label=group.label, sort_order=group.sort_order
        )

    for row in bundle.worksheet_registry:
        await _insert_worksheet_registry_conn(
            db, row.model_dump(exclude_none=False)
        )

    for link in bundle.worksheet_account_links:
        await _insert_worksheet_account_link_conn(
            db, link.account_id, link.external_link_id
        )

    settings = bundle.discover_settings
    await _insert_discover_settings_conn(
        db,
        ignored_categories=settings.ignored_categories,
        ignored_payees=settings.ignored_payees,
    )

    for row in bundle.account_profiles:
        if row.profile_kind == "cc_worksheet":
            await _insert_cc_worksheet_profile_conn(
                db, row.firefly_account_id, row.profile
            )
        else:
            await _insert_liability_worksheet_profile_conn(
                db, row.firefly_account_id, row.profile
            )

    for row in bundle.loan_profiles:
        await _insert_loan_profile_conn(db, row.firefly_account_id, row.profile)


def _row_to_cc_worksheet_profile(row: aiosqlite.Row) -> dict[str, Any]:
    profile: dict[str, Any] = {
        "included": bool(row["included"]),
        "worksheet_section": "credit",
    }
    for key in (
        "funding_bucket_key",
        "credit_limit",
        "default_planned_payment",
        "apr_percent",
        "special_apr_percent",
        "special_apr_start",
        "special_apr_end",
        "payment_due_day",
    ):
        if row[key] is not None:
            profile[key] = row[key]
    if row["sort_order"] is not None:
        profile["sort_order"] = row["sort_order"]
    if row["migrated_at"] is not None:
        profile["migrated_at"] = row["migrated_at"]
    return profile


def _row_to_liability_worksheet_profile(row: aiosqlite.Row) -> dict[str, Any]:
    profile: dict[str, Any] = {"included": bool(row["included"])}
    for key in ("funding_bucket_key", "default_planned_payment"):
        if row[key] is not None:
            profile[key] = row[key]
    if row["migrated_at"] is not None:
        profile["migrated_at"] = row["migrated_at"]
    return profile


def _assemble_loan_profile(
    row: aiosqlite.Row, components: list[aiosqlite.Row]
) -> dict[str, Any]:
    profile: dict[str, Any] = {
        "version": row["version"],
        "enabled": bool(row["enabled"]),
        "match": {
            "type": row["match_type"],
            "description_contains": row["match_description_contains"],
            "expected_amount": row["match_expected_amount"],
            "amount_tolerance": row["match_amount_tolerance"],
        },
        "split": {
            "escrow_amount": row["split_escrow_amount"],
            "components": [],
        },
    }
    match = profile["match"]
    for key, col in (
        ("source_account_id", "match_source_account_id"),
        ("source_account", "match_source_account"),
        ("import_destination_account_id", "match_import_destination_account_id"),
        ("import_destination_account", "match_import_destination_account"),
        ("max_per_month", "match_max_per_month"),
    ):
        if row[col] is not None:
            match[key] = row[col]
    split = profile["split"]
    if row["split_budget"] is not None:
        split["budget"] = row["split_budget"]
    if row["rate_override"] is not None:
        profile["rate_override"] = row["rate_override"]
    if row["profile_notes"] is not None:
        profile["notes"] = row["profile_notes"]
    if row["migrated_at"] is not None:
        profile["migrated_at"] = row["migrated_at"]
    for comp in components:
        entry: dict[str, Any] = {
            "role": comp["role"],
            "type": comp["type"],
            "destination_account_id": comp["destination_account_id"],
            "destination_account": comp["destination_account"],
        }
        if comp["category"] is not None:
            entry["category"] = comp["category"]
        if comp["budget"] is not None:
            entry["budget"] = comp["budget"]
        split["components"].append(entry)
    return profile


async def get_cc_worksheet_profile(account_id: str) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT firefly_account_id, included, funding_bucket_key, credit_limit,
                   default_planned_payment, apr_percent, special_apr_percent,
                   special_apr_start, special_apr_end, payment_due_day, sort_order,
                   migrated_at
            FROM cc_worksheet_profiles
            WHERE firefly_account_id = ?
            """,
            (account_id,),
        )
        row = await cursor.fetchone()
        return _row_to_cc_worksheet_profile(row) if row else None


async def list_cc_worksheet_profiles() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT firefly_account_id, included, funding_bucket_key, credit_limit,
                   default_planned_payment, apr_percent, special_apr_percent,
                   special_apr_start, special_apr_end, payment_due_day, sort_order,
                   migrated_at
            FROM cc_worksheet_profiles
            ORDER BY firefly_account_id ASC
            """
        )
        rows = await cursor.fetchall()
        return [
            {
                "firefly_account_id": row["firefly_account_id"],
                "profile": _row_to_cc_worksheet_profile(row),
            }
            for row in rows
        ]


async def upsert_cc_worksheet_profile(
    account_id: str,
    profile: dict[str, Any],
    *,
    migrated_at: str | None = None,
) -> None:
    await init_db()
    included = 1 if profile.get("included", True) else 0
    sort_order = profile.get("sort_order")
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO cc_worksheet_profiles (
              firefly_account_id, included, funding_bucket_key, credit_limit,
              default_planned_payment, apr_percent, special_apr_percent,
              special_apr_start, special_apr_end, payment_due_day, sort_order,
              migrated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(firefly_account_id) DO UPDATE SET
              included = excluded.included,
              funding_bucket_key = excluded.funding_bucket_key,
              credit_limit = excluded.credit_limit,
              default_planned_payment = excluded.default_planned_payment,
              apr_percent = excluded.apr_percent,
              special_apr_percent = excluded.special_apr_percent,
              special_apr_start = excluded.special_apr_start,
              special_apr_end = excluded.special_apr_end,
              payment_due_day = excluded.payment_due_day,
              sort_order = excluded.sort_order,
              migrated_at = COALESCE(excluded.migrated_at, cc_worksheet_profiles.migrated_at)
            """,
            (
                account_id,
                included,
                profile.get("funding_bucket_key"),
                profile.get("credit_limit"),
                profile.get("default_planned_payment"),
                profile.get("apr_percent"),
                profile.get("special_apr_percent"),
                profile.get("special_apr_start"),
                profile.get("special_apr_end"),
                profile.get("payment_due_day"),
                sort_order,
                migrated_at or profile.get("migrated_at"),
            ),
        )
        await db.commit()


async def delete_cc_worksheet_profile(account_id: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "DELETE FROM cc_worksheet_profiles WHERE firefly_account_id = ?",
            (account_id,),
        )
        await db.commit()


async def get_liability_worksheet_profile(account_id: str) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT firefly_account_id, included, funding_bucket_key,
                   default_planned_payment, migrated_at
            FROM liability_worksheet_profiles
            WHERE firefly_account_id = ?
            """,
            (account_id,),
        )
        row = await cursor.fetchone()
        return _row_to_liability_worksheet_profile(row) if row else None


async def list_liability_worksheet_profiles() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT firefly_account_id, included, funding_bucket_key,
                   default_planned_payment, migrated_at
            FROM liability_worksheet_profiles
            ORDER BY firefly_account_id ASC
            """
        )
        rows = await cursor.fetchall()
        return [
            {
                "firefly_account_id": row["firefly_account_id"],
                "profile": _row_to_liability_worksheet_profile(row),
            }
            for row in rows
        ]


async def upsert_liability_worksheet_profile(
    account_id: str,
    profile: dict[str, Any],
    *,
    migrated_at: str | None = None,
) -> None:
    await init_db()
    included = 1 if profile.get("included", True) else 0
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO liability_worksheet_profiles (
              firefly_account_id, included, funding_bucket_key,
              default_planned_payment, migrated_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(firefly_account_id) DO UPDATE SET
              included = excluded.included,
              funding_bucket_key = excluded.funding_bucket_key,
              default_planned_payment = excluded.default_planned_payment,
              migrated_at = COALESCE(
                excluded.migrated_at, liability_worksheet_profiles.migrated_at
              )
            """,
            (
                account_id,
                included,
                profile.get("funding_bucket_key"),
                profile.get("default_planned_payment"),
                migrated_at or profile.get("migrated_at"),
            ),
        )
        await db.commit()


async def delete_liability_worksheet_profile(account_id: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "DELETE FROM liability_worksheet_profiles WHERE firefly_account_id = ?",
            (account_id,),
        )
        await db.commit()


async def get_loan_profile(account_id: str) -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT firefly_account_id, version, enabled, match_type,
                   match_description_contains, match_expected_amount,
                   match_amount_tolerance, match_source_account_id,
                   match_source_account, match_import_destination_account_id,
                   match_import_destination_account, match_max_per_month,
                   split_escrow_amount, split_budget, rate_override, profile_notes,
                   migrated_at
            FROM loan_profiles
            WHERE firefly_account_id = ?
            """,
            (account_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        comp_cursor = await db.execute(
            """
            SELECT role, type, destination_account_id, destination_account,
                   category, budget
            FROM loan_profile_split_components
            WHERE firefly_account_id = ?
            ORDER BY component_index ASC
            """,
            (account_id,),
        )
        components = await comp_cursor.fetchall()
        return _assemble_loan_profile(row, components)


async def list_loan_profiles() -> list[dict[str, Any]]:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT firefly_account_id
            FROM loan_profiles
            ORDER BY firefly_account_id ASC
            """
        )
        account_ids = [row["firefly_account_id"] for row in await cursor.fetchall()]
    profiles: list[dict[str, Any]] = []
    for account_id in account_ids:
        profile = await get_loan_profile(account_id)
        if profile is not None:
            profiles.append(
                {"firefly_account_id": account_id, "profile": profile}
            )
    return profiles


async def upsert_loan_profile(
    account_id: str,
    profile: dict[str, Any],
    *,
    migrated_at: str | None = None,
) -> None:
    await init_db()
    match = profile.get("match") or {}
    split = profile.get("split") or {}
    components = split.get("components") or []
    enabled = 1 if profile.get("enabled", True) else 0
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO loan_profiles (
              firefly_account_id, version, enabled, match_type,
              match_description_contains, match_expected_amount,
              match_amount_tolerance, match_source_account_id,
              match_source_account, match_import_destination_account_id,
              match_import_destination_account, match_max_per_month,
              split_escrow_amount, split_budget, rate_override, profile_notes,
              migrated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(firefly_account_id) DO UPDATE SET
              version = excluded.version,
              enabled = excluded.enabled,
              match_type = excluded.match_type,
              match_description_contains = excluded.match_description_contains,
              match_expected_amount = excluded.match_expected_amount,
              match_amount_tolerance = excluded.match_amount_tolerance,
              match_source_account_id = excluded.match_source_account_id,
              match_source_account = excluded.match_source_account,
              match_import_destination_account_id = excluded.match_import_destination_account_id,
              match_import_destination_account = excluded.match_import_destination_account,
              match_max_per_month = excluded.match_max_per_month,
              split_escrow_amount = excluded.split_escrow_amount,
              split_budget = excluded.split_budget,
              rate_override = excluded.rate_override,
              profile_notes = excluded.profile_notes,
              migrated_at = COALESCE(excluded.migrated_at, loan_profiles.migrated_at)
            """,
            (
                account_id,
                profile.get("version", 1),
                enabled,
                match.get("type", "transfer"),
                match.get("description_contains", ""),
                match.get("expected_amount", "0.00"),
                match.get("amount_tolerance", "0.50"),
                match.get("source_account_id"),
                match.get("source_account"),
                match.get("import_destination_account_id"),
                match.get("import_destination_account"),
                match.get("max_per_month"),
                split.get("escrow_amount", "0.00"),
                split.get("budget"),
                profile.get("rate_override"),
                profile.get("notes"),
                migrated_at or profile.get("migrated_at"),
            ),
        )
        await db.execute(
            "DELETE FROM loan_profile_split_components WHERE firefly_account_id = ?",
            (account_id,),
        )
        for index, comp in enumerate(components):
            await db.execute(
                """
                INSERT INTO loan_profile_split_components (
                  firefly_account_id, component_index, role, type,
                  destination_account_id, destination_account, category, budget
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    account_id,
                    index,
                    comp.get("role"),
                    comp.get("type"),
                    comp.get("destination_account_id"),
                    comp.get("destination_account"),
                    comp.get("category"),
                    comp.get("budget"),
                ),
            )
        await db.commit()


async def delete_loan_profile(account_id: str) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "DELETE FROM loan_profile_split_components WHERE firefly_account_id = ?",
            (account_id,),
        )
        await db.execute(
            "DELETE FROM loan_profiles WHERE firefly_account_id = ?",
            (account_id,),
        )
        await db.commit()


async def get_profile_migration_meta() -> dict[str, Any] | None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, ran_at, accounts_scanned, accounts_migrated
            FROM profile_migration_meta
            WHERE id = 1
            """
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "ran_at": row["ran_at"],
            "accounts_scanned": row["accounts_scanned"],
            "accounts_migrated": row["accounts_migrated"],
        }


async def upsert_profile_migration_meta(
    *,
    ran_at: str,
    accounts_scanned: int,
    accounts_migrated: int,
) -> None:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO profile_migration_meta (
              id, ran_at, accounts_scanned, accounts_migrated
            )
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              ran_at = excluded.ran_at,
              accounts_scanned = excluded.accounts_scanned,
              accounts_migrated = excluded.accounts_migrated
            """,
            (ran_at, accounts_scanned, accounts_migrated),
        )
        await db.commit()
