"""Tests for async FireflyClient (DATA-03)."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from conftest import load_fixture
from firefly_client import FireflyClient


def _mock_handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/accounts"):
        return httpx.Response(200, json=load_fixture("accounts.json"))
    if path.endswith("/transactions"):
        name = request.url.params.get("fixture", "withdrawal")
        if name == "split":
            payload = load_fixture("transactions_split.json")
        elif name == "transfer_cc":
            payload = load_fixture("transactions_transfer_cc.json")
        else:
            payload = load_fixture("transactions_withdrawal.json")
        return httpx.Response(200, json=payload)
    return httpx.Response(404)


@pytest.fixture
def firefly_client():
    return FireflyClient(
        transport=httpx.MockTransport(_mock_handler),
        base_url="https://firefly.example",
        api_token="test-token",
    )


def test_accounts_cached_per_client():
    request_count = 0
    accounts_payload = load_fixture("accounts.json")

    def counting_handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        if request.url.path.endswith("/accounts"):
            request_count += 1
            return httpx.Response(200, json=accounts_payload)
        return httpx.Response(200, json={"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}})

    client = FireflyClient(
        transport=httpx.MockTransport(counting_handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    asyncio.run(client.fetch_accounts())
    asyncio.run(client.fetch_accounts())
    assert request_count == 1


def test_fetch_splits_passes_start_end():
    seen: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/transactions"):
            seen.append(dict(request.url.params))
            return httpx.Response(200, json=load_fixture("transactions_withdrawal.json"))
        return httpx.Response(200, json=load_fixture("accounts.json"))

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    asyncio.run(client.fetch_splits("2024-01-01", "2024-01-31"))
    assert seen
    assert seen[0]["start"] == "2024-01-01"
    assert seen[0]["end"] == "2024-01-31"


def test_split_journal_produces_two_rows():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json=load_fixture("accounts.json"))
        return httpx.Response(200, json=load_fixture("transactions_split.json"))

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    flat = asyncio.run(client.fetch_splits("2024-01-01", "2024-01-31"))
    assert len(flat) == 2


def test_includes_transfer_type():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json=load_fixture("accounts.json"))
        return httpx.Response(200, json=load_fixture("transactions_transfer_cc.json"))

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    flat = asyncio.run(client.fetch_splits("2024-01-01", "2024-01-31"))
    assert any(row["type"] == "transfer" for row in flat)
    assert any(row.get("destination_role") == "Credit card" for row in flat)
