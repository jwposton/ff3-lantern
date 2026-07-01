"""Tests for uncategorized queue detection and pending list builder."""

from __future__ import annotations

import httpx
import pytest

from categorize_queue import (
    _is_categorize_queue_row,
    build_grouped_pending_queue,
    build_pending_queue,
)
from firefly_client import FireflyClient
from transaction_normalization import description_fingerprint, is_uncategorized_for_queue


class TestDescriptionFingerprint:
    def test_amazon_variants_same_fingerprint(self):
        a = description_fingerprint("AMZN MKTP US*AB1CD2EF3")
        b = description_fingerprint("amzn mktp us*xy9")
        assert a == b
        assert a == "amzn mktp us"

    def test_empty_returns_empty(self):
        assert description_fingerprint("") == ""
        assert description_fingerprint("   ") == ""

    def test_lowercase(self):
        assert description_fingerprint("NETFLIX.COM") == "netflix com"

    def test_strips_digits_and_punctuation(self):
        assert description_fingerprint("STORE #123!!!") == "store"


def test_uncategorized_withdrawal_null_category():
    assert is_uncategorized_for_queue(
        {"type": "withdrawal", "category_name": None}
    )


def test_uncategorized_withdrawal_empty_category():
    assert is_uncategorized_for_queue(
        {"type": "withdrawal", "category_name": "   "}
    )


def test_uncategorized_withdrawal_budget_no_category():
    assert is_uncategorized_for_queue(
        {
            "type": "withdrawal",
            "category_name": None,
            "budget_name": "Groceries",
        }
    )


def test_categorized_withdrawal_excluded():
    assert not is_uncategorized_for_queue(
        {
            "type": "withdrawal",
            "category_name": "Groceries",
            "budget_name": "Food",
        }
    )


def test_withdrawal_category_no_budget_in_queue():
    assert is_uncategorized_for_queue(
        {
            "type": "withdrawal",
            "category_name": "Groceries",
            "budget_name": None,
        }
    )
    assert is_uncategorized_for_queue(
        {
            "type": "withdrawal",
            "category_name": "Groceries",
            "budget_name": "   ",
        }
    )


def test_transfer_excluded_even_without_category():
    assert not is_uncategorized_for_queue(
        {"type": "transfer", "category_name": None}
    )


def test_deposit_null_category_included_in_uncategorized_helper():
    assert is_uncategorized_for_queue(
        {"type": "deposit", "category_name": None}
    )


def test_deposit_excluded_from_categorize_queue():
    assert not _is_categorize_queue_row(
        {"type": "deposit", "category_name": None}
    )
    assert _is_categorize_queue_row(
        {"type": "withdrawal", "category_name": None}
    )


def test_cc_payment_transfer_excluded_via_pseudo_label():
    assert not is_uncategorized_for_queue(
        {
            "type": "transfer",
            "category_name": None,
            "destination_name": "Chase Visa",
            "destination_role": "Credit card",
            "destination_type": "Asset account",
            "source_type": "Asset account",
            "source_role": "Default account",
        }
    )


def test_internal_transfer_excluded_via_pseudo_label():
    assert not is_uncategorized_for_queue(
        {
            "type": "transfer",
            "category_name": None,
            "destination_name": "Savings",
            "destination_role": "Savings",
            "destination_type": "Asset account",
            "source_type": "Asset account",
            "source_role": "Default account",
        }
    )


MIXED_SPLITS = [
    {
        "journal_id": "100",
        "transaction_journal_id": "1001",
        "type": "withdrawal",
        "amount": "-50.00",
        "category_name": None,
        "budget_name": None,
        "date": "2024-06-15",
        "description": "AMZN MKTP",
        "source_name": "Checking",
        "destination_name": "Amazon",
    },
    {
        "journal_id": "101",
        "transaction_journal_id": "1002",
        "type": "withdrawal",
        "amount": "-20.00",
        "category_name": "Groceries",
        "budget_name": None,
        "date": "2024-06-14",
        "description": "SAFEWAY",
        "source_name": "Checking",
        "destination_name": "Safeway",
    },
    {
        "journal_id": "102",
        "transaction_journal_id": "1003",
        "type": "transfer",
        "amount": "-500.00",
        "category_name": None,
        "budget_name": None,
        "date": "2024-06-13",
        "description": "CC PAYMENT",
        "source_name": "Checking",
        "destination_name": "Chase Visa",
        "destination_role": "Credit card",
        "destination_type": "Asset account",
        "source_type": "Asset account",
        "source_role": "Default account",
    },
    {
        "journal_id": "103",
        "transaction_journal_id": "1004",
        "type": "deposit",
        "amount": "2000.00",
        "category_name": None,
        "budget_name": None,
        "date": "2024-06-12",
        "description": "PAYROLL",
        "source_name": "Employer",
        "destination_name": "Checking",
    },
]


@pytest.mark.asyncio
async def test_pending_queue_filters_and_sorts():
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json={"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}})
        if request.url.path.endswith("/transactions"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": s["journal_id"],
                            "attributes": {
                                "transactions": [
                                    {
                                        **s,
                                        "source_id": "1",
                                        "destination_id": "2",
                                    }
                                ]
                            },
                        }
                        for s in MIXED_SPLITS
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="token",
    )
    rows = await build_pending_queue(client, "2024-06-01", "2024-06-30")
    journal_ids = [r["journal_id"] for r in rows]
    assert journal_ids == ["100", "101"]
    assert rows[0]["description"] == "AMZN MKTP"
    assert rows[0]["transaction_journal_id"] == "1001"


@pytest.mark.asyncio
async def test_pending_queue_respects_limit():
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json={"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}})
        if request.url.path.endswith("/transactions"):
            splits = [
                {
                    "journal_id": str(i),
                    "transaction_journal_id": str(1000 + i),
                    "type": "withdrawal",
                    "amount": "-1.00",
                    "category_name": None,
                    "date": f"2024-06-{i:02d}",
                    "description": f"TX{i}",
                    "source_name": "Checking",
                    "destination_name": "Store",
                }
                for i in range(1, 11)
            ]
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": s["journal_id"],
                            "attributes": {
                                "transactions": [{**s, "source_id": "1", "destination_id": "2"}]
                            },
                        }
                        for s in splits
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="token",
    )
    rows = await build_pending_queue(client, "2024-06-01", "2024-06-30", limit=3)
    assert len(rows) == 3


GROUPED_SPLITS = [
    {
        "journal_id": "201",
        "transaction_journal_id": "2001",
        "type": "withdrawal",
        "amount": "-10.00",
        "category_name": None,
        "budget_name": None,
        "date": "2024-06-20",
        "description": "AMZN MKTP US*AB1",
        "source_name": "Checking",
        "destination_name": "Amazon",
    },
    {
        "journal_id": "202",
        "transaction_journal_id": "2002",
        "type": "withdrawal",
        "amount": "-15.00",
        "category_name": None,
        "budget_name": None,
        "date": "2024-06-19",
        "description": "amzn mktp us*xy9",
        "source_name": "Checking",
        "destination_name": "Amazon",
    },
    {
        "journal_id": "203",
        "transaction_journal_id": "2003",
        "type": "withdrawal",
        "amount": "-20.00",
        "category_name": None,
        "budget_name": None,
        "date": "2024-06-18",
        "description": "amzn mktp us*zz1",
        "source_name": "Checking",
        "destination_name": "Amazon",
    },
    {
        "journal_id": "204",
        "transaction_journal_id": "2004",
        "type": "withdrawal",
        "amount": "-5.00",
        "category_name": None,
        "budget_name": None,
        "date": "2024-06-17",
        "description": "UNIQUE MERCHANT",
        "source_name": "Checking",
        "destination_name": "Store",
    },
]


@pytest.mark.asyncio
async def test_grouped_pending_queue_buckets_by_fingerprint():
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json={"data": [], "meta": {"pagination": {"current_page": 1, "total_pages": 1}}})
        if request.url.path.endswith("/transactions"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": s["journal_id"],
                            "attributes": {
                                "transactions": [
                                    {**s, "source_id": "1", "destination_id": "2"}
                                ]
                            },
                        }
                        for s in GROUPED_SPLITS
                    ],
                    "meta": {"pagination": {"current_page": 1, "total_pages": 1}},
                },
            )
        return httpx.Response(404)

    client = FireflyClient(
        transport=httpx.MockTransport(handler),
        base_url="https://firefly.example",
        api_token="token",
    )
    groups = await build_grouped_pending_queue(client, "2024-06-01", "2024-06-30")
    assert len(groups) == 2
    assert groups[0]["count"] == 3
    assert set(groups[0]["journal_ids"]) == {"201", "202", "203"}
    assert groups[0]["sample_description"] == "AMZN MKTP US*AB1"
    assert groups[1]["count"] == 1
    assert groups[1]["journal_ids"] == ["204"]
