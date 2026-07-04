"""Tests for bill history aggregation (PAY-21)."""

from __future__ import annotations

from datetime import date

from payment_worksheet_bill_history import (
    bill_history_date_window,
    compute_bill_history_stats,
)


def test_bill_history_date_window_span():
    start, end = bill_history_date_window(date(2026, 7, 3))
    assert start == "2025-08-01"
    assert end == "2026-07-03"


def test_bill_history_date_window_year_rollover():
    start, end = bill_history_date_window(date(2026, 2, 15))
    assert start == "2025-03-01"
    assert end == "2026-02-15"


def test_calendar_average_divides_by_twelve():
    rows = [{"date": "2026-01-15", "amount": "100.00"}]
    stats = compute_bill_history_stats(rows)
    assert stats["total"] == "100.00"
    assert stats["calendar_average"] == "8.33"
    assert stats["active_month_average"] == "100.00"
    assert stats["active_month_count"] == 1


def test_active_month_average_excludes_zero_months():
    rows = [
        {"date": "2026-01-10", "amount": "60.00"},
        {"date": "2026-03-10", "amount": "40.00"},
    ]
    stats = compute_bill_history_stats(rows)
    assert stats["total"] == "100.00"
    assert stats["calendar_average"] == "8.33"
    assert stats["active_month_average"] == "50.00"
    assert stats["active_month_count"] == 2


def test_intermittent_oil():
    rows = [
        {"date": "2026-01-05", "amount": "-200.00"},
        {"date": "2026-01-20", "amount": "-150.00"},
        {"date": "2026-06-10", "amount": "-250.00"},
    ]
    stats = compute_bill_history_stats(rows)
    assert stats["total"] == "600.00"
    assert stats["calendar_average"] == "50.00"
    assert stats["active_month_average"] == "300.00"
    assert stats["active_month_count"] == 2
    assert len(stats["monthly_totals"]) == 2
    assert stats["monthly_totals"][0] == {"month": "2026-01", "total": "350.00"}
    assert stats["monthly_totals"][1] == {"month": "2026-06", "total": "250.00"}


def test_empty_history():
    stats = compute_bill_history_stats([])
    assert stats["total"] == "0.00"
    assert stats["calendar_average"] == "0.00"
    assert stats["active_month_average"] == "0.00"
    assert stats["active_month_count"] == 0
    assert stats["monthly_totals"] == []
