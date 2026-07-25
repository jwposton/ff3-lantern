"""Tests for auth configuration and session foundation (AUTH-01, #99)."""

from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone

import aiosqlite
import pytest
from fastapi.testclient import TestClient

from auth.cookies import ACCESS_COOKIE_NAME, ACCESS_TTL_SECONDS, REFRESH_COOKIE_NAME
from auth.sessions import (
    ReuseDetected,
    create_session_pair,
    hash_token,
    revoke_all_user_sessions,
    rotate_refresh,
    validate_access_token,
)
from sidecar_db import get_db_path, init_db


@pytest.fixture
def none_mode_client(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    yield TestClient(main.app)
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    importlib.reload(main)


@pytest.fixture
def local_mode_client(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    yield TestClient(main.app)
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    importlib.reload(main)


def test_invalid_auth_mode_startup(monkeypatch):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "typo")
    import auth.config

    with pytest.raises(SystemExit):
        importlib.reload(auth.config)
        auth.config.load_auth_settings()


def test_auth_config_defaults(monkeypatch):
    monkeypatch.delenv("FF3LANTERN_AUTH_MODE", raising=False)
    monkeypatch.delenv("FF3LANTERN_COOKIE_SECURE", raising=False)
    import auth.config

    importlib.reload(auth.config)
    settings = auth.config.load_auth_settings()
    assert settings.auth_mode == "none"
    assert settings.secured is False
    assert settings.cookie_secure is False


def test_auth_config_local_mode_secured(monkeypatch):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "LOCAL")
    import auth.config

    importlib.reload(auth.config)
    settings = auth.config.load_auth_settings()
    assert settings.auth_mode == "local"
    assert settings.secured is True


def test_auth_config_cookie_secure(monkeypatch):
    monkeypatch.setenv("FF3LANTERN_COOKIE_SECURE", "yes")
    import auth.config

    importlib.reload(auth.config)
    settings = auth.config.load_auth_settings()
    assert settings.cookie_secure is True


def test_auth_config_none_mode(none_mode_client):
    response = none_mode_client.get("/api/auth/config")
    assert response.status_code == 200
    data = response.json()
    assert data == {"auth_mode": "none", "secured": False}
    assert "cache-control" not in {k.lower() for k in response.headers}


def test_auth_config_local_mode(local_mode_client):
    response = local_mode_client.get("/api/auth/config")
    assert response.status_code == 200
    data = response.json()
    assert data["auth_mode"] == "local"
    assert data["secured"] is True


def test_invalid_auth_mode_blocks_main_import(monkeypatch):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "invalid")
    import main

    with pytest.raises(SystemExit):
        importlib.reload(main)


def test_none_mode_api_open(none_mode_client):
    import main

    assert (
        len([m for m in main.app.user_middleware if "SessionAuth" in str(m)]) == 0
    )
    response = none_mode_client.post("/api/cache/clear")
    assert response.status_code != 401


def test_secured_mode_requires_session(secured_client):
    response = secured_client.post("/api/cache/clear")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_secured_mode_auth_config_public(secured_client):
    response = secured_client.get("/api/auth/config")
    assert response.status_code == 200


async def _seed_test_user(user_id: int = 1) -> None:
    await init_db()
    now = datetime.now(timezone.utc).isoformat()
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
            INSERT OR IGNORE INTO lantern_users (
              id, username, role_id, enabled, created_at
            )
            VALUES (?, 'testuser', 1, 1, ?)
            """,
            (user_id, now),
        )
        await db.commit()


def test_hash_token_returns_sha256_hex():
    assert len(hash_token("x")) == 64
    assert hash_token("x") == hash_token("x")
    assert hash_token("x") != hash_token("y")


def test_access_ttl_is_fifteen_minutes():
    assert ACCESS_TTL_SECONDS == 900


@pytest.mark.asyncio
async def test_create_session_pair_stores_hashes_only(data_dir):
    await _seed_test_user()
    pair = await create_session_pair(user_id=1)
    assert pair.access
    assert pair.refresh
    assert pair.access != pair.refresh

    async with aiosqlite.connect(get_db_path()) as db:
        refresh_cursor = await db.execute(
            "SELECT token_hash FROM lantern_refresh_tokens WHERE user_id = 1"
        )
        refresh_hash = (await refresh_cursor.fetchone())[0]
        session_cursor = await db.execute(
            "SELECT access_token_hash FROM lantern_sessions WHERE user_id = 1"
        )
        access_hash = (await session_cursor.fetchone())[0]

    assert refresh_hash == hash_token(pair.refresh)
    assert access_hash == hash_token(pair.access)
    assert refresh_hash != pair.refresh
    assert access_hash != pair.access


@pytest.mark.asyncio
async def test_validate_access_token_expired_returns_none(data_dir):
    await _seed_test_user()
    pair = await create_session_pair(user_id=1)
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE lantern_sessions SET expires_at = ? WHERE user_id = 1",
            (past,),
        )
        await db.commit()

    assert await validate_access_token(pair.access) is None

    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute("SELECT COUNT(*) FROM lantern_sessions WHERE user_id = 1")
        assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_rotate_refresh_inherits_parent_expires_at(data_dir):
    await _seed_test_user()
    pair = await create_session_pair(user_id=1)
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            "SELECT expires_at FROM lantern_refresh_tokens WHERE user_id = 1"
        )
        parent_expires = (await cursor.fetchone())[0]

    rotated = await rotate_refresh(pair.refresh)
    assert rotated.access != pair.access
    assert rotated.refresh != pair.refresh

    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT expires_at FROM lantern_refresh_tokens
            WHERE token_hash = ? AND revoked_at IS NULL
            """,
            (hash_token(rotated.refresh),),
        )
        child_expires = (await cursor.fetchone())[0]

    assert child_expires == parent_expires


@pytest.mark.asyncio
async def test_revoke_all_user_sessions_clears_rows(data_dir):
    await _seed_test_user()
    await create_session_pair(user_id=1)
    await revoke_all_user_sessions(user_id=1)

    async with aiosqlite.connect(get_db_path()) as db:
        session_cursor = await db.execute(
            "SELECT COUNT(*) FROM lantern_sessions WHERE user_id = 1"
        )
        refresh_cursor = await db.execute(
            """
            SELECT COUNT(*) FROM lantern_refresh_tokens
            WHERE user_id = 1 AND revoked_at IS NULL
            """
        )
        assert (await session_cursor.fetchone())[0] == 0
        assert (await refresh_cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_rotate_refresh_reuse_raises_reuse_detected(data_dir):
    await _seed_test_user()
    pair = await create_session_pair(user_id=1)
    await rotate_refresh(pair.refresh)
    with pytest.raises(ReuseDetected):
        await rotate_refresh(pair.refresh)


@pytest.mark.asyncio
async def test_refresh_rotation(secured_client, create_test_session):
    session = await create_test_session()
    orig_access = session["access"]
    orig_refresh = session["refresh"]

    response = secured_client.post(
        "/api/auth/refresh",
        cookies={REFRESH_COOKIE_NAME: orig_refresh},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    new_access = response.cookies[ACCESS_COOKIE_NAME]
    new_refresh = response.cookies[REFRESH_COOKIE_NAME]
    assert new_access != orig_access
    assert new_refresh != orig_refresh

    response = secured_client.post(
        "/api/auth/refresh",
        cookies={REFRESH_COOKIE_NAME: new_refresh},
    )
    assert response.status_code == 200
    rotated_refresh = response.cookies[REFRESH_COOKIE_NAME]
    assert rotated_refresh != new_refresh


@pytest.mark.asyncio
async def test_logout_revokes(secured_client, create_test_session):
    session = await create_test_session()

    response = secured_client.post(
        "/api/auth/logout",
        cookies={
            REFRESH_COOKIE_NAME: session["refresh"],
            ACCESS_COOKIE_NAME: session["access"],
        },
    )
    assert response.status_code == 200
    set_cookies = " ".join(response.headers.get_list("set-cookie"))
    assert ACCESS_COOKIE_NAME in set_cookies
    assert REFRESH_COOKIE_NAME in set_cookies

    response = secured_client.post(
        "/api/auth/refresh",
        cookies={REFRESH_COOKIE_NAME: session["refresh"]},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


@pytest.mark.asyncio
async def test_valid_access_passes_middleware(secured_client, create_test_session):
    session = await create_test_session()
    response = secured_client.post(
        "/api/cache/clear",
        cookies={ACCESS_COOKIE_NAME: session["access"]},
    )
    assert response.status_code != 401


def test_refresh_without_cookie_returns_401(secured_client):
    response = secured_client.post("/api/auth/refresh")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


async def _count_active_sessions(user_id: int) -> int:
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT COUNT(*) FROM lantern_sessions
            WHERE user_id = ? AND expires_at > ?
            """,
            (user_id, now),
        )
        return int((await cursor.fetchone())[0])


async def _count_unrevoked_refresh_tokens(user_id: int) -> int:
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT COUNT(*) FROM lantern_refresh_tokens
            WHERE user_id = ? AND revoked_at IS NULL
            """,
            (user_id,),
        )
        return int((await cursor.fetchone())[0])


@pytest.mark.asyncio
async def test_refresh_reuse_revokes_all(secured_client, create_test_session):
    """D-08: replaying a revoked refresh revokes every session for the user."""
    session_a = await create_test_session(user_id=1)
    refresh_a = session_a["refresh"]

    response = secured_client.post(
        "/api/auth/refresh",
        cookies={REFRESH_COOKIE_NAME: refresh_a},
    )
    assert response.status_code == 200
    access_b = response.cookies[ACCESS_COOKIE_NAME]
    refresh_b = response.cookies[REFRESH_COOKIE_NAME]

    response = secured_client.post(
        "/api/auth/refresh",
        cookies={REFRESH_COOKIE_NAME: refresh_a},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}

    response = secured_client.post(
        "/api/cache/clear",
        cookies={ACCESS_COOKIE_NAME: access_b},
    )
    assert response.status_code == 401

    session_b = await create_test_session(user_id=1)
    assert await _count_active_sessions(1) >= 1

    secured_client.post(
        "/api/auth/refresh",
        cookies={REFRESH_COOKIE_NAME: refresh_a},
    )

    assert await _count_active_sessions(1) == 0
    assert await _count_unrevoked_refresh_tokens(1) == 0

    response = secured_client.post(
        "/api/cache/clear",
        cookies={ACCESS_COOKIE_NAME: session_b["access"]},
    )
    assert response.status_code == 401

    response = secured_client.post(
        "/api/cache/clear",
        cookies={ACCESS_COOKIE_NAME: access_b},
    )
    assert response.status_code == 401

    response = secured_client.post(
        "/api/auth/refresh",
        cookies={REFRESH_COOKIE_NAME: refresh_b},
    )
    assert response.status_code == 401
