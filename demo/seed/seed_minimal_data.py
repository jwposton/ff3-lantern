#!/usr/bin/env python3
"""Seed a minimal Firefly dataset for Lantern integration smoke tests (#103)."""

from __future__ import annotations

import calendar
import json
import os
import sys
from datetime import date
from typing import Any

import httpx

BASE_URL = os.environ.get("FIREFLY_BASE_URL", "http://firefly:8080").rstrip("/")
TOKEN = os.environ.get("FIREFLY_API_TOKEN", "").strip()
if not TOKEN:
    print("FIREFLY_API_TOKEN is required", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def _month_date(months_back: int, day: int) -> str:
    today = date.today()
    month = today.month - months_back
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    max_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, max_day)).isoformat()


def _request(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    with httpx.Client(base_url=BASE_URL, headers=HEADERS, timeout=30.0) as client:
        response = client.request(method, path, **kwargs)
    if response.status_code >= 400:
        raise RuntimeError(
            f"{method} {path} failed ({response.status_code}): {response.text[:500]}"
        )
    if not response.content:
        return {}
    return response.json()


def _find_account(name: str) -> str | None:
    payload = _request("GET", "/api/v1/accounts", params={"limit": 1000})
    for entry in payload.get("data", []):
        attrs = entry.get("attributes", {})
        if attrs.get("name") == name:
            return str(entry.get("id"))
    return None


def _ensure_account(name: str, body: dict[str, Any]) -> str:
    existing = _find_account(name)
    if existing:
        return existing
    payload = _request("POST", "/api/v1/accounts", json=body)
    return str(payload["data"]["id"])


def _ensure_category(name: str) -> None:
    payload = _request("GET", "/api/v1/categories", params={"limit": 1000})
    for entry in payload.get("data", []):
        if entry.get("attributes", {}).get("name") == name:
            return
    _request("POST", "/api/v1/categories", json={"name": name})


def _transactions_exist() -> bool:
    start = _month_date(2, 1)
    end = date.today().isoformat()
    payload = _request(
        "GET",
        "/api/v1/transactions",
        params={"start": start, "end": end, "limit": 5},
    )
    return bool(payload.get("data"))


def main() -> None:
    checking_id = _ensure_account(
        "Integration Checking",
        {"name": "Integration Checking", "type": "asset", "account_role": "defaultAsset"},
    )
    cc_id = _ensure_account(
        "Integration VISA",
        {
            "name": "Integration VISA",
            "type": "asset",
            "account_role": "ccAsset",
            "credit_card_type": "monthlyFull",
            "monthly_payment_date": "2000-01-15",
        },
    )
    grocery_id = _ensure_account(
        "Grocery Store",
        {"name": "Grocery Store", "type": "expense"},
    )
    _ensure_account("Streaming Service", {"name": "Streaming Service", "type": "expense"})
    _ensure_account("Interest", {"name": "Interest", "type": "expense"})

    for category in (
        "Groceries",
        "Credit Card Interest",
        "Credit Card Fee(s)",
        "Late Fee(s)",
        "Entertainment",
    ):
        _ensure_category(category)

    if _transactions_exist():
        print(json.dumps({"status": "seed_skipped", "reason": "transactions_present"}))
        return

    _request(
        "POST",
        "/api/v1/transactions",
        json={
            "transactions": [
                {
                    "type": "transfer",
                    "date": _month_date(0, 5),
                    "amount": "500.00",
                    "description": "CC payment",
                    "source_id": checking_id,
                    "destination_id": cc_id,
                }
            ]
        },
    )
    _request(
        "POST",
        "/api/v1/transactions",
        json={
            "transactions": [
                {
                    "type": "withdrawal",
                    "date": _month_date(0, 10),
                    "amount": "89.99",
                    "description": "Integration Grocery",
                    "source_id": cc_id,
                    "destination_id": grocery_id,
                    "category_name": "Groceries",
                }
            ]
        },
    )
    _request(
        "POST",
        "/api/v1/transactions",
        json={
            "transactions": [
                {
                    "type": "withdrawal",
                    "date": _month_date(0, 12),
                    "amount": "24.50",
                    "description": "Interest charge",
                    "source_id": cc_id,
                    "destination_name": "Interest",
                    "category_name": "Credit Card Interest",
                }
            ]
        },
    )
    _request(
        "POST",
        "/api/v1/transactions",
        json={
            "transactions": [
                {
                    "type": "withdrawal",
                    "date": _month_date(0, 14),
                    "amount": "35.00",
                    "description": "Late fee",
                    "source_id": cc_id,
                    "destination_name": "Streaming Service",
                    "category_name": "Late Fee(s)",
                }
            ]
        },
    )
    for months_back in (0, 1, 2):
        _request(
            "POST",
            "/api/v1/transactions",
            json={
                "transactions": [
                    {
                        "type": "withdrawal",
                        "date": _month_date(months_back, 15),
                        "amount": "15.99",
                        "description": "STREAMING SERVICE MONTHLY",
                        "source_id": cc_id,
                        "destination_name": "Streaming Service",
                        "category_name": "Entertainment",
                    }
                ]
            },
        )

    print(
        json.dumps(
            {
                "status": "seeded",
                "checking_id": checking_id,
                "credit_card_id": cc_id,
                "grocery_id": grocery_id,
            }
        )
    )


if __name__ == "__main__":
    main()
