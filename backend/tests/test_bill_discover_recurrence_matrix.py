"""Recurrence matrix for bill discover — positive/negative exemplars (#52–#54).

Each case documents *why* the engine should or should not emit a suggestion.
Operator category ignores are empty unless the case explicitly tests that path.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable

import pytest

from payment_worksheet_bill_suggestions import (
    _is_recurring_candidate,
    _is_visit_style_spending,
    build_bill_suggestions,
)
from tests.test_payment_worksheet_bill_suggestions import (
    _engine_kwargs,
    all_american_waste_monthly,
    apple_services_operator_fixture,
    cheap_app_subscription_monthly,
    empty_accounts,
    entertainment_streaming_monthly,
    spotify_monthly_withdrawals,
    variable_electricity_monthly,
)


def _withdrawal(
    *,
    amount: str,
    date: str,
    destination: str,
    category: str,
    description: str = "",
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


def multi_visit_restaurant(
    *,
    destination: str = "Arbys",
    category: str = "Fast Food",
    months: int = 6,
    visits_per_month: int = 3,
) -> list[dict[str, Any]]:
    """2–3 variable visits per month — habit, not one bill per cycle."""
    amounts = ("8.99", "11.47", "13.20", "9.75", "12.05", "10.50")
    visit_days = (3, 12, 22)[:visits_per_month]
    rows: list[dict[str, Any]] = []
    for i in range(months):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        for day in visit_days:
            idx = i * len(visit_days) + visit_days.index(day)
            rows.append(
                _withdrawal(
                    amount=amounts[idx % len(amounts)],
                    date=f"{year}-{month:02d}-{day:02d}",
                    destination=destination,
                    category=category,
                    description="Drive thru",
                )
            )
    return rows


def once_per_month_same_payee(
    *,
    destination: str,
    category: str,
    amount: str,
    months: int = 12,
    day: int = 8,
) -> list[dict[str, Any]]:
    """Exactly one charge per calendar month (subscription / bill shape)."""
    rows: list[dict[str, Any]] = []
    for i in range(months):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append(
            _withdrawal(
                amount=amount,
                date=f"{year}-{month:02d}-{day:02d}",
                destination=destination,
                category=category,
            )
        )
    return rows


def biweekly_payroll_deduction(months: int = 6) -> list[dict[str, Any]]:
    """Every 14 days — some months have two charges; not visit-style."""
    rows: list[dict[str, Any]] = []
    day = 7
    month = 7
    year = 2025
    for _ in range(months * 2):
        rows.append(
            _withdrawal(
                amount="25.00",
                date=f"{year}-{month:02d}-{day:02d}",
                destination="Gym Membership",
                category="Health & Fitness",
                description="Biweekly draft",
            )
        )
        day += 14
        while day > 28:
            day -= 28
            month += 1
            if month > 12:
                month = 1
                year += 1
    return rows


def electric_duplicate_one_month() -> list[dict[str, Any]]:
    """One month double-charged; other months single — still a bill."""
    rows = variable_electricity_monthly(12)
    rows.append(
        _withdrawal(
            amount="95.00",
            date="2025-08-20",
            destination="Eversource Energy",
            category="Electricity",
            description="Duplicate autopay retry",
        )
    )
    return rows


def rent_payee_rename_monthly(months: int = 12) -> list[dict[str, Any]]:
    """Quiet-category merge: same amount, landlord renamed mid-year."""
    rows: list[dict[str, Any]] = []
    payees = ("Property Mgmt LLC", "New Landlord Inc")
    for i in range(months):
        month = 7 + i
        year = 2025
        while month > 12:
            month -= 12
            year += 1
        rows.append(
            _withdrawal(
                amount="1200.00",
                date=f"{year}-{month:02d}-01",
                destination=payees[i % len(payees)],
                category="Rent",
                description="Monthly rent",
            )
        )
    return rows


def suggest_count(rows: list[dict[str, Any]], **engine_kwargs: Any) -> int:
    kwargs = _engine_kwargs()
    kwargs.update(engine_kwargs)
    return len(build_bill_suggestions(rows, **kwargs)["data"])


# --- Unit tests for visit-style helper ---


def test_visit_style_detects_multi_visit_months():
    txns = multi_visit_restaurant(months=6, visits_per_month=3)
    assert _is_visit_style_spending(txns) is True


def test_visit_style_allows_monthly_subscription():
    txns = once_per_month_same_payee(
        destination="Spotify USA Inc",
        category="Music Streaming",
        amount="22.15",
    )
    assert _is_visit_style_spending(txns) is False


def test_visit_style_allows_single_duplicate_month():
    txns = electric_duplicate_one_month()
    assert _is_visit_style_spending(txns) is False


def test_visit_style_skips_steady_biweekly_cadence():
    txns = biweekly_payroll_deduction()
    from payment_worksheet_bill_suggestions import _analyze_group

    metrics = _analyze_group("gym", [t | {"amount": Decimal(t["amount"])} for t in txns])
    assert metrics is not None
    assert _is_visit_style_spending(txns, metrics=metrics) is False


def test_visit_style_detects_twice_monthly_coffee():
    txns = multi_visit_restaurant(
        destination="Starbucks",
        category="Coffee",
        visits_per_month=2,
    )
    from payment_worksheet_bill_suggestions import _analyze_group

    metrics = _analyze_group("sb", [t | {"amount": Decimal(t["amount"])} for t in txns])
    assert metrics is not None
    assert _is_visit_style_spending(txns, metrics=metrics) is True


def test_visit_style_skips_billing_anchor_cyclicality():
    """Semi-monthly billing on stable calendar days — not visit-style."""
    txns = backblaze_usage_billing()
    from payment_worksheet_bill_suggestions import _analyze_group

    metrics = _analyze_group("Backblaze", [t | {"amount": Decimal(t["amount"])} for t in txns])
    assert metrics is not None
    assert _is_visit_style_spending(txns, metrics=metrics) is False


def test_visit_style_anchor_cyclicality_ignores_category():
    """Anchor-day detection is statistical — category label does not gate it."""
    txns = backblaze_usage_billing()
    for txn in txns:
        txn["category_name"] = "Fast Food"
    from payment_worksheet_bill_suggestions import _analyze_group

    metrics = _analyze_group("Backblaze", [t | {"amount": Decimal(t["amount"])} for t in txns])
    assert metrics is not None
    assert _is_visit_style_spending(txns, metrics=metrics) is False


def backblaze_usage_billing() -> list[dict[str, Any]]:
    """Two usage charges most months; one month with three — real Backblaze shape."""
    rows: list[dict[str, Any]] = []
    charges = [
        ("2025-07-12", "1.31"),
        ("2025-07-19", "2.89"),
        ("2025-08-12", "1.35"),
        ("2025-08-19", "3.08"),
        ("2025-09-12", "1.29"),
        ("2025-09-19", "2.62"),
        ("2025-10-12", "1.39"),
        ("2025-10-19", "3.42"),
        ("2025-11-12", "1.25"),
        ("2025-11-19", "2.53"),
        ("2025-12-12", "1.06"),
        ("2025-12-19", "2.50"),
        ("2026-01-12", "1.31"),
        ("2026-01-19", "2.89"),
        ("2026-01-24", "0.96"),
    ]
    for date, amount in charges:
        rows.append(
            _withdrawal(
                amount=amount,
                date=date,
                destination="Backblaze",
                category="Cloud Storage",
                description="BACKBLAZE INC",
            )
        )
    return rows


def cursor_usage_billing() -> list[dict[str, Any]]:
    """AI usage line items — multiple mid-month charges, not restaurant visits."""
    charges = [
        ("2026-03-22", "21.27"),
        ("2026-03-26", "21.96"),
        ("2026-04-22", "42.84"),
        ("2026-04-28", "64.48"),
        ("2026-05-22", "21.27"),
        ("2026-05-26", "21.96"),
        ("2026-05-28", "42.84"),
        ("2026-06-02", "64.48"),
        ("2026-06-22", "21.27"),
        ("2026-06-24", "76.14"),
    ]
    return [
        _withdrawal(
            amount=amount,
            date=date,
            destination="Cursor",
            category="AI Subscription",
            description="CURSOR USAGE",
        )
        for date, amount in charges
    ]


def ionos_annual_hosting() -> list[dict[str, Any]]:
    """Two renewals ~11 months apart — sparse annual hosting."""
    return [
        _withdrawal(
            amount="72.61",
            date="2025-07-17",
            destination="IONOS Inc.",
            category="WebHost",
            description="PreApproved Payment Bill User Payment",
        ),
        _withdrawal(
            amount="24.63",
            date="2026-06-01",
            destination="IONOS Inc.",
            category="WebHost",
            description="PreApproved Payment Bill User Payment",
        ),
    ]

def heating_oil_seasonal() -> list[dict[str, Any]]:
    """Oct–Mar deliveries, irregular calendar cadence, varying fill amounts."""
    deliveries = [
        ("2025-10-15", "425.00"),
        ("2025-11-02", "380.00"),
        ("2025-11-28", "410.00"),
        ("2025-12-20", "395.00"),
        ("2026-01-10", "440.00"),
        ("2026-01-25", "365.00"),
        ("2026-02-08", "420.00"),
        ("2026-03-05", "390.00"),
    ]
    return [
        _withdrawal(
            amount=amount,
            date=date,
            destination="ABC Fuel Oil Co",
            category="Heating Oil",
            description="Heating oil delivery",
        )
        for date, amount in deliveries
    ]


def heating_oil_cold_snap_january() -> list[dict[str, Any]]:
    """Three fill-ups in one cold month — high dollar, not visit-style."""
    return [
        _withdrawal(
            amount=amount,
            date=date,
            destination="ABC Fuel Oil Co",
            category="Heating Oil",
            description="Heating oil delivery",
        )
        for date, amount in (
            ("2026-01-05", "400.00"),
            ("2026-01-15", "380.00"),
            ("2026-01-28", "420.00"),
            ("2026-02-20", "390.00"),
        )
    ]


POSITIVE_CASES: list[tuple[str, Callable[[], list[dict[str, Any]]], str]] = [
    (
        "spotify_monthly_fixed",
        lambda: spotify_monthly_withdrawals(12),
        "Stable monthly streaming; one hit per month",
    ),
    (
        "cheap_app_subscription",
        lambda: cheap_app_subscription_monthly(12),
        "$0.99/mo app sub; amount is not a gate",
    ),
    (
        "variable_electricity",
        lambda: variable_electricity_monthly(12),
        "Utility bill; amount varies, one charge per month",
    ),
    (
        "trash_pickup",
        lambda: all_american_waste_monthly(12),
        "Fixed municipal trash; ~$39/mo",
    ),
    (
        "entertainment_streaming",
        lambda: entertainment_streaming_monthly(12),
        "Hulu in Entertainment — not category-blocked",
    ),
    (
        "rent_payee_rename",
        rent_payee_rename_monthly,
        "Quiet category fingerprint merge across payee rename",
    ),
    (
        "electric_duplicate_month",
        electric_duplicate_one_month,
        "One double-charged month is not visit-style",
    ),
    (
        "apple_opaque_subgroups",
        apple_services_operator_fixture,
        "Opaque payee splits into stable per-category rows",
    ),
    (
        "biweekly_gym",
        biweekly_payroll_deduction,
        "Biweekly cadence; two hits in some months is OK",
    ),
    (
        "heating_oil_seasonal",
        heating_oil_seasonal,
        "Seasonal irregular freq; spacing among deliveries is steady",
    ),
    (
        "heating_oil_cold_snap",
        heating_oil_cold_snap_january,
        "Three fill-ups in January; high dollar not visit-style",
    ),
    (
        "backblaze_usage_billing",
        backblaze_usage_billing,
        "Cloud storage usage — multiple hits/month not visit-style",
    ),
    (
        "cursor_usage_billing",
        cursor_usage_billing,
        "AI usage line items — biweekly SaaS cluster",
    ),
    (
        "ionos_annual_hosting",
        ionos_annual_hosting,
        "Two annual renewals ~11 months apart",
    ),
]


@pytest.mark.parametrize(("case_id", "fixture_fn", "reason"), POSITIVE_CASES)
def test_matrix_positive_should_suggest(case_id: str, fixture_fn, reason: str):
    _ = reason
    rows = fixture_fn()
    assert suggest_count(rows) >= 1, f"{case_id}: expected suggestion"


# --- Matrix: should NOT emit (negative) ---


NEGATIVE_CASES: list[tuple[str, Callable[[], list[dict[str, Any]]], str]] = [
    (
        "arbys_multi_visit",
        lambda: multi_visit_restaurant(destination="Arbys", category="Fast Food"),
        "3 visits/month; varying amounts; not one bill",
    ),
    (
        "local_diner_multi_visit",
        lambda: multi_visit_restaurant(
            destination="Local Diner",
            category="Restaurants",
        ),
        "Restaurant habit same shape as fast food",
    ),
    (
        "starbucks_multi_visit",
        lambda: multi_visit_restaurant(
            destination="Starbucks",
            category="Coffee",
            visits_per_month=2,
        ),
        "2+ coffee runs per month in most months",
    ),
    (
        "single_transaction",
        lambda: [_withdrawal(
            amount="50.00",
            date="2025-08-01",
            destination="One Off Co",
            category="Utilities",
        )],
        "Need at least two dated hits to analyze",
    ),
    (
        "heating_oil_only_two_deliveries",
        lambda: [
            _withdrawal(
                amount="400.00",
                date="2025-12-01",
                destination="ABC Fuel Oil Co",
                category="Heating Oil",
            ),
            _withdrawal(
                amount="420.00",
                date="2026-02-01",
                destination="ABC Fuel Oil Co",
                category="Heating Oil",
            ),
        ],
        "Fewer than three deliveries in lookback",
    ),
]


@pytest.mark.parametrize(("case_id", "fixture_fn", "reason"), NEGATIVE_CASES)
def test_matrix_negative_should_not_suggest(case_id: str, fixture_fn, reason: str):
    _ = reason
    rows = fixture_fn()
    assert suggest_count(rows) == 0, f"{case_id}: expected no suggestions"


# --- Edge cases (documented behavior) ---


def test_edge_once_per_month_restaurant_may_suggest_without_ignore():
    """Unusual but possible: exactly one fast-food charge every month.

    Visit-style rule does not fire; operator can add category to ignore list.
    """
    rows = once_per_month_same_payee(
        destination="Arbys",
        category="Fast Food",
        amount="12.47",
        months=6,
    )
    assert suggest_count(rows) >= 1


def test_edge_operator_ignore_still_drops_category():
    rows = once_per_month_same_payee(
        destination="Arbys",
        category="Fast Food",
        amount="12.47",
        months=6,
    )
    assert suggest_count(rows, ignored_categories=["Fast Food"]) == 0
