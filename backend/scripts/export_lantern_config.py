"""Export lantern-config.v1 bundle to a JSON file. Run from backend container or repo backend/."""

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
from lantern_config_bundle import export_bundle


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export lantern-config.v1 JSON bundle from the sidecar"
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output JSON file path",
    )
    parser.add_argument(
        "--label",
        default=None,
        help="Optional source_instance label stored in the bundle header",
    )
    args = parser.parse_args()

    await sidecar_db.init_db()
    client = FireflyClient()
    bundle = await export_bundle(source_instance=args.label, client=client)
    output_path = Path(args.output)
    output_path.write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
