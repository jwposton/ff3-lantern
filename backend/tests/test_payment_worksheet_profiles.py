"""Tests for payment_worksheet.v1 notes profiles and account worksheet API (PAY-05)."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from firefly_client import FireflyClient
from payment_worksheet_profiles import (
    PAYMENT_WORKSHEET_LEGACY_MARKER,
    PAYMENT_WORKSHEET_MARKER,
    current_month_key,
    merge_payment_worksheet_profile,
    parse_payment_worksheet_from_notes,
    patch_worksheet_refresh_profile,
    serialize_payment_worksheet_to_notes,
    write_payment_worksheet_profile,
)

SAMPLE_PROFILE = {
    "included": True,
    "worksheet_section": "credit",
    "funding_bucket_key": "checking",
    "credit_limit": "10000.00",
}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(data_dir):
    from main import app

    return TestClient(app)


def test_parse_reads_legacy_marker():
    notes = f"Memo\n{PAYMENT_WORKSHEET_LEGACY_MARKER}\n{json.dumps(SAMPLE_PROFILE)}"
    parsed = parse_payment_worksheet_from_notes(notes)
    assert parsed == SAMPLE_PROFILE
    serialized = serialize_payment_worksheet_to_notes(SAMPLE_PROFILE, "Memo")
    assert PAYMENT_WORKSHEET_MARKER in serialized
    assert PAYMENT_WORKSHEET_LEGACY_MARKER not in serialized


def test_parse_roundtrip_marker():
    notes = f"Memo\n{PAYMENT_WORKSHEET_MARKER}\n{json.dumps(SAMPLE_PROFILE)}"
    parsed = parse_payment_worksheet_from_notes(notes)
    assert parsed == SAMPLE_PROFILE
    serialized = serialize_payment_worksheet_to_notes(SAMPLE_PROFILE, "Memo")
    assert PAYMENT_WORKSHEET_MARKER in serialized
    assert parse_payment_worksheet_from_notes(serialized) == SAMPLE_PROFILE


def test_parse_included_false():
    profile = {**SAMPLE_PROFILE, "included": False}
    notes = serialize_payment_worksheet_to_notes(profile, "")
    parsed = parse_payment_worksheet_from_notes(notes)
    assert parsed is not None
    assert parsed["included"] is False


def test_parse_returns_none_without_marker():
    assert parse_payment_worksheet_from_notes("plain notes") is None
    assert parse_payment_worksheet_from_notes("") is None


def test_merge_clears_funding_bucket_key_on_null():
    existing = {**SAMPLE_PROFILE, "funding_bucket_key": "checking"}
    merged = merge_payment_worksheet_profile(existing, {"funding_bucket_key": None})
    assert "funding_bucket_key" not in merged
    assert merged["included"] is True
    assert merged["worksheet_section"] == "credit"


def test_merge_clears_credit_limit_on_null():
    existing = {**SAMPLE_PROFILE, "credit_limit": "10000.00"}
    merged = merge_payment_worksheet_profile(existing, {"credit_limit": None})
    assert "credit_limit" not in merged
    assert merged["funding_bucket_key"] == "checking"


def test_merge_clears_default_planned_payment_on_null():
    existing = {**SAMPLE_PROFILE, "default_planned_payment": "500.00"}
    merged = merge_payment_worksheet_profile(existing, {"default_planned_payment": None})
    assert "default_planned_payment" not in merged


def test_merge_preserves_unmentioned_keys():
    existing = {
        **SAMPLE_PROFILE,
        "funding_bucket_key": "checking",
        "credit_limit": "10000.00",
    }
    merged = merge_payment_worksheet_profile(existing, {"funding_bucket_key": None})
    assert "funding_bucket_key" not in merged
    assert merged["credit_limit"] == "10000.00"


def test_merge_included_false_not_treated_as_clear():
    existing = {**SAMPLE_PROFILE, "included": True}
    merged = merge_payment_worksheet_profile(existing, {"included": False})
    assert merged["included"] is False


def test_put_worksheet_writes_marker_to_firefly(monkeypatch, client, firefly_env):
    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")
    put_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/cc1" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc1",
                        "attributes": {
                            "name": "Chase VISA",
                            "type": "asset",
                            "account_role": "creditCard",
                            "notes": "",
                        },
                    }
                },
            )
        if request.url.path == "/api/v1/accounts/cc1" and request.method == "PUT":
            put_bodies.append(json.loads(request.content))
            attrs = put_bodies[-1]
            return httpx.Response(
                200,
                json={"data": {"id": "cc1", "attributes": attrs}},
            )
        return httpx.Response(404)

    from routes import payment_run as payment_run_mod

    def _client_factory():
        return FireflyClient(
            transport=httpx.MockTransport(handler),
            base_url="https://firefly.example",
            api_token="tok",
        )

    from main import app

    app.dependency_overrides[payment_run_mod.get_firefly_client] = _client_factory
    try:
        response = client.put(
            "/api/payment-run/accounts/cc1/worksheet",
            json={"funding_bucket_key": "checking", "credit_limit": "5000.00"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert len(put_bodies) == 1
    notes = put_bodies[0].get("notes", "")
    assert PAYMENT_WORKSHEET_MARKER in notes
    parsed = parse_payment_worksheet_from_notes(notes)
    assert parsed["funding_bucket_key"] == "checking"
    assert parsed["credit_limit"] == "5000.00"


@pytest.mark.asyncio
async def test_patch_refresh_snapshot_bucket_assign(data_dir):
    import sidecar_db

    month = current_month_key()
    balances = {
        "buckets": {},
        "credit_cards": {
            "cc1": {
                "name": "Chase VISA",
                "funding_bucket_key": None,
                "owed": "1200.00",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    await patch_worksheet_refresh_profile(
        month,
        "cc1",
        {"included": True, "funding_bucket_key": "checking", "credit_limit": "8000.00"},
    )

    row = await sidecar_db.get_worksheet_refresh(month)
    assert row is not None
    updated = json.loads(row["balances_json"])
    assert updated["credit_cards"]["cc1"]["funding_bucket_key"] == "checking"
    assert updated["credit_cards"]["cc1"]["credit_limit"] == "8000.00"
    assert row["refreshed_at"] == "2026-07-03T12:00:00Z"


@pytest.mark.asyncio
async def test_patch_refresh_clears_bucket_when_updates_null(data_dir):
    import sidecar_db

    month = current_month_key()
    balances = {
        "buckets": {},
        "credit_cards": {
            "cc1": {
                "name": "Chase VISA",
                "funding_bucket_key": "checking",
                "owed": "1200.00",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    await patch_worksheet_refresh_profile(
        month,
        "cc1",
        {"included": True, "worksheet_section": "credit"},
        {"funding_bucket_key": None},
    )

    row = await sidecar_db.get_worksheet_refresh(month)
    assert row is not None
    updated = json.loads(row["balances_json"])
    assert updated["credit_cards"]["cc1"]["funding_bucket_key"] is None


@pytest.mark.asyncio
async def test_patch_refresh_creates_row_when_missing(data_dir):
    import sidecar_db

    from payment_worksheet_profiles import patch_worksheet_refresh_profile

    month = current_month_key()
    await patch_worksheet_refresh_profile(
        month,
        "cc1",
        {
            "included": True,
            "worksheet_section": "credit",
            "funding_bucket_key": "checking",
        },
        {"funding_bucket_key": "checking"},
    )

    row = await sidecar_db.get_worksheet_refresh(month)
    assert row is not None
    updated = json.loads(row["balances_json"])
    assert updated["credit_cards"]["cc1"]["funding_bucket_key"] == "checking"


@pytest.mark.asyncio
async def test_patch_refresh_exclude_moves_card_to_excluded_list(data_dir):
    import sidecar_db

    from payment_worksheet_profiles import patch_worksheet_refresh_profile

    month = current_month_key()
    balances = {
        "buckets": {},
        "credit_cards": {
            "cc1": {
                "name": "Chase VISA",
                "funding_bucket_key": "checking",
                "owed": "1200.00",
            }
        },
        "excluded_credit_cards": {},
    }
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    await patch_worksheet_refresh_profile(
        month,
        "cc1",
        {"included": False, "worksheet_section": "credit"},
        {"included": False},
    )

    row = await sidecar_db.get_worksheet_refresh(month)
    assert row is not None
    updated = json.loads(row["balances_json"])
    assert "cc1" not in updated["credit_cards"]
    assert updated["excluded_credit_cards"]["cc1"]["name"] == "Chase VISA"


@pytest.mark.asyncio
async def test_patch_refresh_omitted_bucket_leaves_snapshot_unchanged(data_dir):
    import sidecar_db

    month = current_month_key()
    balances = {
        "buckets": {},
        "credit_cards": {
            "cc1": {
                "name": "Chase VISA",
                "funding_bucket_key": "checking",
                "owed": "1200.00",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    await patch_worksheet_refresh_profile(
        month,
        "cc1",
        {"included": True, "worksheet_section": "credit", "credit_limit": "5000.00"},
        {"credit_limit": "5000.00"},
    )

    row = await sidecar_db.get_worksheet_refresh(month)
    updated = json.loads(row["balances_json"])
    assert updated["credit_cards"]["cc1"]["funding_bucket_key"] == "checking"
    assert updated["credit_cards"]["cc1"]["credit_limit"] == "5000.00"


@pytest.mark.asyncio
async def test_patch_refresh_snapshot_exclude(data_dir):
    import sidecar_db

    month = current_month_key()
    balances = {
        "buckets": {},
        "credit_cards": {
            "cc1": {"name": "Chase VISA", "owed": "1200.00"},
            "cc2": {"name": "AmEx", "owed": "300.00"},
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    await patch_worksheet_refresh_profile(month, "cc1", {"included": False})

    row = await sidecar_db.get_worksheet_refresh(month)
    updated = json.loads(row["balances_json"])
    assert "cc1" not in updated["credit_cards"]
    assert "cc2" in updated["credit_cards"]


def test_write_profile_only_updates_notes():
    put_attrs: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "cc1",
                        "attributes": {
                            "name": "Chase VISA",
                            "type": "asset",
                            "account_role": "creditCard",
                            "notes": "",
                            "currency_code": "USD",
                        },
                    }
                },
            )
        if request.method == "PUT":
            put_attrs.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={"data": {"id": "cc1", "attributes": put_attrs[-1]}},
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    asyncio.run(
        write_payment_worksheet_profile(client, "cc1", SAMPLE_PROFILE)
    )
    assert len(put_attrs) == 1
    body = put_attrs[0]
    assert "notes" in body
    assert body.get("name") == "Chase VISA"
    assert PAYMENT_WORKSHEET_MARKER in body["notes"]


@pytest.mark.asyncio
async def test_patch_liability_profile_does_not_add_credit_card_row(data_dir):
    import sidecar_db

    from payment_worksheet_profiles import patch_worksheet_refresh_liability_profile

    month = current_month_key()
    balances = {
        "buckets": {},
        "credit_cards": {},
        "excluded_credit_cards": {},
        "liabilities": {
            "404": {
                "name": "Mortgage",
                "owed": "250000.00",
                "default_planned_payment": "1800.00",
            }
        },
        "excluded_liabilities": {},
    }
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    await patch_worksheet_refresh_liability_profile(
        month,
        "404",
        {"included": True, "funding_bucket_key": "checking"},
        {"funding_bucket_key": "checking"},
    )

    row = await sidecar_db.get_worksheet_refresh(month)
    updated = json.loads(row["balances_json"])
    assert "404" not in updated["credit_cards"]
    assert updated["liabilities"]["404"]["funding_bucket_key"] == "checking"


@pytest.mark.asyncio
async def test_patch_liability_profile_removes_legacy_credit_card_stub(data_dir):
    import sidecar_db

    from payment_worksheet_profiles import patch_worksheet_refresh_liability_profile

    month = current_month_key()
    balances = {
        "buckets": {},
        "credit_cards": {
            "404": {"funding_bucket_key": "checking"},
        },
        "excluded_credit_cards": {},
        "liabilities": {
            "404": {"name": "Mortgage", "owed": "250000.00"},
        },
        "excluded_liabilities": {},
    }
    await sidecar_db.upsert_worksheet_refresh(
        month=month,
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    await patch_worksheet_refresh_liability_profile(
        month,
        "404",
        {"included": True, "funding_bucket_key": "checking"},
        {"funding_bucket_key": "checking"},
    )

    row = await sidecar_db.get_worksheet_refresh(month)
    updated = json.loads(row["balances_json"])
    assert "404" not in updated["credit_cards"]
    assert updated["liabilities"]["404"]["funding_bucket_key"] == "checking"
