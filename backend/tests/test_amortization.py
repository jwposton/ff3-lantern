"""Tests for amortization (LOAN-03, LOAN-08)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from amortization import apply_penny_adjustment, compute_payment_split


def test_lending_tree_example():
    result = compute_payment_split(
        Decimal("50000"),
        Decimal("0.065"),
        Decimal("427.18"),
        Decimal("0"),
    )
    assert result["interest"] == Decimal("270.83")
    assert result["principal"] == Decimal("156.35")
    assert result["principal"] + result["interest"] + result["escrow"] == Decimal(
        "427.18"
    )


def test_penny_adjustment_exact_sum():
    raw = {
        "principal": Decimal("100.01"),
        "interest": Decimal("50.00"),
        "escrow": Decimal("0.00"),
    }
    adjusted = apply_penny_adjustment(raw, Decimal("150.00"))
    assert sum(adjusted.values()) == Decimal("150.00")


def test_negative_principal_raises():
    with pytest.raises(ValueError, match="negative"):
        compute_payment_split(
            Decimal("100"),
            Decimal("1.5"),
            Decimal("10"),
            Decimal("0"),
        )
