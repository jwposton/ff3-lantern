"""Tests for loan_matcher (LOAN-02)."""

from __future__ import annotations

from loan_matcher import (
    amount_outside_tolerance,
    find_matching_profile,
    match_split_to_profile,
)

PROFILE = {
    "enabled": True,
    "_account_id": "42",
    "match": {
        "description_contains": "Loan Provider",
        "expected_amount": "427.18",
        "amount_tolerance": "0.50",
        "max_per_month": 1,
    },
}


def _split(**kwargs):
    base = {
        "description": "Loan Provider payment",
        "amount": "-427.18",
        "type": "transfer",
        "date": "2026-07-15",
        "split_count": 1,
    }
    base.update(kwargs)
    return base


def test_match_when_description_and_amount_fit():
    assert match_split_to_profile(_split(), PROFILE) is True


def test_no_match_when_description_missing_substring():
    assert match_split_to_profile(_split(description="Other payee"), PROFILE) is False


def test_no_match_when_amount_outside_tolerance():
    assert match_split_to_profile(_split(amount="-500.00"), PROFILE) is False


def test_no_match_when_split_count_gt_one():
    assert match_split_to_profile(_split(split_count=2), PROFILE) is False


def test_no_match_when_profile_disabled():
    disabled = {**PROFILE, "enabled": False}
    assert match_split_to_profile(_split(), disabled) is False


def test_max_per_month_enforced():
    counts = {"42:2026-07": 1}
    assert match_split_to_profile(_split(), PROFILE, month_counts=counts) is False


def test_source_account_guard():
    guarded = {
        **PROFILE,
        "match": {**PROFILE["match"], "source_account_id": "7"},
    }
    assert match_split_to_profile(_split(source_id="7"), guarded) is True
    assert match_split_to_profile(_split(source_id="9"), guarded) is False


def test_find_matching_profile_returns_first_match():
    found = find_matching_profile(_split(), [PROFILE])
    assert found is PROFILE


def test_amount_outside_tolerance_flag():
    assert amount_outside_tolerance(_split(amount="-500.00"), PROFILE) is True
    assert amount_outside_tolerance(_split(), PROFILE) is False
