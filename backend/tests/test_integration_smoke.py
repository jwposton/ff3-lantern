"""Live Firefly integration smoke tests — run via scripts/integration-smoke.sh (#103).

The write-surface test drives Lantern routes that call Firefly on the success path:

- GET  /api/v1/about                          health
- GET  /api/v1/accounts, /accounts/{id}       loans, worksheet, histories
- PUT  /api/v1/accounts/{id}                  worksheet profile, loan profile
- GET  /api/v1/transactions                   normalized transactions, queues
- GET  /api/v1/transactions/{id}              categorize apply, mass edit, loan split
- PUT  /api/v1/transactions/{id}              same writes
- GET  /api/v1/categories, /budgets           categorize and transaction meta
- GET  /api/v1/rules, /rules/{id}             bill registry and repair
- POST /api/v1/rules, /rule-groups            categorize rule and bill link rule
- PUT  /api/v1/rules/{id}                     bill rename
- POST /api/v1/rules/{id}/trigger             categorize backfill and bill link
- GET/POST/PUT /api/v1/bills                  register and rename
- GET  /api/v1/bills/{id}/rules, /transactions

DELETE /api/v1/bills/{id} and DELETE /api/v1/rules/{id} run only when bill
registration rolls back. Suggest stays a 503 without an OpenRouter key.
"""

from __future__ import annotations

import os
from datetime import date

import httpx
import pytest

BASE_URL = os.environ.get("LANTERN_INTEGRATION_URL", "http://localhost:18002").rstrip("/")
FIREFLY_TAG = os.environ.get("FIREFLY_TAG", "unknown")


def _client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=60.0)


def _month_bounds() -> tuple[str, str]:
    today = date.today()
    start = today.replace(day=1)
    return start.isoformat(), today.isoformat()


@pytest.mark.integration
def test_health_ok_and_firefly_version_when_available():
    with _client() as client:
        response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["firefly_base_url_configured"] is True
    assert data["firefly_api_token_configured"] is True
    assert data["payment_worksheet_enabled"] is True
    assert "FIREFLY_API_TOKEN" not in response.text
    version = data.get("firefly_version")
    if version is not None:
        assert isinstance(version, str)
        assert version.strip()


@pytest.mark.integration
def test_reference_data_loads():
    with _client() as client:
        start, end = _month_bounds()
        response = client.get(
            "/api/normalized_transactions",
            params={"start": start, "end": end},
        )
    assert response.status_code == 200
    payload = response.json()
    assert "data" in payload
    assert isinstance(payload["data"], list)
    assert len(payload["data"]) > 0


@pytest.mark.integration
def test_payment_worksheet_refresh_and_get():
    month = date.today().strftime("%Y-%m")
    with _client() as client:
        refresh = client.post("/api/payment-run/refresh", params={"month": month})
        assert refresh.status_code == 200
        worksheet = client.get("/api/payment-run", params={"month": month})
    assert worksheet.status_code == 200
    envelope = worksheet.json()
    assert envelope.get("month") == month
    assert "credit_cards" in envelope
    assert len(envelope["credit_cards"]) >= 1


@pytest.mark.integration
def test_bill_suggestions_on_real_splits():
    with _client() as client:
        response = client.get("/api/payment-run/bill-suggestions")
    assert response.status_code == 200
    payload = response.json()
    assert "data" in payload
    assert isinstance(payload["data"], list)


def _json(response: httpx.Response, *expected: int) -> dict:
    allowed = expected or (200,)
    if response.status_code not in allowed:
        raise AssertionError(
            f"{response.request.method} {response.request.url} -> "
            f"{response.status_code}: {response.text[:800]}"
        )
    if not response.content:
        return {}
    payload = response.json()
    assert isinstance(payload, dict)
    return payload


def _by_name(rows: list[dict], name: str, *, key: str = "name") -> dict:
    for row in rows:
        if row.get(key) == name:
            return row
    raise AssertionError(f"missing {key}={name!r} in {rows!r}"[:800])


@pytest.mark.integration
def test_firefly_write_surface():
    """Exercise every Firefly endpoint Lantern calls on a success path."""
    start, end = _month_bounds()
    month = date.today().strftime("%Y-%m")
    with _client() as client:
        meta = _json(client.get("/api/categorize/meta"))
        assert meta["categories"]
        assert any(row["name"] == "Household" for row in meta["budgets"])
        groceries = _by_name(meta["categories"], "Groceries")
        entertainment = _by_name(meta["categories"], "Entertainment")

        tx_meta = _json(client.get("/api/transactions/meta"))
        assert tx_meta["categories"] and tx_meta["budgets"]

        pending = _json(
            client.get(
                "/api/categorize/pending",
                params={"start": start, "end": end},
            )
        )
        assert isinstance(pending["data"], list)

        transactions = _json(
            client.get(
                "/api/normalized_transactions",
                params={"start": start, "end": end},
            )
        )["data"]
        grocery = _by_name(transactions, "Integration Grocery", key="description")
        late_fee = _by_name(transactions, "Late fee", key="description")

        preview = _json(
            client.post(
                "/api/categorize/rules/preview",
                json={
                    "start": start,
                    "end": end,
                    "rule": {
                        "title": "Integration Grocery → Groceries",
                        "description_contains": "Integration Grocery",
                        "transaction_type": "withdrawal",
                    },
                },
            )
        )
        assert preview["data"]["total"] >= 1

        created_rule = _json(
            client.post(
                "/api/categorize/rules",
                json={
                    "start": start,
                    "end": end,
                    "category_id": groceries["id"],
                    "rule": {
                        "title": "Integration Grocery → Groceries",
                        "description_contains": "Integration Grocery",
                        "transaction_type": "withdrawal",
                    },
                },
            )
        )
        rule_id = created_rule["data"]["rule_id"]
        assert rule_id

        triggered = _json(
            client.post(
                f"/api/categorize/rules/{rule_id}/trigger",
                json={"start": start, "end": end},
            )
        )
        assert triggered["ok"] is True

        applied = _json(
            client.post(
                f"/api/categorize/{grocery['journal_id']}/apply",
                json={
                    "category_id": entertainment["id"],
                    "transaction_journal_id": grocery["transaction_journal_id"],
                    "description": "Integration Grocery categorized",
                },
            )
        )
        assert applied["ok"] is True

        edited = _json(
            client.post(
                "/api/transactions/mass-edit",
                json={
                    "targets": [
                        {
                            "journal_id": grocery["journal_id"],
                            "transaction_journal_id": grocery["transaction_journal_id"],
                        }
                    ],
                    "category_id": groceries["id"],
                },
            )
        )
        assert edited["failed"] == 0

        ignored = _json(
            client.post(
                f"/api/categorize/{late_fee['journal_id']}/ignore",
                json={"transaction_journal_id": late_fee["transaction_journal_id"]},
            )
        )
        assert ignored["ok"] is True

        suggest = client.post(
            "/api/categorize/suggest",
            json={"start": start, "end": end},
        )
        assert suggest.status_code == 503

        loans_meta = _json(client.get("/api/loans/meta"))
        visa = _by_name(loans_meta["asset_accounts"], "Integration VISA")
        mortgage = _by_name(loans_meta["liability_accounts"], "Integration Mortgage")
        interest = _by_name(loans_meta["expense_accounts"], "Interest")

        worksheet = _json(
            client.put(
                f"/api/payment-run/accounts/{visa['id']}/worksheet",
                params={"month": month},
                json={
                    "included": True,
                    "worksheet_section": "credit",
                    "credit_limit": "5000.00",
                    "apr_percent": "19.99",
                    "payment_due_day": "15",
                    "default_planned_payment": "200.00",
                },
            )
        )
        assert worksheet["account_id"] == visa["id"]
        assert worksheet["profile"]["payment_due_day"] == "15"

        cc_history = _json(
            client.get(
                f"/api/payment-run/credit-cards/{visa['id']}/history",
                params={"start": start, "end": end},
            )
        )
        assert "transactions" in cc_history or "data" in cc_history

        loan = _json(client.get(f"/api/loans/{mortgage['id']}"))
        assert loan["account_id"] == mortgage["id"]
        inferred = _json(client.get(f"/api/loans/{mortgage['id']}/inferred-profile"))
        assert "profile" in inferred

        saved = _json(
            client.put(
                f"/api/loans/{mortgage['id']}",
                json={
                    "version": 1,
                    "enabled": True,
                    "rate_override": "6",
                    "match": {
                        "type": "withdrawal",
                        "description_contains": "MORTGAGE PAYMENT",
                        "expected_amount": "1000.00",
                        "amount_tolerance": "1.00",
                        "source_account_id": _by_name(
                            loans_meta["asset_accounts"], "Integration Checking"
                        )["id"],
                    },
                    "split": {
                        "escrow_amount": "0.00",
                        "components": [
                            {
                                "role": "principal",
                                "type": "withdrawal",
                                "destination_account_id": mortgage["id"],
                                "destination_account": "Integration Mortgage",
                            },
                            {
                                "role": "interest",
                                "type": "withdrawal",
                                "destination_account_id": interest["id"],
                                "destination_account": "Interest",
                                "category": "Credit Card Interest",
                            },
                        ],
                    },
                },
            )
        )
        assert saved["ok"] is True

        _json(client.post("/api/cache/clear"))
        loan_queue = _json(
            client.get(
                "/api/loan-splits/pending",
                params={"start": start, "end": end},
            )
        )
        assert loan_queue["data"], loan_queue
        payment = _by_name(loan_queue["data"], "MORTGAGE PAYMENT", key="description")
        preview_amounts = _json(
            client.post(
                f"/api/loan-splits/{payment['journal_id']}/preview",
                params={"start": start, "end": end},
                json=payment["preview"],
            )
        )
        amounts = preview_amounts["amounts"]
        applied_split = _json(
            client.post(
                f"/api/loan-splits/{payment['journal_id']}/apply",
                json={
                    "transaction_journal_id": payment["transaction_journal_id"],
                    "principal": amounts["principal"],
                    "interest": amounts["interest"],
                    "escrow": amounts["escrow"],
                    "start": start,
                    "end": end,
                },
            )
        )
        assert applied_split["ok"] is True

        liability_history = _json(
            client.get(
                f"/api/payment-run/liabilities/{mortgage['id']}/history",
                params={"start": start, "end": end},
            )
        )
        assert isinstance(liability_history, dict)

        registered = _json(
            client.post(
                "/api/payment-run/bills/register",
                json={
                    "mode": "create_new",
                    "name": "Integration Streaming",
                    "amount": "15.99",
                    "amount_mode": "recurring",
                    "repeat_freq": "monthly",
                    "worksheet_section": "bills",
                    "payment_rail": "credit_card",
                    "credit_card_account_id": visa["id"],
                    "description_contains": "STREAMING SERVICE MONTHLY",
                    "destination_account": "Streaming Service",
                },
            )
        )
        registry_id = registered["id"]
        firefly_bill_id = str(registered["firefly_bill_id"])

        bills = _json(client.get("/api/payment-run/bills"))
        assert any(row["registry_id"] == registry_id for row in bills["data"])
        detail = _json(client.get(f"/api/payment-run/bills/{registry_id}"))
        assert detail["firefly_bill_id"] == firefly_bill_id
        link_rules = _json(
            client.get(f"/api/payment-run/bills/{firefly_bill_id}/link-rules")
        )
        assert link_rules["data"]
        history = _json(client.get(f"/api/payment-run/bills/{registry_id}/history"))
        assert isinstance(history, dict)
        available = _json(client.get("/api/payment-run/available"))
        assert all(str(row.get("id")) != firefly_bill_id for row in available["data"])

        renamed = _json(
            client.put(
                f"/api/payment-run/bills/{registry_id}",
                json={"name": "Integration Streaming Plus"},
            )
        )
        assert renamed.get("name") == "Integration Streaming Plus" or renamed.get(
            "row_label"
        ) == "Integration Streaming Plus"
        repaired = _json(
            client.post(f"/api/payment-run/bills/{registry_id}/repair-rule")
        )
        assert repaired["rule_sync_status"] == "synced"
        deleted = _json(client.delete(f"/api/payment-run/bills/{registry_id}"))
        assert deleted["ok"] is True


def pytest_report_header(config):
    return f"integration: lantern={BASE_URL} firefly_tag={FIREFLY_TAG}"
