"""Admin users CRUD API (Phase 34, AUTH-07)."""

from __future__ import annotations

from typing import Any

from auth.dependencies import AdminUserId
from auth.passwords import hash_password, validate_password_length
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import sidecar_db

router = APIRouter()


class UserCreateBody(BaseModel):
    username: str
    password: str
    role_id: int
    display_name: str | None = None


class UserPatchBody(BaseModel):
    enabled: bool | None = None
    role_id: int | None = None
    display_name: str | None = None


class ResetPasswordBody(BaseModel):
    new_password: str


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user.get("display_name"),
        "role_id": user["role_id"],
        "role_name": user.get("role_name"),
        "enabled": user["enabled"],
        "must_change_password": user.get("must_change_password"),
        "created_at": user["created_at"],
        "last_login_at": user.get("last_login_at"),
    }


async def _ensure_role_exists(role_id: int) -> None:
    role = await sidecar_db.get_role(role_id)
    if role is None:
        raise HTTPException(status_code=422, detail=f"Role not found: {role_id}")


async def _ensure_not_last_system_admin(user_id: int) -> None:
    user = await sidecar_db.get_user(user_id)
    if user is None:
        return
    role = await sidecar_db.get_role(user["role_id"])
    if role is None or not role["is_system"]:
        return
    remaining = await sidecar_db.count_enabled_system_admins(exclude_user_id=user_id)
    if remaining == 0:
        raise HTTPException(
            status_code=403,
            detail="Cannot disable the last enabled system admin.",
        )


@router.get("/admin/users")
async def list_users_route(_admin_user_id: AdminUserId) -> dict[str, list[dict[str, Any]]]:
    users = await sidecar_db.list_users()
    return {"data": [_public_user(user) for user in users]}


@router.post("/admin/users", status_code=201)
async def create_user_route(
    body: UserCreateBody,
    _admin_user_id: AdminUserId,
) -> dict[str, Any]:
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username is required.")
    await _ensure_role_exists(body.role_id)
    try:
        validate_password_length(body.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    existing = await sidecar_db.get_user_by_username(username)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Username already exists: {username}",
        )
    password_hash = hash_password(body.password)
    try:
        user_id = await sidecar_db.insert_user(
            {
                "username": username,
                "password_hash": password_hash,
                "role_id": body.role_id,
                "display_name": body.display_name,
                "enabled": 1,
                "must_change_password": 1,
            }
        )
    except sidecar_db.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    user = await sidecar_db.get_user_with_role(user_id)
    assert user is not None
    return _public_user(user)


@router.get("/admin/users/{user_id}")
async def get_user_route(
    user_id: int,
    _admin_user_id: AdminUserId,
) -> dict[str, Any]:
    user = await sidecar_db.get_user_with_role(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return _public_user(user)


@router.patch("/admin/users/{user_id}")
async def patch_user_route(
    user_id: int,
    body: UserPatchBody,
    _admin_user_id: AdminUserId,
) -> dict[str, Any]:
    user = await sidecar_db.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if body.role_id is not None:
        await _ensure_role_exists(body.role_id)
    if body.enabled is False:
        await _ensure_not_last_system_admin(user_id)
    fields: dict[str, Any] = {}
    if body.enabled is not None:
        fields["enabled"] = body.enabled
    if body.role_id is not None:
        fields["role_id"] = body.role_id
    if body.display_name is not None:
        fields["display_name"] = body.display_name
    if fields:
        try:
            await sidecar_db.update_user(user_id, fields)
        except sidecar_db.ConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    updated = await sidecar_db.get_user_with_role(user_id)
    assert updated is not None
    return _public_user(updated)


@router.post("/admin/users/{user_id}/reset-password")
async def reset_password_route(
    user_id: int,
    body: ResetPasswordBody,
    _admin_user_id: AdminUserId,
) -> dict[str, bool]:
    user = await sidecar_db.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    try:
        validate_password_length(body.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    password_hash = hash_password(body.new_password)
    await sidecar_db.update_user_password(user_id, password_hash, must_change_password=1)
    return {"ok": True}
