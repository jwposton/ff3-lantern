"""Tests for bill registration wizard orchestration (PAY-17, #21)."""

from __future__ import annotations

import json

import httpx
import pytest

import sidecar_db
from firefly_client import FireflyClient
from payment_worksheet_bills import (
    BillRegistrationError,
    RegisterBillBody,
    build_bill_link_rule_body,
    compute_bill_owed_from_firefly,
    compute_recurring_bill_owed,
    find_link_rules_for_bill,
    list_link_rules_for_bill,
    register_bill,
    register_new_bill,
    _resolve_firefly_bill_amounts,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    return tmp_path


def test_build_bill_link_rule_body_includes_link_action():
    body = build_bill_link_rule_body(
        bill_name="Water bill",
        title="Water bill",
        description_contains="CITY WATER",
        destination_account="City Utilities",
        category_name="",
        amount_exactly="55.00",
        rule_group_id="9",
    )
    assert body["rule_group_id"] == "9"
    assert body["actions"] == [
        {"type": "link_to_bill", "value": "Water bill", "active": True},
    ]
    assert body["triggers"][0] == {
        "type": "description_contains",
        "value": "CITY WATER",
        "active": True,
    }
    assert body["triggers"][1] == {
        "type": "destination_account_contains",
        "value": "City Utilities",
        "active": True,
    }
    assert body["triggers"][2]["type"] == "amount_exactly"


def test_build_bill_link_rule_body_payee_only():
    body = build_bill_link_rule_body(
        bill_name="Power and Lights",
        title="Power and Lights",
        description_contains="",
        destination_account="Duke Energy",
        category_name="",
        amount_exactly=None,
        rule_group_id="9",
    )
    assert len(body["triggers"]) == 1
    assert body["triggers"][0]["type"] == "destination_account_contains"


def test_build_bill_link_rule_body_category_only():
    body = build_bill_link_rule_body(
        bill_name="Streaming",
        title="Streaming",
        description_contains="",
        destination_account="",
        category_name="Subscriptions",
        amount_exactly=None,
        rule_group_id="9",
    )
    assert len(body["triggers"]) == 1
    assert body["triggers"][0] == {
        "type": "category_is",
        "value": "Subscriptions",
        "active": True,
    }


def test_resolve_firefly_bill_amounts_mirrors_single_value():
    body = RegisterBillBody(
        mode="create_new",
        name="Oil",
        amount_mode="intermittent",
        worksheet_section="bills",
        payment_rail="bank",
        funding_bucket_key="checking",
        amount_min="150.00",
    )
    assert _resolve_firefly_bill_amounts(body) == ("150.00", "150.00")

    body_max = RegisterBillBody(
        mode="create_new",
        name="Oil",
        amount_mode="intermittent",
        worksheet_section="bills",
        payment_rail="bank",
        funding_bucket_key="checking",
        amount_max="200.00",
    )
    assert _resolve_firefly_bill_amounts(body_max) == ("200.00", "200.00")


def test_compute_recurring_bill_owed_uses_average():
    assert compute_recurring_bill_owed("80.00", "100.00") == "90.00"
    assert compute_recurring_bill_owed("50.00", "50.00") == "50.00"


def test_compute_bill_owed_from_firefly_intermittent_is_zero():
    owed = compute_bill_owed_from_firefly(
        {"amount_min": "400.00", "amount_max": "600.00"},
        amount_mode="intermittent",
    )
    assert owed == "0.00"


@pytest.mark.asyncio
async def test_register_wizard(data_dir, monkeypatch):
    monkeypatch.setenv(
        "FF3ANALYTICS_PAYMENT_WORKSHEET_RULE_GROUP", "Payment worksheet"
    )
    bill_posts: list[dict] = []
    rule_posts: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/rule-groups" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "rule-groups",
                            "id": "1",
                            "attributes": {"title": "Payment worksheet"},
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path == "/api/v1/bills" and request.method == "POST":
            bill_posts.append(json.loads(request.content.decode()))
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "bills",
                        "id": "bill-new",
                        "attributes": {
                            "name": bill_posts[-1]["name"],
                            "amount_min": "50.00",
                            "amount_max": "50.00",
                            "repeat_freq": "monthly",
                        },
                    }
                },
            )
        if path == "/api/v1/rules" and request.method == "POST":
            rule_posts.append(json.loads(request.content.decode()))
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-new",
                        "attributes": {"title": rule_posts[-1]["title"]},
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    body = RegisterBillBody(
        mode="create_new",
        name="Water",
        amount_min="50.00",
        amount_mode="recurring",
        repeat_freq="monthly",
        worksheet_section="bills",
        payment_rail="bank",
        funding_bucket_key="checking",
        description_contains="CITY WATER",
    )
    result = await register_bill(client, body)
    assert result["id"] > 0
    assert result["firefly_bill_id"] == "bill-new"
    assert result["rule_id"] == "rule-new"
    assert result["counts_toward_cash_plan"] is True
    assert len(bill_posts) == 1
    assert bill_posts[0]["name"] == "Water"
    assert "date" in bill_posts[0]
    assert bill_posts[0]["active"] is True
    assert bill_posts[0]["object_group_title"] == "Payment worksheet"
    assert len(rule_posts) == 1
    assert rule_posts[0]["actions"][0]["type"] == "link_to_bill"
    assert rule_posts[0]["actions"][0]["value"] == "Water"
    row = await sidecar_db.get_worksheet_registry(result["id"])
    assert row is not None
    assert row["firefly_bill_id"] == "bill-new"
    assert row["planned_sync"] == "fixed"


@pytest.mark.asyncio
async def test_register_intermittent_without_amount(data_dir, monkeypatch):
    monkeypatch.setenv(
        "FF3ANALYTICS_PAYMENT_WORKSHEET_RULE_GROUP", "Payment worksheet"
    )
    bill_posts: list[dict] = []
    rule_posts: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/rule-groups" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "rule-groups",
                            "id": "1",
                            "attributes": {"title": "Payment worksheet"},
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path == "/api/v1/bills" and request.method == "POST":
            bill_posts.append(json.loads(request.content.decode()))
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "bills",
                        "id": "bill-oil",
                        "attributes": {"name": bill_posts[-1]["name"]},
                    }
                },
            )
        if path == "/api/v1/rules" and request.method == "POST":
            rule_posts.append(json.loads(request.content.decode()))
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-oil",
                        "attributes": {"title": rule_posts[-1]["title"]},
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    body = RegisterBillBody(
        mode="create_new",
        name="Heating oil",
        amount_mode="intermittent",
        repeat_freq="monthly",
        worksheet_section="bills",
        payment_rail="bank",
        funding_bucket_key="checking",
        description_contains="OIL DELIVERY",
    )
    result = await register_bill(client, body)
    assert result["firefly_bill_id"] == "bill-oil"
    assert len(bill_posts) == 1
    assert bill_posts[0]["amount_min"] == "1.00"
    assert bill_posts[0]["amount_max"] == "99999.99"
    assert len(rule_posts) == 1
    assert not any(
        trigger.get("type") == "amount_exactly"
        for trigger in rule_posts[0]["triggers"]
    )
    row = await sidecar_db.get_worksheet_registry(result["id"])
    assert row is not None
    assert row["amount_mode"] == "intermittent"
    assert row["planned_sync"] == "manual"


@pytest.mark.asyncio
async def test_register_credit_card_rail_counts_toward_cash_plan_off(data_dir, monkeypatch):
    monkeypatch.setenv(
        "FF3ANALYTICS_PAYMENT_WORKSHEET_RULE_GROUP", "Payment worksheet"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/rule-groups" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "rule-groups",
                            "id": "1",
                            "attributes": {"title": "Payment worksheet"},
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path == "/api/v1/bills" and request.method == "POST":
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "bills",
                        "id": "bill-cc",
                        "attributes": {"name": "Cell"},
                    }
                },
            )
        if path == "/api/v1/rules" and request.method == "POST":
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "rules",
                        "id": "rule-cc",
                        "attributes": {"title": "Cell"},
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    body = RegisterBillBody(
        mode="create_new",
        name="Cell",
        amount="80.00",
        amount_mode="recurring",
        repeat_freq="monthly",
        worksheet_section="bills",
        payment_rail="credit_card",
        credit_card_account_id="cc-1",
        description_contains="VERIZON",
    )
    result = await register_bill(client, body)
    assert result["counts_toward_cash_plan"] is False
    row = await sidecar_db.get_worksheet_registry(result["id"])
    assert row is not None
    assert row["counts_toward_cash_plan"] is False


def test_find_link_rules_for_bill_extracts_triggers():
    rules = [
        {
            "id": "9",
            "title": "Cell rule",
            "triggers": [
                {"type": "description_contains", "value": "VERIZON"},
                {"type": "amount_exactly", "value": "80.00"},
            ],
            "actions": [{"type": "link_to_bill", "value": "Power and Lights"}],
        },
        {
            "id": "10",
            "title": "Other",
            "triggers": [{"type": "description_contains", "value": "AMZN"}],
            "actions": [{"type": "set_category", "value": "Shopping"}],
        },
    ]
    matched = find_link_rules_for_bill(rules, "42", bill_name="Power and Lights")
    assert matched == [
        {
            "id": "9",
            "title": "Cell rule",
            "description_contains": "VERIZON",
            "payee_contains": None,
            "category_name": None,
            "amount_exactly": "80.00",
        }
    ]


@pytest.mark.asyncio
async def test_list_link_rules_for_bill_uses_bill_rules_endpoint(data_dir):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/bills/power/rules" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "rules",
                            "id": "rule-power",
                            "attributes": {
                                "title": "Power rule",
                                "triggers": [
                                    {
                                        "type": "description_contains",
                                        "value": "DUKE ENERGY",
                                    }
                                ],
                                "actions": [
                                    {
                                        "type": "link_to_bill",
                                        "value": "Power and Lights",
                                    }
                                ],
                            },
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path == "/api/v1/bills/power" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "bills",
                        "id": "power",
                        "attributes": {"name": "Power and Lights"},
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    matched = await list_link_rules_for_bill(client, "power")
    assert matched == [
        {
            "id": "rule-power",
            "title": "Power rule",
            "description_contains": "DUKE ENERGY",
            "payee_contains": None,
            "category_name": None,
            "amount_exactly": None,
        }
    ]


@pytest.mark.asyncio
async def test_link_existing_with_rule_id_reuses_rule(data_dir):
    rule_posts: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/bills/existing" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "bills",
                        "id": "existing",
                        "attributes": {"name": "Rent"},
                    }
                },
            )
        if path == "/api/v1/rules" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "rules",
                            "id": "rule-rent",
                            "attributes": {
                                "title": "Rent rule",
                                "triggers": [
                                    {
                                        "type": "description_contains",
                                        "value": "LANDLORD",
                                    }
                                ],
                                "actions": [
                                    {
                                        "type": "link_to_bill",
                                        "value": "Rent",
                                    }
                                ],
                            },
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path == "/api/v1/rules" and request.method == "POST":
            rule_posts.append(json.loads(request.content.decode()))
            return httpx.Response(201, json={"data": {"id": "new-rule"}})
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    body = RegisterBillBody(
        mode="link_existing",
        name="Rent",
        amount="1200.00",
        amount_mode="recurring",
        worksheet_section="liabilities",
        payment_rail="bank",
        funding_bucket_key="checking",
        description_contains="",
        firefly_bill_id="existing",
        rule_id="rule-rent",
    )
    result = await register_bill(client, body)
    assert result["rule_id"] == "rule-rent"
    assert rule_posts == []


@pytest.mark.asyncio
async def test_link_existing_without_rule_or_trigger_raises_422(data_dir):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/bills/existing" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "type": "bills",
                        "id": "existing",
                        "attributes": {"name": "Rent"},
                    }
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    body = RegisterBillBody(
        mode="link_existing",
        name="Rent",
        amount="1200.00",
        amount_mode="recurring",
        worksheet_section="liabilities",
        payment_rail="bank",
        funding_bucket_key="checking",
        description_contains="",
        firefly_bill_id="existing",
    )
    with pytest.raises(BillRegistrationError) as exc:
        await register_bill(client, body)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_register_new_bill_compensates_on_rule_failure(data_dir, monkeypatch):
    monkeypatch.setenv(
        "FF3ANALYTICS_PAYMENT_WORKSHEET_RULE_GROUP", "Payment worksheet"
    )
    deleted_bills: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/v1/rule-groups" and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "type": "rule-groups",
                            "id": "1",
                            "attributes": {"title": "Payment worksheet"},
                        }
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        if path == "/api/v1/bills" and request.method == "POST":
            return httpx.Response(
                201,
                json={
                    "data": {
                        "type": "bills",
                        "id": "bill-orphan",
                        "attributes": {"name": "Water"},
                    }
                },
            )
        if path == "/api/v1/bills/bill-orphan" and request.method == "DELETE":
            deleted_bills.append("bill-orphan")
            return httpx.Response(204)
        if path == "/api/v1/rules" and request.method == "POST":
            return httpx.Response(500, json={"message": "rule create failed"})
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    body = RegisterBillBody(
        mode="create_new",
        name="Water",
        amount="50.00",
        amount_mode="recurring",
        repeat_freq="monthly",
        worksheet_section="bills",
        payment_rail="bank",
        funding_bucket_key="checking",
        description_contains="CITY WATER",
    )
    with pytest.raises(BillRegistrationError):
        await register_new_bill(client, body)
    assert deleted_bills == ["bill-orphan"]
    rows = await sidecar_db.list_worksheet_registry()
    assert not [r for r in rows if r.get("firefly_bill_id") == "bill-orphan"]
