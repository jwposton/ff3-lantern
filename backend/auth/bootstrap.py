"""Local auth bootstrap: role seeding and first admin user (D-01, D-02, D-04–D-08)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from auth.config import AuthSettings
from auth.passwords import hash_password, validate_password_length
from auth.resources import VIEWER_NONE_RESOURCES, VIEWER_READ_RESOURCES
import sidecar_db

logger = logging.getLogger("uvicorn.error")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _viewer_permission_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = [
        {"resource": resource, "level": "read"}
        for resource in VIEWER_READ_RESOURCES
    ]
    rows.extend(
        {"resource": resource, "level": "none"}
        for resource in VIEWER_NONE_RESOURCES
    )
    return rows


async def _seed_roles() -> None:
    created_at = _utc_now()
    await sidecar_db.insert_role(
        id=1,
        name="admin",
        slug="admin",
        is_system=1,
        created_at=created_at,
    )
    await sidecar_db.insert_role(
        id=2,
        name="Viewer",
        slug="viewer",
        is_system=0,
        created_at=created_at,
    )
    viewer_rows = _viewer_permission_rows()
    await sidecar_db.replace_role_permissions(role_id=2, rows=viewer_rows)
    await sidecar_db.insert_role(
        id=3,
        name="Member",
        slug="member",
        is_system=0,
        created_at=created_at,
    )
    await sidecar_db.replace_role_permissions(role_id=3, rows=viewer_rows)


async def ensure_local_auth_ready(settings: AuthSettings) -> None:
    """Seed roles and optionally bootstrap the first local admin user."""
    if settings.auth_mode not in ("local", "oidc"):
        return

    if await sidecar_db.count_roles() == 0:
        await _seed_roles()

    if settings.auth_mode != "local":
        return

    if await sidecar_db.count_users() > 0:
        return

    if not settings.bootstrap_username or not settings.bootstrap_password:
        logger.error(
            "FF3LANTERN_AUTH_MODE=local but no users exist and bootstrap credentials "
            "are missing. Set FF3LANTERN_BOOTSTRAP_ADMIN_USERNAME and "
            "FF3LANTERN_BOOTSTRAP_ADMIN_PASSWORD (password must be at least 12 "
            "characters) before starting Lantern."
        )
        raise SystemExit(1)

    try:
        validate_password_length(settings.bootstrap_password)
    except ValueError as exc:
        logger.error("Bootstrap admin password invalid: %s", exc)
        raise SystemExit(1) from exc

    await sidecar_db.insert_user(
        {
            "username": settings.bootstrap_username,
            "role_id": 1,
            "enabled": 1,
            "must_change_password": 1,
            "password_hash": hash_password(settings.bootstrap_password),
        }
    )
