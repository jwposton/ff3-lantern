"""Tests for async FireflyClient (DATA-03)."""

from __future__ import annotations

import asyncio
import json

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


def test_flat_splits_include_journal_id_from_entry():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json=load_fixture("accounts.json"))
        return httpx.Response(200, json=load_fixture("transactions_withdrawal.json"))

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    flat = asyncio.run(client.fetch_splits("2024-01-01", "2024-01-31"))
    assert len(flat) == 1
    assert flat[0]["journal_id"] == "100"


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
    journal_ids = {row["transaction_journal_id"] for row in flat}
    assert journal_ids == {"2001", "2002"}


def test_withdrawal_fixture_includes_description_and_transaction_journal_id():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json=load_fixture("accounts.json"))
        return httpx.Response(200, json=load_fixture("transactions_withdrawal.json"))

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    flat = asyncio.run(client.fetch_splits("2024-01-01", "2024-01-31"))
    assert len(flat) == 1
    assert flat[0]["description"] == "Weekly groceries"
    assert flat[0]["transaction_journal_id"] == "1001"


def test_cc_withdrawal_source_role_is_credit_card():
    payload = {
        "data": [
            {
                "type": "transactions",
                "id": "300",
                "attributes": {
                    "transactions": [
                        {
                            "type": "withdrawal",
                            "amount": "42.00",
                            "source_id": "3",
                            "destination_id": "2",
                            "source_name": "Chase VISA",
                            "destination_name": "Store",
                            "date": "2024-01-16T12:00:00+00:00",
                        }
                    ]
                },
            }
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json=load_fixture("accounts.json"))
        return httpx.Response(200, json=payload)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    flat = asyncio.run(client.fetch_splits("2024-01-01", "2024-01-31"))
    cc_rows = [r for r in flat if r.get("source_name") == "Chase VISA"]
    assert len(cc_rows) == 1
    assert cc_rows[0].get("source_role") == "Credit card"
    assert cc_rows[0].get("source_type") == "Asset account"


def test_normalize_cc_asset_role():
    from firefly_client import _normalize_account_role

    assert _normalize_account_role("ccAsset") == "Credit card"
    assert _normalize_account_role("creditCard") == "Credit card"


def test_prepare_account_update_payload_ccasset_strips_liability_fields():
    from firefly_client import prepare_account_update_payload

    attrs = {
        "name": "Chase",
        "type": "asset",
        "account_role": "ccAsset",
        "notes": "old notes",
        "liability_type": "loan",
        "liability_direction": "credit",
        "interest": None,
        "interest_period": "monthly",
    }
    payload = prepare_account_update_payload(attrs, notes="new notes")
    assert payload["notes"] == "new notes"
    assert payload["credit_card_type"] == "monthlyFull"
    assert payload["monthly_payment_date"] == "2000-01-01"
    assert "liability_type" not in payload
    assert "interest" not in payload


def test_normalize_monthly_payment_date_formats():
    from firefly_client import _normalize_monthly_payment_date

    assert _normalize_monthly_payment_date(None) == "2000-01-01"
    assert _normalize_monthly_payment_date("15") == "2000-01-15"
    assert _normalize_monthly_payment_date("2020-05-11") == "2020-05-11"
    assert _normalize_monthly_payment_date("2020-05-11T12:00:00+00:00") == "2020-05-11"


def test_update_account_sends_sanitized_ccasset_body():
    put_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/9" and request.method == "PUT":
            put_bodies.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "9",
                        "attributes": put_bodies[-1],
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    asyncio.run(
        client.update_account(
            "9",
            {
                "name": "Chase",
                "type": "asset",
                "account_role": "ccAsset",
                "notes": "profile",
                "liability_type": "loan",
            },
        )
    )
    assert put_bodies
    body = put_bodies[0]
    assert body["credit_card_type"] == "monthlyFull"
    assert body["monthly_payment_date"] == "2000-01-01"
    assert "liability_type" not in body


def test_account_role_not_replaced_by_account_type():
    accounts_payload = {
        "data": [
            {
                "type": "accounts",
                "id": "9",
                "attributes": {
                    "name": "Mystery Asset",
                    "type": "asset",
                    "account_role": None,
                },
            }
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json=accounts_payload)
        return httpx.Response(200, json={"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}})

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    accounts = asyncio.run(client.fetch_accounts())
    assert accounts["9"]["role"] is None
    assert accounts["9"]["type"] == "Asset account"


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


def test_fetch_categories_returns_id_and_name():
    payload = {
        "data": [
            {"type": "categories", "id": "5", "attributes": {"name": "Food"}},
            {"type": "categories", "id": "6", "attributes": {"name": "Travel"}},
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/categories"):
            return httpx.Response(200, json=payload)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    categories = asyncio.run(client.fetch_categories())
    assert len(categories) == 2
    assert categories[0] == {"id": "5", "name": "Food"}
    assert categories[1] == {"id": "6", "name": "Travel"}


def test_fetch_budgets_returns_id_and_name():
    payload = {
        "data": [
            {"type": "budgets", "id": "10", "attributes": {"name": "Essentials"}},
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/budgets"):
            return httpx.Response(200, json=payload)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    budgets = asyncio.run(client.fetch_budgets())
    assert budgets == [{"id": "10", "name": "Essentials"}]


def test_fetch_rules_returns_id_and_title():
    payload = {
        "data": [
            {"type": "rules", "id": "7", "attributes": {"title": "Auto categorize groceries"}},
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rules"):
            return httpx.Response(200, json=payload)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    rules = asyncio.run(client.fetch_rules())
    assert rules == [{"id": "7", "title": "Auto categorize groceries", "triggers": []}]


def test_create_rule_posts_active_body():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/rules" and request.method == "POST":
            seen.append(json.loads(request.content.decode()))
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "rules",
                        "id": "12",
                        "attributes": {"title": seen[-1]["title"]},
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    body = {
        "rule_group_title": "FF3Analytics AI",
        "title": "Amazon",
        "trigger": "store-journal",
        "active": True,
        "triggers": [{"type": "description_contains", "value": "AMZN"}],
        "actions": [{"type": "set_category", "value": "Shopping"}],
    }
    result = asyncio.run(client.create_rule(body))
    assert result == {"id": "12", "title": "Amazon"}
    assert seen[0]["active"] is True


def test_trigger_rule_posts_date_range():
    seen: list[tuple[str, str, bytes]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/rules/12/trigger" and request.method == "POST":
            seen.append(
                (
                    request.url.params.get("start", ""),
                    request.url.params.get("end", ""),
                    request.content,
                )
            )
            return httpx.Response(204)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    result = asyncio.run(client.trigger_rule("12", "2024-01-01", "2024-01-31"))
    assert seen == [("2024-01-01", "2024-01-31", b"{}")]
    assert result == {"ok": True}


def test_fetch_rule_groups_returns_id_and_title():
    payload = {
        "data": [
            {"type": "rule_groups", "id": "3", "attributes": {"title": "FF3Analytics AI"}},
        ],
        "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rule-groups"):
            return httpx.Response(200, json=payload)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    groups = asyncio.run(client.fetch_rule_groups())
    assert groups == [{"id": "3", "title": "FF3Analytics AI"}]


def test_create_rule_group_posts_title():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/rule-groups" and request.method == "POST":
            seen.append(json.loads(request.content.decode()))
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "rule_groups",
                        "id": "9",
                        "attributes": {"title": seen[-1]["title"]},
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    result = asyncio.run(client.create_rule_group("FF3Analytics AI"))
    assert result == {"id": "9", "title": "FF3Analytics AI"}
    assert seen[0] == {"title": "FF3Analytics AI", "active": True}


def test_ensure_rule_group_returns_existing():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rule-groups") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "rule_groups",
                            "id": "3",
                            "attributes": {"title": "FF3Analytics AI"},
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    group_id = asyncio.run(client.ensure_rule_group("FF3Analytics AI"))
    assert group_id == "3"


def test_ensure_rule_group_creates_when_missing():
    created: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rule-groups") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if request.url.path == "/api/v1/rule-groups" and request.method == "POST":
            created.append(json.loads(request.content.decode()))
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "rule_groups",
                        "id": "11",
                        "attributes": {"title": created[-1]["title"]},
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    group_id = asyncio.run(client.ensure_rule_group("FF3Analytics AI"))
    assert group_id == "11"
    assert created == [{"title": "FF3Analytics AI", "active": True}]


def test_fetch_account_returns_notes():
    payload = {
        "data": {
            "type": "accounts",
            "id": "42",
            "attributes": {"name": "Mortgage", "notes": "loan profile here"},
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/42":
            return httpx.Response(200, json=payload)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    account = asyncio.run(client.fetch_account("42"))
    assert account["id"] == "42"
    assert account["attributes"]["notes"] == "loan profile here"
