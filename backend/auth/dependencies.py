"""FastAPI auth dependencies for protected admin routes (D-09, D-10)."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request

import sidecar_db
from auth.access_log import append_permission_denied
from auth.config import load_auth_settings
from auth.permissions import (
    minimum_level_for_action,
    user_has_permission,
    validate_resource_action,
)


async def get_current_user_id(request: Request) -> int:
    user_id = getattr(request.state, "auth_user_id", None)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return int(user_id)


async def require_system_admin(
    user_id: int = Depends(get_current_user_id),
) -> int:
    user = await sidecar_db.get_user(user_id)
    if user is None or not user["enabled"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    role = await sidecar_db.get_role(user["role_id"])
    if role is None or not role["is_system"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    return user_id


AdminUserId = Annotated[int, Depends(require_system_admin)]


async def _authenticated_enabled_user(request: Request) -> tuple[int, bool]:
    """Return (user_id, is_system_admin) after session and enabled checks."""
    user_id = await get_current_user_id(request)
    user = await sidecar_db.get_user(user_id)
    if user is None or not user["enabled"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    role = await sidecar_db.get_role(user["role_id"])
    is_system_admin = role is not None and role["is_system"]
    return user_id, is_system_admin


def require_permission(resource: str, action: str):
    async def _check(request: Request) -> int:
        if load_auth_settings().auth_mode == "none":
            return 0
        user_id, is_system_admin = await _authenticated_enabled_user(request)
        if is_system_admin:
            return user_id
        validate_resource_action(resource, action)
        if not await user_has_permission(user_id, resource, action):
            await append_permission_denied(
                request,
                user_id,
                resource=resource,
                action=action,
                required_level=minimum_level_for_action(resource, action),
            )
            raise HTTPException(status_code=403, detail="Forbidden")
        return user_id

    return _check


def require_any_permission(*checks: tuple[str, str]):
    async def _check(request: Request) -> int:
        if load_auth_settings().auth_mode == "none":
            return 0
        user_id, is_system_admin = await _authenticated_enabled_user(request)
        if is_system_admin:
            return user_id
        for check_resource, check_action in checks:
            validate_resource_action(check_resource, check_action)
        for check_resource, check_action in checks:
            if await user_has_permission(user_id, check_resource, check_action):
                return user_id
        # Audit trail uses the first check when all alternatives fail.
        first_resource, first_action = checks[0]
        await append_permission_denied(
            request,
            user_id,
            resource=first_resource,
            action=first_action,
            required_level=minimum_level_for_action(first_resource, first_action),
        )
        raise HTTPException(status_code=403, detail="Forbidden")

    return _check


async def require_bill_register_permission(
    request: Request,
    source: str | None = Query(None),
) -> int:
    is_discover = (
        source == "discover"
        or request.headers.get("x-lantern-source") == "discover"
    )
    resource = "bill_discover" if is_discover else "bills"
    checker = require_permission(resource, "write")
    return await checker(request)
