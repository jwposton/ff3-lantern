"""Tests for SQLite sidecar (WRITE-05)."""

from __future__ import annotations

import asyncio
import json

import pytest

import sidecar_db


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


def test_init_db_creates_tables(data_dir):
    asyncio.run(sidecar_db.init_db())
    assert sidecar_db.get_db_path().exists()
    assert sidecar_db.get_db_path().name == "ff3lantern.db"


def test_migrates_legacy_db_filename(data_dir):
    async def setup_legacy():
        import aiosqlite

        legacy = data_dir / "ff3analytics.db"
        async with aiosqlite.connect(legacy) as db:
            await db.execute("CREATE TABLE probe (id INTEGER)")
            await db.commit()

    asyncio.run(setup_legacy())
    asyncio.run(sidecar_db.init_db())
    assert not (data_dir / "ff3analytics.db").exists()
    assert (data_dir / "ff3lantern.db").exists()


def test_is_writable_true_on_tmp_path(data_dir):
    assert asyncio.run(sidecar_db.is_writable()) is True


def test_log_audit_persists_across_reopen(data_dir):
    asyncio.run(sidecar_db.init_db())
    asyncio.run(sidecar_db.log_audit("test_action", journal_id="J1", details_json='{"k":1}'))

    async def read_row():
        import aiosqlite

        async with aiosqlite.connect(sidecar_db.get_db_path()) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT action, journal_id, details_json FROM audit_log WHERE action = ?",
                ("test_action",),
            )
            return await cursor.fetchone()

    row = asyncio.run(read_row())
    assert row["journal_id"] == "J1"
    assert json.loads(row["details_json"]) == {"k": 1}


def test_upsert_suggestion_round_trip(data_dir):
    asyncio.run(sidecar_db.init_db())
    payload = {"category_id": "5", "confidence": 0.9}
    asyncio.run(
        sidecar_db.upsert_suggestion("J100", "gpt-4o-mini", json.dumps(payload))
    )
    result = asyncio.run(sidecar_db.get_suggestion("J100", "gpt-4o-mini"))
    assert result is not None
    assert json.loads(result) == payload


def test_init_db_migrates_discover_settings_defaults_version(data_dir):
    async def setup_legacy_discover_settings():
        import aiosqlite

        async with aiosqlite.connect(sidecar_db.get_db_path()) as db:
            await db.execute(
                """
                CREATE TABLE discover_settings (
                  id INTEGER PRIMARY KEY CHECK (id = 1),
                  ignored_categories_json TEXT NOT NULL DEFAULT '[]'
                )
                """
            )
            await db.execute(
                "INSERT INTO discover_settings (id, ignored_categories_json) VALUES (1, '[]')"
            )
            await db.commit()

    asyncio.run(setup_legacy_discover_settings())
    asyncio.run(sidecar_db.init_db())
    asyncio.run(sidecar_db.init_db())
    settings = asyncio.run(sidecar_db.get_discover_settings())
    assert "Gas" in settings["ignored_categories"]


def _table_columns(data_dir, table: str) -> set[str]:
    async def read_columns():
        import aiosqlite

        async with aiosqlite.connect(sidecar_db.get_db_path()) as db:
            cursor = await db.execute(f"PRAGMA table_info({table})")
            rows = await cursor.fetchall()
            return {row[1] for row in rows}

    return asyncio.run(read_columns())


def test_external_links_schema_migration(data_dir):
    asyncio.run(sidecar_db.init_db())

    assert _table_columns(data_dir, "external_links") == {"id", "label", "url"}
    assert _table_columns(data_dir, "worksheet_account_links") == {
        "account_id",
        "external_link_id",
    }
    assert "external_link_id" in _table_columns(data_dir, "worksheet_registry")
    assert "external_link_id" in _table_columns(data_dir, "funding_buckets")

    async def insert_link():
        import aiosqlite

        async with aiosqlite.connect(sidecar_db.get_db_path()) as db:
            await db.execute(
                """
                INSERT INTO external_links (id, label, url)
                VALUES (?, ?, ?)
                """,
                ("chase-login", "Chase Login", "https://chase.com/login"),
            )
            await db.commit()

    asyncio.run(insert_link())

    reg_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "worksheet_section": "bills",
                "row_label": "Electric",
                "external_link_id": "chase-login",
            }
        )
    )
    row = asyncio.run(sidecar_db.get_worksheet_registry(reg_id))
    assert row is not None
    assert row["external_link_id"] == "chase-login"

    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
            external_link_id="chase-login",
        )
    )
    bucket = asyncio.run(sidecar_db.get_funding_bucket("checking"))
    assert bucket is not None
    assert bucket["external_link_id"] == "chase-login"


def test_external_links_crud_sidecar(data_dir):
    asyncio.run(sidecar_db.init_db())

    asyncio.run(
        sidecar_db.insert_external_link_if_absent(
            id="zebra-portal",
            label="Zebra Portal",
            url="https://zebra.example/login",
        )
    )
    asyncio.run(
        sidecar_db.insert_external_link_if_absent(
            id="alpha-portal",
            label="Alpha Portal",
            url="https://alpha.example/login",
        )
    )

    listed = asyncio.run(sidecar_db.list_external_links())
    assert [row["id"] for row in listed] == ["alpha-portal", "zebra-portal"]

    fetched = asyncio.run(sidecar_db.get_external_link("alpha-portal"))
    assert fetched == {
        "id": "alpha-portal",
        "label": "Alpha Portal",
        "url": "https://alpha.example/login",
    }

    with pytest.raises(sidecar_db.ConflictError):
        asyncio.run(
            sidecar_db.insert_external_link_if_absent(
                id="alpha-portal",
                label="Duplicate",
                url="https://dup.example",
            )
        )

    asyncio.run(
        sidecar_db.patch_external_link(
            "alpha-portal",
            label="Alpha Updated",
            url="https://alpha.example/updated",
        )
    )
    patched = asyncio.run(sidecar_db.get_external_link("alpha-portal"))
    assert patched is not None
    assert patched["label"] == "Alpha Updated"
    assert patched["url"] == "https://alpha.example/updated"

    batch = asyncio.run(
        sidecar_db.get_external_links_by_ids(["alpha-portal", "missing"])
    )
    assert batch == {
        "alpha-portal": {
            "id": "alpha-portal",
            "label": "Alpha Updated",
            "url": "https://alpha.example/updated",
        }
    }
    assert asyncio.run(sidecar_db.get_external_links_by_ids([])) == {}

    asyncio.run(sidecar_db.delete_external_link("zebra-portal"))
    assert asyncio.run(sidecar_db.get_external_link("zebra-portal")) is None


def test_auth_tables_exist(data_dir):
    asyncio.run(sidecar_db.init_db())

    assert _table_columns(data_dir, "lantern_roles") == {
        "id",
        "name",
        "slug",
        "is_system",
        "created_at",
    }
    assert _table_columns(data_dir, "lantern_role_permissions") == {
        "role_id",
        "resource",
        "level",
        "actions_json",
    }
    assert _table_columns(data_dir, "lantern_users") == {
        "id",
        "username",
        "email",
        "password_hash",
        "oidc_sub",
        "display_name",
        "role_id",
        "enabled",
        "must_change_password",
        "created_at",
        "last_login_at",
    }
    assert _table_columns(data_dir, "lantern_refresh_tokens") == {
        "id",
        "user_id",
        "token_hash",
        "expires_at",
        "created_at",
        "revoked_at",
    }
    assert _table_columns(data_dir, "lantern_access_log") == {
        "id",
        "occurred_at",
        "event_type",
        "user_id",
        "actor_user_id",
        "ip_address",
        "user_agent",
        "detail_json",
    }
    assert _table_columns(data_dir, "lantern_sessions") == {
        "id",
        "access_token_hash",
        "user_id",
        "refresh_token_id",
        "expires_at",
        "created_at",
    }


def test_count_external_link_dependents_sidecar(data_dir):
    asyncio.run(sidecar_db.init_db())
    asyncio.run(
        sidecar_db.insert_external_link_if_absent(
            id="shared-link",
            label="Shared Link",
            url="https://shared.example",
        )
    )

    bill_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "worksheet_section": "bills",
                "row_label": "Electric",
                "external_link_id": "shared-link",
            }
        )
    )
    liability_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "worksheet_section": "liabilities",
                "row_label": "Mortgage",
                "external_link_id": "shared-link",
            }
        )
    )
    assert bill_id and liability_id

    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=0,
            firefly_account_ids=["1"],
            external_link_id="shared-link",
        )
    )
    asyncio.run(
        sidecar_db.upsert_worksheet_account_link("acct-1", "shared-link")
    )

    counts = asyncio.run(sidecar_db.count_external_link_dependents("shared-link"))
    assert counts == {
        "bills": 1,
        "liabilities": 1,
        "buckets": 1,
        "accounts": 1,
    }

    asyncio.run(
        sidecar_db.upsert_worksheet_account_link("acct-2", "shared-link")
    )
    asyncio.run(sidecar_db.delete_worksheet_account_link("acct-1"))
    account_link = asyncio.run(sidecar_db.get_worksheet_account_link("acct-2"))
    assert account_link == {
        "account_id": "acct-2",
        "external_link_id": "shared-link",
    }
    listed_links = asyncio.run(sidecar_db.list_worksheet_account_links())
    assert listed_links == [
        {"account_id": "acct-2", "external_link_id": "shared-link"}
    ]
    counts = asyncio.run(sidecar_db.count_external_link_dependents("shared-link"))
    assert counts["accounts"] == 1
