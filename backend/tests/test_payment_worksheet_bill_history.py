"""Tests for bill history aggregation (PAY-21)."""

from __future__ import annotations

from datetime import date

from payment_worksheet_bill_history import (
    bill_history_date_window,
    bill_history_stats_month_range,
    compute_bill_history_stats,
    rows_have_current_month_payment,
)


def test_bill_history_date_window_span():
    start, end = bill_history_date_window(date(2026, 7, 3))
    assert start == "2025-07-01"
    assert end == "2026-07-03"


def test_bill_history_date_window_year_rollover():
    start, end = bill_history_date_window(date(2026, 2, 15))
    assert start == "2025-02-01"
    assert end == "2026-02-15"


def test_bill_history_stats_month_range_when_current_month_has_payment():
    start, end = bill_history_stats_month_range(
        date(2026, 7, 3),
        current_month_has_payment=True,
    )
    assert start == "2025-08"
    assert end == "2026-07"


def test_bill_history_stats_month_range_when_current_month_empty():
    start, end = bill_history_stats_month_range(
        date(2026, 7, 3),
        current_month_has_payment=False,
    )
    assert start == "2025-07"
    assert end == "2026-06"


def test_bill_history_stats_month_range_year_rollover_with_current_month():
    start, end = bill_history_stats_month_range(
        date(2026, 2, 15),
        current_month_has_payment=True,
    )
    assert start == "2025-03"
    assert end == "2026-02"


def test_bill_history_stats_month_range_year_rollover_without_current_month():
    start, end = bill_history_stats_month_range(
        date(2026, 2, 15),
        current_month_has_payment=False,
    )
    assert start == "2025-02"
    assert end == "2026-01"


def test_rows_have_current_month_payment():
    rows = [
        {"date": "2026-06-01", "amount": "100.00"},
        {"date": "2026-07-01", "amount": "50.00"},
    ]
    assert rows_have_current_month_payment(rows, today=date(2026, 7, 3)) is True
    assert rows_have_current_month_payment(rows[:1], today=date(2026, 7, 3)) is False


def test_stats_keeps_oldest_when_current_month_empty():
    rows = [
        {"date": "2025-07-02", "amount": "2100.00"},
        {"date": "2026-06-01", "amount": "2100.00"},
    ]
    stats = compute_bill_history_stats(rows, today=date(2026, 7, 3))
    assert stats["total"] == "4200.00"
    assert stats["calendar_average"] == "350.00"
    assert stats["active_month_count"] == 2


def test_stats_drops_oldest_when_current_month_has_payment():
    rows = [
        {"date": "2025-07-02", "amount": "2100.00"},
        {"date": "2026-06-01", "amount": "2100.00"},
        {"date": "2026-07-01", "amount": "2100.00"},
    ]
    stats = compute_bill_history_stats(rows, today=date(2026, 7, 3))
    assert stats["total"] == "4200.00"
    assert stats["calendar_average"] == "350.00"
    assert stats["active_month_count"] == 2


def test_stats_use_twelve_months_dropping_oldest_not_thirteen():
    rows = [
        {"date": f"2025-{month:02d}-01", "amount": "100.00"}
        for month in range(7, 13)
    ] + [
        {"date": f"2026-{month:02d}-01", "amount": "100.00"}
        for month in range(1, 8)
    ]
    stats = compute_bill_history_stats(rows, today=date(2026, 7, 3))
    assert stats["total"] == "1200.00"
    assert stats["calendar_average"] == "100.00"
    assert stats["active_month_count"] == 12


def test_calendar_average_divides_by_twelve():
    rows = [{"date": "2026-01-15", "amount": "100.00"}]
    stats = compute_bill_history_stats(rows, today=date(2026, 7, 3))
    assert stats["total"] == "100.00"
    assert stats["calendar_average"] == "8.33"
    assert stats["active_month_average"] == "100.00"
    assert stats["active_month_count"] == 1


def test_active_month_average_excludes_zero_months():
    rows = [
        {"date": "2026-01-10", "amount": "60.00"},
        {"date": "2026-03-10", "amount": "40.00"},
    ]
    stats = compute_bill_history_stats(rows, today=date(2026, 7, 3))
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
    stats = compute_bill_history_stats(rows, today=date(2026, 7, 3))
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
