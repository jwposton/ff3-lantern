"""Tests for demo anchor clock (FF3LANTERN_DEMO_ANCHOR_DATE)."""

from datetime import date, datetime, timezone

import pytest


def test_demo_anchor_date_unset(monkeypatch):
    monkeypatch.delenv("FF3LANTERN_DEMO_ANCHOR_DATE", raising=False)
    import importlib

    import app_clock

    importlib.reload(app_clock)
    assert app_clock.demo_anchor_date() is None
    assert app_clock.today() == date.today()
    assert app_clock.current_month_key() == date.today().strftime("%Y-%m")


def test_demo_anchor_date_set(monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DEMO_ANCHOR_DATE", "2026-07-05")
    import importlib

    import app_clock

    importlib.reload(app_clock)
    assert app_clock.demo_anchor_date_str() == "2026-07-05"
    assert app_clock.today() == date(2026, 7, 5)
    assert app_clock.current_month_key() == "2026-07"
    assert app_clock.now_utc() == datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)
