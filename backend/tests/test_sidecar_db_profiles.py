"""Profile table CRUD tests for sidecar_db (Phase 32)."""

from __future__ import annotations

import asyncio

import pytest

import sidecar_db
from payment_worksheet_profiles import CLEARABLE_OPTIONAL_KEYS


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


def _sample_cc_profile() -> dict:
    return {
        "included": True,
        "funding_bucket_key": "checking",
        "credit_limit": "5000.00",
        "default_planned_payment": "150.00",
        "apr_percent": "19.99",
        "special_apr_percent": "0.00",
        "special_apr_start": "2026-01-01",
        "special_apr_end": "2026-12-31",
        "payment_due_day": "15",
        "sort_order": 2,
    }


def _sample_loan_profile() -> dict:
    return {
        "version": 1,
        "enabled": True,
        "match": {
            "type": "transfer",
            "description_contains": "Mortgage Payment",
            "expected_amount": "1500.00",
            "amount_tolerance": "0.50",
        },
        "split": {
            "escrow_amount": "200.00",
            "budget": "Housing",
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
                    "destination_account": "Mortgage Interest",
                    "category": "Interest",
                },
            ],
        },
        "rate_override": "4.25",
        "notes": "Operator note",
    }


def test_durable_tables_include_profile_tables(data_dir):
    asyncio.run(sidecar_db.init_db())
    for table in (
        "cc_worksheet_profiles",
        "liability_worksheet_profiles",
        "loan_profiles",
        "loan_profile_split_components",
        "profile_migration_meta",
    ):
        assert table in sidecar_db.DURABLE_TABLES


def test_cc_worksheet_profile_round_trip_preserves_clearable_keys(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = _sample_cc_profile()
    asyncio.run(sidecar_db.upsert_cc_worksheet_profile("acct-cc-1", profile))
    loaded = asyncio.run(sidecar_db.get_cc_worksheet_profile("acct-cc-1"))
    assert loaded is not None
    for key in CLEARABLE_OPTIONAL_KEYS:
        assert loaded.get(key) == profile.get(key)
    assert loaded["included"] is True
    assert loaded["worksheet_section"] == "credit"


def test_cc_worksheet_profile_get_returns_none_when_missing(data_dir):
    asyncio.run(sidecar_db.init_db())
    assert asyncio.run(sidecar_db.get_cc_worksheet_profile("missing")) is None


def test_liability_worksheet_profile_stores_subset_fields(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = {
        "included": False,
        "funding_bucket_key": "checking",
        "default_planned_payment": "250.00",
    }
    asyncio.run(sidecar_db.upsert_liability_worksheet_profile("acct-liab-1", profile))
    loaded = asyncio.run(sidecar_db.get_liability_worksheet_profile("acct-liab-1"))
    assert loaded == {
        "included": False,
        "funding_bucket_key": "checking",
        "default_planned_payment": "250.00",
    }


def test_loan_profile_round_trip_with_split_components(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = _sample_loan_profile()
    asyncio.run(sidecar_db.upsert_loan_profile("acct-loan-1", profile))
    loaded = asyncio.run(sidecar_db.get_loan_profile("acct-loan-1"))
    assert loaded is not None
    assert loaded["match"]["expected_amount"] == "1500.00"
    assert loaded["split"]["escrow_amount"] == "200.00"
    assert len(loaded["split"]["components"]) == 2
    assert loaded["split"]["components"][0]["role"] == "principal"
    assert loaded["split"]["components"][1]["category"] == "Interest"
    assert loaded["notes"] == "Operator note"


def test_loan_profile_upsert_replaces_split_components(data_dir):
    asyncio.run(sidecar_db.init_db())
    profile = _sample_loan_profile()
    asyncio.run(sidecar_db.upsert_loan_profile("acct-loan-1", profile))
    updated = _sample_loan_profile()
    updated["split"]["components"] = updated["split"]["components"][:1]
    asyncio.run(sidecar_db.upsert_loan_profile("acct-loan-1", updated))
    loaded = asyncio.run(sidecar_db.get_loan_profile("acct-loan-1"))
    assert loaded is not None
    assert len(loaded["split"]["components"]) == 1


def test_profile_migration_meta_single_row(data_dir):
    asyncio.run(sidecar_db.init_db())
    asyncio.run(
        sidecar_db.upsert_profile_migration_meta(
            ran_at="2026-07-22T12:00:00Z",
            accounts_scanned=10,
            accounts_migrated=8,
        )
    )
    meta = asyncio.run(sidecar_db.get_profile_migration_meta())
    assert meta == {
        "ran_at": "2026-07-22T12:00:00Z",
        "accounts_scanned": 10,
        "accounts_migrated": 8,
    }
