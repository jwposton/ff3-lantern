"""Access log append helpers for auth events (D-15)."""

from __future__ import annotations

import json

from fastapi import Request

from sidecar_db import insert_access_log


def _client_ip(request: Request) -> str | None:
    if request.client is not None:
        return request.client.host
    return None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


async def append_login_success(request: Request, user_id: int) -> None:
    await insert_access_log(
        "login_success",
        user_id=user_id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
    )


async def append_login_failed(request: Request, username: str) -> None:
    await insert_access_log(
        "login_failed",
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        detail_json=json.dumps({"username": username}),
    )


async def append_logout(request: Request, user_id: int) -> None:
    await insert_access_log(
        "logout",
        user_id=user_id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
    )


async def append_permission_denied(
    request: Request,
    user_id: int,
    *,
    resource: str,
    action: str,
    required_level: str,
) -> None:
    await insert_access_log(
        "permission_denied",
        user_id=user_id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        detail_json=json.dumps(
            {
                "resource": resource,
                "action": action,
                "required_level": required_level,
                "path": request.url.path,
            }
        ),
    )
