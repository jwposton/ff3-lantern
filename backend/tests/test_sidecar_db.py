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
