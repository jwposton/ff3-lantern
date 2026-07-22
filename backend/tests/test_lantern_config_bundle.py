"""Tests for lantern-config.v1 bundle models, export, and validation (#98)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from lantern_config_bundle import (
    LanternConfigBundleV1,
    bundle_json_schema,
    write_bundle_json_schema,
)

_SCHEMA_FILE = Path(__file__).resolve().parent.parent / "schemas" / "lantern-config.v1.json"


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
