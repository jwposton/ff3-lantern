"""Admin config export/import routes (lantern-config.v1, #98)."""

from __future__ import annotations

import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from firefly_client import FireflyClient
from lantern_config_bundle import export_bundle, import_bundle

router = APIRouter()

MAX_IMPORT_BYTES = 5 * 1024 * 1024


def get_firefly_client() -> FireflyClient:
    return FireflyClient()


@router.get("/admin/config/export")
async def export_config(
    client: FireflyClient = Depends(get_firefly_client),
) -> Response:
    bundle = await export_bundle(client=client)
    filename = f"lantern-config-{date.today().isoformat()}.json"
    body = json.dumps(bundle, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/admin/config/import")
async def import_config(
    request: Request,
    client: FireflyClient = Depends(get_firefly_client),
) -> dict:
    raw = await request.body()
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Request body too large (max 5MB)",
        )
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Invalid JSON body") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Import body must be a JSON object")
    confirm = bool(body.pop("confirm", False))
    report = await import_bundle(body, client=client, confirm=confirm)
    return report.model_dump()
