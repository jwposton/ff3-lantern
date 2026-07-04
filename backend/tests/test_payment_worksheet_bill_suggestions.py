"""Tests for bill suggestion engine (DISC-01–DISC-12, #32)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from payment_worksheet_bills import RegisterBillBody
from payment_worksheet_bill_suggestions import (
    BUCKET_ORDER,
    OPAQUE_NOTES,
    _bucket_sort_rank,
    _merchant_from_category,
    _pad_amounts,
    _should_subsplit_opaque_payee,
    _slugify_cluster,
    _subgroups_for_opaque_payee,
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


def apple_services_operator_fixture() -> list[dict[str, Any]]:
    """Operator-validated Apple sub-groups: iCloud+, Ulysses, Arcade, misc one-offs."""
    rows: list[dict[str, Any]] = []

    def add(category: str, amount: str, dates: list[str]) -> None:
        for date in dates:
            rows.append({
                "type": "withdrawal",
                "amount": amount,
                "date": date,
                "destination_name": "APPLE.COM/BILL",
                "description": "PreApproved Payment Bill User Payment",
                "category_name": category,
                "source_name": "PayPal Credit",
                "source_id": "cc-paypal",
                "source_type": "Asset account",
                "source_role": "Credit card",
            })

    monthly = [f"2025-{month:02d}-10" for month in range(7, 13)] + [
        f"2026-{month:02d}-10" for month in range(1, 7)
    ]
    add("Cloud Storage", "10.09", monthly)
    add("Ulysses App", "6.37", monthly)
    add("App Subscriptions", "7.43", ["2025-09-10", "2025-10-10", "2025-11-10"])
    misc_amounts = ["1.05", "2.99", "4.50", "5.00", "7.99", "9.99", "12.00", "15.50", "19.12"]
    for index, amount in enumerate(misc_amounts):
        add("App Subscriptions", amount, [f"2025-{8 + index:02d}-15"])
    return rows


def paypal_preapproved_multi_category() -> list[dict[str, Any]]:
    """Generic opaque payee — Software Subscription + Cloud Storage, no Apple string."""
    rows: list[dict[str, Any]] = []
    combos = (
        ("Software Subscription", "14.99"),
        ("Cloud Storage", "9.99"),
    )
    for category, amount in combos:
        for month in range(1, 7):
            date_month = month + 6
            year = 2025 if date_month <= 12 else 2026
            if date_month > 12:
                date_month -= 12
            rows.append({
                "type": "withdrawal",
                "amount": amount,
                "date": f"{year}-{date_month:02d}-05",
                "destination_name": "PAYPAL *DIGITALGOODS",
                "description": "PreApproved Payment Bill User Payment",
                "category_name": category,
                "source_name": "Checking",
                "source_id": "checking",
                "source_type": "Asset account",
                "source_role": "Default asset",
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


def _opaque_txn(
    *,
    category: str,
    amount: str,
    date: str,
    destination: str = "APPLE.COM/BILL",
) -> dict[str, Any]:
    return {
        "type": "withdrawal",
        "amount": Decimal(amount),
        "date": date,
        "destination_name": destination,
        "description": "PreApproved Payment Bill User Payment",
        "category_name": category,
        "source_name": "PayPal Credit",
        "source_id": "cc-paypal",
        "source_type": "Asset account",
        "source_role": "Credit card",
    }


def opaque_subsplit_fixture() -> list[dict[str, Any]]:
    """Two stable opaque fingerprints plus misc one-offs."""
    rows: list[dict[str, Any]] = []
    combos = (
        ("Cloud Storage", "10.09", ["2025-07-10", "2025-08-10", "2025-09-10"]),
        ("Ulysses App", "6.37", ["2025-07-15", "2025-08-15", "2025-09-15"]),
        ("App Subscriptions", "7.43", ["2025-10-10", "2025-11-10", "2025-12-10"]),
    )
    for category, amount, dates in combos:
        for date in dates:
            rows.append({
                "type": "withdrawal",
                "amount": amount,
                "date": date,
                "destination_name": "APPLE.COM/BILL",
                "description": "PreApproved Payment Bill User Payment",
                "category_name": category,
                "source_name": "PayPal Credit",
                "source_id": "cc-paypal",
                "source_type": "Asset account",
                "source_role": "Credit card",
            })
    rows.append({
        "type": "withdrawal",
        "amount": "1.05",
        "date": "2025-08-20",
        "destination_name": "APPLE.COM/BILL",
        "description": "PreApproved Payment Bill User Payment",
        "category_name": "App Subscriptions",
        "source_name": "PayPal Credit",
        "source_id": "cc-paypal",
        "source_type": "Asset account",
        "source_role": "Credit card",
    })
    return rows


def test_opaque_subgroup_no_parent_row_on_subsplit():
    result = build_bill_suggestions(opaque_subsplit_fixture(), **_engine_kwargs())
    assert len(result["data"]) >= 3
    assert all(row["bucket"] == "APPLE.COM/BILL" for row in result["data"])
    assert all(row["cluster"] == "apple-com-bill" for row in result["data"])
    assert all(row.get("notes") is None for row in result["data"])
    merchants = {row["merchant"] for row in result["data"]}
    assert "Apple.com/bill" not in merchants


def test_enrich_opaque_subgroup_stable_prefill_amount_exactly():
    result = build_bill_suggestions(opaque_subsplit_fixture(), **_engine_kwargs())
    cloud = next(row for row in result["data"] if row["merchant"].startswith("Cloud Storage"))
    prefill = cloud["register_prefill"]
    assert prefill["destination_account"] == "APPLE.COM/BILL"
    assert prefill["category_name"] == "Cloud Storage"
    assert prefill["amount_exactly"] == "10.09"
    assert_valid_register_prefill(prefill)


def test_enrich_opaque_subgroup_misc_row():
    result = build_bill_suggestions(opaque_subsplit_fixture(), **_engine_kwargs())
    misc = next(row for row in result["data"] if row["merchant"] == "APPLE.COM/BILL (misc)")
    assert misc["status"] == "review"
    assert misc["register_prefill"]["amount_mode"] == "intermittent"
    assert misc["register_prefill"]["amount_exactly"] is None


def test_opaque_subgroup_unique_ids():
    result = build_bill_suggestions(opaque_subsplit_fixture(), **_engine_kwargs())
    ids = [row["id"] for row in result["data"]]
    assert len(ids) == len(set(ids))


def test_enrich_opaque_subgroup_likely_suffix():
    result = build_bill_suggestions(opaque_subsplit_fixture(), **_engine_kwargs())
    arcade = next(row for row in result["data"] if "App Subscriptions" in row["merchant"])
    assert arcade["merchant"] == "App Subscriptions (likely)"


def test_subsplit_trigger_false_for_single_fingerprint():
    txns = [
        _opaque_txn(category="Music Streaming", amount="22.15", date=f"2025-0{m}-15")
        for m in (7, 8)
    ]
    assert _should_subsplit_opaque_payee(txns) is False


def test_subsplit_trigger_true_for_two_fingerprints_with_two_dates_each():
    txns = [
        _opaque_txn(category="Cloud Storage", amount="10.09", date="2025-07-10"),
        _opaque_txn(category="Cloud Storage", amount="10.09", date="2025-08-10"),
        _opaque_txn(category="Ulysses App", amount="6.37", date="2025-07-15"),
        _opaque_txn(category="Ulysses App", amount="6.37", date="2025-08-15"),
    ]
    assert _should_subsplit_opaque_payee(txns) is True


def test_subsplit_trigger_true_for_one_fingerprint_with_three_dates():
    txns = [
        _opaque_txn(category="App Subscriptions", amount="7.43", date="2025-09-10"),
        _opaque_txn(category="App Subscriptions", amount="7.43", date="2025-10-10"),
        _opaque_txn(category="App Subscriptions", amount="7.43", date="2025-11-10"),
        _opaque_txn(category="Cloud Storage", amount="10.09", date="2025-07-10"),
    ]
    assert _should_subsplit_opaque_payee(txns) is True


def test_slugify_cluster_apple_com_bill():
    assert _slugify_cluster("APPLE.COM/BILL") == "apple-com-bill"


def test_merchant_from_category_no_suffix_at_twelve_hits():
    assert _merchant_from_category("Cloud Storage", 12) == "Cloud Storage"


def test_merchant_from_category_likely_suffix_at_four_hits():
    assert _merchant_from_category("App Subscriptions", 4) == "App Subscriptions (likely)"


def test_subgroups_for_opaque_payee_returns_misc_only_when_non_empty():
    txns = [
        _opaque_txn(category="Cloud Storage", amount="10.09", date=f"2025-{m:02d}-10")
        for m in range(7, 13)
    ] + [
        _opaque_txn(category="Ulysses App", amount="6.37", date=f"2025-{m:02d}-15")
        for m in range(7, 13)
    ] + [
        _opaque_txn(category="App Subscriptions", amount="1.05", date="2025-08-15"),
    ]
    groups = _subgroups_for_opaque_payee(txns)
    kinds = [kind for _, kind in groups]
    assert "stable" in kinds
    if "misc" in kinds:
        misc_txns = [txns for txns, kind in groups if kind == "misc"][0]
        assert len(misc_txns) > 0


def test_apple_services_split_opaque():
    result = build_bill_suggestions(apple_services_operator_fixture(), **_engine_kwargs())
    data = result["data"]
    stable_rows = [row for row in data if row["merchant"] != "APPLE.COM/BILL (misc)"]
    misc_rows = [row for row in data if row["merchant"] == "APPLE.COM/BILL (misc)"]

    assert len(stable_rows) >= 3
    assert len(misc_rows) == 1
    assert all(row["bucket"] == "APPLE.COM/BILL" for row in data)
    assert all(row["cluster"] == "apple-com-bill" for row in data)
    assert all(row.get("notes") is None for row in data)

    merchants = {row["merchant"] for row in data}
    assert "Apple.com/bill" not in merchants
    assert any(row["merchant"] == "Cloud Storage" for row in stable_rows)
    assert any(row["merchant"] == "Ulysses App" for row in stable_rows)
    assert any("(likely)" in row["merchant"] for row in stable_rows if "App Subscriptions" in row["merchant"])

    misc = misc_rows[0]
    assert misc["status"] == "review"
    assert misc["register_prefill"]["amount_mode"] == "intermittent"
    assert misc["register_prefill"]["amount_exactly"] is None

    for row in stable_rows:
        if row["occurrences"] >= 12:
            prefill = row["register_prefill"]
            assert prefill["destination_account"] == "APPLE.COM/BILL"
            assert prefill["category_name"]
            assert prefill["amount_exactly"] is not None
            assert_valid_register_prefill(prefill)


def test_apple_no_monolithic_parent():
    result = build_bill_suggestions(apple_services_operator_fixture(), **_engine_kwargs())
    for row in result["data"]:
        assert row["merchant"] != "Apple.com/bill"
        assert row.get("notes") != OPAQUE_NOTES


def test_opaque_no_monolithic_parent():
    """Multi-fingerprint opaque clusters never emit a single combined parent row."""
    for fixture in (apple_services_operator_fixture(), paypal_preapproved_multi_category()):
        result = build_bill_suggestions(fixture, **_engine_kwargs())
        assert len(result["data"]) >= 2
        payee = fixture[0]["destination_name"]
        assert not any(
            row["merchant"] == _friendly_merchant_from_payee(payee)
            for row in result["data"]
        )
        assert all(row.get("notes") != OPAQUE_NOTES for row in result["data"])


def _friendly_merchant_from_payee(raw_payee: str) -> str:
    from payment_worksheet_bill_suggestions import _friendly_merchant_name
    return _friendly_merchant_name(raw_payee)


@pytest.mark.parametrize(
    ("raw_payee", "expected_slug"),
    [
        ("APPLE.COM/BILL", "apple-com-bill"),
        ("PAYPAL *DIGITALGOODS", "paypal-digitalgoods"),
    ],
)
def test_cluster_slug(raw_payee: str, expected_slug: str):
    assert _slugify_cluster(raw_payee) == expected_slug
    if raw_payee == "APPLE.COM/BILL":
        fixture = apple_services_operator_fixture()
    else:
        fixture = paypal_preapproved_multi_category()
    result = build_bill_suggestions(fixture, **_engine_kwargs())
    assert result["data"]
    assert all(row["cluster"] == expected_slug for row in result["data"])


def test_paypal_opaque_splits_generic():
    result = build_bill_suggestions(paypal_preapproved_multi_category(), **_engine_kwargs())
    data = result["data"]
    assert len(data) == 2
    assert all(row["bucket"] == "PAYPAL *DIGITALGOODS" for row in data)
    assert all(row["cluster"] == "paypal-digitalgoods" for row in data)
    merchants = {row["merchant"] for row in data}
    assert "Cloud Storage" in merchants
    assert "Software Subscription" in merchants
    assert not any("apple" in row["merchant"].casefold() for row in data)
    assert not any("apple" in row["bucket"].casefold() for row in data)
    ids = {row["id"] for row in data}
    assert len(ids) == 2
    for row in data:
        assert row["register_prefill"]["destination_account"] == "PAYPAL *DIGITALGOODS"
        assert_valid_register_prefill(row["register_prefill"])


def test_misc_catch_all_opaque():
    result = build_bill_suggestions(apple_services_operator_fixture(), **_engine_kwargs())
    misc = next(row for row in result["data"] if row["merchant"] == "APPLE.COM/BILL (misc)")
    assert misc["status"] == "review"
    prefill = misc["register_prefill"]
    assert prefill["amount_mode"] == "intermittent"
    assert prefill["amount_exactly"] is None
    assert prefill["name"] == "APPLE.COM/BILL (misc)"
    expected_lo, expected_hi = _pad_amounts(
        Decimal(misc["amount_min"]),
        Decimal(misc["amount_max"]),
    )
    assert prefill["amount_min"] == expected_lo
    assert prefill["amount_max"] == expected_hi
    assert prefill["amount_min"] != misc["amount_min"] or prefill["amount_max"] != misc["amount_max"]


def test_opaque_partial_adoption():
    kwargs = _engine_kwargs()
    kwargs["registry_rows"] = [{"row_label": "Cloud Storage", "firefly_bill_id": None}]
    result = build_bill_suggestions(apple_services_operator_fixture(), **kwargs)
    merchants = {row["merchant"] for row in result["data"]}
    assert "Cloud Storage" not in merchants
    assert "Ulysses App" in merchants


def test_sub_group_prefill_fields():
    result = build_bill_suggestions(apple_services_operator_fixture(), **_engine_kwargs())
    stable = [
        row for row in result["data"]
        if row["merchant"] != "APPLE.COM/BILL (misc)" and row["occurrences"] >= 12
    ]
    assert stable
    for row in stable:
        prefill = row["register_prefill"]
        assert prefill["destination_account"] == "APPLE.COM/BILL"
        assert prefill["category_name"]
        assert prefill["amount_exactly"] is not None
        assert_valid_register_prefill(prefill)


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


def test_bucket_sort_rank_dynamic_opaque_at_apple_slot():
    apple_slot = BUCKET_ORDER.index("Apple Services")
    assert _bucket_sort_rank("APPLE.COM/BILL") == apple_slot
    assert _bucket_sort_rank("PAYPAL *DIGITALGOODS") == apple_slot
    assert _bucket_sort_rank("Streaming & Media") == 0
    assert _bucket_sort_rank("Unknown Payee XYZ") == apple_slot


def test_opaque_bucket_sort_rank():
    splits = spotify_monthly_withdrawals(12) + apple_services_operator_fixture()
    result = build_bill_suggestions(splits, **_engine_kwargs())
    buckets = [row["bucket"] for row in result["data"]]
    apple_slot = BUCKET_ORDER.index("Apple Services")
    streaming_idx = buckets.index("Streaming & Media")
    apple_bucket_indices = [index for index, bucket in enumerate(buckets) if bucket == "APPLE.COM/BILL"]
    assert apple_bucket_indices
    assert streaming_idx < min(apple_bucket_indices)
    after_apple_fixed = [bucket for bucket in BUCKET_ORDER[apple_slot + 1:] if bucket in buckets]
    if after_apple_fixed:
        first_after_idx = buckets.index(after_apple_fixed[0])
        assert max(apple_bucket_indices) < first_after_idx
    apple_rows = [row for row in result["data"] if row["bucket"] == "APPLE.COM/BILL"]
    from itertools import groupby
    for (_confidence, _occurrences), group in groupby(
        apple_rows,
        key=lambda row: (row["confidence"], row["occurrences"]),
    ):
        merchants = [row["merchant"] for row in group]
        assert merchants == sorted(merchants, key=str.casefold)


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
