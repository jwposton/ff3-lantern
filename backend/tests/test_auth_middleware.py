"""Unit tests for SessionAuthMiddleware (AUTH-02, D-16–D-19)."""

from __future__ import annotations

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def middleware_client(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import auth.middleware
    import sidecar_db

    importlib.reload(sidecar_db)
    importlib.reload(auth.middleware)

    app = FastAPI()
    app.add_middleware(auth.middleware.SessionAuthMiddleware)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/auth/config")
    async def auth_config():
        return {"auth_mode": "local", "secured": True}

    @app.get("/api/categorize/meta")
    async def categorize_meta():
        return {"ok": True}

    @app.api_route("/api/categorize/meta", methods=["OPTIONS"])
    async def categorize_meta_options():
        return {"ok": True}

    yield TestClient(app)


def test_middleware_importable():
    from auth.middleware import SessionAuthMiddleware

    assert hasattr(SessionAuthMiddleware, "__call__")
    assert "BaseHTTPMiddleware" not in SessionAuthMiddleware.__mro__


def test_protected_api_without_cookie_returns_401(middleware_client):
    response = middleware_client.get("/api/categorize/meta")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_auth_config_public_without_cookie(middleware_client):
    response = middleware_client.get("/api/auth/config")
    assert response.status_code == 200


def test_health_public_without_cookie(middleware_client):
    response = middleware_client.get("/health")
    assert response.status_code == 200


def test_options_preflight_not_blocked(middleware_client):
    response = middleware_client.options("/api/categorize/meta")
    assert response.status_code != 401
