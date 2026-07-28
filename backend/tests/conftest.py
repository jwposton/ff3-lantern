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
from sidecar_db import get_db_path, init_db

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
    """TestClient with Firefly env cleared unless a test sets values."""
    monkeypatch.delenv("FIREFLY_BASE_URL", raising=False)
    monkeypatch.delenv("FIREFLY_API_TOKEN", raising=False)
    from main import app

    return TestClient(app)


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
