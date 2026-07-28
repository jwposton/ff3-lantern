"""Local auth bootstrap, passwords, and resource catalog tests (Phase 34)."""

from __future__ import annotations

import asyncio
import importlib
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from auth.resources import (
    RESOURCES,
    SEED_LEVELS,
    VALID_LEVELS,
    VIEWER_NONE_RESOURCES,
    VIEWER_READ_RESOURCES,
)
from auth.cookies import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME
from auth.sessions import create_session_pair
from auth.passwords import hash_password
from sidecar_db import (
    count_users,
    get_role_by_slug,
    get_user,
    get_user_by_username,
    init_db,
    list_role_permissions,
    list_roles,
)
import aiosqlite
from sidecar_db import get_db_path


def test_hash_and_verify_password():
    from auth.passwords import hash_password, verify_password

    password = "validpassword12"
    stored = hash_password(password)
    assert stored.startswith("$2")
    assert verify_password(password, stored) is True
    assert verify_password("wrongpassword1", stored) is False


def test_validate_password_min_length():
    from auth.passwords import validate_password_length

    with pytest.raises(ValueError, match="12"):
        validate_password_length("short")


def test_validate_password_max_bytes():
    from auth.passwords import validate_password_length

    with pytest.raises(ValueError, match="72"):
        validate_password_length("a" * 73)


def test_resources_catalog_matches_epic():
    assert RESOURCES == frozenset(
        {
            "dashboard",
            "reports",
            "transactions",
            "categorize",
            "loans",
            "payment_worksheet",
            "payment_setup",
            "bill_discover",
            "bills",
            "liabilities",
            "admin",
            "ops_cache",
        }
    )
    assert VALID_LEVELS == frozenset({"none", "read", "limited", "write"})
    assert SEED_LEVELS == frozenset({"none", "read"})
    assert "limited" not in SEED_LEVELS
    assert len(VIEWER_READ_RESOURCES) == 7
    assert len(VIEWER_NONE_RESOURCES) == 5
    assert VIEWER_READ_RESOURCES == (
        "dashboard",
        "reports",
        "transactions",
        "payment_worksheet",
        "bill_discover",
        "bills",
        "liabilities",
    )
    assert VIEWER_NONE_RESOURCES == (
        "categorize",
        "loans",
        "payment_setup",
        "admin",
        "ops_cache",
    )


def test_bootstrap_creates_admin_when_db_empty(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    with TestClient(main.app):
        pass

    assert asyncio.run(count_users()) == 1
    user = asyncio.run(get_user_by_username("bootstrapadmin"))
    assert user is not None
    assert user["role_id"] == 1
    assert user["must_change_password"] is True


def test_bootstrap_missing_env_crashes(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("FF3LANTERN_BOOTSTRAP_ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("FF3LANTERN_BOOTSTRAP_ADMIN_PASSWORD", raising=False)
    import auth.config
    from auth.bootstrap import ensure_local_auth_ready

    importlib.reload(auth.config)
    settings = auth.config.load_auth_settings()
    with pytest.raises(SystemExit):
        asyncio.run(ensure_local_auth_ready(settings))


def test_role_seed_three_roles(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    with TestClient(main.app):
        pass

    roles = asyncio.run(list_roles())
    assert len(roles) == 3
    admin = asyncio.run(get_role_by_slug("admin"))
    assert admin is not None
    assert admin["is_system"] is True
    assert asyncio.run(list_role_permissions(admin["id"])) == []

    viewer = asyncio.run(get_role_by_slug("viewer"))
    assert viewer is not None
    viewer_perms = {
        row["resource"]: row["level"]
        for row in asyncio.run(list_role_permissions(viewer["id"]))
    }
    assert viewer_perms["dashboard"] == "read"
    assert viewer_perms["admin"] == "none"


async def _seed_existing_local_user() -> None:
    await init_db()
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT INTO lantern_roles (id, name, slug, is_system, created_at)
            VALUES (1, 'Existing', 'existing', 0, ?)
            """,
            (now,),
        )
        await db.execute(
            """
            INSERT INTO lantern_users (
              id, username, role_id, enabled, created_at
            )
            VALUES (1, 'existinguser', 1, 1, ?)
            """,
            (now,),
        )
        await db.commit()


def test_bootstrap_skipped_when_users_exist(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    asyncio.run(_seed_existing_local_user())
    import main

    importlib.reload(main)
    with TestClient(main.app):
        pass

    assert asyncio.run(count_users()) == 1
    assert asyncio.run(get_user_by_username("bootstrapadmin")) is None
    assert asyncio.run(get_user_by_username("existinguser")) is not None


def test_rate_limit_lockout_after_five_failures():
    from auth.rate_limit import LOGIN_RATE_LIMITER

    username = "rate_limit_user"
    LOGIN_RATE_LIMITER.clear(username)
    assert LOGIN_RATE_LIMITER.is_locked(username) is False
    for _ in range(5):
        LOGIN_RATE_LIMITER.record_failure(username)
    assert LOGIN_RATE_LIMITER.is_locked(username) is True


def test_rate_limit_clear_resets():
    from auth.rate_limit import LOGIN_RATE_LIMITER

    username = "rate_limit_clear_user"
    for _ in range(5):
        LOGIN_RATE_LIMITER.record_failure(username)
    assert LOGIN_RATE_LIMITER.is_locked(username) is True
    LOGIN_RATE_LIMITER.clear(username)
    assert LOGIN_RATE_LIMITER.is_locked(username) is False


async def _count_access_log_rows() -> int:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute("SELECT COUNT(*) FROM lantern_access_log")
        row = await cursor.fetchone()
        return int(row[0]) if row else 0


def test_insert_access_log_persists_event(monkeypatch, tmp_path):
    from sidecar_db import insert_access_log

    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))

    async def _run() -> tuple[str, str]:
        before = await _count_access_log_rows()
        await insert_access_log(
            "login_failed",
            detail_json='{"username": "testuser"}',
            ip_address="127.0.0.1",
        )
        after = await _count_access_log_rows()
        assert after == before + 1
        async with aiosqlite.connect(get_db_path()) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT event_type, detail_json FROM lantern_access_log ORDER BY id DESC LIMIT 1"
            )
            row = await cursor.fetchone()
        assert row is not None
        return row["event_type"], row["detail_json"]

    event_type, detail_json = asyncio.run(_run())
    assert event_type == "login_failed"
    assert detail_json == '{"username": "testuser"}'


def _local_client(monkeypatch, tmp_path, bootstrap_env):
    from auth.rate_limit import LOGIN_RATE_LIMITER

    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import main

    importlib.reload(main)
    return TestClient(main.app)


def test_login_success(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        response = client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "bootstrappass12"},
        )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert ACCESS_COOKIE_NAME in response.cookies
    assert REFRESH_COOKIE_NAME in response.cookies


def test_login_failed(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        response = client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "wrongpassword1"},
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_login_disabled_user(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)

    async def _disable_bootstrap_admin() -> None:
        user = await get_user_by_username("bootstrapadmin")
        assert user is not None
        async with aiosqlite.connect(get_db_path()) as db:
            await db.execute(
                "UPDATE lantern_users SET enabled = 0 WHERE id = ?",
                (user["id"],),
            )
            await db.commit()

    with client:
        client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "bootstrappass12"},
        )
        asyncio.run(_disable_bootstrap_admin())
        response = client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "bootstrappass12"},
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_login_not_available_in_none_mode(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    with TestClient(main.app) as client:
        response = client.post(
            "/api/auth/login",
            json={"username": "anyone", "password": "anypassword12"},
        )
    assert response.status_code == 404
    assert response.json()["detail"] == "Local login not available"


def test_change_password(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        login = client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "bootstrappass12"},
        )
        assert login.status_code == 200
        response = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "bootstrappass12",
                "new_password": "newpassword1234",
            },
        )
        assert response.status_code == 200
        user = asyncio.run(get_user_by_username("bootstrapadmin"))
    assert user is not None
    assert user["must_change_password"] is False


def test_login_rate_limit_429(monkeypatch, tmp_path, bootstrap_env):
    from auth.rate_limit import LOGIN_RATE_LIMITER

    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    username = "bootstrapadmin"
    LOGIN_RATE_LIMITER.clear(username)
    with client:
        for _ in range(5):
            bad = client.post(
                "/api/auth/login",
                json={"username": username, "password": "wrongpassword1"},
            )
            assert bad.status_code == 401
        locked = client.post(
            "/api/auth/login",
            json={"username": username, "password": "wrongpassword1"},
        )
    assert locked.status_code == 429


def test_must_change_gate_blocks_api(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        login = client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "bootstrappass12"},
        )
        assert login.status_code == 200
        blocked = client.post("/api/cache/clear")
        assert blocked.status_code == 403
        assert blocked.json()["detail"] == "Password change required"
        config = client.get("/api/auth/config")
        assert config.status_code == 200
        changed = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "bootstrappass12",
                "new_password": "newpassword1234",
            },
        )
        assert changed.status_code == 200
        after = client.post("/api/cache/clear")
    assert after.status_code != 403
    assert after.json().get("detail") != "Password change required"


async def _create_disabled_user_session() -> dict[str, str | dict[str, str]]:
    await init_db()
    now = datetime.now(timezone.utc).isoformat()
    user_id = 99
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO lantern_roles (id, name, slug, is_system, created_at)
            VALUES (1, 'Test', 'test', 0, ?)
            """,
            (now,),
        )
        await db.execute(
            """
            INSERT OR REPLACE INTO lantern_users (
              id, username, password_hash, role_id, enabled, created_at
            )
            VALUES (?, 'disableduser', ?, 1, 0, ?)
            """,
            (user_id, hash_password("disabledpass12"), now),
        )
        await db.commit()
    pair = await create_session_pair(user_id=user_id)
    return {
        "access": pair.access,
        "refresh": pair.refresh,
        "cookies": {
            ACCESS_COOKIE_NAME: pair.access,
            REFRESH_COOKIE_NAME: pair.refresh,
        },
    }


def test_disabled_user_session_forbidden(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    session = asyncio.run(_create_disabled_user_session())
    with client:
        response = client.post(
            "/api/cache/clear",
            cookies=session["cookies"],
        )
    assert response.status_code == 403
    assert response.json()["detail"] == "Forbidden"


async def _count_access_log_by_type(event_type: str) -> int:
    await init_db()
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM lantern_access_log WHERE event_type = ?",
            (event_type,),
        )
        row = await cursor.fetchone()
        return int(row[0]) if row else 0


def test_logout_writes_access_log(monkeypatch, tmp_path, bootstrap_env):
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        login = client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "bootstrappass12"},
        )
        assert login.status_code == 200
        before = asyncio.run(_count_access_log_by_type("logout"))
        logout = client.post("/api/auth/logout")
        assert logout.status_code == 200
        after = asyncio.run(_count_access_log_by_type("logout"))
    assert after == before + 1


def test_login_full_matrix(monkeypatch, tmp_path, bootstrap_env):
    """Bootstrap login → change password → protected route → logout."""
    client = _local_client(monkeypatch, tmp_path, bootstrap_env)
    with client:
        login = client.post(
            "/api/auth/login",
            json={"username": "bootstrapadmin", "password": "bootstrappass12"},
        )
        assert login.status_code == 200

        blocked = client.post("/api/cache/clear")
        assert blocked.status_code == 403
        assert blocked.json()["detail"] == "Password change required"

        changed = client.post(
            "/api/auth/change-password",
            json={
                "current_password": "bootstrappass12",
                "new_password": "matrixpass1234",
            },
        )
        assert changed.status_code == 200

        protected = client.post("/api/cache/clear")
        assert protected.status_code != 403
        assert protected.json().get("detail") != "Password change required"

        logout = client.post("/api/auth/logout")
        assert logout.status_code == 200

        after_logout = client.post("/api/cache/clear")
    assert after_logout.status_code == 401
