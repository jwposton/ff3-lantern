"""Shared pytest fixtures for FF3 Lantern backend."""

from __future__ import annotations

import importlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow imports of backend modules (main, firefly_client, …) from tests/
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import aiosqlite
import httpx
import pytest
from auth.cookies import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME
from auth.sessions import create_session_pair
from fastapi.testclient import TestClient
from sidecar_db import get_db_path, get_user_by_username, init_db

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict:
    """Load a JSON fixture from tests/fixtures/."""
    path = FIXTURES_DIR / name
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def client(monkeypatch):
    """TestClient with Firefly env cleared and auth disabled (isolated from local-auth tests)."""
    monkeypatch.delenv("FIREFLY_BASE_URL", raising=False)
    monkeypatch.delenv("FIREFLY_API_TOKEN", raising=False)
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    import main

    importlib.reload(main)
    return TestClient(main.app)


@pytest.fixture
def firefly_env(monkeypatch):
    """Non-empty FIREFLY_* placeholders for API tests."""
    monkeypatch.setenv("FIREFLY_BASE_URL", "https://firefly.example")
    monkeypatch.setenv("FIREFLY_API_TOKEN", "test-token-placeholder")


def _firefly_mock_handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/accounts"):
        return httpx.Response(200, json=load_fixture("accounts.json"))
    if path.endswith("/transactions"):
        params = dict(request.url.params)
        if params.get("start") == "2099-01-01":
            empty = {"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}}
            return httpx.Response(200, json=empty)
        return httpx.Response(200, json=load_fixture("transactions_withdrawal.json"))
    return httpx.Response(404, json={"message": "not found"})


@pytest.fixture
def mock_firefly_transport() -> httpx.MockTransport:
    return httpx.MockTransport(_firefly_mock_handler)


@pytest.fixture
def client_with_mock_firefly(monkeypatch, mock_firefly_transport, firefly_env):
    """TestClient with MockTransport injected into FireflyClient."""
    import api_normalized_transactions as api_mod
    from firefly_client import FireflyClient
    from main import app

    def _client_factory():
        return FireflyClient(transport=mock_firefly_transport)

    app.dependency_overrides[api_mod.get_firefly_client] = _client_factory
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _clear_firefly_reference_cache():
    import firefly_reference_cache

    firefly_reference_cache.clear()
    yield
    firefly_reference_cache.clear()


@pytest.fixture(autouse=True)
def _clear_firefly_env_between_tests(monkeypatch):
    """Avoid env leakage across tests that import main.app at module level."""
    for key in ("FIREFLY_BASE_URL", "FIREFLY_API_TOKEN"):
        if key not in os.environ:
            monkeypatch.delenv(key, raising=False)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def bootstrap_env(monkeypatch):
    monkeypatch.setenv("FF3LANTERN_BOOTSTRAP_ADMIN_USERNAME", "bootstrapadmin")
    monkeypatch.setenv("FF3LANTERN_BOOTSTRAP_ADMIN_PASSWORD", "bootstrappass12")


@pytest.fixture
def secured_client(monkeypatch, data_dir, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    import main

    importlib.reload(main)
    yield TestClient(main.app)
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    importlib.reload(main)


async def _ensure_test_user(user_id: int = 1) -> None:
    from auth.passwords import hash_password

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
              id, username, password_hash, role_id, enabled, created_at
            )
            VALUES (?, 'testuser', ?, 1, 1, ?)
            """,
            (user_id, hash_password("testpassword12"), now),
        )
        await db.commit()


@pytest.fixture
def create_test_session(data_dir):
    async def _create(user_id: int = 1) -> dict[str, str | dict[str, str]]:
        await _ensure_test_user(user_id)
        pair = await create_session_pair(user_id=user_id)
        return {
            "access": pair.access,
            "refresh": pair.refresh,
            "cookies": {
                ACCESS_COOKIE_NAME: pair.access,
                REFRESH_COOKIE_NAME: pair.refresh,
            },
        }

    return _create


@pytest.fixture
async def admin_session(monkeypatch, data_dir, bootstrap_env):
    """Authenticated system-admin cookies after local bootstrap."""
    from auth.rate_limit import LOGIN_RATE_LIMITER
    from sidecar_db import clear_must_change_password, get_user_by_username

    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import main

    importlib.reload(main)
    with TestClient(main.app):
        pass

    user = await get_user_by_username("bootstrapadmin")
    assert user is not None
    await clear_must_change_password(int(user["id"]))
    pair = await create_session_pair(user_id=int(user["id"]))
    return {
        ACCESS_COOKIE_NAME: pair.access,
        REFRESH_COOKIE_NAME: pair.refresh,
    }


@pytest.fixture
def admin_client(monkeypatch, data_dir, bootstrap_env, admin_session):
    """TestClient with authenticated system-admin session cookies."""
    from auth.rate_limit import LOGIN_RATE_LIMITER

    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(data_dir))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import main

    importlib.reload(main)
    client = TestClient(main.app)
    client.cookies.update(admin_session)
    return client


@pytest.fixture
def payment_worksheet_enabled(monkeypatch):
    """Enable payment worksheet feature flag and Firefly placeholders."""
    monkeypatch.setenv("FF3LANTERN_PAYMENT_WORKSHEET_ENABLED", "true")
    monkeypatch.setenv("FIREFLY_BASE_URL", "https://firefly.example")
    monkeypatch.setenv("FIREFLY_API_TOKEN", "test-token")


@pytest.fixture
def rbac_local_client(monkeypatch, data_dir, bootstrap_env):
    """TestClient with local auth mode and isolated data dir (RBAC matrix tests)."""
    from auth.rate_limit import LOGIN_RATE_LIMITER

    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(data_dir))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import main

    importlib.reload(main)
    with TestClient(main.app):
        pass
    return TestClient(main.app)


async def grant_role_permissions(role_id: int, overrides: dict[str, str]) -> None:
    """Replace role permissions: all resources default to none, then apply overrides."""
    from auth.resources import RESOURCES
    from sidecar_db import replace_role_permissions

    rows = [
        {"resource": resource, "level": overrides.get(resource, "none")}
        for resource in sorted(RESOURCES)
    ]
    await replace_role_permissions(role_id, rows)


async def _rbac_user_session(
    *,
    username: str,
    role_id: int,
    password: str,
    monkeypatch,
    data_dir,
    bootstrap_env,
) -> dict[str, str]:
    from auth.passwords import hash_password
    from auth.rate_limit import LOGIN_RATE_LIMITER
    from auth.sessions import create_session_pair
    from sidecar_db import insert_user

    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(data_dir))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import main

    importlib.reload(main)
    with TestClient(main.app):
        pass

    await insert_user(
        {
            "username": username,
            "role_id": role_id,
            "enabled": 1,
            "must_change_password": 0,
            "password_hash": hash_password(password),
        }
    )
    user = await get_user_by_username(username)
    assert user is not None
    pair = await create_session_pair(user_id=int(user["id"]))
    return {ACCESS_COOKIE_NAME: pair.access}


@pytest.fixture
async def viewer_session(monkeypatch, data_dir, bootstrap_env):
    """Access cookie for seeded Viewer role (role_id=2)."""
    return await _rbac_user_session(
        username="vieweruser",
        role_id=2,
        password="viewerpass1234",
        monkeypatch=monkeypatch,
        data_dir=data_dir,
        bootstrap_env=bootstrap_env,
    )


@pytest.fixture
async def member_session(monkeypatch, data_dir, bootstrap_env):
    """Access cookie for seeded Member role (role_id=3)."""
    return await _rbac_user_session(
        username="memberuser",
        role_id=3,
        password="memberpass1234",
        monkeypatch=monkeypatch,
        data_dir=data_dir,
        bootstrap_env=bootstrap_env,
    )


@pytest.fixture
def viewer_client(rbac_local_client, viewer_session):
    """Local-auth TestClient authenticated as Viewer."""
    rbac_local_client.cookies.update(viewer_session)
    return rbac_local_client


@pytest.fixture
def member_client(rbac_local_client, member_session):
    """Local-auth TestClient authenticated as Member."""
    rbac_local_client.cookies.update(member_session)
    return rbac_local_client
