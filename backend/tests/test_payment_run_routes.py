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


def test_bucket_crud(monkeypatch, client):
    monkeypatch.setenv("FF3ANALYTICS_PAYMENT_WORKSHEET_ENABLED", "true")

    create_savings = client.post(
        "/api/payment-run/buckets",
        json={
            "id": "savings",
            "label": "Savings",
            "sort_order": 0,
            "firefly_account_ids": ["10"],
        },
    )
    assert create_savings.status_code == 200
    assert create_savings.json()["id"] == "savings"

    create_checking = client.post(
        "/api/payment-run/buckets",
        json={
            "id": "checking",
            "label": "Checking",
            "sort_order": 1,
            "firefly_account_ids": ["7", "8"],
        },
    )
    assert create_checking.status_code == 200

    listed = client.get("/api/payment-run/buckets")
    assert listed.status_code == 200
    data = listed.json()["data"]
    assert [bucket["id"] for bucket in data] == ["savings", "checking"]

    updated = client.put(
        "/api/payment-run/buckets/checking",
        json={
            "label": "Primary Checking",
            "sort_order": 1,
            "firefly_account_ids": ["7", "8"],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["label"] == "Primary Checking"

    after_update = client.get("/api/payment-run/buckets")
    checking = next(
        bucket for bucket in after_update.json()["data"] if bucket["id"] == "checking"
    )
    assert checking["label"] == "Primary Checking"

    deleted = client.delete("/api/payment-run/buckets/savings")
    assert deleted.status_code == 200

    remaining = client.get("/api/payment-run/buckets")
    assert len(remaining.json()["data"]) == 1
    assert remaining.json()["data"][0]["id"] == "checking"

    invalid = client.post(
        "/api/payment-run/buckets",
        json={
            "id": "bad",
            "label": "Bad",
            "sort_order": 2,
            "firefly_account_ids": [""],
        },
    )
    assert invalid.status_code == 422
