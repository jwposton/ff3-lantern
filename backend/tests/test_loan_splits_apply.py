"""Tests for loan_splits apply mutator (LOAN-05, LOAN-08)."""

from __future__ import annotations

import asyncio
import copy
import json

import httpx

from loan_splits import (
    apply_loan_split,
    apply_penny_adjust_to_amounts,
    build_split_transactions,
)

PROFILE = {
    "_account_id": "42",
    "match": {"type": "transfer"},
    "split": {
        "components": [
            {
                "role": "principal",
                "type": "transfer",
                "destination_account_id": "42",
                "destination_account": "Mortgage",
            },
            {
                "role": "interest",
                "type": "transfer",
                "destination_account_id": "88",
                "destination_account": "Interest",
            },
        ]
    },
}

FLAT = {
    "amount": "-427.18",
    "description": "Loan Provider",
    "date": "2026-07-10",
    "source_name": "Checking",
    "source_id": "7",
    "transaction_journal_id": "5001",
}


def test_apply_penny_adjust_to_amounts_exact_sum():
    from decimal import Decimal

    adjusted = apply_penny_adjust_to_amounts(
        {"principal": "156.34", "interest": "270.84", "escrow": "0"},
        Decimal("427.18"),
    )
    assert sum(adjusted.values()) == Decimal("427.18")


def test_build_split_transactions_count():
    from decimal import Decimal

    amounts = {
        "principal": Decimal("156.35"),
        "interest": Decimal("270.83"),
        "escrow": Decimal("0"),
    }
    txns = build_split_transactions(PROFILE, FLAT, amounts)
    assert len(txns) == 2
    assert txns[0]["transaction_journal_id"] == "5001"
    assert txns[0]["type"] == "transfer"
    assert txns[0]["amount"] == "156.35"
    assert txns[1]["type"] == "transfer"
    assert txns[1]["amount"] == "270.83"


def test_build_split_transactions_withdrawal_match_uses_positive_amounts():
    from decimal import Decimal

    profile = {
        "match": {"type": "withdrawal"},
        "split": {
            "components": [
                {
                    "role": "principal",
                    "type": "withdrawal",
                    "destination_account_id": "42",
                    "destination_account": "Mortgage",
                },
                {
                    "role": "interest",
                    "type": "withdrawal",
                    "destination_account_id": "88",
                    "destination_account": "Interest",
                },
            ]
        },
    }
    flat = {**FLAT, "type": "withdrawal"}
    amounts = {
        "principal": Decimal("156.35"),
        "interest": Decimal("270.83"),
        "escrow": Decimal("0"),
    }
    txns = build_split_transactions(profile, flat, amounts)
    assert all(txn["type"] == "withdrawal" for txn in txns)
    assert all(not txn["amount"].startswith("-") for txn in txns)


def test_apply_loan_split_single_put():
    from decimal import Decimal
    from firefly_client import FireflyClient

    get_payload = {
        "data": {
            "type": "transactions",
            "id": "500",
            "attributes": {
                "description": "Loan Provider",
                "transactions": [
                    {
                        "transaction_journal_id": "5001",
                        "type": "transfer",
                        "amount": "-427.18",
                        "date": "2026-07-10",
                        "description": "Loan Provider",
                        "source_name": "Checking",
                        "destination_name": "Mortgage",
                    }
                ],
            },
        }
    }
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
    amounts = {
        "principal": "156.35",
        "interest": "270.83",
        "escrow": "0",
    }
    asyncio.run(
        apply_loan_split(client, "500", "5001", PROFILE, FLAT, amounts)
    )
    assert len(put_bodies) == 1
    body = put_bodies[0]
    assert body.get("apply_rules") is False
    assert len(body["transactions"]) == 2
    assert body.get("group_title") == "Loan Provider"
