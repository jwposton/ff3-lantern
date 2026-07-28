"""FastAPI auth dependencies for protected admin routes (D-09, D-10)."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request

import sidecar_db


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
