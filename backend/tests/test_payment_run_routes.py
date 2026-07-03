"""Tests for payment-run API routes (PAY-02, PAY-03)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(data_dir):
    from main import app

    return TestClient(app)


def test_disabled_returns_404(monkeypatch, client):
    monkeypatch.delenv("FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED", raising=False)
    response = client.get("/api/payment-run")
    assert response.status_code == 404
    assert response.json()["detail"] == "Payment worksheet is not enabled."


def test_enabled_stub_returns_200(monkeypatch, client):
    monkeypatch.setenv("FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED", "true")
    response = client.get("/api/payment-run")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
