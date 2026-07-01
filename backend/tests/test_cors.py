"""Tests for CORS origin allowlist (OPS-01, D-06)."""

import importlib
import logging

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def cors_client(monkeypatch):
    monkeypatch.setenv(
        "CORS_ALLOWED_ORIGINS",
        "https://analytics.example.com,http://localhost:5174",
    )
    import main

    importlib.reload(main)
    yield TestClient(main.app)
    importlib.reload(main)


def test_cors_allows_listed_origin(cors_client):
    response = cors_client.get(
        "/health",
        headers={"Origin": "https://analytics.example.com"},
    )
    assert response.status_code == 200
    assert (
        response.headers.get("access-control-allow-origin")
        == "https://analytics.example.com"
    )


def test_cors_blocks_unknown_origin(cors_client):
    response = cors_client.get(
        "/health",
        headers={"Origin": "https://evil.example.com"},
    )
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_preflight_allowed(cors_client):
    response = cors_client.options(
        "/api/normalized_transactions",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert (
        response.headers.get("access-control-allow-origin") == "http://localhost:5174"
    )


def test_cors_api_route_headers(cors_client):
    response = cors_client.get(
        "/api/normalized_transactions",
        headers={"Origin": "https://analytics.example.com"},
    )
    assert response.status_code == 422
    assert (
        response.headers.get("access-control-allow-origin")
        == "https://analytics.example.com"
    )


def test_cors_default_localhost_origins(monkeypatch, caplog):
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    import main

    with caplog.at_level(logging.WARNING):
        importlib.reload(main)

    assert any(
        "CORS_ALLOWED_ORIGINS unset" in record.message for record in caplog.records
    )

    client = TestClient(main.app)
    response = client.get(
        "/health",
        headers={"Origin": "http://localhost:5174"},
    )
    assert response.status_code == 200
    assert (
        response.headers.get("access-control-allow-origin") == "http://localhost:5174"
    )
    importlib.reload(main)


def test_cors_never_wildcard(cors_client):
    response = cors_client.get(
        "/health",
        headers={"Origin": "https://analytics.example.com"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") != "*"
