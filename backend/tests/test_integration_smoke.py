"""Live Firefly integration smoke tests — run via scripts/integration-smoke.sh (#103)."""

from __future__ import annotations

import os
from datetime import date, timedelta

import httpx
import pytest

BASE_URL = os.environ.get("LANTERN_INTEGRATION_URL", "http://localhost:18002").rstrip("/")
FIREFLY_TAG = os.environ.get("FIREFLY_TAG", "unknown")


def _client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=60.0)


def _month_bounds() -> tuple[str, str]:
    today = date.today()
    start = today.replace(day=1)
    return start.isoformat(), today.isoformat()


@pytest.mark.integration
def test_health_ok_and_firefly_version_when_available():
    with _client() as client:
        response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["firefly_base_url_configured"] is True
    assert data["firefly_api_token_configured"] is True
    assert data["payment_worksheet_enabled"] is True
    assert "FIREFLY_API_TOKEN" not in response.text
    version = data.get("firefly_version")
    if version is not None:
        assert isinstance(version, str)
        assert version.strip()


@pytest.mark.integration
def test_reference_data_loads():
    with _client() as client:
        start, end = _month_bounds()
        response = client.get(
            "/api/normalized_transactions",
            params={"start": start, "end": end},
        )
    assert response.status_code == 200
    payload = response.json()
    assert "data" in payload
    assert isinstance(payload["data"], list)
    assert len(payload["data"]) > 0


@pytest.mark.integration
def test_payment_worksheet_refresh_and_get():
    month = date.today().strftime("%Y-%m")
    with _client() as client:
        refresh = client.post("/api/payment-run/refresh", params={"month": month})
        assert refresh.status_code == 200
        worksheet = client.get("/api/payment-run", params={"month": month})
    assert worksheet.status_code == 200
    envelope = worksheet.json()
    assert envelope.get("month") == month
    assert "rows" in envelope


@pytest.mark.integration
def test_bill_suggestions_on_real_splits():
    with _client() as client:
        response = client.get("/api/payment-run/bill-suggestions")
    assert response.status_code == 200
    payload = response.json()
    assert "data" in payload
    assert isinstance(payload["data"], list)


def pytest_report_header(config):
    return f"integration: lantern={BASE_URL} firefly_tag={FIREFLY_TAG}"
