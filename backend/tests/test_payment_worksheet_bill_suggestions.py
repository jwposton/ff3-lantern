"""Tests for bill suggestion engine (DISC-01–DISC-12, #32)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from payment_worksheet_bills import RegisterBillBody
from payment_worksheet_bill_suggestions import (
    OPAQUE_NOTES,
    _pad_amounts,
    build_bill_suggestions,
    fetch_bill_suggestions,
)


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
            "category_name": "Professional Services",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def restaurant_variant_noise(count: int = 6) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "28.50",
            "date": f"{year}-{month:02d}-12",
            "destination_name": "Local Diner",
            "description": "Dinner",
            "category_name": "Restaurant",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def gas_station_noise(count: int = 6) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    stations = ("Sunoco", "Exxon")
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "45.00",
            "date": f"{year}-{month:02d}-05",
            "destination_name": stations[i % len(stations)],
            "description": "Fuel purchase",
            "category_name": "Gas",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def gasoline_variant_noise(count: int = 6) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "45.00",
            "date": f"{year}-{month:02d}-05",
            "destination_name": "Shell Station",
            "description": "Fuel purchase",
            "category_name": "Gasoline",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def restaurant_noise(count: int = 6) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "28.50",
            "date": f"{year}-{month:02d}-12",
            "destination_name": "Local Diner",
            "description": "Dinner",
            "category_name": "Restaurants",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def apple_cash_p2p(count: int = 6) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "25.00",
            "date": f"{year}-{month:02d}-20",
            "destination_name": "Friend",
            "description": "APPLE CASH SENT MONEY VIA MOBILE",
            "category_name": "Transfer",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def cc_interest_noise(count: int = 6) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "18.75",
            "date": f"{year}-{month:02d}-01",
            "destination_name": "PayPal Credit",
            "description": "Interest Charge",
            "category_name": "Credit Card Interest",
            "source_name": "PayPal Credit",
            "source_id": "cc-paypal",
            "source_type": "Asset account",
            "source_role": "Credit card",
        })
    return rows


def loan_payment_noise(count: int = 6) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "850.00",
            "date": f"{year}-{month:02d}-01",
            "destination_name": "Mortgage",
            "description": "Loan payment",
            "category_name": "Loan Payment",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
            "destination_id": "mortgage",
            "destination_type": "Liability account",
            "destination_role": "Debt",
        })
    return rows


def spotify_varying_amounts(count: int = 12) -> list[dict[str, Any]]:
    amount_cycle = ("21.26", "22.15", "23.39")
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": amount_cycle[i % len(amount_cycle)],
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


def apple_services_combined(count: int = 12) -> list[dict[str, Any]]:
    categories = ("iCloud+", "App Store", "Apple Music")
    amounts = ("2.99", "9.99", "10.99")
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": amounts[i % len(amounts)],
            "date": f"{year}-{month:02d}-10",
            "destination_name": "APPLE.COM/BILL",
            "description": "PreApproved Payment Bill User Payment",
            "category_name": categories[i % len(categories)],
            "source_name": "PayPal Credit",
            "source_id": "cc-paypal",
            "source_type": "Asset account",
            "source_role": "Credit card",
        })
    return rows


def registered_spotify_registry_row() -> list[dict[str, Any]]:
    return [{"row_label": "Spotify", "firefly_bill_id": None}]


def registered_firefly_bill_id_row() -> list[dict[str, Any]]:
    return [{"row_label": "Spotify USA Inc", "firefly_bill_id": "99"}]


def assert_valid_register_prefill(prefill: dict[str, Any]) -> None:
    stub = {
        "funding_bucket_key": "checking" if prefill["payment_rail"] == "bank" else None,
        "credit_card_account_id": "cc1" if prefill["payment_rail"] == "credit_card" else None,
    }
    RegisterBillBody.model_validate({**prefill, **stub})


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
    assert "Spotify" in merchants
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


@pytest.mark.parametrize(
    ("fixture_fn", "label"),
    [
        (gas_station_noise, "gas_station"),
        (gasoline_variant_noise, "gasoline_variant"),
        (restaurant_noise, "restaurant"),
        (restaurant_variant_noise, "restaurant_variant"),
        (apple_cash_p2p, "apple_cash_p2p"),
        (cc_interest_noise, "cc_interest"),
        (loan_payment_noise, "loan_payment"),
    ],
)
def test_noise_exclusion_categories(fixture_fn, label):
    _ = label
    result = build_bill_suggestions(fixture_fn(6), **_engine_kwargs())
    assert result["data"] == []


def test_noise_does_not_block_spotify():
    splits = spotify_monthly_withdrawals(12) + gas_station_noise(6) + restaurant_noise(6)
    result = build_bill_suggestions(splits, **_engine_kwargs())
    assert len(result["data"]) == 1
    assert result["data"][0]["merchant"] == "Spotify"


def test_spotify_bucket_streaming_media():
    result = build_bill_suggestions(spotify_monthly_withdrawals(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    suggestion = result["data"][0]
    assert suggestion["bucket"] == "Streaming & Media"
    assert suggestion["merchant"] == "Spotify"


def test_spotify_varying_amounts_not_opaque():
    result = build_bill_suggestions(spotify_varying_amounts(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    suggestion = result["data"][0]
    assert suggestion["bucket"] == "Streaming & Media"
    assert suggestion["merchant"] == "Spotify"
    assert suggestion["status"] != "review" or "opaque_payee" not in suggestion.get("reasons", [])
    assert suggestion.get("notes") != OPAQUE_NOTES
    assert suggestion["register_prefill"]["category_name"] == "Music Streaming"


def test_all_american_waste_bucket_trash():
    result = build_bill_suggestions(all_american_waste_monthly(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    assert result["data"][0]["bucket"] == "Utilities — Trash"


def test_pad_amounts_five_percent():
    lo, hi = _pad_amounts(Decimal("21.26"), Decimal("23.39"))
    assert lo == "20.20"
    assert hi == "24.56"


def test_spotify_prefill_rail_and_amount_mode():
    result = build_bill_suggestions(spotify_monthly_withdrawals(12), **_engine_kwargs())
    prefill = result["data"][0]["register_prefill"]
    assert prefill["payment_rail"] == "credit_card"
    assert prefill["amount_mode"] == "recurring"
    assert prefill["name"] == "Spotify"
    assert prefill["destination_account"] == "Spotify USA Inc"


def test_spotify_category_field():
    result = build_bill_suggestions(spotify_monthly_withdrawals(12), **_engine_kwargs())
    assert result["data"][0]["category"] == "Music Streaming"


def test_apple_services_combined_opaque():
    result = build_bill_suggestions(apple_services_combined(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    suggestion = result["data"][0]
    assert suggestion["bucket"] == "Apple Services"
    assert suggestion["cluster"] is None
    assert suggestion["status"] == "review"
    assert suggestion["notes"] == OPAQUE_NOTES


def test_sort_bucket_confidence_occurrences():
    splits = (
        spotify_monthly_withdrawals(12)
        + all_american_waste_monthly(12)
        + low_confidence_quarterly(2)
    )
    result = build_bill_suggestions(splits, **_engine_kwargs())
    assert len(result["data"]) == 3
    buckets = [row["bucket"] for row in result["data"]]
    assert buckets[0] == "Streaming & Media"
    assert buckets[1] == "Utilities — Trash"
    assert buckets[2] == "Other Recurring"
    assert result["data"][0]["confidence"] == "high"
    assert result["data"][1]["confidence"] in ("high", "medium")
    assert result["data"][2]["confidence"] in ("low", "medium")
    assert result["data"][0]["occurrences"] >= result["data"][1]["occurrences"]


def test_registered_spotify_excluded():
    kwargs = _engine_kwargs()
    kwargs["registry_rows"] = registered_spotify_registry_row()
    result = build_bill_suggestions(spotify_monthly_withdrawals(12), **kwargs)
    assert result["data"] == []


def test_registered_firefly_bill_id_excluded():
    kwargs = _engine_kwargs()
    kwargs["registry_rows"] = registered_firefly_bill_id_row()
    kwargs["firefly_bills"] = [{"id": "99", "name": "Spotify USA Inc"}]
    result = build_bill_suggestions(spotify_monthly_withdrawals(12), **kwargs)
    assert result["data"] == []


def test_register_prefill_validates():
    splits = spotify_monthly_withdrawals(12) + all_american_waste_monthly(12)
    result = build_bill_suggestions(splits, **_engine_kwargs())
    for suggestion in result["data"]:
        assert_valid_register_prefill(suggestion["register_prefill"])


def test_named_bucket_assertions():
    splits = spotify_monthly_withdrawals(12) + all_american_waste_monthly(12)
    result = build_bill_suggestions(splits, **_engine_kwargs())
    buckets = {row["merchant"]: row["bucket"] for row in result["data"]}
    assert buckets["Spotify"] == "Streaming & Media"
    assert buckets["All American Waste"] == "Utilities — Trash"


def rent_monthly_withdrawals_linked(count: int = 12) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "1200.00",
            "date": f"{year}-{month:02d}-01",
            "destination_name": "Property Mgmt LLC",
            "description": "Monthly rent payment",
            "category_name": "Rent",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
            "subscription_id": "7",
            "subscription_name": "Rent",
        })
    return rows


def test_linked_subscription_split_excluded():
    kwargs = _engine_kwargs()
    kwargs["registry_rows"] = [{"row_label": "Rent", "firefly_bill_id": "7"}]
    result = build_bill_suggestions(rent_monthly_withdrawals_linked(12), **kwargs)
    assert result["data"] == []


def test_unlinked_recurring_still_suggested():
    result = build_bill_suggestions(spotify_monthly_withdrawals(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    assert result["data"][0]["merchant"] == "Spotify"


@pytest.mark.asyncio
async def test_fetch_bill_suggestions_rejects_invalid_lookback():
    class StubClient:
        async def fetch_splits(self, *_args, **_kwargs):
            return []

        async def fetch_accounts(self):
            return {}

        async def fetch_bills(self):
            return []

    with pytest.raises(ValueError, match="lookback_months must be 6, 12, or 24"):
        await fetch_bill_suggestions(StubClient(), lookback_months=18)
