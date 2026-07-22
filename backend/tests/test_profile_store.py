"""Tests for profile_store unified resolver (Phase 32, D-09–D-12)."""

from __future__ import annotations

import asyncio
import json

import pytest

import profile_store
import sidecar_db
from firefly_client import FireflyClient
from loan_profiles import LOAN_PROFILE_MARKER, serialize_loan_profile_to_notes
from payment_worksheet_profiles import (
    PAYMENT_WORKSHEET_LEGACY_MARKER,
    serialize_payment_worksheet_to_notes,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


class _RecordingFireflyClient(FireflyClient):
    def __init__(self, *, account_id: str, attrs: dict):
        super().__init__(base_url="https://firefly.example", api_token="test")
        self.account_id = account_id
        self.attrs = dict(attrs)
        self.updates: list[dict] = []

    async def fetch_account(self, account_id: str) -> dict:
        return {"id": account_id, "attributes": dict(self.attrs)}

    async def update_account(self, account_id: str, attrs: dict) -> dict:
        self.updates.append(dict(attrs))
        self.attrs = dict(attrs)
        return {"id": account_id, "attributes": attrs}


def _cc_attrs(**overrides) -> dict:
    base = {
        "type": "Asset account",
        "account_role": "Credit card",
        "notes": "",
    }
    base.update(overrides)
    return base


def test_read_sidecar_wins(data_dir):
    asyncio.run(sidecar_db.init_db())
    asyncio.run(
        sidecar_db.upsert_cc_worksheet_profile(
            "42",
            {"included": True, "apr_percent": "9.99", "sort_order": 1},
        )
    )
    notes = serialize_payment_worksheet_to_notes(
        {"included": True, "apr_percent": "29.99"},
        "",
    )
    result = asyncio.run(profile_store.get_cc_worksheet_profile("42", notes))
    assert result["apr_percent"] == "9.99"


def test_read_legacy_marker_fallback_backfills_sidecar(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = {"included": True, "funding_bucket_key": "checking", "apr_percent": "12.50"}
    notes = f"{PAYMENT_WORKSHEET_LEGACY_MARKER}\n{json.dumps(profile)}"
    result = asyncio.run(profile_store.get_cc_worksheet_profile("legacy-1", notes))
    assert result["funding_bucket_key"] == "checking"
    stored = asyncio.run(sidecar_db.get_cc_worksheet_profile("legacy-1"))
    assert stored is not None
    assert stored.get("migrated_at") is not None


def test_read_notes_default_included_without_sidecar_insert(data_dir):
    asyncio.run(sidecar_db.init_db())
    result = asyncio.run(profile_store.get_cc_worksheet_profile("new-card", ""))
    assert result["included"] is True
    assert asyncio.run(sidecar_db.get_cc_worksheet_profile("new-card")) is None


def test_save_strips_firefly_marker(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = {"included": True, "apr_percent": "18.00"}
    notes = serialize_payment_worksheet_to_notes(profile, "Operator memo")
    attrs = _cc_attrs(notes=notes)
    client = _RecordingFireflyClient(account_id="99", attrs=attrs)
    asyncio.run(
        profile_store.save_cc_worksheet_profile(
            client,
            "99",
            attrs,
            {"sort_order": 3},
        )
    )
    assert client.updates
    saved_notes = client.updates[-1]["notes"]
    assert PAYMENT_WORKSHEET_LEGACY_MARKER not in saved_notes
    assert "<!-- ff3lantern:payment_worksheet.v1 -->" not in saved_notes
    assert "Operator memo" in saved_notes
    stored = asyncio.run(sidecar_db.get_cc_worksheet_profile("99"))
    assert stored is not None
    assert stored.get("sort_order") == 3


def test_save_loan_profile_validates_16kb(data_dir):
    asyncio.run(sidecar_db.init_db())
    huge = "x" * (16 * 1024)
    profile = {
        "version": 1,
        "enabled": True,
        "match": {
            "description_contains": huge,
            "expected_amount": "100.00",
        },
        "split": {"escrow_amount": "0.00", "components": []},
    }
    client = _RecordingFireflyClient(
        account_id="loan-1",
        attrs={"type": "Liabilities account", "notes": ""},
    )
    with pytest.raises(ValueError, match="16KB"):
        asyncio.run(profile_store.save_loan_profile(client, "loan-1", profile))


def test_clearable_null_clears_column(data_dir):
    asyncio.run(sidecar_db.init_db())
    asyncio.run(
        sidecar_db.upsert_cc_worksheet_profile(
            "55",
            {"included": True, "funding_bucket_key": "checking"},
        )
    )
    attrs = _cc_attrs()
    client = _RecordingFireflyClient(account_id="55", attrs=attrs)
    asyncio.run(
        profile_store.save_cc_worksheet_profile(
            client,
            "55",
            attrs,
            {"funding_bucket_key": None},
        )
    )
    stored = asyncio.run(sidecar_db.get_cc_worksheet_profile("55"))
    assert stored is not None
    assert "funding_bucket_key" not in stored


def test_get_loan_profile_sidecar_wins_over_notes(data_dir):
    asyncio.run(sidecar_db.init_db())
    sidecar_profile = {
        "version": 1,
        "enabled": True,
        "match": {
            "type": "transfer",
            "description_contains": "Sidecar",
            "expected_amount": "500.00",
            "amount_tolerance": "0.50",
        },
        "split": {
            "escrow_amount": "0.00",
            "components": [
                {
                    "role": "principal",
                    "type": "transfer",
                    "destination_account_id": "42",
                    "destination_account": "Mortgage",
                },
                {
                    "role": "interest",
                    "type": "transfer",
                    "destination_account_id": "88",
                    "destination_account": "Interest",
                },
            ],
        },
    }
    asyncio.run(sidecar_db.upsert_loan_profile("loan-9", sidecar_profile))
    notes_profile = {
        "version": 1,
        "enabled": True,
        "match": {
            "description_contains": "Notes",
            "expected_amount": "999.00",
            "amount_tolerance": "0.50",
        },
        "split": {"escrow_amount": "0.00", "components": []},
    }
    notes = serialize_loan_profile_to_notes(notes_profile, "")
    result = asyncio.run(profile_store.get_loan_profile("loan-9", notes))
    assert result is not None
    assert result["match"]["expected_amount"] == "500.00"


ACCOUNTS_BY_ID = {
    "42": {"name": "Mortgage", "type": "Liabilities account", "role": None},
    "88": {"name": "Interest", "type": "Expense account", "role": None},
}


def test_save_loan_profile_strips_marker(data_dir):
    asyncio.run(sidecar_db.init_db())
    valid = {
        "version": 1,
        "enabled": True,
        "match": {
            "description_contains": "Mortgage",
            "expected_amount": "1500.00",
            "amount_tolerance": "0.50",
        },
        "split": {
            "escrow_amount": "0.00",
            "components": [
                {
                    "role": "principal",
                    "type": "transfer",
                    "destination_account_id": "42",
                    "destination_account": "Mortgage",
                },
                {
                    "role": "interest",
                    "type": "transfer",
                    "destination_account_id": "88",
                    "destination_account": "Interest",
                },
            ],
        },
    }
    notes = serialize_loan_profile_to_notes(valid, "Keep this text")
    client = _RecordingFireflyClient(
        account_id="loan-2",
        attrs={"type": "Liabilities account", "notes": notes},
    )
    asyncio.run(
        profile_store.save_loan_profile(
            client, "loan-2", valid, accounts_by_id=ACCOUNTS_BY_ID
        )
    )
    assert client.updates
    saved_notes = client.updates[-1]["notes"]
    assert LOAN_PROFILE_MARKER not in saved_notes
    assert "Keep this text" in saved_notes
