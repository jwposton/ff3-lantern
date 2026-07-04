"""Tests for bill suggestion engine (DISC-01–DISC-12, #32)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from payment_worksheet_bill_suggestions import build_bill_suggestions


def _engine_kwargs() -> dict[str, Any]:
    return {
        "accounts": empty_accounts(),
        "firefly_bills": [],
        "registry_rows": [],
        "period_start": "2025-07-01",
        "period_end": "2026-07-01",
    }


def empty_accounts() -> dict[str, dict[str, Any]]:
    return {
        "cc-paypal": {
            "id": "cc-paypal",
            "name": "PayPal Credit",
            "type": "Asset account",
            "role": "Credit card",
        },
        "checking": {
            "id": "checking",
            "name": "Checking",
            "type": "Asset account",
            "role": "Default asset",
        },
    }


def spotify_monthly_withdrawals(count: int = 12) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "22.15",
            "date": f"{year}-{month:02d}-15",
            "destination_name": "Spotify USA Inc",
            "description": "PreApproved Payment Bill User Payment",
            "category_name": "Music Streaming",
            "source_name": "PayPal Credit",
            "source_id": "cc-paypal",
            "source_type": "Asset account",
            "source_role": "Credit card",
        })
    return rows


def all_american_waste_monthly(count: int = 12) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "39.00",
            "date": f"{year}-{month:02d}-01",
            "destination_name": "All American Waste",
            "description": "Trash service",
            "category_name": "Utilities",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def low_confidence_quarterly(count: int = 2) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    dates = ["2025-01-15", "2025-04-18"]
    for i in range(count):
        rows.append({
            "type": "withdrawal",
            "amount": "15.00",
            "date": dates[i],
            "destination_name": "Quarterly Sub Co",
            "description": "Subscription renewal",
            "category_name": "Subscriptions",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def test_spotify_monthly_high_confidence():
    result = build_bill_suggestions(
        spotify_monthly_withdrawals(12),
        **_engine_kwargs(),
    )
    assert len(result["data"]) == 1
    suggestion = result["data"][0]
    assert suggestion["confidence"] == "high"
    assert suggestion["freq"] == "monthly"
    assert suggestion["occurrences"] == 12
    assert abs(Decimal(suggestion["amount_avg"]) - Decimal("22.15")) < Decimal("0.01")


def test_all_american_waste_monthly_metrics():
    result = build_bill_suggestions(
        all_american_waste_monthly(12),
        **_engine_kwargs(),
    )
    assert len(result["data"]) == 1
    suggestion = result["data"][0]
    assert suggestion["occurrences"] == 12
    assert abs(Decimal(suggestion["amount_avg"]) - Decimal("39.00")) < Decimal("1.00")


def test_deposits_excluded():
    splits = spotify_monthly_withdrawals(3) + [
        {"type": "deposit", "amount": "100.00", "date": "2025-08-01"},
        {"type": "deposit", "amount": "50.00", "date": "2025-09-01"},
    ]
    result = build_bill_suggestions(splits, **_engine_kwargs())
    assert result["meta"]["withdrawals_analyzed"] == 3


def test_single_date_group_skipped():
    result = build_bill_suggestions(
        spotify_monthly_withdrawals(1),
        **_engine_kwargs(),
    )
    assert result["data"] == []


def test_grouping_by_payee():
    splits = spotify_monthly_withdrawals(6) + all_american_waste_monthly(6)
    result = build_bill_suggestions(splits, **_engine_kwargs())
    assert len(result["data"]) == 2
    merchants = {row["merchant"] for row in result["data"]}
    assert "Spotify USA Inc" in merchants
    assert "All American Waste" in merchants


def test_low_confidence_included():
    result = build_bill_suggestions(
        low_confidence_quarterly(2),
        **_engine_kwargs(),
    )
    assert len(result["data"]) == 1
    assert result["data"][0]["confidence"] in ("low", "medium")
    assert result["data"][0]["status"] == "review"


def test_empty_splits():
    result = build_bill_suggestions([], **_engine_kwargs())
    assert result["data"] == []
    assert result["meta"]["suggestions_count"] == 0
