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


def _rbac_test_app():
    from fastapi import Depends, FastAPI

    from auth.config import load_auth_settings
    from auth.dependencies import (
        require_any_permission,
        require_bill_register_permission,
        require_permission,
    )
    from auth.middleware import SessionAuthMiddleware

    app = FastAPI()
    if load_auth_settings().auth_mode != "none":
        app.add_middleware(SessionAuthMiddleware)

    @app.get("/api/rbac/categorize-read")
    async def categorize_read(
        user_id: int = Depends(require_permission("categorize", "read")),
    ):
        return {"user_id": user_id}

    @app.get("/api/rbac/any-dashboard-or-reports")
    async def any_dashboard_or_reports(
        user_id: int = Depends(
            require_any_permission(("dashboard", "read"), ("reports", "read"))
        ),
    ):
        return {"user_id": user_id}

    @app.post("/api/rbac/bills/register")
    async def bills_register(
        user_id: int = Depends(require_bill_register_permission),
    ):
        return {"user_id": user_id}

    return app


async def _permission_denied_count() -> int:
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM lantern_access_log WHERE event_type = ?",
            ("permission_denied",),
        )
        row = await cursor.fetchone()
        return int(row[0])


def test_require_permission_none_mode_skips(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import auth.config

    importlib.reload(auth.config)
    app = _rbac_test_app()
    with TestClient(app) as client:
        response = client.get("/api/rbac/categorize-read")
    assert response.status_code == 200
    assert response.json() == {"user_id": 0}


@pytest.mark.asyncio
async def test_system_admin_bypasses_permission(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import auth.config
    import main

    importlib.reload(auth.config)
    importlib.reload(main)
    with TestClient(main.app):
        pass

    from auth.cookies import ACCESS_COOKIE_NAME
    from auth.sessions import create_session_pair
    from sidecar_db import clear_must_change_password

    admin = await get_user_by_username("bootstrapadmin")
    assert admin is not None
    await clear_must_change_password(int(admin["id"]))
    pair = await create_session_pair(user_id=int(admin["id"]))

    app = _rbac_test_app()
    with TestClient(app) as client:
        response = client.get(
            "/api/rbac/categorize-read",
            cookies={ACCESS_COOKIE_NAME: pair.access},
        )
    assert response.status_code == 200
    assert response.json()["user_id"] == int(admin["id"])


@pytest.mark.asyncio
async def test_access_log_permission_denied(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import auth.config
    import main

    importlib.reload(auth.config)
    importlib.reload(main)
    with TestClient(main.app):
        pass

    from auth.cookies import ACCESS_COOKIE_NAME
    from auth.passwords import hash_password
    from auth.sessions import create_session_pair
    from sidecar_db import clear_must_change_password, insert_user

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
    pair = await create_session_pair(user_id=int(viewer["id"]))

    before = await _permission_denied_count()
    app = _rbac_test_app()
    with TestClient(app) as client:
        response = client.get(
            "/api/rbac/categorize-read",
            cookies={ACCESS_COOKIE_NAME: pair.access},
        )
    assert response.status_code == 403
    assert await _permission_denied_count() == before + 1


def test_none_mode_does_not_append_access_log(monkeypatch, tmp_path):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "none")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    import auth.config

    importlib.reload(auth.config)
    asyncio.run(init_db())
    before = asyncio.run(_permission_denied_count())
    app = _rbac_test_app()
    with TestClient(app) as client:
        response = client.get("/api/rbac/categorize-read")
    assert response.status_code == 200
    assert asyncio.run(_permission_denied_count()) == before


@pytest.mark.asyncio
async def test_require_any_permission_partial_match(monkeypatch, tmp_path, bootstrap_env):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import auth.config
    import main

    importlib.reload(auth.config)
    importlib.reload(main)
    with TestClient(main.app):
        pass

    from auth.cookies import ACCESS_COOKIE_NAME
    from auth.passwords import hash_password
    from auth.sessions import create_session_pair
    from sidecar_db import insert_role, insert_user, replace_role_permissions

    await insert_role(id=4, name="ReportsOnly", slug="reports-only", is_system=0)
    await replace_role_permissions(
        4,
        [{"resource": "reports", "level": "read"}],
    )
    await insert_user(
        {
            "username": "reportsonly",
            "role_id": 4,
            "enabled": 1,
            "must_change_password": 0,
            "password_hash": hash_password("reportsonly12"),
        }
    )
    user = await get_user_by_username("reportsonly")
    assert user is not None
    pair = await create_session_pair(user_id=int(user["id"]))

    app = _rbac_test_app()
    with TestClient(app) as client:
        response = client.get(
            "/api/rbac/any-dashboard-or-reports",
            cookies={ACCESS_COOKIE_NAME: pair.access},
        )
    assert response.status_code == 200
    assert response.json()["user_id"] == int(user["id"])


@pytest.mark.asyncio
async def test_require_bill_register_permission_source_routing(
    monkeypatch, tmp_path, bootstrap_env
):
    monkeypatch.setenv("FF3LANTERN_AUTH_MODE", "local")
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    LOGIN_RATE_LIMITER.clear("bootstrapadmin")
    import auth.config
    import main

    importlib.reload(auth.config)
    importlib.reload(main)
    with TestClient(main.app):
        pass

    from auth.cookies import ACCESS_COOKIE_NAME
    from auth.passwords import hash_password
    from auth.sessions import create_session_pair
    from sidecar_db import insert_role, insert_user, replace_role_permissions

    await insert_role(id=5, name="BillsWriter", slug="bills-writer", is_system=0)
    await replace_role_permissions(
        5,
        [
            {"resource": "bills", "level": "write"},
            {"resource": "bill_discover", "level": "none"},
        ],
    )
    await insert_user(
        {
            "username": "billswriter",
            "role_id": 5,
            "enabled": 1,
            "must_change_password": 0,
            "password_hash": hash_password("billswriter12"),
        }
    )
    user = await get_user_by_username("billswriter")
    assert user is not None
    pair = await create_session_pair(user_id=int(user["id"]))
    cookies = {ACCESS_COOKIE_NAME: pair.access}

    app = _rbac_test_app()
    with TestClient(app) as client:
        hub = client.post("/api/rbac/bills/register", cookies=cookies)
        discover_query = client.post(
            "/api/rbac/bills/register?source=discover",
            cookies=cookies,
        )
        discover_header = client.post(
            "/api/rbac/bills/register",
            cookies=cookies,
            headers={"X-Lantern-Source": "discover"},
        )

    assert hub.status_code == 200
    assert discover_query.status_code == 403
    assert discover_header.status_code == 403


# --- Phase 35 plan 04: D-18 integration 403 matrix (AUTH-08, AUTH-09) ---


def test_fixtures_load(viewer_client, payment_worksheet_enabled):
    """Shared RBAC fixtures authenticate against a protected route."""
    response = viewer_client.get("/api/payment-run", params={"month": "2026-07"})
    assert response.status_code != 401


def test_viewer_worksheet_refresh_allowed(viewer_client, payment_worksheet_enabled):
    response = viewer_client.post("/api/payment-run/refresh", params={"month": "2026-07"})
    assert response.status_code != 403


def test_viewer_worksheet_row_put_denied(viewer_client, payment_worksheet_enabled):
    response = viewer_client.put(
        "/api/payment-run/rows/test-key",
        params={"month": "2026-07"},
        json={"planned_amount": "100.00"},
    )
    assert response.status_code == 403


def test_viewer_payment_setup_bucket_denied(viewer_client, payment_worksheet_enabled):
    response = viewer_client.get("/api/payment-run/buckets")
    assert response.status_code == 403


def test_viewer_discover_scan_allowed(viewer_client, payment_worksheet_enabled):
    import firefly_reference_cache
    import httpx
    from firefly_client import FireflyClient
    from main import app
    from routes.payment_run import get_firefly_client
    from test_payment_run_routes import _bill_suggestions_handler

    firefly_reference_cache.clear()
    app.dependency_overrides[get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(_bill_suggestions_handler()),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    try:
        response = viewer_client.get("/api/payment-run/bill-suggestions")
        assert response.status_code != 403
    finally:
        app.dependency_overrides.pop(get_firefly_client, None)


def test_viewer_discover_ignore_denied(viewer_client, payment_worksheet_enabled):
    response = viewer_client.post(
        "/api/payment-run/discover-settings/ignore-payee",
        json={"suggestion_id": "spotify", "lookback_months": 12},
    )
    assert response.status_code == 403


def test_viewer_adopt_discover_denied(viewer_client, payment_worksheet_enabled):
    response = viewer_client.post(
        "/api/payment-run/bills/register?source=discover",
        json={},
    )
    assert response.status_code == 403


def test_viewer_hub_register_denied(viewer_client, payment_worksheet_enabled):
    response = viewer_client.post("/api/payment-run/bills/register", json={})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_member_bills_write_hub_register_allowed(
    member_client, payment_worksheet_enabled
):
    from conftest import grant_role_permissions

    await grant_role_permissions(
        3,
        {"bills": "write", "payment_worksheet": "read"},
    )
    response = member_client.post("/api/payment-run/bills/register", json={})
    assert response.status_code != 403


@pytest.mark.asyncio
async def test_adopt_discover_requires_bill_discover_write(
    member_client, payment_worksheet_enabled
):
    from conftest import grant_role_permissions

    await grant_role_permissions(
        3,
        {"bills": "write", "payment_worksheet": "read"},
    )
    response = member_client.post(
        "/api/payment-run/bills/register?source=discover",
        json={},
    )
    assert response.status_code == 403


def test_admin_bypass_categorize(admin_client, firefly_env):
    response = admin_client.get(
        "/api/categorize/pending",
        params={"start": "2024-01-01", "end": "2024-01-31"},
    )
    assert response.status_code != 403


def test_none_mode_skips_rbac(client, firefly_env):
    response = client.get(
        "/api/categorize/pending",
        params={"start": "2024-01-01", "end": "2024-01-31"},
    )
    assert response.status_code != 401


@pytest.mark.asyncio
async def test_permission_denied_access_log(viewer_client, firefly_env):
    before = await _permission_denied_count()
    response = viewer_client.get(
        "/api/categorize/pending",
        params={"start": "2024-01-01", "end": "2024-01-31"},
    )
    assert response.status_code == 403
    assert await _permission_denied_count() == before + 1

    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT event_type, detail_json
            FROM lantern_access_log
            WHERE event_type = 'permission_denied'
            ORDER BY id DESC
            LIMIT 1
            """
        )
        row = await cursor.fetchone()

    assert row is not None
    assert row[0] == "permission_denied"
    detail = json.loads(row[1])
    assert set(detail.keys()) == {"resource", "action", "required_level", "path"}
    assert detail["resource"] == "categorize"
    assert detail["action"] == "read"


def test_viewer_loans_denied(viewer_client, firefly_env):
    response = viewer_client.get("/api/loans")
    assert response.status_code == 403


def test_viewer_transactions_mass_edit_denied(viewer_client, firefly_env):
    response = viewer_client.post(
        "/api/transactions/mass-edit",
        json={"targets": [{"journal_id": "1", "transaction_journal_id": "10"}]},
    )
    assert response.status_code == 403


def test_viewer_cache_clear_denied(viewer_client):
    response = viewer_client.post("/api/cache/clear")
    assert response.status_code == 403


def _normalized_transactions_params() -> dict[str, str]:
    return {"start": "2024-01-01", "end": "2024-01-31"}


def _with_normalized_firefly_mock():
    import httpx
    from firefly_client import FireflyClient
    from main import app

    import api_normalized_transactions as api_mod
    from conftest import _firefly_mock_handler

    app.dependency_overrides[api_mod.get_firefly_client] = lambda: FireflyClient(
        transport=httpx.MockTransport(_firefly_mock_handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )
    return app, api_mod


def test_normalized_transactions_or_permission(viewer_client, firefly_env):
    app, api_mod = _with_normalized_firefly_mock()
    try:
        viewer_response = viewer_client.get(
            "/api/normalized_transactions",
            params=_normalized_transactions_params(),
        )
        assert viewer_response.status_code != 403
    finally:
        app.dependency_overrides.pop(api_mod.get_firefly_client, None)


@pytest.mark.asyncio
async def test_normalized_transactions_reports_read_allowed(
    member_client, firefly_env
):
    from conftest import grant_role_permissions

    await grant_role_permissions(3, {"reports": "read"})
    app, api_mod = _with_normalized_firefly_mock()
    try:
        response = member_client.get(
            "/api/normalized_transactions",
            params=_normalized_transactions_params(),
        )
        assert response.status_code != 403
    finally:
        app.dependency_overrides.pop(api_mod.get_firefly_client, None)


@pytest.mark.asyncio
async def test_normalized_transactions_dashboard_and_reports_denied(
    member_client, firefly_env
):
    from conftest import grant_role_permissions

    await grant_role_permissions(3, {})
    app, api_mod = _with_normalized_firefly_mock()
    try:
        response = member_client.get(
            "/api/normalized_transactions",
            params=_normalized_transactions_params(),
        )
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(api_mod.get_firefly_client, None)

