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
from sidecar_db import (
    count_users,
    get_role_by_slug,
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
