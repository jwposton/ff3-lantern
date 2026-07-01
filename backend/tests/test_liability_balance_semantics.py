"""LOAN-06 gate: liability balance semantics fixture verification."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from amortization import LOAN_BALANCE_SEMANTICS, balance_for_interest_calc, compute_payment_split

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "liability_balance_semantics.json"


def test_loan_balance_semantics_constant_set():
    assert LOAN_BALANCE_SEMANTICS == "pre_payment"


def test_fixture_expected_interest_matches_compute_payment_split():
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert fixture.get("assumption") == "pre_payment"
    balance = Decimal(fixture["example_balance"])
    rate = Decimal(fixture["example_rate_percent"]) / Decimal("100")
    payment = Decimal(fixture["example_payment"])
    result = compute_payment_split(balance, rate, payment, Decimal("0"))
    assert result["interest"] == Decimal(fixture["expected_interest"])
    assert result["principal"] == Decimal(fixture["expected_principal"])


def test_balance_for_interest_calc_uses_abs_current_balance():
    attrs = {"current_balance": "-50000.00"}
    balance = balance_for_interest_calc(attrs, Decimal("427.18"))
    assert balance == Decimal("50000.00")
