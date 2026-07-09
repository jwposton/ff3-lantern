"""Tests for intermittent bill forecast engine (WS-04–WS-06, #95)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from payment_worksheet_bill_forecast import (
    compute_intermittent_bill_forecast,
    resolve_intermittent_owed,
)
from payment_worksheet_bill_history import bill_history_date_window
from payment_worksheet_bill_suggestions import _classify_freq


def _row(payment_date: str, amount: str) -> dict:
    return {"date": payment_date, "amount": amount}


def two_winter_seasonal_rows() -> list[dict]:
    """Oct–Mar deliveries across two winters — varying amounts, no category strings."""
    deliveries = [
        ("2024-10-15", "425.00"),
        ("2024-11-02", "380.00"),
        ("2024-12-20", "395.00"),
        ("2025-01-10", "440.00"),
        ("2025-02-08", "420.00"),
        ("2025-03-05", "390.00"),
        ("2025-10-15", "425.00"),
        ("2025-11-02", "380.00"),
        ("2025-11-28", "410.00"),
        ("2025-12-20", "395.00"),
        ("2026-01-10", "440.00"),
        ("2026-01-25", "365.00"),
        ("2026-02-08", "420.00"),
        ("2026-03-05", "390.00"),
    ]
    return [_row(d, a) for d, a in deliveries]


def propane_bimonthly_rows() -> list[dict]:
    """Propane-like every-other-month pattern (~56-day gaps, UAT #95)."""
    deliveries = [
        ("2025-11-15", "200.86"),
        ("2026-01-10", "201.20"),
        ("2026-03-07", "199.50"),
        ("2026-05-02", "200.10"),
        ("2026-07-01", "200.86"),
    ]
    return [_row(d, a) for d, a in deliveries]


def bimonthly_rows_with_monthly_repeat_freq() -> list[dict]:
    """Five payments on ~56-day gaps for repeat_freq override test."""
    return [
        _row("2025-09-01", "150.00"),
        _row("2025-10-27", "155.00"),
        _row("2025-12-22", "152.00"),
        _row("2026-02-16", "148.00"),
        _row("2026-04-13", "151.00"),
    ]


def monthly_rows_spanning_24_months() -> list[dict]:
    return [
        _row("2024-08-01", "90.00"),
        _row("2024-09-01", "92.00"),
        _row("2024-10-01", "88.00"),
        _row("2024-11-01", "91.00"),
        _row("2024-12-01", "89.00"),
        _row("2025-01-01", "93.00"),
        _row("2025-02-01", "87.00"),
        _row("2025-03-01", "90.00"),
        _row("2025-04-01", "92.00"),
        _row("2025-05-01", "88.00"),
        _row("2025-06-01", "91.00"),
        _row("2025-07-01", "89.00"),
        _row("2025-08-01", "90.00"),
        _row("2025-09-01", "92.00"),
        _row("2025-10-01", "88.00"),
        _row("2025-11-01", "91.00"),
        _row("2025-12-01", "89.00"),
        _row("2026-01-01", "93.00"),
        _row("2026-02-01", "87.00"),
        _row("2026-03-01", "90.00"),
        _row("2026-04-01", "92.00"),
        _row("2026-05-01", "88.00"),
        _row("2026-06-01", "91.00"),
        _row("2026-07-01", "89.00"),
    ]


def test_bill_history_date_window_default_still_12_months() -> None:
    start, end = bill_history_date_window(date(2026, 7, 3))
    assert start == "2025-07-01"
    assert end == "2026-07-03"


def test_bill_history_date_window_accepts_24_months() -> None:
    start, end = bill_history_date_window(date(2026, 7, 3), months=24)
    assert start == "2024-07-01"
    assert end == "2026-07-03"


def test_fewer_than_two_payments_unknown() -> None:
    forecast = compute_intermittent_bill_forecast(
        [_row("2026-01-10", "400.00")],
        month="2026-07",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    assert forecast["likelihood"] == "unknown"
    assert forecast["suggested_amount"] is None
    assert resolve_intermittent_owed(forecast, [_row("2026-01-10", "400.00")], "2026-07") == "0.00"


def test_irregular_non_seasonal_emits_possible() -> None:
    rows = [
        _row("2026-01-05", "150.00"),
        _row("2026-02-19", "175.00"),
        _row("2026-04-10", "160.00"),
    ]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-07",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    assert forecast["likelihood"] == "possible"
    assert forecast["suggested_amount"] is not None
    assert "planned_amount" not in forecast


def test_monthly_repeat_freq_lookback_months_12_even_with_24mo_rows() -> None:
    forecast = compute_intermittent_bill_forecast(
        monthly_rows_spanning_24_months(),
        month="2026-07",
        repeat_freq="monthly",
        today=date(2026, 7, 15),
    )
    assert forecast["lookback_months"] == 12
    assert forecast["likelihood"] in {"likely", "possible"}
    assert forecast["suggested_amount"] is not None


def test_annual_repeat_freq_lookback_months_24() -> None:
    rows = [
        _row("2024-07-01", "120.00"),
        _row("2025-07-01", "125.00"),
        _row("2026-07-01", "130.00"),
    ]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-07",
        repeat_freq="yearly",
        today=date(2026, 7, 15),
    )
    assert forecast["lookback_months"] == 24


def test_two_year_seasonal_july_unlikely() -> None:
    rows = two_winter_seasonal_rows()
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-07",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    assert forecast["seasonal"]["detected"] is True
    assert forecast["likelihood"] == "unlikely"
    assert forecast["suggested_amount"] is None
    assert forecast["lookback_months"] == 24


def test_two_year_seasonal_in_season_month_suggests_amount() -> None:
    rows = two_winter_seasonal_rows()
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-01",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    assert forecast["seasonal"]["detected"] is True
    assert forecast["likelihood"] in {"likely", "possible"}
    assert forecast["suggested_amount"] is not None
    assert Decimal(forecast["suggested_amount"]) > 0


def test_sparse_single_season_unknown() -> None:
    rows = [
        _row("2025-10-15", "425.00"),
        _row("2025-11-28", "380.00"),
        _row("2026-01-05", "395.00"),
        _row("2026-02-20", "440.00"),
        _row("2026-03-15", "420.00"),
    ]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-01",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    assert forecast["seasonal"]["detected"] is False
    assert forecast["likelihood"] == "unknown"
    assert forecast["suggested_amount"] is None


def test_resolve_intermittent_owed_posted_month_wins() -> None:
    rows = [
        _row("2026-01-05", "400.00"),
        _row("2026-01-15", "380.00"),
        _row("2026-02-20", "390.00"),
    ]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-01",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    owed = resolve_intermittent_owed(forecast, rows, "2026-01")
    assert owed == "780.00"
    assert forecast is not None


def test_resolve_likely_populates_suggested_when_no_posting() -> None:
    rows = [
        _row("2026-01-05", "400.00"),
        _row("2026-02-20", "390.00"),
    ]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-07",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    if forecast["likelihood"] in {"likely", "possible"} and forecast["suggested_amount"]:
        owed = resolve_intermittent_owed(forecast, rows, "2026-07")
        assert owed == forecast["suggested_amount"]
    else:
        assert resolve_intermittent_owed(forecast, rows, "2026-07") == "0.00"


def test_forecast_module_has_no_sidecar_or_firefly_imports() -> None:
    import payment_worksheet_bill_forecast as mod

    source_path = mod.__file__
    assert source_path is not None
    text = open(source_path, encoding="utf-8").read()
    assert "sidecar_db" not in text
    assert "FireflyClient" not in text


def test_classify_freq_bimonthly_bucket() -> None:
    assert _classify_freq(56.0) == "bimonthly"
    assert _classify_freq(52.0) == "bimonthly"
    assert _classify_freq(68.0) == "bimonthly"
    assert _classify_freq(30.0) == "monthly"
    assert _classify_freq(15.0) == "biweekly"
    assert _classify_freq(90.0) == "quarterly"
    assert _classify_freq(51.9) == "irregular"
    assert _classify_freq(68.1) == "irregular"


def test_gap_cadence_overrides_monthly_repeat_freq() -> None:
    rows = bimonthly_rows_with_monthly_repeat_freq()
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-06",
        repeat_freq="monthly",
        today=date(2026, 7, 15),
    )
    assert forecast["cadence_label"] == "bimonthly"
    assert forecast["lookback_months"] == 12


def test_bimonthly_lookback_months_12() -> None:
    rows = propane_bimonthly_rows()[:-1]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-07",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    assert forecast["lookback_months"] == 12
    assert forecast["cadence_label"] == "bimonthly"


def test_propane_bimonthly_on_month_likely() -> None:
    rows = propane_bimonthly_rows()[:-1]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-07",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    assert forecast["likelihood"] == "likely"
    assert forecast["suggested_amount"] is not None
    assert forecast["cadence_label"] == "bimonthly"
    assert Decimal(forecast["suggested_amount"]) > 0


def test_propane_bimonthly_off_month_unlikely() -> None:
    rows = propane_bimonthly_rows()[:-1]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-08",
        repeat_freq=None,
        today=date(2026, 8, 15),
    )
    assert forecast["likelihood"] == "unlikely"
    assert forecast["suggested_amount"] is None
    assert forecast["cadence_label"] == "bimonthly-off-month"


def test_propane_bimonthly_resolve_owed_populates_due() -> None:
    rows = propane_bimonthly_rows()[:-1]
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-07",
        repeat_freq=None,
        today=date(2026, 7, 15),
    )
    assert forecast["likelihood"] == "likely"
    owed = resolve_intermittent_owed(forecast, rows, "2026-07")
    assert owed != "0.00"
    assert Decimal(owed) > 0


def test_repeat_freq_monthly_does_not_override_bimonthly_gaps() -> None:
    rows = bimonthly_rows_with_monthly_repeat_freq()
    forecast = compute_intermittent_bill_forecast(
        rows,
        month="2026-06",
        repeat_freq="monthly",
        today=date(2026, 7, 15),
    )
    assert forecast["cadence_label"] == "bimonthly"
    assert forecast["likelihood"] == "likely"
    assert forecast["suggested_amount"] is not None
