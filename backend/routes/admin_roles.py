"""Admin roles CRUD API (Phase 34, AUTH-06, D-11)."""

from __future__ import annotations

import re
from typing import Any

from auth.dependencies import AdminUserId
from auth.resources import RESOURCES, VALID_LEVELS
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import sidecar_db

router = APIRouter()


class RoleCreateBody(BaseModel):
    name: str
    permissions: dict[str, str] = Field(default_factory=dict)


class RoleUpdateBody(BaseModel):
    name: str
    permissions: dict[str, str] = Field(default_factory=dict)


class RoleDuplicateBody(BaseModel):
    name: str | None = None


def _slugify_label(label: str) -> str:
    text = label.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:64].strip("-")


def _normalize_permissions(permissions: dict[str, str]) -> dict[str, str]:
    unknown = set(permissions) - RESOURCES
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown permission resources: {sorted(unknown)}",
        )
    invalid_levels = {
        resource: level
        for resource, level in permissions.items()
        if level not in VALID_LEVELS
    }
    if invalid_levels:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid permission levels: {invalid_levels}",
        )
    normalized = {resource: "none" for resource in RESOURCES}
    normalized.update(permissions)
    return normalized


def _permissions_to_rows(permissions: dict[str, str]) -> list[dict[str, str]]:
    return [
        {"resource": resource, "level": level}
        for resource, level in sorted(permissions.items())
    ]


def _permissions_from_rows(rows: list[dict[str, Any]]) -> dict[str, str]:
    return {row["resource"]: row["level"] for row in rows}


async def _resolve_role_slug(name: str, *, exclude_role_id: int | None = None) -> str:
    base = _slugify_label(name) or "role"
    for attempt in range(100):
        candidate = base if attempt == 0 else f"{base}-{attempt + 1}"
        existing = await sidecar_db.get_role_by_slug(candidate)
        if existing is None or (
            exclude_role_id is not None and existing["id"] == exclude_role_id
        ):
            return candidate
    raise HTTPException(status_code=500, detail="Failed to allocate role slug.")


async def _ensure_unique_role_name(
    name: str,
    *,
    exclude_role_id: int | None = None,
) -> None:
    existing = await sidecar_db.get_role_by_name(name)
    if existing is not None and (
        exclude_role_id is None or existing["id"] != exclude_role_id
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Role name already exists: {name}",
        )


async def _role_payload(role: dict[str, Any]) -> dict[str, Any]:
    rows = await sidecar_db.list_role_permissions(role["id"])
    return {
        **role,
        "permissions": _permissions_from_rows(rows),
    }


@router.get("/admin/roles")
async def list_roles_route(_admin_user_id: AdminUserId) -> dict[str, list[dict[str, Any]]]:
    roles = await sidecar_db.list_roles()
    data = [await _role_payload(role) for role in roles]
    return {"data": data}


@router.post("/admin/roles", status_code=201)
async def create_role_route(
    body: RoleCreateBody,
    _admin_user_id: AdminUserId,
) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Role name is required.")
    await _ensure_unique_role_name(name)
    permissions = _normalize_permissions(body.permissions)
    role_id = await sidecar_db.allocate_next_id("lantern_roles")
    slug = await _resolve_role_slug(name)
    await sidecar_db.insert_role(
        id=role_id,
        name=name,
        slug=slug,
        is_system=0,
    )
    await sidecar_db.replace_role_permissions(
        role_id,
        _permissions_to_rows(permissions),
    )
    role = await sidecar_db.get_role(role_id)
    assert role is not None
    return await _role_payload(role)


@router.get("/admin/roles/{role_id}")
async def get_role_route(
    role_id: int,
    _admin_user_id: AdminUserId,
) -> dict[str, Any]:
    role = await sidecar_db.get_role(role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found.")
    return await _role_payload(role)


@router.put("/admin/roles/{role_id}")
async def update_role_route(
    role_id: int,
    body: RoleUpdateBody,
    _admin_user_id: AdminUserId,
) -> dict[str, Any]:
    role = await sidecar_db.get_role(role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found.")
    if role["is_system"]:
        raise HTTPException(status_code=403, detail="System roles cannot be modified.")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Role name is required.")
    await _ensure_unique_role_name(name, exclude_role_id=role_id)
    permissions = _normalize_permissions(body.permissions)
    slug = await _resolve_role_slug(name, exclude_role_id=role_id)
    try:
        await sidecar_db.update_role(role_id, name, slug)
    except sidecar_db.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await sidecar_db.replace_role_permissions(
        role_id,
        _permissions_to_rows(permissions),
    )
    updated = await sidecar_db.get_role(role_id)
    assert updated is not None
    return await _role_payload(updated)


@router.delete("/admin/roles/{role_id}")
async def delete_role_route(
    role_id: int,
    _admin_user_id: AdminUserId,
) -> dict[str, bool]:
    role = await sidecar_db.get_role(role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found.")
    if role["is_system"]:
        raise HTTPException(status_code=403, detail="System roles cannot be deleted.")
    assigned = await sidecar_db.count_users_for_role(role_id)
    if assigned > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete role while {assigned} user(s) are assigned.",
        )
    await sidecar_db.delete_role(role_id)
    return {"ok": True}


@router.post("/admin/roles/{role_id}/duplicate", status_code=201)
async def duplicate_role_route(
    role_id: int,
    body: RoleDuplicateBody,
    _admin_user_id: AdminUserId,
) -> dict[str, Any]:
    source = await sidecar_db.get_role(role_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Role not found.")
    name = (body.name or f"{source['name']} copy").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Role name is required.")
    await _ensure_unique_role_name(name)
    new_role_id = await sidecar_db.allocate_next_id("lantern_roles")
    slug = await _resolve_role_slug(name)
    try:
        await sidecar_db.insert_role(
            id=new_role_id,
            name=name,
            slug=slug,
            is_system=0,
        )
    except sidecar_db.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await sidecar_db.duplicate_role_permissions(role_id, new_role_id)
    created = await sidecar_db.get_role(new_role_id)
    assert created is not None
    return await _role_payload(created)
