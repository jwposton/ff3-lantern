"""Public auth configuration endpoints (AUTH-01, D-01, D-03)."""

from __future__ import annotations

from typing import Literal

from auth.config import load_auth_settings
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class AuthConfigResponse(BaseModel):
    auth_mode: Literal["none", "local", "oidc"]
    secured: bool


@router.get("/auth/config", response_model=AuthConfigResponse)
async def get_auth_config() -> AuthConfigResponse:
    settings = load_auth_settings()
    return AuthConfigResponse(
        auth_mode=settings.auth_mode,  # type: ignore[arg-type]
        secured=settings.secured,
    )
