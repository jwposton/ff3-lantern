"""Bulk backfill of account profiles from Firefly notes into sidecar (Phase 32, D-13–D-15)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import sidecar_db
from firefly_client import FireflyClient
from loan_profiles import parse_loan_profile_from_notes
from payment_worksheet_liabilities import is_liability_account
from payment_worksheet_profiles import (
    DEFAULT_PROFILE,
    is_credit_card_asset,
    parse_payment_worksheet_from_notes,
)

logger = logging.getLogger(__name__)


@dataclass
class MigrationReport:
    accounts_scanned: int = 0
    migrated: int = 0
    skipped: int = 0
    failures: list[dict[str, str]] = field(default_factory=list)


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


async def _migrate_worksheet_profile(
    account_id: str,
    attrs: dict[str, Any],
    notes: str,
    *,
    dry_run: bool,
    migrated_at: str,
) -> str | None:
    """Return 'migrated', 'skipped', or None when no marker present."""
    parsed = parse_payment_worksheet_from_notes(notes)
    if parsed is None:
        return None

    merged = {**DEFAULT_PROFILE, **parsed}
    if is_credit_card_asset(attrs):
        existing = await sidecar_db.get_cc_worksheet_profile(account_id)
        if existing is not None:
            return "skipped"
        if not dry_run:
            stored = {k: v for k, v in merged.items() if k != "worksheet_section"}
            await sidecar_db.upsert_cc_worksheet_profile(
                account_id, stored, migrated_at=migrated_at
            )
        return "migrated"
    if is_liability_account(attrs):
        existing = await sidecar_db.get_liability_worksheet_profile(account_id)
        if existing is not None:
            return "skipped"
        if not dry_run:
            liability_profile = {
                key: merged.get(key)
                for key in ("included", "funding_bucket_key", "default_planned_payment")
            }
            await sidecar_db.upsert_liability_worksheet_profile(
                account_id, liability_profile, migrated_at=migrated_at
            )
        return "migrated"
    return None


async def _migrate_loan_profile(
    account_id: str,
    notes: str,
    *,
    dry_run: bool,
    migrated_at: str,
) -> str | None:
    """Return 'migrated', 'skipped', or None when no marker present."""
    parsed = parse_loan_profile_from_notes(notes)
    if parsed is None:
        return None
    existing = await sidecar_db.get_loan_profile(account_id)
    if existing is not None:
        return "skipped"
    if not dry_run:
        await sidecar_db.upsert_loan_profile(account_id, parsed, migrated_at=migrated_at)
    return "migrated"


async def migrate_account_profiles(
    client: FireflyClient,
    *,
    dry_run: bool = False,
) -> MigrationReport:
    """Backfill CC, liability worksheet, and loan profiles from Firefly notes (D-14, D-15)."""
    report = MigrationReport()
    migrated_at = _utc_now_iso()
    accounts = await client.fetch_accounts()
    report.accounts_scanned = len(accounts)

    for account_id in accounts:
        try:
            account = await client.fetch_account(account_id)
            attrs = account.get("attributes", {})
            notes = attrs.get("notes") or ""

            worksheet_result = await _migrate_worksheet_profile(
                account_id, attrs, notes, dry_run=dry_run, migrated_at=migrated_at
            )
            loan_result = await _migrate_loan_profile(
                account_id, notes, dry_run=dry_run, migrated_at=migrated_at
            )

            for result in (worksheet_result, loan_result):
                if result == "migrated":
                    report.migrated += 1
                elif result == "skipped":
                    report.skipped += 1
        except Exception as exc:
            logger.warning(
                "Profile migration failed for account %s: %s",
                account_id,
                exc,
            )
            report.failures.append(
                {"account_id": account_id, "error": str(exc)},
            )
    return report


async def maybe_run_on_boot(client: FireflyClient) -> MigrationReport | None:
    """Run bulk migration once when profile_migration_meta is absent (D-13, pitfall 6)."""
    existing = await sidecar_db.get_profile_migration_meta()
    if existing is not None:
        return None
    report = await migrate_account_profiles(client)
    await sidecar_db.upsert_profile_migration_meta(
        ran_at=_utc_now_iso(),
        accounts_scanned=report.accounts_scanned,
        accounts_migrated=report.migrated,
    )
    return report
