"""Lantern config bundle export/import core module (lantern-config.v1, #98)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

EXPORT_TOOL_VERSION = "1"

_SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "lantern-config.v1.json"
_FRONTEND_PACKAGE_JSON = Path(__file__).resolve().parent.parent / "frontend" / "package.json"

KNOWN_BUNDLE_TOP_LEVEL_KEYS = frozenset(
    {
        "schema",
        "exported_at",
        "source_instance",
        "lantern_version",
        "export_tool_version",
        "external_links",
        "funding_buckets",
        "worksheet_registry",
        "worksheet_bill_groups",
        "worksheet_account_links",
        "discover_settings",
        "account_profiles",
    }
)


class ExternalLinkRow(BaseModel):
    id: str
    label: str
    url: str


class FundingBucketRow(BaseModel):
    id: str
    label: str
    sort_order: int
    firefly_account_ids: list[str]
    external_link_id: str | None = None


class WorksheetRegistryRow(BaseModel):
    firefly_bill_id: str | None = None
    worksheet_section: str | None = None
    funding_bucket_key: str | None = None
    amount_mode: str | None = None
    planned_sync: str | None = None
    payment_rail: str | None = None
    counts_toward_cash_plan: bool = False
    rule_id: str | None = None
    row_label: str | None = None
    credit_card_account_id: str | None = None
    bill_group_id: str | None = None
    show_in_group: bool = False
    external_link_id: str | None = None


class BillGroupRow(BaseModel):
    id: str
    label: str
    sort_order: int


class WorksheetAccountLinkRow(BaseModel):
    account_id: str
    external_link_id: str


class DiscoverSettingsRow(BaseModel):
    ignored_categories: list[str] = Field(default_factory=list)
    ignored_payees: list[str] = Field(default_factory=list)


class AccountProfileRow(BaseModel):
    firefly_account_id: str
    profile: dict[str, Any]


class LanternConfigBundleV1(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_: Literal["lantern-config.v1"] = Field(alias="schema")
    exported_at: datetime
    source_instance: str | None = None
    lantern_version: str | None = None
    export_tool_version: str
    external_links: list[ExternalLinkRow] = Field(default_factory=list)
    funding_buckets: list[FundingBucketRow] = Field(default_factory=list)
    worksheet_registry: list[WorksheetRegistryRow] = Field(default_factory=list)
    worksheet_bill_groups: list[BillGroupRow] = Field(default_factory=list)
    worksheet_account_links: list[WorksheetAccountLinkRow] = Field(default_factory=list)
    discover_settings: DiscoverSettingsRow = Field(default_factory=DiscoverSettingsRow)
    account_profiles: list[AccountProfileRow] = Field(default_factory=list)


class ValidationIssue(BaseModel):
    code: str
    message: str
    entity: str | None = None
    firefly_id: str | None = None


class ValidationSummary(BaseModel):
    error_count: int
    warning_count: int
    sections: list[str]


class ValidationReport(BaseModel):
    valid: bool
    errors: list[ValidationIssue] = Field(default_factory=list)
    warnings: list[ValidationIssue] = Field(default_factory=list)
    summary: ValidationSummary


def scan_unknown_top_level_keys(raw: dict[str, Any]) -> list[str]:
    """Return top-level keys not in the lantern-config.v1 bundle contract."""
    return sorted(key for key in raw if key not in KNOWN_BUNDLE_TOP_LEVEL_KEYS)


def resolve_lantern_version() -> str | None:
    tag = os.environ.get("FF3LANTERN_TAG", "").strip()
    if tag:
        return tag
    if _FRONTEND_PACKAGE_JSON.is_file():
        try:
            payload = json.loads(_FRONTEND_PACKAGE_JSON.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        version = payload.get("version")
        if isinstance(version, str) and version.strip():
            return version.strip()
    return None


def bundle_json_schema() -> dict[str, Any]:
    return LanternConfigBundleV1.model_json_schema()


def write_bundle_json_schema(path: Path | None = None) -> Path:
    target = path or _SCHEMA_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(bundle_json_schema(), indent=2) + "\n",
        encoding="utf-8",
    )
    return target


if __name__ == "__main__":
    written = write_bundle_json_schema()
    print(f"Wrote {written}")
