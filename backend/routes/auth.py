"""Public auth configuration endpoints (AUTH-01, D-01, D-03)."""

from __future__ import annotations

from typing import Literal

from auth.config import load_auth_settings
from auth.cookies import REFRESH_COOKIE_NAME, attach_session_cookies, clear_session_cookies
from auth.sessions import InvalidRefreshToken, ReuseDetected, revoke_refresh, rotate_refresh
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()


class AuthConfigResponse(BaseModel):
    auth_mode: Literal["none", "local", "oidc"]
    secured: bool


class OkResponse(BaseModel):
    ok: bool = True


@router.get("/auth/config", response_model=AuthConfigResponse)
async def get_auth_config() -> AuthConfigResponse:
    settings = load_auth_settings()
    return AuthConfigResponse(
        auth_mode=settings.auth_mode,  # type: ignore[arg-type]
        secured=settings.secured,
    )


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
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if refresh_token:
        await revoke_refresh(refresh_token)
    settings = load_auth_settings()
    response = JSONResponse({"ok": True})
    clear_session_cookies(response, secure=settings.cookie_secure)
    return response
