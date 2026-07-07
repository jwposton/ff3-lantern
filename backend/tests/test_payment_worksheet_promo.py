"""Tests for credit card promotional APR window resolution (#107)."""

from __future__ import annotations

import pytest

from payment_worksheet_promo import (
    promo_active_for_month,
    resolve_credit_card_promo,
    validate_promo_bundle,
)


@pytest.mark.parametrize(
    ("month_key", "start", "end", "expected"),
    [
        ("2026-06", "2026-07-01", "2026-09-30", False),
        ("2026-07", "2026-07-01", "2026-09-30", True),
        ("2026-08", "2026-07-15", "2026-08-10", True),
        ("2026-10", "2026-07-01", "2026-09-30", False),
        ("2026-07", "2026-07-31", "2026-07-31", True),
    ],
)
def test_promo_active_for_month_boundaries(
    month_key: str, start: str, end: str, expected: bool
) -> None:
    assert promo_active_for_month(month_key, start, end) is expected


def test_resolve_credit_card_promo_inactive_when_partial_profile() -> None:
    profile = {"apr_percent": "24.99", "special_apr_percent": "0.00"}
    resolved = resolve_credit_card_promo(profile, "2026-07")
    assert resolved == {
        "promo_active": False,
        "effective_apr_percent": "24.99",
    }


def test_resolve_credit_card_promo_active_in_window() -> None:
    profile = {
        "apr_percent": "24.99",
        "special_apr_percent": "0.00",
        "special_apr_start": "2026-07-01",
        "special_apr_end": "2026-09-30",
    }
    resolved = resolve_credit_card_promo(profile, "2026-07")
    assert resolved == {
        "promo_active": True,
        "effective_apr_percent": "0.00",
    }


def test_resolve_credit_card_promo_inactive_outside_window() -> None:
    profile = {
        "apr_percent": "24.99",
        "special_apr_percent": "0.00",
        "special_apr_start": "2026-07-01",
        "special_apr_end": "2026-09-30",
    }
    resolved = resolve_credit_card_promo(profile, "2026-06")
    assert resolved == {
        "promo_active": False,
        "effective_apr_percent": "24.99",
    }


def test_resolve_credit_card_promo_null_apr_percent() -> None:
    profile = {
        "apr_percent": None,
        "special_apr_percent": "0.00",
        "special_apr_start": "2026-07-01",
        "special_apr_end": "2026-09-30",
    }
    resolved = resolve_credit_card_promo(profile, "2026-06")
    assert resolved == {
        "promo_active": False,
        "effective_apr_percent": None,
    }


@pytest.mark.parametrize(
    "updates",
    [
        {"special_apr_percent": "0.00"},
        {"special_apr_start": "2026-07-01"},
        {"special_apr_end": "2026-09-30"},
        {"special_apr_percent": "0.00", "special_apr_start": "2026-07-01"},
    ],
)
def test_validate_promo_bundle_rejects_partial(updates: dict) -> None:
    with pytest.raises(ValueError, match="all-or-nothing"):
        validate_promo_bundle(updates)


def test_validate_promo_bundle_allows_full_bundle() -> None:
    validate_promo_bundle(
        {
            "special_apr_percent": "0.00",
            "special_apr_start": "2026-07-01",
            "special_apr_end": "2026-09-30",
        }
    )


def test_validate_promo_bundle_allows_clear_all_null() -> None:
    validate_promo_bundle(
        {
            "special_apr_percent": None,
            "special_apr_start": None,
            "special_apr_end": None,
        }
    )
