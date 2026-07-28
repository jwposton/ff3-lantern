"""Admin roles API and require_system_admin gate tests (Phase 34, AUTH-06)."""

from __future__ import annotations

import importlib

import httpx
import pytest
from auth.cookies import ACCESS_COOKIE_NAME
from auth.passwords import hash_password
from auth.rate_limit import LOGIN_RATE_LIMITER
from fastapi.testclient import TestClient
from firefly_client import FireflyClient
from sidecar_db import (
    clear_must_change_password,
    get_user_by_username,
    insert_user,
    list_role_permissions,
)


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


def _admin_client(monkeypatch, data_dir, bootstrap_env, cookies: dict[str, str]) -> TestClient:
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(data_dir))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import main

    importlib.reload(main)
    client = TestClient(main.app)
    client.cookies.update(cookies)
    return client


@pytest.mark.asyncio
async def test_role_seed_three_roles(
    monkeypatch, data_dir, bootstrap_env, admin_session
):
    client = _admin_client(monkeypatch, data_dir, bootstrap_env, admin_session)
    with client:
        response = client.get("/api/admin/roles")
    assert response.status_code == 200
    names = {role["name"] for role in response.json()["data"]}
    assert names == {"admin", "Viewer", "Member"}


@pytest.mark.asyncio
async def test_roles_list_requires_admin(monkeypatch, data_dir, bootstrap_env):
    client = _local_client(monkeypatch, data_dir, bootstrap_env)
    with client:
        pass

    await insert_user(
        {
            "username": "vieweruser2",
            "role_id": 2,
            "enabled": 1,
            "must_change_password": 0,
            "password_hash": hash_password("viewerpass1234"),
        }
    )
    from auth.sessions import create_session_pair

    viewer = await get_user_by_username("vieweruser2")
    pair = await create_session_pair(user_id=int(viewer["id"]))

    import main

    client = TestClient(main.app)
    client.cookies.set(ACCESS_COOKIE_NAME, pair.access)
    response = client.get("/api/admin/roles")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_delete_system_admin_forbidden(
    monkeypatch, data_dir, bootstrap_env, admin_session
):
    client = _admin_client(monkeypatch, data_dir, bootstrap_env, admin_session)
    with client:
        response = client.delete("/api/admin/roles/1")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_duplicate_role_name_rejected(
    monkeypatch, data_dir, bootstrap_env, admin_session
):
    client = _admin_client(monkeypatch, data_dir, bootstrap_env, admin_session)
    with client:
        response = client.post(
            "/api/admin/roles/2/duplicate",
            json={"name": "Member"},
        )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_duplicate_role_clones_permissions(
    monkeypatch, data_dir, bootstrap_env, admin_session
):
    source_permissions = await list_role_permissions(2)
    client = _admin_client(monkeypatch, data_dir, bootstrap_env, admin_session)
    with client:
        response = client.post("/api/admin/roles/2/duplicate")
    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "Viewer copy"
    assert len(payload["permissions"]) == len(source_permissions)
    assert payload["permissions"]["dashboard"] == "read"
    assert payload["permissions"]["admin"] == "none"


@pytest.mark.asyncio
async def test_delete_role_with_users_conflict(
    monkeypatch, data_dir, bootstrap_env, admin_session
):
    await insert_user(
        {
            "username": "viewerassigned",
            "role_id": 2,
            "enabled": 1,
            "must_change_password": 0,
            "password_hash": hash_password("viewerpass1234"),
        }
    )
    client = _admin_client(monkeypatch, data_dir, bootstrap_env, admin_session)
    with client:
        response = client.delete("/api/admin/roles/2")
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_create_role_invalid_resource(
    monkeypatch, data_dir, bootstrap_env, admin_session
):
    client = _admin_client(monkeypatch, data_dir, bootstrap_env, admin_session)
    with client:
        response = client.post(
            "/api/admin/roles",
            json={"name": "Bad Role", "permissions": {"not_a_resource": "read"}},
        )
    assert response.status_code == 422
