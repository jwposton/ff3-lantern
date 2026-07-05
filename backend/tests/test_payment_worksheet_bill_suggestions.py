"""Tests for bill suggestion engine (DISC-01–DISC-12, #32)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from datetime import date

import pytest

from payment_worksheet_bills import RegisterBillBody
from payment_worksheet_bill_suggestions import (
    OPAQUE_NOTES,
    _category_is_ignored,
    _cluster_withdrawals,
    _is_quiet_category,
    _lookback_period_start,
    _payee_is_ignored,
    _payee_similarity,
    _merchant_from_category,
    _pad_amounts,
    _resolve_opaque_raw_payee,
    _should_subsplit_opaque_payee,
    _slugify_cluster,
    _subgroups_for_opaque_payee,
    build_bill_suggestions,
    fetch_bill_suggestions,
    find_suggestion_transactions,
)


def _engine_kwargs(
    *,
    ignored_categories: list[str] | None = None,
    ignored_payees: list[str] | None = None,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "accounts": empty_accounts(),
        "firefly_bills": [],
        "registry_rows": [],
        "period_start": "2025-07-01",
        "period_end": "2026-07-01",
    }
    if ignored_categories is not None:
        kwargs["ignored_categories"] = ignored_categories
    if ignored_payees is not None:
        kwargs["ignored_payees"] = ignored_payees
    return kwargs


DEFAULT_IGNORED_CATEGORIES = [
    "Gas",
    "Restaurants",
    "Restaurant",
    "Gasoline",
    "Groceries",
    "Shopping",
    "Entertainment",
]


def test_lookback_period_start_snaps_to_first_of_month() -> None:
    assert _lookback_period_start(date(2026, 7, 5), 12) == date(2025, 7, 1)
    assert _lookback_period_start(date(2026, 7, 5), 6) == date(2026, 1, 1)


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


def apple_services_friendly_payee_fixture() -> list[dict[str, Any]]:
    """Apple fixture with friendly Firefly payee but canonical token in description."""
    rows = apple_services_operator_fixture()
    for row in rows:
        row["destination_name"] = "Apple Services"
        row["description"] = "APPLE.COM/BILL PreApproved Payment Bill User Payment"
    return rows


def apple_services_slight_variance_fixture() -> list[dict[str, Any]]:
    """iCloud sub-group with one month ~4% above base — within stable_amount band."""
    rows = apple_services_operator_fixture()
    for row in rows:
        if row["category_name"] == "Cloud Storage" and row["date"] == "2026-06-10":
            row["amount"] = "10.49"
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
        (apple_cash_p2p, "apple_cash_p2p"),
        (cc_interest_noise, "cc_interest"),
        (loan_payment_noise, "loan_payment"),
    ],
)
def test_accounting_noise_exclusion(fixture_fn, label):
    _ = label
    result = build_bill_suggestions(fixture_fn(6), **_engine_kwargs())
    assert result["data"] == []


@pytest.mark.parametrize(
    ("fixture_fn", "label"),
    [
        (restaurant_noise, "restaurant"),
        (restaurant_variant_noise, "restaurant_variant"),
    ],
)
def test_operator_ignored_category_exclusion(fixture_fn, label):
    _ = label
    result = build_bill_suggestions(
        fixture_fn(6),
        **_engine_kwargs(ignored_categories=DEFAULT_IGNORED_CATEGORIES),
    )
    assert result["data"] == []


def test_rent_not_excluded_without_ignore_list():
    rows: list[dict[str, Any]] = []
    for i in range(12):
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
        })
    result = build_bill_suggestions(rows, **_engine_kwargs())
    assert len(result["data"]) == 1
    assert result["data"][0]["category"] == "Rent"


def test_quiet_rent_merges_payee_variants():
    rows: list[dict[str, Any]] = []
    payees = ("Property Mgmt LLC", "New Landlord Inc")
    for i in range(12):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "1200.00",
            "date": f"{year}-{month:02d}-01",
            "destination_name": payees[i % len(payees)],
            "description": "Monthly rent payment",
            "category_name": "Rent",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    result = build_bill_suggestions(rows, **_engine_kwargs())
    assert len(result["data"]) == 1
    assert result["data"][0]["occurrences"] == 12


def _rent_row(
    *,
    amount: str,
    date: str,
    destination: str,
    category: str = "Rent",
    description: str = "Monthly rent payment",
) -> dict[str, Any]:
    return {
        "type": "withdrawal",
        "amount": amount,
        "date": date,
        "destination_name": destination,
        "description": description,
        "category_name": category,
        "source_name": "Checking",
        "source_id": "checking",
        "source_type": "Asset account",
        "source_role": "Default asset",
    }


def _noisy_rent_category_rows() -> list[dict[str, Any]]:
    """Rent rename plus extra Rent-category payees so category is not quiet (>3 payees)."""
    rows: list[dict[str, Any]] = []
    payees = ("Property Mgmt LLC", "Harvest Wind Rentals")
    for i in range(12):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append(
            _rent_row(
                amount="1850.00",
                date=f"{year}-{month:02d}-01",
                destination=payees[i % len(payees)],
            )
        )
    for i, payee in enumerate(
        ("Utility Co", "Insurance Co", "HOA Fees", "Parking LLC"),
        start=1,
    ):
        rows.append(
            _rent_row(
                amount=f"{50 + i}.00",
                date="2025-08-01",
                destination=payee,
                description="misc",
            )
        )
    return rows


def test_rent_payee_rename_single_suggestion():
    """#55: noisy Rent category still merges landlord rename into one row."""
    result = build_bill_suggestions(_noisy_rent_category_rows(), **_engine_kwargs())
    rent_rows = [
        row
        for row in result["data"]
        if row.get("register_prefill", {}).get("category_name") == "Rent"
        and row.get("amount_avg") == "1850.00"
    ]
    assert len(rent_rows) == 1
    assert rent_rows[0]["occurrences"] == 12


def test_fuzzy_payee_near_match_merges():
    rows: list[dict[str, Any]] = []
    payees = ("Property Mgmt LLC", "Property Mgmt, LLC")
    for i in range(6):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append(
            _rent_row(
                amount="1200.00",
                date=f"{year}-{month:02d}-01",
                destination=payees[i % len(payees)],
            )
        )
    assert _payee_similarity(payees[0], payees[1]) >= 0.85
    result = build_bill_suggestions(rows, **_engine_kwargs())
    assert len(result["data"]) == 1
    assert result["data"][0]["occurrences"] == 6


def test_same_category_different_amounts_stay_separate():
    rows = [
        _rent_row(amount="1850.00", date="2025-07-01", destination="Property Mgmt LLC"),
        _rent_row(amount="1850.00", date="2025-08-01", destination="Property Mgmt LLC"),
        _rent_row(amount="1850.00", date="2025-09-01", destination="Property Mgmt LLC"),
        _rent_row(amount="75.00", date="2025-07-15", destination="Property Mgmt LLC", description="Parking"),
        _rent_row(amount="75.00", date="2025-08-15", destination="Property Mgmt LLC", description="Parking"),
        _rent_row(amount="75.00", date="2025-09-15", destination="Property Mgmt LLC", description="Parking"),
    ]
    result = build_bill_suggestions(rows, **_engine_kwargs())
    assert len(result["data"]) == 2
    amounts = {row["amount_avg"] for row in result["data"]}
    assert amounts == {"75.00", "1850.00"}


def comcast_semi_monthly_fixture() -> list[dict[str, Any]]:
    """Operator Comcast: ~3rd stream with rate steps + ~20th stream at $118."""
    rows: list[dict[str, Any]] = []
    early_amounts = {
        "2025-08": "68.00",
        "2025-09": "68.00",
        "2025-10": "68.00",
        "2025-11": "88.00",
        "2025-12": "88.00",
        "2026-01": "88.00",
        "2026-02": "90.00",
        "2026-03": "90.00",
        "2026-04": "90.00",
        "2026-05": "90.00",
        "2026-06": "90.00",
        "2026-07": "90.00",
    }
    for month, amount in early_amounts.items():
        year, mon = month.split("-")
        rows.append({
            "type": "withdrawal",
            "amount": amount,
            "date": f"{year}-{mon}-03",
            "destination_name": "Comcast",
            "description": "Internet bill",
            "category_name": "Internet",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    for i in range(12):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "118.00",
            "date": f"{year}-{month:02d}-20",
            "destination_name": "Comcast",
            "description": "Internet bill",
            "category_name": "Internet",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def test_comcast_rate_steps_merge_within_billing_anchor_stream():
    """Semi-monthly anchors: one row per stream, not per historical amount tier (#64)."""
    result = build_bill_suggestions(comcast_semi_monthly_fixture(), **_engine_kwargs())
    comcast_rows = [row for row in result["data"] if row.get("payee") == "Comcast"]
    assert len(comcast_rows) == 2
    amount_avgs = {row["amount_avg"] for row in comcast_rows}
    assert "118.00" in amount_avgs
    secondary = next(row for row in comcast_rows if row["amount_avg"] != "118.00")
    assert secondary["amount_min"] == "68.00"
    assert secondary["amount_max"] == "90.00"
    assert secondary["occurrences"] == 12


def test_parallel_same_amount_subscriptions_do_not_merge():
    rows: list[dict[str, Any]] = []
    services = ("Netflix", "Hulu", "Disney+", "Max", "Spotify")
    for service in services[:2]:
        for i in range(6):
            month = 7 + i
            year = 2025
            while month > 12:
                month -= 12
                year += 1
            rows.append({
                "type": "withdrawal",
                "amount": "15.99",
                "date": f"{year}-{month:02d}-05",
                "destination_name": service,
                "description": f"{service} subscription",
                "category_name": "Entertainment",
                "source_name": "Checking",
                "source_id": "checking",
                "source_type": "Asset account",
                "source_role": "Default asset",
            })
    for service in services[2:]:
        rows.append({
            "type": "withdrawal",
            "amount": "9.99",
            "date": "2025-08-01",
            "destination_name": service,
            "description": f"{service} subscription",
            "category_name": "Entertainment",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    result = build_bill_suggestions(rows, **_engine_kwargs())
    amount_1599 = [
        row for row in result["data"] if row.get("amount_avg") == "15.99"
    ]
    assert len(amount_1599) == 2


def test_category_ignore_casefold_and_alias():
    assert _category_is_ignored("GAS", ["gas"]) is True
    assert _category_is_ignored("Gasoline", ["Gas"]) is True
    assert _category_is_ignored("Restaurant", ["Restaurants"]) is True
    assert _category_is_ignored("Rent", ["Gas", "Groceries"]) is False


def test_payee_ignore_casefold():
    assert _payee_is_ignored("Spotify USA Inc", ["spotify usa inc"]) is True
    assert _payee_is_ignored("Spotify USA Inc", ["Netflix"]) is False
    assert _payee_is_ignored("", ["Spotify"]) is False


def test_spotify_excluded_when_payee_ignored():
    result = build_bill_suggestions(
        spotify_monthly_withdrawals(),
        **_engine_kwargs(ignored_payees=["Spotify USA Inc"]),
    )
    assert result["data"] == []


def test_spotify_includes_destination_name():
    result = build_bill_suggestions(
        spotify_monthly_withdrawals(),
        **_engine_kwargs(),
    )
    assert len(result["data"]) == 1
    assert result["data"][0]["destination_name"] == "Spotify USA Inc"


def arbys_multi_visit_fast_food(months: int = 6) -> list[dict[str, Any]]:
    """Realistic habit: several Arby's runs per month, not one monthly bill."""
    from tests.test_bill_discover_recurrence_matrix import multi_visit_restaurant
    return multi_visit_restaurant(months=months, destination="Arbys", category="Fast Food")


def test_arbys_multi_visit_not_suggested():
    result = build_bill_suggestions(arbys_multi_visit_fast_food(6), **_engine_kwargs())
    assert result["data"] == []


def test_arbys_excluded_when_category_ignored():
    from tests.test_bill_discover_recurrence_matrix import multi_visit_restaurant
    result = build_bill_suggestions(
        multi_visit_restaurant(destination="Arbys", category="Fast Food"),
        **_engine_kwargs(ignored_categories=["Fast Food"]),
    )
    assert result["data"] == []


def test_arbys_fast_food_not_suggested():
    """Alias for multi-visit fixture (statistical visit-style filter)."""
    result = build_bill_suggestions(arbys_multi_visit_fast_food(6), **_engine_kwargs())
    assert result["data"] == []


def _legacy_arbys_monthly_once(count: int = 6) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "12.47",
            "date": f"{year}-{month:02d}-08",
            "destination_name": "Arbys",
            "description": "Drive thru",
            "category_name": "Fast Food",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def variable_electricity_monthly(count: int = 12) -> list[dict[str, Any]]:
    amounts = (
        "82.15", "95.40", "88.22", "110.05", "91.33", "104.88",
        "87.60", "99.12", "93.45", "108.70", "85.90", "101.25",
    )
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
            "date": f"{year}-{month:02d}-12",
            "destination_name": "Eversource Energy",
            "description": "Electric bill",
            "category_name": "Electricity",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def mixed_utilities_trash_and_electric() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    electric_amounts = ("95.00", "110.00", "88.00", "102.00", "91.00", "105.00")
    for i in range(12):
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
        rows.append({
            "type": "withdrawal",
            "amount": electric_amounts[i % len(electric_amounts)],
            "date": f"{year}-{month:02d}-15",
            "destination_name": "Eversource Energy",
            "description": "Electric bill",
            "category_name": "Utilities",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def test_arbys_excluded_when_category_ignored_legacy_once_monthly():
    result = build_bill_suggestions(
        _legacy_arbys_monthly_once(6),
        **_engine_kwargs(ignored_categories=["Fast Food"]),
    )
    assert result["data"] == []


def entertainment_streaming_monthly(count: int = 12) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "15.99",
            "date": f"{year}-{month:02d}-03",
            "destination_name": "Hulu LLC",
            "description": "Subscription renewal",
            "category_name": "Entertainment",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def test_entertainment_subscription_not_blocked_by_discretionary():
    result = build_bill_suggestions(entertainment_streaming_monthly(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    assert "Hulu" in result["data"][0]["merchant"]


def cheap_app_subscription_monthly(count: int = 12) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(count):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append({
            "type": "withdrawal",
            "amount": "0.99",
            "date": f"{year}-{month:02d}-01",
            "destination_name": "Apple App Store",
            "description": "App subscription",
            "category_name": "App Subscriptions",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def small_variable_utility_monthly(count: int = 12) -> list[dict[str, Any]]:
    amounts = ("3.50", "4.25", "3.99", "4.10", "3.75", "4.00")
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
            "date": f"{year}-{month:02d}-05",
            "destination_name": "Town Water Dept",
            "description": "Water bill",
            "category_name": "Utilities",
            "source_name": "Checking",
            "source_id": "checking",
            "source_type": "Asset account",
            "source_role": "Default asset",
        })
    return rows


def test_cheap_app_subscription_suggested():
    result = build_bill_suggestions(cheap_app_subscription_monthly(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    assert abs(Decimal(result["data"][0]["amount_avg"]) - Decimal("0.99")) < Decimal("0.01")


def test_small_variable_utility_suggested():
    result = build_bill_suggestions(small_variable_utility_monthly(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    assert "Water" in result["data"][0]["merchant"] or "Town" in result["data"][0]["merchant"]


def test_variable_electricity_suggested():
    result = build_bill_suggestions(variable_electricity_monthly(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    assert "Eversource" in result["data"][0]["merchant"]


def test_mixed_utilities_trash_and_electric_both_suggested():
    result = build_bill_suggestions(mixed_utilities_trash_and_electric(), **_engine_kwargs())
    merchants = {row["merchant"] for row in result["data"]}
    assert len(result["data"]) == 2
    assert any("All American Waste" in m for m in merchants)
    assert any("Eversource" in m for m in merchants)


def test_noise_does_not_block_spotify():
    splits = spotify_monthly_withdrawals(12) + gas_station_noise(6) + restaurant_noise(6)
    result = build_bill_suggestions(
        splits,
        **_engine_kwargs(ignored_categories=DEFAULT_IGNORED_CATEGORIES),
    )
    assert len(result["data"]) == 1
    assert result["data"][0]["merchant"] == "Spotify"


def test_spotify_payee_grouping():
    result = build_bill_suggestions(spotify_monthly_withdrawals(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    suggestion = result["data"][0]
    assert suggestion["payee"] == "Spotify USA Inc"
    assert suggestion["bucket"] == suggestion["payee"]
    assert suggestion["merchant"] == "Spotify"


def test_spotify_varying_amounts_not_opaque():
    result = build_bill_suggestions(spotify_varying_amounts(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    suggestion = result["data"][0]
    assert suggestion["bucket"] == suggestion["payee"]
    assert suggestion["merchant"] == "Spotify"
    assert suggestion["status"] != "review" or "opaque_payee" not in suggestion.get("reasons", [])
    assert suggestion.get("notes") != OPAQUE_NOTES
    assert suggestion["register_prefill"]["category_name"] == "Music Streaming"


def test_all_american_waste_payee():
    result = build_bill_suggestions(all_american_waste_monthly(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    assert result["data"][0]["payee"] == "All American Waste"
    assert result["data"][0]["bucket"] == "All American Waste"


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
    assert prefill["amount_min"] == "22.15"
    assert prefill["amount_max"] == "22.15"


def test_monthly_recurring_prefill_uses_three_month_average():
    from payment_worksheet_bill_history import compute_trailing_monthly_average

    txns = [
        {"date": "2026-01-12", "amount": "10.00"},
        {"date": "2026-01-19", "amount": "5.00"},
        {"date": "2026-02-12", "amount": "12.00"},
        {"date": "2026-02-19", "amount": "6.00"},
        {"date": "2026-03-12", "amount": "8.00"},
        {"date": "2026-03-19", "amount": "4.00"},
    ]
    assert compute_trailing_monthly_average(txns, months=3) == Decimal("15.00")


def test_monthly_cluster_average_uses_available_months_when_under_three():
    from payment_worksheet_bill_history import compute_trailing_monthly_average

    txns = [
        {"date": "2026-02-01", "amount": "20.00"},
        {"date": "2026-03-01", "amount": "40.00"},
    ]
    assert compute_trailing_monthly_average(txns, months=3) == Decimal("30.00")


def test_backblaze_intermittent_prefill_keeps_padded_min_max():
    from tests.test_bill_discover_recurrence_matrix import backblaze_usage_billing

    result = build_bill_suggestions(backblaze_usage_billing(), **_engine_kwargs())
    assert result["data"]
    prefill = result["data"][0]["register_prefill"]
    assert prefill["amount_mode"] == "intermittent"
    assert prefill["amount_min"] != prefill["amount_max"]


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


def test_opaque_two_hit_subsplit_emits_stable_subgroups():
    """D-34-01 minimum trigger (2 fingerprints × 2 dates) must not return zero rows."""
    txns = [
        _opaque_txn(category="Cloud Storage", amount="10.09", date="2025-07-10"),
        _opaque_txn(category="Cloud Storage", amount="10.09", date="2025-08-10"),
        _opaque_txn(category="Ulysses App", amount="6.37", date="2025-07-15"),
        _opaque_txn(category="Ulysses App", amount="6.37", date="2025-08-15"),
    ]
    result = build_bill_suggestions(txns, **_engine_kwargs())
    merchants = {row["merchant"] for row in result["data"]}
    assert len(result["data"]) >= 2
    assert "Cloud Storage" in merchants
    assert "Ulysses App" in merchants
    assert all(row["cluster"] == "apple-com-bill" for row in result["data"])


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


def test_opaque_subgroup_amount_exactly_with_slight_variance():
    result = build_bill_suggestions(apple_services_slight_variance_fixture(), **_engine_kwargs())
    cloud = next(row for row in result["data"] if row["merchant"] == "Cloud Storage")
    assert cloud["register_prefill"]["amount_exactly"] is not None
    assert_valid_register_prefill(cloud["register_prefill"])


def test_opaque_friendly_payee_resolves_canonical_payee():
    result = build_bill_suggestions(apple_services_friendly_payee_fixture(), **_engine_kwargs())
    assert result["data"]
    assert all(row["payee"] == "APPLE.COM/BILL" for row in result["data"])
    assert all(row["bucket"] == row["payee"] for row in result["data"])
    assert all(row["cluster"] == "apple-com-bill" for row in result["data"])
    for row in result["data"]:
        if row["merchant"].endswith("(misc)"):
            continue
        assert row["register_prefill"]["destination_account"] == "APPLE.COM/BILL"


def test_opaque_generic_description_uses_firefly_payee():
    rows = apple_services_operator_fixture()
    for row in rows:
        row["destination_name"] = "Apple Services"
    resolved = _resolve_opaque_raw_payee(rows, "Apple Services")
    assert resolved == "Apple Services"


def test_opaque_resolver_ignores_junk_description_tokens():
    txns = [
        {
            "description": "DEAD PreApproved Payment Bill User Payment",
            "destination_name": "Apple Services",
        }
    ] * 12
    assert _resolve_opaque_raw_payee(txns, "Apple Services") == "Apple Services"


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


def test_sort_payee_confidence_occurrences():
    splits = (
        spotify_monthly_withdrawals(12)
        + all_american_waste_monthly(12)
        + low_confidence_quarterly(2)
    )
    result = build_bill_suggestions(splits, **_engine_kwargs())
    assert len(result["data"]) == 3
    payees = [row["payee"] for row in result["data"]]
    assert payees == sorted(payees, key=str.casefold)
    assert result["data"][0]["confidence"] == "high"
    high_conf = [row for row in result["data"] if row["confidence"] == "high"]
    assert high_conf
    assert high_conf[0]["occurrences"] >= 3


def test_opaque_payee_sort_alphabetically():
    splits = spotify_monthly_withdrawals(12) + apple_services_operator_fixture()
    result = build_bill_suggestions(splits, **_engine_kwargs())
    payees = [row["payee"] for row in result["data"]]
    apple_indices = [index for index, payee in enumerate(payees) if payee == "APPLE.COM/BILL"]
    spotify_indices = [
        index for index, payee in enumerate(payees) if "spotify" in payee.casefold()
    ]
    assert apple_indices and spotify_indices
    assert max(apple_indices) < min(spotify_indices)
    apple_rows = [row for row in result["data"] if row["payee"] == "APPLE.COM/BILL"]
    from itertools import groupby
    merchants = [row["merchant"] for row in apple_rows]
    assert len(merchants) == len(set(merchants))
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


def test_payee_field_matches_destination():
    splits = spotify_monthly_withdrawals(12) + all_american_waste_monthly(12)
    result = build_bill_suggestions(splits, **_engine_kwargs())
    payees = {row["merchant"]: row["payee"] for row in result["data"]}
    assert payees["Spotify"] == "Spotify USA Inc"
    assert payees["All American Waste"] == "All American Waste"
    for row in result["data"]:
        assert row["bucket"] == row["payee"]


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


def test_active_firefly_subscription_excluded_without_registry():
    kwargs = _engine_kwargs()
    kwargs["firefly_bills"] = [{"id": "14", "name": "Trash"}]
    rows = all_american_waste_monthly(12)
    for row in rows:
        row["subscription_id"] = "14"
    result = build_bill_suggestions(rows, **kwargs)
    assert result["data"] == []


def test_stale_deleted_subscription_link_still_suggested():
    """subscription_id on journal after Firefly bill deleted — not an active link."""
    kwargs = _engine_kwargs()
    kwargs["firefly_bills"] = [{"id": "22", "name": "Rent"}]
    rows = all_american_waste_monthly(12)
    for row in rows:
        row["subscription_id"] = "14"
        row["subscription_name"] = "Trash"
    result = build_bill_suggestions(rows, **kwargs)
    assert len(result["data"]) == 1
    assert "All American Waste" in result["data"][0]["merchant"]


def test_unlinked_recurring_still_suggested():
    result = build_bill_suggestions(spotify_monthly_withdrawals(12), **_engine_kwargs())
    assert len(result["data"]) == 1
    assert result["data"][0]["merchant"] == "Spotify"


def test_drilldown_not_found_returns_none():
    fixture = spotify_monthly_withdrawals(12)
    result = find_suggestion_transactions(
        fixture,
        **_engine_kwargs(),
        suggestion_id="sug-nonexistent0000",
    )
    assert result is None


def test_drilldown_opaque_subgroup_isolated():
    fixture = opaque_subsplit_fixture()
    built = build_bill_suggestions(fixture, **_engine_kwargs())
    cloud = next(row for row in built["data"] if row["merchant"].startswith("Cloud Storage"))
    txns = find_suggestion_transactions(
        fixture,
        **_engine_kwargs(),
        suggestion_id=cloud["id"],
    )
    assert txns is not None
    amounts = {t["amount"] for t in txns}
    assert amounts == {"10.09"}
    assert all(t["category"] == "Cloud Storage" for t in txns)
    assert "6.37" not in amounts
    assert "7.43" not in amounts


def test_drilldown_regular_returns_all_withdrawals_sorted():
    fixture = spotify_monthly_withdrawals(12)
    built = build_bill_suggestions(fixture, **_engine_kwargs())
    spotify_id = built["data"][0]["id"]
    txns = find_suggestion_transactions(
        fixture,
        **_engine_kwargs(),
        suggestion_id=spotify_id,
    )
    assert txns is not None
    assert len(txns) == 12
    dates = [t["date"] for t in txns]
    assert dates == sorted(dates, reverse=True)


def test_drilldown_fields_include_required_keys():
    fixture = spotify_monthly_withdrawals(12)
    built = build_bill_suggestions(fixture, **_engine_kwargs())
    spotify_id = built["data"][0]["id"]
    txns = find_suggestion_transactions(
        fixture,
        **_engine_kwargs(),
        suggestion_id=spotify_id,
    )
    assert txns is not None
    required = {"date", "amount", "description", "category", "payee", "budget"}
    for txn in txns:
        assert required.issubset(txn.keys())
        assert txn["category"] == "Music Streaming"
        assert txn["payee"] == "Spotify USA Inc"


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
