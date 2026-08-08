"""GET /api/auth/me session bootstrap + permissions map (AUTH-10, Phase 36)."""

from __future__ import annotations

import importlib

from auth.resources import RESOURCES, VIEWER_NONE_RESOURCES, VIEWER_READ_RESOURCES
from fastapi.testclient import TestClient


def test_me_viewer_permissions(viewer_client):
    with viewer_client as client:
        response = client.get("/api/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert "dashboard" in body["permissions"]
    assert "categorize" in body["permissions"]
    assert set(body["permissions"]) == RESOURCES

    for resource in VIEWER_READ_RESOURCES:
        assert body["permissions"][resource] == "read", resource
    for resource in VIEWER_NONE_RESOURCES:
        assert body["permissions"][resource] == "none", resource

    assert body["permissions"]["categorize"] == "none"
    assert body["user"]["username"] == "vieweruser"
    assert body["user"]["role_id"] == 2
    assert body["must_change_password"] is False


def test_me_unauthenticated_401(rbac_local_client):
    with rbac_local_client as client:
        response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_me_auth_mode_none_404(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    with TestClient(main.app) as client:
        response = client.get("/api/auth/me")

    assert response.status_code == 404
