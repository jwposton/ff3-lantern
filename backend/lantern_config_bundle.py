"""Lantern config bundle export/import core module (lantern-config.v1, #98)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import aiosqlite
from pydantic import BaseModel, ConfigDict, Field

import sidecar_db
from firefly_client import FireflyClient
from loan_profile_validate import validate_profile
from payment_worksheet_bills import validate_portal_url

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
        "loan_profiles",
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
    profile_kind: Literal["cc_worksheet", "liability_worksheet"]
    profile: dict[str, Any]


class LoanProfileBundleRow(BaseModel):
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
    loan_profiles: list[LoanProfileBundleRow] = Field(default_factory=list)


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


def _registry_row_for_export(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key != "id"}


def collect_referenced_account_ids(bundle_sections: dict[str, Any]) -> set[str]:
    account_ids: set[str] = set()
    for bucket in bundle_sections.get("funding_buckets", []):
        for account_id in bucket.get("firefly_account_ids", []):
            if account_id:
                account_ids.add(str(account_id))
    for row in bundle_sections.get("worksheet_registry", []):
        credit_card_id = row.get("credit_card_account_id")
        if credit_card_id:
            account_ids.add(str(credit_card_id))
    for link in bundle_sections.get("worksheet_account_links", []):
        account_id = link.get("account_id")
        if account_id:
            account_ids.add(str(account_id))
    return account_ids


async def _collect_account_profiles_for_export() -> list[AccountProfileRow]:
    rows: list[AccountProfileRow] = []
    for item in await sidecar_db.list_cc_worksheet_profiles():
        profile = dict(item["profile"])
        profile.pop("migrated_at", None)
        rows.append(
            AccountProfileRow(
                firefly_account_id=item["firefly_account_id"],
                profile_kind="cc_worksheet",
                profile=profile,
            )
        )
    for item in await sidecar_db.list_liability_worksheet_profiles():
        profile = dict(item["profile"])
        profile.pop("migrated_at", None)
        rows.append(
            AccountProfileRow(
                firefly_account_id=item["firefly_account_id"],
                profile_kind="liability_worksheet",
                profile=profile,
            )
        )
    rows.sort(key=lambda row: row.firefly_account_id)
    return rows


async def _collect_loan_profiles_for_export() -> list[LoanProfileBundleRow]:
    rows: list[LoanProfileBundleRow] = []
    for item in await sidecar_db.list_loan_profiles():
        profile = dict(item["profile"])
        profile.pop("migrated_at", None)
        rows.append(
            LoanProfileBundleRow(
                firefly_account_id=item["firefly_account_id"],
                profile=profile,
            )
        )
    return rows


async def export_bundle(
    *,
    source_instance: str | None = None,
    client: FireflyClient,
) -> dict[str, Any]:
    external_links = await sidecar_db.list_external_links()
    funding_buckets = await sidecar_db.list_funding_buckets()
    worksheet_registry = [
        _registry_row_for_export(row)
        for row in await sidecar_db.list_worksheet_registry()
    ]
    worksheet_bill_groups = await sidecar_db.list_bill_groups()
    worksheet_account_links = await sidecar_db.list_worksheet_account_links()
    discover_settings = await sidecar_db.get_discover_settings()
    account_profiles = await _collect_account_profiles_for_export()
    loan_profiles = await _collect_loan_profiles_for_export()

    bundle = LanternConfigBundleV1(
        schema_="lantern-config.v1",
        exported_at=datetime.now(timezone.utc),
        source_instance=source_instance,
        lantern_version=resolve_lantern_version(),
        export_tool_version=EXPORT_TOOL_VERSION,
        external_links=external_links,
        funding_buckets=funding_buckets,
        worksheet_registry=worksheet_registry,
        worksheet_bill_groups=worksheet_bill_groups,
        worksheet_account_links=worksheet_account_links,
        discover_settings=discover_settings,
        account_profiles=account_profiles,
        loan_profiles=loan_profiles,
    )
    validated = LanternConfigBundleV1.model_validate(
        bundle.model_dump(by_alias=True)
    )
    return validated.model_dump(by_alias=True, mode="json")


def collect_firefly_references(bundle: dict[str, Any]) -> tuple[set[str], set[str]]:
    bill_ids: set[str] = set()
    account_ids: set[str] = set()
    for row in bundle.get("worksheet_registry", []):
        if not isinstance(row, dict):
            continue
        bill_id = row.get("firefly_bill_id")
        if bill_id:
            bill_ids.add(str(bill_id))
        account_id = row.get("credit_card_account_id")
        if account_id:
            account_ids.add(str(account_id))
    for bucket in bundle.get("funding_buckets", []):
        if not isinstance(bucket, dict):
            continue
        for account_id in bucket.get("firefly_account_ids", []):
            if account_id:
                account_ids.add(str(account_id))
    for link in bundle.get("worksheet_account_links", []):
        if not isinstance(link, dict):
            continue
        account_id = link.get("account_id")
        if account_id:
            account_ids.add(str(account_id))
    return bill_ids, account_ids


def _bundle_section_names(bundle: dict[str, Any]) -> list[str]:
    sections: list[str] = []
    for key in (
        "external_links",
        "funding_buckets",
        "worksheet_registry",
        "worksheet_bill_groups",
        "worksheet_account_links",
        "discover_settings",
        "account_profiles",
        "loan_profiles",
    ):
        value = bundle.get(key)
        if key == "discover_settings":
            if isinstance(value, dict) and value:
                sections.append(key)
        elif isinstance(value, list) and value:
            sections.append(key)
    return sections


def _validation_summary(
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
    bundle: dict[str, Any],
) -> ValidationSummary:
    return ValidationSummary(
        error_count=len(errors),
        warning_count=len(warnings),
        sections=_bundle_section_names(bundle),
    )


def _append_schema_errors(
    errors: list[ValidationIssue], exc: Exception
) -> None:
    from pydantic import ValidationError

    if isinstance(exc, ValidationError):
        for issue in exc.errors():
            loc = ".".join(str(part) for part in issue.get("loc", ()))
            errors.append(
                ValidationIssue(
                    code="bundle_schema_invalid",
                    message=issue.get("msg", "invalid bundle"),
                    entity=loc or None,
                )
            )
        return
    errors.append(
        ValidationIssue(
            code="bundle_schema_invalid",
            message=str(exc),
        )
    )


async def validate_bundle(
    bundle: dict[str, Any],
    *,
    client: FireflyClient,
) -> ValidationReport:
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    for key in scan_unknown_top_level_keys(bundle):
        warnings.append(
            ValidationIssue(
                code="unknown_field",
                message=f"Unknown top-level field: {key}",
                entity=key,
            )
        )

    parsed: LanternConfigBundleV1 | None = None
    try:
        parsed = LanternConfigBundleV1.model_validate(bundle)
    except Exception as exc:
        _append_schema_errors(errors, exc)
        summary = _validation_summary(errors, warnings, bundle)
        return ValidationReport(
            valid=False,
            errors=errors,
            warnings=warnings,
            summary=summary,
        )

    bundle_dict = parsed.model_dump(by_alias=True)

    current_version = resolve_lantern_version()
    bundle_version = bundle_dict.get("lantern_version")
    if bundle_version and current_version and bundle_version != current_version:
        warnings.append(
            ValidationIssue(
                code="schema_version_mismatch",
                message=(
                    f"Bundle lantern_version {bundle_version!r} differs from "
                    f"current {current_version!r}"
                ),
            )
        )

    link_ids = {
        str(link["id"])
        for link in bundle_dict.get("external_links", [])
        if isinstance(link, dict) and link.get("id")
    }

    for index, link in enumerate(bundle_dict.get("external_links", [])):
        if not isinstance(link, dict):
            continue
        url = link.get("url")
        if not isinstance(url, str):
            continue
        try:
            validate_portal_url(url)
        except ValueError as exc:
            errors.append(
                ValidationIssue(
                    code="invalid_portal_url",
                    message=str(exc),
                    entity=f"external_links[{index}].url",
                )
            )

    def _warn_orphaned_external_link(
        external_link_id: str | None, entity: str
    ) -> None:
        if not external_link_id:
            return
        link_id = str(external_link_id)
        if link_id not in link_ids:
            warnings.append(
                ValidationIssue(
                    code="orphaned_external_link_id",
                    message=f"external_link_id {link_id!r} not found in external_links",
                    entity=entity,
                )
            )

    for index, bucket in enumerate(bundle_dict.get("funding_buckets", [])):
        if not isinstance(bucket, dict):
            continue
        _warn_orphaned_external_link(
            bucket.get("external_link_id"),
            f"funding_buckets[{index}].external_link_id",
        )

    for index, row in enumerate(bundle_dict.get("worksheet_registry", [])):
        if not isinstance(row, dict):
            continue
        _warn_orphaned_external_link(
            row.get("external_link_id"),
            f"worksheet_registry[{index}].external_link_id",
        )

    for index, link in enumerate(bundle_dict.get("worksheet_account_links", [])):
        if not isinstance(link, dict):
            continue
        _warn_orphaned_external_link(
            link.get("external_link_id"),
            f"worksheet_account_links[{index}].external_link_id",
        )

    bill_ids, account_ids = collect_firefly_references(bundle_dict)
    live_bills = {str(bill["id"]) for bill in await client.fetch_bills()}
    live_accounts = set((await client.fetch_accounts()).keys())

    for bill_id in sorted(bill_ids - live_bills):
        errors.append(
            ValidationIssue(
                code="firefly_bill_missing",
                message=f"Firefly bill not found: {bill_id}",
                entity="worksheet_registry",
                firefly_id=bill_id,
            )
        )

    for account_id in sorted(account_ids - live_accounts):
        errors.append(
            ValidationIssue(
                code="firefly_account_missing",
                message=f"Firefly account not found: {account_id}",
                entity="funding_buckets",
                firefly_id=account_id,
            )
        )

    summary = _validation_summary(errors, warnings, bundle_dict)
    return ValidationReport(
        valid=not errors,
        errors=errors,
        warnings=warnings,
        summary=summary,
    )


async def _blocking_durable_counts() -> dict[str, int]:
    """Per-table counts that block import; factory discover seed is treated as empty."""
    counts = await sidecar_db.count_durable_rows()
    if counts.get("discover_settings", 0) > 0:
        current = await sidecar_db.get_discover_settings()
        if (
            current["ignored_categories"] == sidecar_db.DEFAULT_DISCOVER_IGNORED_CATEGORIES
            and not current["ignored_payees"]
        ):
            counts = {**counts, "discover_settings": 0}
    return {table: count for table, count in counts.items() if count > 0}


def _append_sidecar_not_empty(
    report: ValidationReport,
    blocking: dict[str, int],
    payload: dict[str, Any],
) -> ValidationReport:
    tables = ", ".join(f"{table}={count}" for table, count in sorted(blocking.items()))
    report.errors.append(
        ValidationIssue(
            code="sidecar_not_empty",
            message=f"Sidecar already has durable config: {tables}",
            entity=",".join(sorted(blocking)),
        )
    )
    report.valid = False
    report.summary = _validation_summary(report.errors, report.warnings, payload)
    return report


async def import_bundle(
    bundle: dict[str, Any],
    *,
    client: FireflyClient,
    confirm: bool = False,
) -> ValidationReport:
    """Validate and optionally import a lantern-config.v1 bundle (D-11, D-14–D-18)."""
    payload = dict(bundle)
    payload.pop("confirm", None)

    report = await validate_bundle(payload, client=client)
    blocking = await _blocking_durable_counts()
    if blocking:
        return _append_sidecar_not_empty(report, blocking, payload)

    if not confirm:
        return report

    if not report.valid:
        return report

    parsed = LanternConfigBundleV1.model_validate(payload)
    accounts_by_id = await client.fetch_accounts()
    for row in parsed.loan_profiles:
        try:
            validate_profile(row.profile, accounts_by_id)
        except ValueError as exc:
            report.errors.append(
                ValidationIssue(
                    code="loan_profile_invalid",
                    message=str(exc),
                    entity="loan_profiles",
                    firefly_id=row.firefly_account_id,
                )
            )
    if report.errors:
        report.valid = False
        report.summary = _validation_summary(report.errors, report.warnings, payload)
        return report

    await sidecar_db.init_db()
    db_path = sidecar_db.get_db_path()
    try:
        async with aiosqlite.connect(db_path) as db:
            await db.execute("BEGIN IMMEDIATE")
            try:
                await sidecar_db.import_durable_config_conn(db, parsed)
                await db.commit()
            except Exception as exc:
                await db.rollback()
                report.errors.append(
                    ValidationIssue(
                        code="import_failed",
                        message=str(exc),
                    )
                )
                report.valid = False
                report.summary = _validation_summary(
                    report.errors, report.warnings, payload
                )
                return report
    except Exception as exc:
        report.errors.append(
            ValidationIssue(
                code="import_failed",
                message=str(exc),
            )
        )
        report.valid = False
        report.summary = _validation_summary(report.errors, report.warnings, payload)
        return report

    return report


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
