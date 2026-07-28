"""Admin users API tests (Phase 34, AUTH-07)."""

from __future__ import annotations

import importlib

import pytest
from auth.cookies import ACCESS_COOKIE_NAME
from auth.passwords import hash_password
from auth.rate_limit import LOGIN_RATE_LIMITER
from fastapi.testclient import TestClient
from sidecar_db import clear_must_change_password, get_user_by_username


def _local_client(monkeypatch, data_dir, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(data_dir))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import main

    importlib.reload(main)
    return TestClient(main.app)


@pytest.mark.asyncio
async def test_create_user(monkeypatch, data_dir, bootstrap_env, admin_client):
    with admin_client:
        response = admin_client.post(
            "/api/admin/users",
            json={
                "username": "newviewer",
                "password": "newviewerpass1",
                "role_id": 2,
                "display_name": "New Viewer",
            },
        )
    assert response.status_code == 201
    payload = response.json()
    assert payload["username"] == "newviewer"
    assert payload["role_id"] == 2
    assert payload["role_name"] == "Viewer"
    assert "password_hash" not in payload

    login_client = _local_client(monkeypatch, data_dir, bootstrap_env)
    with login_client:
        login = login_client.post(
            "/api/auth/login",
            json={"username": "newviewer", "password": "newviewerpass1"},
        )
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_disabled_user_login_and_session(
    monkeypatch, data_dir, bootstrap_env, admin_client
):
    with admin_client:
        created = admin_client.post(
            "/api/admin/users",
            json={
                "username": "disableme",
                "password": "disablemepass1",
                "role_id": 2,
            },
        )
    assert created.status_code == 201
    user_id = created.json()["id"]

    user = await get_user_by_username("disableme")
    assert user is not None
    await clear_must_change_password(int(user["id"]))

    login_client = _local_client(monkeypatch, data_dir, bootstrap_env)
    with login_client:
        login = login_client.post(
            "/api/auth/login",
            json={"username": "disableme", "password": "disablemepass1"},
        )
    assert login.status_code == 200
    cookies = dict(login.cookies)

    with admin_client:
        patch = admin_client.patch(
            f"/api/admin/users/{user_id}",
            json={"enabled": False},
        )
    assert patch.status_code == 200
    assert patch.json()["enabled"] is False

    with login_client:
        relogin = login_client.post(
            "/api/auth/login",
            json={"username": "disableme", "password": "disablemepass1"},
        )
        assert relogin.status_code == 401
        blocked = login_client.post("/api/cache/clear", cookies=cookies)
    assert blocked.status_code == 403


@pytest.mark.asyncio
async def test_reset_password(monkeypatch, data_dir, bootstrap_env, admin_client):
    with admin_client:
        created = admin_client.post(
            "/api/admin/users",
            json={
                "username": "resetme",
                "password": "resetmepass123",
                "role_id": 2,
            },
        )
    assert created.status_code == 201
    user_id = created.json()["id"]

    user = await get_user_by_username("resetme")
    assert user is not None
    await clear_must_change_password(int(user["id"]))

    login_client = _local_client(monkeypatch, data_dir, bootstrap_env)
    with login_client:
        old_login = login_client.post(
            "/api/auth/login",
            json={"username": "resetme", "password": "resetmepass123"},
        )
    assert old_login.status_code == 200

    with admin_client:
        reset = admin_client.post(
            f"/api/admin/users/{user_id}/reset-password",
            json={"new_password": "newresetpass12"},
        )
    assert reset.status_code == 200
    assert reset.json() == {"ok": True}

    with login_client:
        old_fails = login_client.post(
            "/api/auth/login",
            json={"username": "resetme", "password": "resetmepass123"},
        )
        assert old_fails.status_code == 401
        new_login = login_client.post(
            "/api/auth/login",
            json={"username": "resetme", "password": "newresetpass12"},
        )
        assert new_login.status_code == 200
        blocked = login_client.post("/api/cache/clear", cookies=new_login.cookies)
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "Password change required"


@pytest.mark.asyncio
async def test_patch_role_assignment(monkeypatch, data_dir, bootstrap_env, admin_client):
    with admin_client:
        created = admin_client.post(
            "/api/admin/users",
            json={
                "username": "rolepatch",
                "password": "rolepatchpass1",
                "role_id": 2,
            },
        )
    assert created.status_code == 201
    user_id = created.json()["id"]

    with admin_client:
        patch = admin_client.patch(
            f"/api/admin/users/{user_id}",
            json={"role_id": 3},
        )
        get_user = admin_client.get(f"/api/admin/users/{user_id}")
    assert patch.status_code == 200
    assert patch.json()["role_id"] == 3
    assert patch.json()["role_name"] == "Member"
    assert get_user.status_code == 200
    assert get_user.json()["role_id"] == 3
    assert get_user.json()["role_name"] == "Member"


@pytest.mark.asyncio
async def test_create_user_duplicate_username(
    monkeypatch, data_dir, bootstrap_env, admin_client
):
    body = {
        "username": "dupuser",
        "password": "dupuserpass123",
        "role_id": 2,
    }
    with admin_client:
        first = admin_client.post("/api/admin/users", json=body)
        second = admin_client.post("/api/admin/users", json=body)
    assert first.status_code == 201
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_users_list_requires_admin(monkeypatch, data_dir, bootstrap_env):
    from auth.sessions import create_session_pair
    from sidecar_db import insert_user

    client = _local_client(monkeypatch, data_dir, bootstrap_env)
    with client:
        pass

    await insert_user(
        {
            "username": "nonadminuser",
            "role_id": 2,
            "enabled": 1,
            "must_change_password": 0,
            "password_hash": hash_password("nonadminpass1"),
        }
    )
    viewer = await get_user_by_username("nonadminuser")
    pair = await create_session_pair(user_id=int(viewer["id"]))

    import main

    client = TestClient(main.app)
    client.cookies.set(ACCESS_COOKIE_NAME, pair.access)
    response = client.get("/api/admin/users")
    assert response.status_code == 403
