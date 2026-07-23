"""Manual re-run of account profile backfill from Firefly notes. Run from backend/."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import sidecar_db
from firefly_client import FireflyClient
from profile_migration import migrate_account_profiles


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill CC, liability worksheet, and loan profiles from Firefly notes"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would migrate without writing sidecar rows",
    )
    args = parser.parse_args()

    await sidecar_db.init_db()
    client = FireflyClient()
    report = await migrate_account_profiles(client, dry_run=args.dry_run)
    print(
        f"scanned={report.accounts_scanned} migrated={report.migrated} "
        f"skipped={report.skipped} failures={len(report.failures)}"
    )
    for failure in report.failures:
        print(f"  {failure['account_id']}: {failure['error']}")
    return 1 if report.failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
