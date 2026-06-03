"""Tests for GET /api/normalized_transactions (DATA-01, D-17, D-20)."""

import json

import pytest

OMNI_KEYS = frozenset(
    {
        "journal_id",
        "amount",
        "type",
        "source_account",
        "source_type",
        "source_role",
        "destination_account",
        "destination_type",
        "destination_role",
        "budget",
        "category",
        "date",
    }
)


def test_missing_dates_422(client, firefly_env):
    assert client.get("/api/normalized_transactions").status_code == 422
    assert (
        client.get(
            "/api/normalized_transactions", params={"start": "2024-01-01"}
        ).status_code
        == 422
    )


def test_invalid_date_format_422(client, firefly_env):
    response = client.get(
        "/api/normalized_transactions",
        params={"start": "not-a-date", "end": "2024-01-31"},
    )
    assert response.status_code == 422
    assert "YYYY-MM-DD" in response.json()["detail"]


def test_start_after_end_422(client, firefly_env):
    response = client.get(
        "/api/normalized_transactions",
        params={"start": "2024-02-01", "end": "2024-01-01"},
    )
    assert response.status_code == 422


def test_range_exceeds_three_years_422(client, firefly_env):
    response = client.get(
        "/api/normalized_transactions",
        params={"start": "2020-01-01", "end": "2024-01-02"},
    )
    assert response.status_code == 422
    assert "3 year" in response.json()["detail"].lower()


def test_firefly_error_502(client, firefly_env, monkeypatch):
    import api_normalized_transactions as api_mod
    from main import app

    class _BrokenClient:
        base_url = "https://firefly.example"

        async def fetch_splits(self, start: str, end: str):
            raise RuntimeError("Firefly API error 503")

    app.dependency_overrides[api_mod.get_firefly_client] = lambda: _BrokenClient()
    try:
        response = client.get(
            "/api/normalized_transactions",
            params={"start": "2024-01-01", "end": "2024-01-31"},
        )
        assert response.status_code == 502
        assert "Firefly" in response.json()["detail"]
        assert response.json().get("data") is None
    finally:
        app.dependency_overrides.clear()


def test_happy_path_normalized_transactions_envelope_mock(
    client_with_mock_firefly,
):
    response = client_with_mock_firefly.get(
        "/api/normalized_transactions",
        params={"start": "2024-01-01", "end": "2024-01-31"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["count"] == len(body["data"])
    assert body["meta"]["start"] == "2024-01-01"
    assert body["meta"]["end"] == "2024-01-31"
    assert body["firefly_base_url"] == "https://firefly.example"
    assert "test-token-placeholder" not in json.dumps(body)
    if body["data"]:
        assert set(body["data"][0].keys()) == OMNI_KEYS
        assert body["data"][0]["journal_id"] == "100"


def test_empty_firefly_range_200(client_with_mock_firefly):
    response = client_with_mock_firefly.get(
        "/api/normalized_transactions",
        params={"start": "2099-01-01", "end": "2099-01-31"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["data"] == []
    assert body["meta"]["count"] == 0


def test_api_does_not_leak_token(client_with_mock_firefly):
    response = client_with_mock_firefly.get(
        "/api/normalized_transactions",
        params={"start": "2024-01-01", "end": "2024-01-31"},
    )
    assert "test-token-placeholder" not in response.text


@pytest.mark.integration
def test_live_spending_total_within_tolerance():
    pytest.skip("Set FIREFLY_BASE_URL and FIREFLY_API_TOKEN to run live integration check")
