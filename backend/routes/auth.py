"""Public auth configuration endpoints (AUTH-01, D-01, D-03, AUTH-10)."""

from __future__ import annotations

from typing import Literal

from auth.access_log import append_login_failed, append_login_success, append_logout
from auth.config import load_auth_settings
from auth.cookies import (
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    attach_session_cookies,
    clear_session_cookies,
)
from auth.passwords import hash_password, validate_password_length, verify_password
from auth.rate_limit import LOGIN_RATE_LIMITER
from auth.resources import RESOURCES
from auth.sessions import (
    InvalidRefreshToken,
    ReuseDetected,
    create_session_pair,
    revoke_refresh,
    rotate_refresh,
    validate_access_token,
)
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sidecar_db import (
    clear_must_change_password,
    get_role,
    get_user,
    get_user_by_username,
    get_user_flags,
    list_role_permissions,
    update_user_last_login,
    update_user_password,
)

router = APIRouter()


class AuthConfigResponse(BaseModel):
    auth_mode: Literal["none", "local", "oidc"]
    secured: bool


class OkResponse(BaseModel):
    ok: bool = True


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AuthMeUser(BaseModel):
    id: int
    username: str
    display_name: str | None
    role_id: int


class AuthMeResponse(BaseModel):
    user: AuthMeUser
    must_change_password: bool
    permissions: dict[str, str]


@router.get("/auth/config", response_model=AuthConfigResponse)
async def get_auth_config() -> AuthConfigResponse:
    settings = load_auth_settings()
    return AuthConfigResponse(
        auth_mode=settings.auth_mode,  # type: ignore[arg-type]
        secured=settings.secured,
    )


@router.get("/auth/me", response_model=AuthMeResponse)
async def get_auth_me(request: Request) -> AuthMeResponse:
    settings = load_auth_settings()
    if settings.auth_mode == "none":
        raise HTTPException(status_code=404, detail="Not found")

    user_id = getattr(request.state, "auth_user_id", None)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = await get_user(int(user_id))
    if user is None or not user["enabled"]:
        raise HTTPException(status_code=401, detail="Not authenticated")

    flags = await get_user_flags(int(user_id))
    must_change = bool(flags and flags["must_change_password"] == 1)

    role = await get_role(user["role_id"])
    if role is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if role["is_system"]:
        permissions = {resource: "write" for resource in RESOURCES}
    else:
        rows = await list_role_permissions(role["id"])
        matrix = {row["resource"]: row["level"] for row in rows}
        permissions = {
            resource: matrix.get(resource, "none") for resource in RESOURCES
        }

    return AuthMeResponse(
        user=AuthMeUser(
            id=int(user["id"]),
            username=user["username"],
            display_name=user.get("display_name"),
            role_id=int(user["role_id"]),
        ),
        must_change_password=must_change,
        permissions=permissions,
    )


@router.post("/auth/login", response_model=OkResponse)
async def login_local(request: Request, body: LoginRequest) -> JSONResponse:
    settings = load_auth_settings()
    if settings.auth_mode != "local":
        raise HTTPException(status_code=404, detail="Local login not available")

    username = body.username.strip()
    if LOGIN_RATE_LIMITER.is_locked(username):
        raise HTTPException(status_code=429, detail="Too many login attempts")

    user = await get_user_by_username(username)
    password_hash = user.get("password_hash") if user else None
    if (
        user is None
        or not user["enabled"]
        or not password_hash
        or not verify_password(body.password, password_hash)
    ):
        await append_login_failed(request, username)
        LOGIN_RATE_LIMITER.record_failure(username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id = int(user["id"])
    LOGIN_RATE_LIMITER.clear(username)
    await update_user_last_login(user_id)
    await append_login_success(request, user_id)
    pair = await create_session_pair(user_id)
    response = JSONResponse({"ok": True})
    attach_session_cookies(
        response,
        pair.access,
        pair.refresh,
        secure=settings.cookie_secure,
    )
    return response


@router.post("/auth/change-password", response_model=OkResponse)
async def change_password(request: Request, body: ChangePasswordRequest) -> JSONResponse:
    user_id = getattr(request.state, "auth_user_id", None)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = await get_user(int(user_id))
    stored_hash = user.get("password_hash") if user else None
    if user is None or not stored_hash:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not verify_password(body.current_password, stored_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    try:
        validate_password_length(body.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await update_user_password(
        int(user_id),
        hash_password(body.new_password),
        must_change_password=0,
    )
    await clear_must_change_password(int(user_id))
    return JSONResponse({"ok": True})


@router.post("/auth/refresh", response_model=OkResponse)
async def refresh_session(request: Request) -> JSONResponse:
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        pair = await rotate_refresh(refresh_token)
    except (ReuseDetected, InvalidRefreshToken):
        raise HTTPException(status_code=401, detail="Not authenticated") from None
    settings = load_auth_settings()
    response = JSONResponse({"ok": True})
    attach_session_cookies(
        response,
        pair.access,
        pair.refresh,
        secure=settings.cookie_secure,
    )
    return response


@router.post("/auth/logout", response_model=OkResponse)
async def logout_session(request: Request) -> JSONResponse:
    access_token = request.cookies.get(ACCESS_COOKIE_NAME)
    if access_token:
        user_id = await validate_access_token(access_token)
        if user_id is not None:
            await append_logout(request, user_id)
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if refresh_token:
        await revoke_refresh(refresh_token)
    settings = load_auth_settings()
    response = JSONResponse({"ok": True})
    clear_session_cookies(response, secure=settings.cookie_secure)
    return response
