"""Pure ASGI session auth middleware (AUTH-02, D-16–D-19)."""

from __future__ import annotations

from starlette.responses import JSONResponse

from auth.cookies import ACCESS_COOKIE_NAME
from auth.sessions import validate_access_token
from sidecar_db import get_user, get_user_flags

_PUBLIC_AUTH_PATHS = frozenset(
    {
        "/api/auth/config",
        "/api/auth/login",
        "/api/auth/refresh",
        "/api/auth/logout",
    }
)

_MUST_CHANGE_ALLOWLIST = frozenset(
    {
        "/api/auth/config",
        "/api/auth/logout",
        "/api/auth/change-password",
        "/api/auth/me",
    }
)


def _unauthenticated_response() -> JSONResponse:
    return JSONResponse({"detail": "Not authenticated"}, status_code=401)


def _forbidden_response() -> JSONResponse:
    return JSONResponse({"detail": "Forbidden"}, status_code=403)


def _must_change_response() -> JSONResponse:
    return JSONResponse({"detail": "Password change required"}, status_code=403)


def _get_cookie(scope: dict, name: str) -> str | None:
    for header_name, header_value in scope.get("headers", ()):
        if header_name != b"cookie":
            continue
        cookie_header = header_value.decode("latin-1")
        prefix = f"{name}="
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith(prefix):
                return part[len(prefix) :]
        return None
    return None


def _is_public_path(path: str) -> bool:
    return path == "/health" or path in _PUBLIC_AUTH_PATHS


class SessionAuthMiddleware:
    """Deny-by-default gate for /api/* when registered (local/oidc modes)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if _is_public_path(path) or not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return

        access_token = _get_cookie(scope, ACCESS_COOKIE_NAME)
        if not access_token:
            await _unauthenticated_response()(scope, receive, send)
            return

        user_id = await validate_access_token(access_token)
        if user_id is None:
            await _unauthenticated_response()(scope, receive, send)
            return

        user = await get_user(user_id)
        if user is None or not user["enabled"]:
            await _forbidden_response()(scope, receive, send)
            return

        scope.setdefault("state", {})["auth_user_id"] = user_id
        await self.app(scope, receive, send)


class MustChangePasswordMiddleware:
    """Block /api/* when must_change_password is set except D-03 allowlist."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if _is_public_path(path) or not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return

        user_id = scope.get("state", {}).get("auth_user_id")
        if user_id is None:
            await self.app(scope, receive, send)
            return

        if path in _MUST_CHANGE_ALLOWLIST:
            await self.app(scope, receive, send)
            return

        flags = await get_user_flags(int(user_id))
        if flags is not None and flags["must_change_password"] == 1:
            await _must_change_response()(scope, receive, send)
            return

        await self.app(scope, receive, send)
