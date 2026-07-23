"""Tests for profile_migration backfill and boot hook (Phase 32, D-13–D-15)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

import profile_migration
import sidecar_db
from firefly_client import FireflyClient
from loan_profiles import LOAN_PROFILE_MARKER, serialize_loan_profile_to_notes
from payment_worksheet_profiles import (
    PAYMENT_WORKSHEET_MARKER,
    serialize_payment_worksheet_to_notes,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


class _MockFireflyClient(FireflyClient):
    def __init__(self, accounts: dict[str, dict[str, Any]]):
        super().__init__(base_url="https://firefly.example", api_token="test")
        self._accounts = accounts
        self.update_calls: list[tuple[str, dict]] = []

    async def fetch_accounts(self) -> dict[str, dict[str, Any]]:
        return {
            aid: {
                "name": attrs.get("name"),
                "type": attrs.get("type"),
                "role": attrs.get("account_role"),
            }
            for aid, attrs in self._accounts.items()
        }

    async def fetch_account(self, account_id: str) -> dict[str, Any]:
        if account_id not in self._accounts:
            raise RuntimeError(f"account {account_id} not found")
        return {"id": account_id, "attributes": dict(self._accounts[account_id])}

    async def update_account(self, account_id: str, attrs: dict) -> dict:
        self.update_calls.append((account_id, dict(attrs)))
        self._accounts[account_id] = dict(attrs)
        return {"id": account_id, "attributes": attrs}


def _cc_attrs(**overrides) -> dict:
    base = {
        "name": "Chase VISA",
        "type": "Asset account",
        "account_role": "Credit card",
        "notes": "",
    }
    base.update(overrides)
    return base


def _liability_attrs(**overrides) -> dict:
    base = {
        "name": "Mortgage",
        "type": "Liabilities account",
        "account_role": None,
        "notes": "",
    }
    base.update(overrides)
    return base


def _loan_profile() -> dict:
    return {
        "version": 1,
        "enabled": True,
        "match": {
            "description_contains": "Mortgage",
            "expected_amount": "1500.00",
            "amount_tolerance": "0.50",
        },
        "split": {
            "escrow_amount": "200.00",
            "components": [
                {
                    "role": "principal",
                    "type": "transfer",
                    "destination_account_id": "42",
                    "destination_account": "Mortgage",
                },
            ],
        },
    }


def test_backfill_skips_existing(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = {"included": True, "apr_percent": "9.99"}
    notes = serialize_payment_worksheet_to_notes(profile, "")
    client = _MockFireflyClient({"cc1": _cc_attrs(notes=notes)})
    first = asyncio.run(profile_migration.migrate_account_profiles(client))
    assert first.migrated == 1
    asyncio.run(
        sidecar_db.upsert_cc_worksheet_profile(
            "cc1", {"included": True, "apr_percent": "1.00"}
        )
    )
    second = asyncio.run(profile_migration.migrate_account_profiles(client))
    assert second.skipped >= 1
    stored = asyncio.run(sidecar_db.get_cc_worksheet_profile("cc1"))
    assert stored is not None
    assert stored["apr_percent"] == "1.00"


def test_backfill_migrates_cc_liability_loan(data_dir):
    asyncio.run(sidecar_db.init_db())
    cc_profile = {"included": True, "credit_limit": "5000.00", "apr_percent": "19.99"}
    liab_profile = {
        "included": True,
        "funding_bucket_key": "checking",
        "default_planned_payment": "250.00",
    }
    loan_profile = _loan_profile()
    client = _MockFireflyClient(
        {
            "cc1": _cc_attrs(
                notes=serialize_payment_worksheet_to_notes(cc_profile, "")
            ),
            "liab1": _liability_attrs(
                notes=serialize_payment_worksheet_to_notes(liab_profile, "")
                + "\n\n"
                + serialize_loan_profile_to_notes(loan_profile, ""),
            ),
        }
    )
    report = asyncio.run(profile_migration.migrate_account_profiles(client))
    assert report.migrated == 3
    cc_row = asyncio.run(sidecar_db.get_cc_worksheet_profile("cc1"))
    assert cc_row is not None
    assert cc_row["credit_limit"] == "5000.00"
    assert cc_row.get("migrated_at") is not None
    liab_row = asyncio.run(sidecar_db.get_liability_worksheet_profile("liab1"))
    assert liab_row is not None
    assert liab_row["funding_bucket_key"] == "checking"
    loan_row = asyncio.run(sidecar_db.get_loan_profile("liab1"))
    assert loan_row is not None
    assert loan_row["match"]["expected_amount"] == "1500.00"


def test_backfill_continues_on_failure(data_dir):
    asyncio.run(sidecar_db.init_db())
    good_profile = {"included": True, "apr_percent": "12.00"}
    client = _MockFireflyClient(
        {
            "bad": _cc_attrs(notes="broken"),
            "good": _cc_attrs(
                notes=serialize_payment_worksheet_to_notes(good_profile, "")
            ),
        }
    )

    async def failing_fetch(account_id: str) -> dict:
        if account_id == "bad":
            raise RuntimeError("Firefly timeout")
        return await _MockFireflyClient.fetch_account(client, account_id)

    client.fetch_account = failing_fetch  # type: ignore[method-assign]
    report = asyncio.run(profile_migration.migrate_account_profiles(client))
    assert len(report.failures) == 1
    assert report.failures[0]["account_id"] == "bad"
    stored = asyncio.run(sidecar_db.get_cc_worksheet_profile("good"))
    assert stored is not None
    assert stored["apr_percent"] == "12.00"


def test_boot_migration_runs_once(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = {"included": True, "sort_order": 2}
    notes = serialize_payment_worksheet_to_notes(profile, "")
    client = _MockFireflyClient({"cc1": _cc_attrs(notes=notes)})
    asyncio.run(profile_migration.maybe_run_on_boot(client))
    meta = asyncio.run(sidecar_db.get_profile_migration_meta())
    assert meta is not None
    assert meta["ran_at"]
    first_fetch_count = 0
    original_fetch = client.fetch_account

    async def counting_fetch(account_id: str) -> dict:
        nonlocal first_fetch_count
        first_fetch_count += 1
        return await original_fetch(account_id)

    client.fetch_account = counting_fetch  # type: ignore[method-assign]
    asyncio.run(profile_migration.maybe_run_on_boot(client))
    assert first_fetch_count == 0


def test_no_backfill_without_marker(data_dir):
    asyncio.run(sidecar_db.init_db())
    client = _MockFireflyClient(
        {
            "cc1": _cc_attrs(notes="Operator memo only"),
            "liab1": _liability_attrs(notes=""),
        }
    )
    report = asyncio.run(profile_migration.migrate_account_profiles(client))
    assert report.migrated == 0
    assert asyncio.run(sidecar_db.get_cc_worksheet_profile("cc1")) is None
    assert asyncio.run(sidecar_db.get_liability_worksheet_profile("liab1")) is None
    assert client.update_calls == []


def test_backfill_does_not_strip_firefly_notes(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = {"included": True, "apr_percent": "15.00"}
    notes = serialize_payment_worksheet_to_notes(profile, "Keep this memo")
    client = _MockFireflyClient({"cc1": _cc_attrs(notes=notes)})
    asyncio.run(profile_migration.migrate_account_profiles(client))
    assert client.update_calls == []
    assert PAYMENT_WORKSHEET_MARKER in client._accounts["cc1"]["notes"]


def test_dry_run_does_not_persist(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = {"included": True, "apr_percent": "11.00"}
    notes = serialize_payment_worksheet_to_notes(profile, "")
    client = _MockFireflyClient({"cc1": _cc_attrs(notes=notes)})
    report = asyncio.run(
        profile_migration.migrate_account_profiles(client, dry_run=True)
    )
    assert report.migrated == 1
    assert asyncio.run(sidecar_db.get_cc_worksheet_profile("cc1")) is None
