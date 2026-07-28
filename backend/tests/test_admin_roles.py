"""Admin roles API and require_system_admin gate tests (Phase 34, AUTH-06)."""

from __future__ import annotations

import asyncio
import importlib

import httpx
import pytest
from auth.passwords import hash_password
from auth.rate_limit import LOGIN_RATE_LIMITER
from fastapi.testclient import TestClient
from firefly_client import FireflyClient
from sidecar_db import clear_must_change_password, get_user_by_username, insert_user


def _local_client(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import main

    importlib.reload(main)
    return TestClient(main.app)


def _build_export_client() -> FireflyClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    return FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )


def test_config_export_unauthenticated(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        response = client.get("/api/admin/config/export")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_config_export_requires_admin(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        pass

    await insert_user(
        {
            "username": "vieweruser",
            "role_id": 2,
            "enabled": 1,
            "must_change_password": 0,
            "password_hash": hash_password("viewerpass1234"),
        }
    )
    from auth.sessions import create_session_pair

    viewer = await get_user_by_username("vieweruser")
    pair = await create_session_pair(user_id=int(viewer["id"]))

    import main
    import routes.admin_config as admin_config_mod

    app = main.app
    app.dependency_overrides[admin_config_mod.get_firefly_client] = (
        lambda: _build_export_client()
    )
    try:
        with TestClient(app) as client:
            response = client.get(
                "/api/admin/config/export",
                cookies={"ff3lantern_access": pair.access},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_config_export_admin_allowed(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        login = client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "bootstrappass12"},
        )
    assert login.status_code == 200

    admin = await get_user_by_username("bootstrapadmin")
    await clear_must_change_password(int(admin["id"]))

    import main
    import routes.admin_config as admin_config_mod

    app = main.app
    app.dependency_overrides[admin_config_mod.get_firefly_client] = (
        lambda: _build_export_client()
    )
    try:
        with TestClient(app) as client:
            response = client.get(
                "/api/admin/config/export",
                cookies=login.cookies,
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["schema"] == "lantern-config.v1"
