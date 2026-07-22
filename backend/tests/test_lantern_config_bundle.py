"""Tests for lantern-config.v1 bundle models, export, and validation (#98)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
import httpx
import pytest
from fastapi.testclient import TestClient

import sidecar_db
from firefly_client import FireflyClient
from lantern_config_bundle import (
    LanternConfigBundleV1,
    bundle_json_schema,
    export_bundle,
    import_bundle,
    validate_bundle,
    write_bundle_json_schema,
)
from payment_worksheet_profiles import (
    PAYMENT_WORKSHEET_MARKER,
    serialize_payment_worksheet_to_notes,
)

_SCHEMA_FILE = Path(__file__).resolve().parent.parent / "schemas" / "lantern-config.v1.json"


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


def _profile_notes(profile: dict) -> str:
    return serialize_payment_worksheet_to_notes(profile, "")


def _build_export_client(*, account_notes: dict[str, str] | None = None) -> FireflyClient:
    notes_by_id = account_notes or {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path.startswith("/api/v1/accounts/"):
            account_id = path.rsplit("/", 1)[-1]
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "accounts",
                        "id": account_id,
                        "attributes": {
                            "name": f"Account {account_id}",
                            "notes": notes_by_id.get(account_id, ""),
                        },
                    }
                },
            )
        return httpx.Response(404)

    return FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )


def test_bundle_schema_valid():
    minimal = {
        "schema": "lantern-config.v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "export_tool_version": "1",
        "external_links": [],
        "funding_buckets": [],
        "worksheet_registry": [],
        "worksheet_bill_groups": [],
        "worksheet_account_links": [],
        "discover_settings": {
            "ignored_categories": [],
            "ignored_payees": [],
        },
        "account_profiles": [],
    }
    parsed = LanternConfigBundleV1.model_validate(minimal)
    assert parsed.schema_ == "lantern-config.v1"

    assert _SCHEMA_FILE.is_file(), "committed JSON Schema file must exist"
    on_disk = json.loads(_SCHEMA_FILE.read_text(encoding="utf-8"))
    generated = bundle_json_schema()
    assert on_disk.get("title") == generated.get("title")
    assert on_disk == generated


def test_write_bundle_json_schema_matches_model():
    write_bundle_json_schema(_SCHEMA_FILE)
    on_disk = json.loads(_SCHEMA_FILE.read_text(encoding="utf-8"))
    assert on_disk == bundle_json_schema()


@pytest.mark.asyncio
async def test_export_round_trip(data_dir):
    await sidecar_db.insert_external_link_if_absent(
        id="chase",
        label="Chase",
        url="https://chase.example/login",
    )
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1", "2"],
        external_link_id="chase",
    )
    await sidecar_db.insert_bill_group_if_absent(
        id="utilities",
        label="Utilities",
        sort_order=0,
    )
    await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "10",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "planned",
            "planned_sync": "bill",
            "payment_rail": "bank",
            "row_label": "Electric",
            "bill_group_id": "utilities",
            "external_link_id": "chase",
        }
    )
    await sidecar_db.upsert_worksheet_account_link("3", "chase")
    await sidecar_db.update_discover_settings(
        ignored_categories=["Transfers"],
        ignored_payees=["Internal"],
    )

    profile = {"included": True, "worksheet_section": "credit", "sort_order": 1}
    client = _build_export_client(
        account_notes={
            "1": _profile_notes(profile),
            "2": "",
            "3": "",
        }
    )

    exported = await export_bundle(source_instance="lab", client=client)

    assert exported["schema"] == "lantern-config.v1"
    assert exported["source_instance"] == "lab"
    assert exported["export_tool_version"] == "1"
    assert len(exported["external_links"]) == 1
    assert len(exported["funding_buckets"]) == 1
    assert len(exported["worksheet_registry"]) == 1
    assert "id" not in exported["worksheet_registry"][0]
    assert exported["worksheet_registry"][0]["bill_group_id"] == "utilities"
    assert len(exported["worksheet_bill_groups"]) == 1
    assert len(exported["worksheet_account_links"]) == 1
    assert exported["discover_settings"]["ignored_categories"] == ["Transfers"]
    assert exported["discover_settings"]["ignored_payees"] == ["Internal"]

    profile_ids = {row["firefly_account_id"] for row in exported["account_profiles"]}
    assert profile_ids == {"1"}
    assert exported["account_profiles"][0]["profile"]["sort_order"] == 1

    LanternConfigBundleV1.model_validate(exported)
    assert PAYMENT_WORKSHEET_MARKER in _profile_notes(profile)


def _minimal_valid_bundle(**overrides) -> dict:
    payload = {
        "schema": "lantern-config.v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "export_tool_version": "1",
        "external_links": [],
        "funding_buckets": [],
        "worksheet_registry": [],
        "worksheet_bill_groups": [],
        "worksheet_account_links": [],
        "discover_settings": {
            "ignored_categories": [],
            "ignored_payees": [],
        },
        "account_profiles": [],
    }
    payload.update(overrides)
    return payload


def _build_validate_client(
    *,
    bill_ids: list[str] | None = None,
    account_ids: list[str] | None = None,
) -> FireflyClient:
    bills = bill_ids if bill_ids is not None else []
    accounts = account_ids if account_ids is not None else []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path.endswith("/bills"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "bills",
                            "id": bill_id,
                            "attributes": {
                                "name": f"Bill {bill_id}",
                                "amount_min": "10.00",
                                "amount_max": "10.00",
                                "repeat_freq": "monthly",
                            },
                        }
                        for bill_id in bills
                    ],
                    "meta": {
                        "pagination": {"current_page": 1, "total_pages": 1},
                    },
                },
            )
        if request.method == "GET" and path.endswith("/accounts"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "accounts",
                            "id": account_id,
                            "attributes": {
                                "name": f"Account {account_id}",
                                "type": "asset",
                            },
                        }
                        for account_id in accounts
                    ],
                    "meta": {
                        "pagination": {"current_page": 1, "total_pages": 1},
                    },
                },
            )
        return httpx.Response(404)

    return FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )


async def _clear_durable_sidecar_config() -> None:
    await sidecar_db.init_db()
    async with aiosqlite.connect(sidecar_db.get_db_path()) as db:
        for table in (
            "worksheet_account_links",
            "worksheet_registry",
            "funding_buckets",
            "worksheet_bill_groups",
            "external_links",
        ):
            await db.execute(f"DELETE FROM {table}")
        await db.execute(
            """
            UPDATE discover_settings
            SET ignored_categories_json = ?, ignored_payees_json = '[]'
            WHERE id = 1
            """,
            (json.dumps(sidecar_db.DEFAULT_DISCOVER_IGNORED_CATEGORIES),),
        )
        await db.commit()


@pytest.mark.asyncio
async def test_import_fk_missing_errors(data_dir):
    before_buckets = await sidecar_db.list_funding_buckets()
    before_registry = await sidecar_db.list_worksheet_registry()

    bundle = _minimal_valid_bundle(
        funding_buckets=[
            {
                "id": "checking",
                "label": "Checking",
                "sort_order": 0,
                "firefly_account_ids": ["99"],
            }
        ],
        worksheet_registry=[
            {
                "firefly_bill_id": "42",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": "planned",
                "planned_sync": "bill",
                "payment_rail": "bank",
                "row_label": "Missing bill",
            }
        ],
    )
    client = _build_validate_client(bill_ids=[], account_ids=[])

    report = await import_bundle(bundle, client=client, confirm=True)

    assert report.valid is False
    error_codes = {issue.code for issue in report.errors}
    assert "firefly_bill_missing" in error_codes
    assert "firefly_account_missing" in error_codes
    assert report.summary.error_count == len(report.errors)
    assert report.summary.warning_count == len(report.warnings)

    after_buckets = await sidecar_db.list_funding_buckets()
    after_registry = await sidecar_db.list_worksheet_registry()
    assert after_buckets == before_buckets
    assert after_registry == before_registry


@pytest.mark.asyncio
async def test_import_preview_no_write(data_dir):
    bundle = _minimal_valid_bundle(
        external_links=[
            {
                "id": "chase",
                "label": "Chase",
                "url": "https://chase.example/login",
            }
        ],
    )
    client = _build_validate_client(bill_ids=[], account_ids=[])

    report = await import_bundle(bundle, client=client, confirm=False)

    assert report.valid is True
    assert await sidecar_db.list_external_links() == []
    assert await sidecar_db.list_funding_buckets() == []


@pytest.mark.asyncio
async def test_import_rejects_nonempty_sidecar(data_dir):
    await sidecar_db.insert_external_link_if_absent(
        id="existing",
        label="Existing",
        url="https://existing.example/login",
    )
    bundle = _minimal_valid_bundle()
    client = _build_validate_client(bill_ids=[], account_ids=[])

    report = await import_bundle(bundle, client=client, confirm=True)

    assert report.valid is False
    assert any(issue.code == "sidecar_not_empty" for issue in report.errors)


def _build_round_trip_client(
    *,
    bill_ids: list[str],
    account_ids: list[str],
    account_notes: dict[str, str] | None = None,
) -> FireflyClient:
    notes_by_id = account_notes or {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path.endswith("/bills"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "bills",
                            "id": bill_id,
                            "attributes": {
                                "name": f"Bill {bill_id}",
                                "amount_min": "10.00",
                                "amount_max": "10.00",
                                "repeat_freq": "monthly",
                            },
                        }
                        for bill_id in bill_ids
                    ],
                    "meta": {
                        "pagination": {"current_page": 1, "total_pages": 1},
                    },
                },
            )
        if request.method == "GET" and path.endswith("/accounts"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "accounts",
                            "id": account_id,
                            "attributes": {
                                "name": f"Account {account_id}",
                                "type": "asset",
                            },
                        }
                        for account_id in account_ids
                    ],
                    "meta": {
                        "pagination": {"current_page": 1, "total_pages": 1},
                    },
                },
            )
        if request.method == "GET" and path.startswith("/api/v1/accounts/"):
            account_id = path.rsplit("/", 1)[-1]
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "accounts",
                        "id": account_id,
                        "attributes": {
                            "name": f"Account {account_id}",
                            "notes": notes_by_id.get(account_id, ""),
                        },
                    }
                },
            )
        if request.method == "PUT" and path.startswith("/api/v1/accounts/"):
            return httpx.Response(200, json={"data": {}})
        return httpx.Response(404)

    return FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )


@pytest.mark.asyncio
async def test_import_round_trip(data_dir):
    await sidecar_db.insert_external_link_if_absent(
        id="chase",
        label="Chase",
        url="https://chase.example/login",
    )
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1", "2"],
        external_link_id="chase",
    )
    await sidecar_db.insert_bill_group_if_absent(
        id="utilities",
        label="Utilities",
        sort_order=0,
    )
    await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "10",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "planned",
            "planned_sync": "bill",
            "payment_rail": "bank",
            "row_label": "Electric",
            "bill_group_id": "utilities",
            "external_link_id": "chase",
        }
    )
    await sidecar_db.upsert_worksheet_account_link("3", "chase")
    await sidecar_db.update_discover_settings(
        ignored_categories=["Transfers"],
        ignored_payees=["Internal"],
    )

    profile = {"included": True, "worksheet_section": "credit", "sort_order": 1}
    client = _build_round_trip_client(
        bill_ids=["10"],
        account_ids=["1", "2", "3"],
        account_notes={
            "1": _profile_notes(profile),
            "2": "",
            "3": "",
        },
    )

    exported = await export_bundle(source_instance="lab", client=client)
    await _clear_durable_sidecar_config()

    report = await import_bundle(exported, client=client, confirm=True)
    assert report.valid is True, report.errors

    links = await sidecar_db.list_external_links()
    assert len(links) == 1
    assert links[0]["id"] == "chase"

    buckets = await sidecar_db.list_funding_buckets()
    assert len(buckets) == 1
    assert buckets[0]["id"] == "checking"

    registry = await sidecar_db.list_worksheet_registry()
    assert len(registry) == 1
    assert registry[0]["row_label"] == "Electric"
    assert registry[0]["bill_group_id"] == "utilities"

    groups = await sidecar_db.list_bill_groups()
    assert len(groups) == 1
    assert groups[0]["id"] == "utilities"

    account_links = await sidecar_db.list_worksheet_account_links()
    assert len(account_links) == 1
    assert account_links[0]["account_id"] == "3"

    discover = await sidecar_db.get_discover_settings()
    assert discover["ignored_categories"] == ["Transfers"]
    assert discover["ignored_payees"] == ["Internal"]


@pytest.mark.asyncio
async def test_import_atomic_rollback(data_dir, monkeypatch):
    await sidecar_db.init_db()

    bundle = LanternConfigBundleV1.model_validate(
        _minimal_valid_bundle(
            external_links=[
                {
                    "id": "chase",
                    "label": "Chase",
                    "url": "https://chase.example/login",
                }
            ],
            funding_buckets=[
                {
                    "id": "checking",
                    "label": "Checking",
                    "sort_order": 0,
                    "firefly_account_ids": [],
                }
            ],
        )
    )

    original_insert_bucket = sidecar_db._insert_funding_bucket_conn

    async def failing_insert_bucket(db, **kwargs):
        await original_insert_bucket(db, **kwargs)
        raise RuntimeError("simulated mid-import failure")

    monkeypatch.setattr(
        sidecar_db, "_insert_funding_bucket_conn", failing_insert_bucket
    )

    db_path = sidecar_db.get_db_path()
    async with aiosqlite.connect(db_path) as db:
        await db.execute("BEGIN IMMEDIATE")
        with pytest.raises(RuntimeError, match="simulated mid-import failure"):
            await sidecar_db.import_durable_config_conn(db, bundle)
        await db.rollback()

    counts = await sidecar_db.count_durable_rows()
    assert counts["external_links"] == 0
    assert counts["funding_buckets"] == 0


def test_api_export_download(data_dir, monkeypatch):
    from main import app
    import routes.admin_config as admin_config_mod

    async def _seed():
        await sidecar_db.insert_external_link_if_absent(
            id="chase",
            label="Chase",
            url="https://chase.example/login",
        )

    import asyncio

    asyncio.run(_seed())

    mock_client = _build_validate_client(bill_ids=[], account_ids=[])
    app.dependency_overrides[admin_config_mod.get_firefly_client] = (
        lambda: mock_client
    )
    try:
        client = TestClient(app)
        response = client.get("/api/admin/config/export")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert "attachment" in response.headers.get("content-disposition", "").lower()
    assert "lantern-config-" in response.headers.get("content-disposition", "")
    payload = response.json()
    assert payload["schema"] == "lantern-config.v1"
    assert len(payload["external_links"]) == 1
    assert payload["external_links"][0]["id"] == "chase"


