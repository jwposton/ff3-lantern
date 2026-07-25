"""Tests for auth configuration and session foundation (AUTH-01, #99)."""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def none_mode_client(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    yield TestClient(main.app)
    importlib.reload(main)


@pytest.fixture
def local_mode_client(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    yield TestClient(main.app)
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
