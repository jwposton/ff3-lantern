"""Local auth bootstrap, passwords, and resource catalog tests (Phase 34)."""

from __future__ import annotations

import pytest

from auth.resources import (
    RESOURCES,
    SEED_LEVELS,
    VALID_LEVELS,
    VIEWER_NONE_RESOURCES,
    VIEWER_READ_RESOURCES,
)


def test_hash_and_verify_password():
    from auth.passwords import hash_password, verify_password

    password = "validpassword12"
    stored = hash_password(password)
    assert stored.startswith("$2")
    assert verify_password(password, stored) is True
    assert verify_password("wrongpassword1", stored) is False


def test_validate_password_min_length():
    from auth.passwords import validate_password_length

    with pytest.raises(ValueError, match="12"):
        validate_password_length("short")


def test_validate_password_max_bytes():
    from auth.passwords import validate_password_length

    with pytest.raises(ValueError, match="72"):
        validate_password_length("a" * 73)


def test_resources_catalog_matches_epic():
    assert RESOURCES == frozenset(
        {
            "dashboard",
            "reports",
            "transactions",
            "categorize",
            "loans",
            "payment_worksheet",
            "payment_setup",
            "bill_discover",
            "bills",
            "liabilities",
            "admin",
            "ops_cache",
        }
    )
    assert VALID_LEVELS == frozenset({"none", "read", "limited", "write"})
    assert SEED_LEVELS == frozenset({"none", "read"})
    assert "limited" not in SEED_LEVELS
    assert len(VIEWER_READ_RESOURCES) == 7
    assert len(VIEWER_NONE_RESOURCES) == 5
    assert VIEWER_READ_RESOURCES == (
        "dashboard",
        "reports",
        "transactions",
        "payment_worksheet",
        "bill_discover",
        "bills",
        "liabilities",
    )
    assert VIEWER_NONE_RESOURCES == (
        "categorize",
        "loans",
        "payment_setup",
        "admin",
        "ops_cache",
    )
