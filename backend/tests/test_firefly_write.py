"""Tests for Firefly write path and loan profiles (WRITE-03, WRITE-04, WRITE-07)."""

from __future__ import annotations

import asyncio
import copy
import json

import httpx
import pytest

from conftest import load_fixture
from firefly_client import FireflyClient
from loan_profiles import (
    LOAN_PROFILE_MARKER,
    parse_loan_profile_from_notes,
    read_loan_profile,
    serialize_loan_profile_to_notes,
    write_loan_profile,
)

SAMPLE_PROFILE = {
    "version": 1,
    "enabled": True,
    "match": {
        "description_contains": "Loan Provider",
        "expected_amount": "427.18",
        "amount_tolerance": "0.50",
    },
    "split": {
        "escrow_amount": "0.00",
        "components": [],
    },
}


def test_parse_loan_profile_from_notes_extracts_json():
    notes = f"Some notes\n{LOAN_PROFILE_MARKER}\n{json.dumps(SAMPLE_PROFILE)}"
    parsed = parse_loan_profile_from_notes(notes)
    assert parsed == SAMPLE_PROFILE


def test_parse_loan_profile_handles_trailing_brace_in_notes():
    notes = (
        f"{LOAN_PROFILE_MARKER}\n{json.dumps(SAMPLE_PROFILE)}\n\n"
        "Operator note with stray } character"
    )
    parsed = parse_loan_profile_from_notes(notes)
    assert parsed == SAMPLE_PROFILE


def test_serialize_loan_profile_preserves_unrelated_notes():
    existing = "Operator memo line"
    serialized = serialize_loan_profile_to_notes(SAMPLE_PROFILE, existing)
    assert existing in serialized
    assert LOAN_PROFILE_MARKER in serialized
    assert parse_loan_profile_from_notes(serialized) == SAMPLE_PROFILE


def test_update_transaction_preserves_all_splits_on_partial_category_change():
    get_payload = load_fixture("transactions_put_roundtrip.json")
    put_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/transactions/500" and request.method == "GET":
            return httpx.Response(200, json=get_payload)
        if request.url.path == "/api/v1/transactions/500" and request.method == "PUT":
            put_bodies.append(json.loads(request.content))
            return httpx.Response(200, json=get_payload)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )

    def mutate(attrs: dict) -> dict:
        updated = copy.deepcopy(attrs)
        updated["transactions"][0]["category_id"] = "99"
        return updated

    asyncio.run(client.update_transaction("500", mutate))

    assert len(put_bodies) == 1
    body = put_bodies[0]
    assert body.get("apply_rules") is False
    splits = body["transactions"]
    assert len(splits) == 2
    journal_ids = {s["transaction_journal_id"] for s in splits}
    assert journal_ids == {"5001", "5002"}
    assert splits[0]["category_id"] == "99"
    assert splits[1]["category_id"] == "10"


def test_write_loan_profile_round_trip_preserves_account_attributes():
    account_get = {
        "data": {
            "type": "accounts",
            "id": "42",
            "attributes": {
                "name": "Mortgage Liability",
                "type": "liabilities",
                "notes": "existing operator note",
            },
        }
    }
    put_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/42" and request.method == "GET":
            return httpx.Response(200, json=account_get)
        if request.url.path == "/api/v1/accounts/42" and request.method == "PUT":
            put_bodies.append(json.loads(request.content))
            updated = copy.deepcopy(account_get)
            updated["data"]["attributes"]["notes"] = put_bodies[-1]["notes"]
            return httpx.Response(200, json=updated)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )

    written = asyncio.run(write_loan_profile(client, "42", SAMPLE_PROFILE))
    assert written == SAMPLE_PROFILE

    assert len(put_bodies) == 1
    put_attrs = put_bodies[0]
    assert put_attrs["name"] == "Mortgage Liability"
    assert put_attrs["type"] == "liabilities"
    assert LOAN_PROFILE_MARKER in put_attrs["notes"]
    assert "existing operator note" in put_attrs["notes"]


def test_read_loan_profile_returns_parsed_dict():
    notes = serialize_loan_profile_to_notes(SAMPLE_PROFILE, "memo")
    account_get = {
        "data": {
            "type": "accounts",
            "id": "42",
            "attributes": {"name": "Mortgage", "notes": notes},
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/accounts/42":
            return httpx.Response(200, json=account_get)
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="tok",
    )
    profile = asyncio.run(read_loan_profile(client, "42"))
    assert profile == SAMPLE_PROFILE
