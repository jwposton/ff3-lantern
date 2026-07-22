"""Import lantern-config.v1 bundle with preview-then-confirm. Run from backend container or repo backend/."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import sidecar_db
from firefly_client import FireflyClient
from lantern_config_bundle import import_bundle


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import lantern-config.v1 JSON bundle into the sidecar"
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Input JSON bundle path",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Write after validation (default: preview only)",
    )
    args = parser.parse_args()

    await sidecar_db.init_db()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("Import file must contain a JSON object")

    client = FireflyClient()
    report = await import_bundle(payload, client=client, confirm=args.confirm)
    print(json.dumps(report.model_dump(), indent=2))
    return 0 if report.valid else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
