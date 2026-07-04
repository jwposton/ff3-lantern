"""Tests for worksheet_registry DAO (PAY-13, #21)."""

from __future__ import annotations

import asyncio

import aiosqlite
import pytest

import sidecar_db


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    return tmp_path


def _registry_columns() -> list[str]:
    async def _read():
        async with aiosqlite.connect(sidecar_db.get_db_path()) as db:
            cursor = await db.execute("PRAGMA table_info(worksheet_registry)")
            rows = await cursor.fetchall()
            return [row[1] for row in rows]

    return asyncio.run(_read())


def test_init_db_adds_credit_card_account_id_column(data_dir):
    asyncio.run(sidecar_db.init_db())
    columns = _registry_columns()
    assert "credit_card_account_id" in columns


def test_init_db_migration_idempotent(data_dir):
    asyncio.run(sidecar_db.init_db())
    asyncio.run(sidecar_db.init_db())
    columns = _registry_columns()
    assert "credit_card_account_id" in columns


def test_worksheet_registry_bank_rail_round_trip(data_dir):
    asyncio.run(sidecar_db.init_db())
    registry_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "101",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "firefly",
                "payment_rail": "bank",
                "rule_id": "55",
                "row_label": "Rent",
                "credit_card_account_id": None,
            }
        )
    )
    assert isinstance(registry_id, int)

    row = asyncio.run(sidecar_db.get_worksheet_registry(registry_id))
    assert row is not None
    assert row["firefly_bill_id"] == "101"
    assert row["worksheet_section"] == "bills"
    assert row["funding_bucket_key"] == "checking"
    assert row["amount_mode"] == "recurring"
    assert row["planned_sync"] == "firefly"
    assert row["payment_rail"] == "bank"
    assert row["counts_toward_cash_plan"] is True
    assert row["rule_id"] == "55"
    assert row["row_label"] == "Rent"
    assert row["credit_card_account_id"] is None

    listed = asyncio.run(sidecar_db.list_worksheet_registry())
    assert len(listed) == 1
    assert listed[0]["id"] == registry_id


def test_worksheet_registry_credit_card_rail_forces_cash_plan_off(data_dir):
    asyncio.run(sidecar_db.init_db())
    registry_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "202",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "recurring",
                "planned_sync": "firefly",
                "payment_rail": "credit_card",
                "counts_toward_cash_plan": True,
                "rule_id": "77",
                "row_label": "Cell phone",
                "credit_card_account_id": "9",
            }
        )
    )
    row = asyncio.run(sidecar_db.get_worksheet_registry(registry_id))
    assert row is not None
    assert row["payment_rail"] == "credit_card"
    assert row["counts_toward_cash_plan"] is False
    assert row["credit_card_account_id"] == "9"


def test_worksheet_registry_update_and_delete(data_dir):
    asyncio.run(sidecar_db.init_db())
    registry_id = asyncio.run(
        sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": "303",
                "worksheet_section": "liabilities",
                "funding_bucket_key": "checking",
                "amount_mode": "intermittent",
                "planned_sync": "manual",
                "payment_rail": "bank",
                "rule_id": "88",
                "row_label": "Oil heat",
            }
        )
    )
    asyncio.run(
        sidecar_db.update_worksheet_registry(
            registry_id,
            {
                "row_label": "Heating oil",
                "amount_mode": "recurring",
            },
        )
    )
    updated = asyncio.run(sidecar_db.get_worksheet_registry(registry_id))
    assert updated is not None
    assert updated["row_label"] == "Heating oil"
    assert updated["amount_mode"] == "recurring"

    asyncio.run(sidecar_db.delete_worksheet_registry(registry_id))
    assert asyncio.run(sidecar_db.get_worksheet_registry(registry_id)) is None
    assert asyncio.run(sidecar_db.list_worksheet_registry()) == []
