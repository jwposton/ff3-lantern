"""Tests for payment worksheet sidecar tables (PAY-01)."""

from __future__ import annotations

import asyncio
import json

import aiosqlite
import pytest

import sidecar_db

PAYMENT_WORKSHEET_TABLES = (
    "funding_buckets",
    "worksheet_registry",
    "worksheet_state",
    "worksheet_refresh",
    "worksheet_bucket_balance",
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


def _table_names() -> set[str]:
    async def _read():
        async with aiosqlite.connect(sidecar_db.get_db_path()) as db:
            cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
            rows = await cursor.fetchall()
            return {row[0] for row in rows}

    return asyncio.run(_read())


def test_init_db_creates_payment_worksheet_tables(data_dir):
    asyncio.run(sidecar_db.init_db())
    names = _table_names()
    for table in PAYMENT_WORKSHEET_TABLES:
        assert table in names


def test_init_db_does_not_seed_buckets(data_dir):
    asyncio.run(sidecar_db.init_db())
    buckets = asyncio.run(sidecar_db.list_funding_buckets())
    assert buckets == []


def test_funding_bucket_crud_round_trip(data_dir):
    asyncio.run(sidecar_db.init_db())
    account_ids = ["7", "42"]
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Checking",
            sort_order=1,
            firefly_account_ids=account_ids,
        )
    )
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="savings",
            label="Savings",
            sort_order=0,
            firefly_account_ids=["99"],
        )
    )

    listed = asyncio.run(sidecar_db.list_funding_buckets())
    assert [row["id"] for row in listed] == ["savings", "checking"]

    one = asyncio.run(sidecar_db.get_funding_bucket("checking"))
    assert one is not None
    assert one["label"] == "Checking"
    assert one["sort_order"] == 1
    assert one["firefly_account_ids"] == account_ids

    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="checking",
            label="Primary Checking",
            sort_order=1,
            firefly_account_ids=account_ids,
        )
    )
    updated = asyncio.run(sidecar_db.get_funding_bucket("checking"))
    assert updated["label"] == "Primary Checking"

    asyncio.run(sidecar_db.delete_funding_bucket("savings"))
    remaining = asyncio.run(sidecar_db.list_funding_buckets())
    assert len(remaining) == 1
    assert remaining[0]["id"] == "checking"


def test_funding_bucket_stores_firefly_account_ids_json(data_dir):
    asyncio.run(sidecar_db.init_db())
    asyncio.run(
        sidecar_db.upsert_funding_bucket(
            id="bucket-a",
            label="Bucket A",
            sort_order=0,
            firefly_account_ids=["1", "2"],
        )
    )

    async def read_raw():
        async with aiosqlite.connect(sidecar_db.get_db_path()) as db:
            cursor = await db.execute(
                "SELECT firefly_account_ids_json FROM funding_buckets WHERE id = ?",
                ("bucket-a",),
            )
            row = await cursor.fetchone()
            return row[0]

    raw = asyncio.run(read_raw())
    assert json.loads(raw) == ["1", "2"]
