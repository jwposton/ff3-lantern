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
    register_bill,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3ANALYTICS_DATA_DIR", str(tmp_path))
    return tmp_path


def test_build_bill_link_rule_body_includes_link_action():
    body = build_bill_link_rule_body(
        bill_id="42",
        title="Water bill",
        description_contains="CITY WATER",
        amount_exactly="55.00",
        rule_group_id="9",
    )
    assert body["rule_group_id"] == "9"
    assert body["actions"] == [
        {"type": "link_to_bill", "value": "42", "active": True},
    ]
    assert body["triggers"][0] == {
        "type": "description_contains",
        "value": "CITY WATER",
        "active": True,
    }
    assert body["triggers"][1]["type"] == "amount_exactly"


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
        amount="50.00",
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
    assert len(rule_posts) == 1
    assert rule_posts[0]["actions"][0]["type"] == "link_to_bill"
    assert rule_posts[0]["actions"][0]["value"] == "bill-new"
    row = await sidecar_db.get_worksheet_registry(result["id"])
    assert row is not None
    assert row["firefly_bill_id"] == "bill-new"
    assert row["planned_sync"] == "fixed"


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
