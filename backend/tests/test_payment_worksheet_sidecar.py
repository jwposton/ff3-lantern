"""Tests for payment worksheet sidecar tables (PAY-01)."""

from __future__ import annotations

import asyncio
import json

import aiosqlite
import pytest

import sidecar_db

PAYMENT_WORKSHEET_TABLES = (
    "funding_buckets",
    "worksheet_bill_groups",
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


def test_bill_group_crud_round_trip(data_dir):
    asyncio.run(sidecar_db.init_db())
    asyncio.run(
        sidecar_db.upsert_bill_group(
            id="utilities",
            label="Utilities",
            sort_order=1,
        )
    )
    asyncio.run(
        sidecar_db.upsert_bill_group(
            id="mobile-apps",
            label="Mobile Apps",
            sort_order=0,
        )
    )

    listed = asyncio.run(sidecar_db.list_bill_groups())
    assert [row["id"] for row in listed] == ["mobile-apps", "utilities"]

    one = asyncio.run(sidecar_db.get_bill_group("utilities"))
    assert one is not None
    assert one["label"] == "Utilities"
    assert one["sort_order"] == 1

    asyncio.run(
        sidecar_db.upsert_bill_group(
            id="utilities",
            label="Home Utilities",
            sort_order=1,
        )
    )
    updated = asyncio.run(sidecar_db.get_bill_group("utilities"))
    assert updated["label"] == "Home Utilities"

    registry_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "501",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "firefly",
                "payment_rail": "bank",
                "rule_id": "99",
                "row_label": "Electric",
                "bill_group_id": "utilities",
                "show_in_group": True,
            }
        )
    )
    row = asyncio.run(sidecar_db.get_worksheet_registry(registry_id))
    assert row is not None
    assert row["bill_group_id"] == "utilities"
    assert row["show_in_group"] is True

    asyncio.run(sidecar_db.delete_bill_group("utilities"))
    after_delete = asyncio.run(sidecar_db.get_worksheet_registry(registry_id))
    assert after_delete is not None
    assert after_delete["bill_group_id"] is None
    assert after_delete["show_in_group"] is True

    registry_id_b = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "502",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "firefly",
                "payment_rail": "bank",
                "rule_id": "100",
                "row_label": "Water",
            }
        )
    )
    asyncio.run(
        sidecar_db.replace_bill_group_members(
            "mobile-apps",
            [registry_id, registry_id_b],
        )
    )
    members = asyncio.run(sidecar_db.list_bill_group_members("mobile-apps"))
    assert {m["registry_id"] for m in members} == {registry_id, registry_id_b}
    assert all(m["show_in_group"] is False for m in members)

    asyncio.run(sidecar_db.replace_bill_group_members("mobile-apps", []))
    cleared_a = asyncio.run(sidecar_db.get_worksheet_registry(registry_id))
    cleared_b = asyncio.run(sidecar_db.get_worksheet_registry(registry_id_b))
    assert cleared_a["bill_group_id"] is None
    assert cleared_b["bill_group_id"] is None

    remaining = asyncio.run(sidecar_db.list_bill_groups())
    assert len(remaining) == 1
    assert remaining[0]["id"] == "mobile-apps"
