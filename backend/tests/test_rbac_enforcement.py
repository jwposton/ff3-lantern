"""RBAC permission resolver and dependency enforcement tests (Phase 35 AUTH-08 #134)."""

from __future__ import annotations

import asyncio
import importlib
import json
from unittest.mock import MagicMock

import aiosqlite
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.permissions import (
    ACTIONS,
    RESOURCE_REFRESH_ACTIONS,
    level_allows_action,
    minimum_level_for_action,
    user_has_permission,
    validate_resource_action,
)
from auth.rate_limit import LOGIN_RATE_LIMITER
from sidecar_db import get_db_path, get_role_by_slug, get_user_by_username, init_db


@pytest.mark.parametrize(
    ("level", "action", "actions_json", "expected"),
    [
        ("write", "read", None, True),
        ("write", "refresh", None, True),
        ("write", "write", None, True),
        ("read", "read", None, True),
        ("read", "refresh", None, True),
        ("read", "write", None, False),
        ("none", "read", None, False),
        ("limited", "write", None, False),
        ("limited", "read", None, True),
    ],
)
def test_level_allows_action_matrix(level, action, actions_json, expected):
    assert level_allows_action(level, action, actions_json) is expected


def test_level_allows_action_limited_with_write_preset():
    actions_json = json.dumps(["write"])
    assert level_allows_action("limited", "write", actions_json) is True
    assert level_allows_action("limited", "read", actions_json) is True


def test_minimum_level_for_action():
    assert minimum_level_for_action("dashboard", "write") == "write"
    assert minimum_level_for_action("dashboard", "read") == "read"
    assert minimum_level_for_action("payment_worksheet", "refresh") == "read"


def test_validate_resource_action_rejects_unknown():
    with pytest.raises(ValueError, match="resource"):
        validate_resource_action("not_a_resource", "read")
    with pytest.raises(ValueError, match="action"):
        validate_resource_action("dashboard", "delete")


def test_resource_refresh_actions_catalog():
    assert RESOURCE_REFRESH_ACTIONS["payment_worksheet"] == frozenset({"refresh"})
    assert RESOURCE_REFRESH_ACTIONS["bill_discover"] == frozenset({"refresh"})
    assert ACTIONS == frozenset({"read", "refresh", "write"})


@pytest.mark.asyncio
async def test_user_has_permission_system_admin_bypass(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    with TestClient(main.app):
        pass

    admin = await get_user_by_username("bootstrapadmin")
    assert admin is not None
    assert await user_has_permission(int(admin["id"]), "categorize", "read") is True


@pytest.mark.asyncio
async def test_user_has_permission_viewer_denies_categorize(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import main

    importlib.reload(main)
    with TestClient(main.app):
        pass

    from auth.passwords import hash_password
    from auth.sessions import create_session_pair
    from sidecar_db import insert_user

    await insert_user(
        {
            "username": "vieweruser",
            "role_id": 2,
            "enabled": 1,
            "must_change_password": 0,
            "password_hash": hash_password("viewerpass1234"),
        }
    )
    viewer = await get_user_by_username("vieweruser")
    assert viewer is not None
    assert await user_has_permission(int(viewer["id"]), "categorize", "read") is False


@pytest.mark.asyncio
async def test_append_permission_denied_helper(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    await init_db()

    from auth.access_log import append_permission_denied

    request = MagicMock(spec=Request)
    request.url.path = "/api/categorize/suggest"
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers = {"user-agent": "pytest"}

    await append_permission_denied(
        request,
        42,
        resource="categorize",
        action="read",
        required_level="read",
    )

    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT event_type, user_id, detail_json
            FROM lantern_access_log
            ORDER BY id DESC
            LIMIT 1
            """
        )
        row = await cursor.fetchone()

    assert row is not None
    assert row[0] == "permission_denied"
    assert row[1] == 42
    detail = json.loads(row[2])
    assert set(detail.keys()) == {"resource", "action", "required_level", "path"}
    assert detail == {
        "resource": "categorize",
        "action": "read",
        "required_level": "read",
        "path": "/api/categorize/suggest",
    }
