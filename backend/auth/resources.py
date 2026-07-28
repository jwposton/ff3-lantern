"""RBAC resource catalog and seed permission matrices (D-05, D-08, D-11)."""

from __future__ import annotations

RESOURCES = frozenset(
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

VALID_LEVELS = frozenset({"none", "read", "limited", "write"})
SEED_LEVELS = frozenset({"none", "read"})

VIEWER_READ_RESOURCES: tuple[str, ...] = (
    "dashboard",
    "reports",
    "transactions",
    "payment_worksheet",
    "bill_discover",
    "bills",
    "liabilities",
)

VIEWER_NONE_RESOURCES: tuple[str, ...] = (
    "categorize",
    "loans",
    "payment_setup",
    "admin",
    "ops_cache",
)
