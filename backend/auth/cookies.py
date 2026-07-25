"""HttpOnly session cookie helpers (AUTH-03, D-09–D-11)."""

from __future__ import annotations

from starlette.responses import Response

ACCESS_COOKIE_NAME = "ff3lantern_access"
REFRESH_COOKIE_NAME = "ff3lantern_refresh"
ACCESS_TTL_SECONDS = 900
REFRESH_TTL_SECONDS = 604800

_COOKIE_ATTRS = {
    "httponly": True,
    "samesite": "lax",
    "path": "/",
}


def attach_session_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    *,
    secure: bool,
) -> None:
    response.set_cookie(
        ACCESS_COOKIE_NAME,
        access_token,
        max_age=ACCESS_TTL_SECONDS,
        secure=secure,
        **_COOKIE_ATTRS,
    )
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=REFRESH_TTL_SECONDS,
        secure=secure,
        **_COOKIE_ATTRS,
    )


def clear_session_cookies(response: Response, *, secure: bool) -> None:
    response.delete_cookie(ACCESS_COOKIE_NAME, secure=secure, **_COOKIE_ATTRS)
    response.delete_cookie(REFRESH_COOKIE_NAME, secure=secure, **_COOKIE_ATTRS)
