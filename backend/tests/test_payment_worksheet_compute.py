"""Tests for payment worksheet compute envelope (PAY-04, PAY-09, PAY-11)."""

from __future__ import annotations

import asyncio
import json

import pytest

import sidecar_db
from payment_worksheet_compute import (
    build_worksheet_envelope,
    bill_row_key,
    cc_row_key,
    compute_bucket_rollups,
    compute_grand_totals,
    compute_section_subtotals,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FF3LANTERN_DATA_DIR", str(tmp_path))
    return tmp_path


def test_bill_row_key():
    assert bill_row_key(7) == "bill:7"
    assert bill_row_key("7") == "bill:7"


def test_cc_row_key():
    assert cc_row_key("42") == "cc:42"


def test_compute_rollups():
    buckets = [
        {"id": "checking", "label": "Checking", "sort_order": 0, "firefly_account_ids": []},
        {"id": "savings", "label": "Savings", "sort_order": 1, "firefly_account_ids": []},
    ]
    refresh_snapshot = {
        "buckets": {
            "checking": {"reported_balance": "5000.00"},
            "savings": {"reported_balance": "2000.00"},
        },
        "credit_cards": {},
    }
    bucket_balances = [
        {
            "bucket_key": "checking",
            "month": "2026-07",
            "user_balance": "4800.00",
            "user_balance_override": 1,
        },
    ]
    cc_rows = [
        {
            "account_id": "cc1",
            "funding_bucket_key": "checking",
            "planned_amount": "1200.00",
            "paid_at": None,
        },
        {
            "account_id": "cc2",
            "funding_bucket_key": None,
            "planned_amount": "500.00",
            "paid_at": None,
        },
        {
            "account_id": "cc3",
            "funding_bucket_key": "checking",
            "planned_amount": "800.00",
            "paid_at": "2026-07-15T12:00:00Z",
        },
    ]
    result = compute_bucket_rollups(
        buckets, refresh_snapshot, bucket_balances, cc_rows, [], [], []
    )
    checking = next(b for b in result["buckets"] if b["id"] == "checking")
    savings = next(b for b in result["buckets"] if b["id"] == "savings")

    assert checking["reported_balance"] == "5000.00"
    assert checking["user_balance"] == "4800.00"
    assert checking["user_balance_override"] is True
    assert checking["planned_outflows"] == "2000.00"
    assert checking["remaining"] == "2800.00"

    assert savings["reported_balance"] == "2000.00"
    assert savings["user_balance"] == "2000.00"
    assert savings["planned_outflows"] == "0.00"
    assert savings["remaining"] == "2000.00"

    assert result["totals"]["reported_balance"] == "7000.00"
    assert result["totals"]["user_balance"] == "6800.00"
    assert result["totals"]["remaining"] == "4800.00"
    assert result["shortfall"] is False


def test_shortfall():
    buckets = [
        {"id": "checking", "label": "Checking", "sort_order": 0, "firefly_account_ids": []},
    ]
    refresh_snapshot = {
        "buckets": {"checking": {"reported_balance": "1000.00"}},
        "credit_cards": {},
    }
    cc_rows = [
        {
            "account_id": "cc1",
            "funding_bucket_key": "checking",
            "planned_amount": "1500.00",
            "paid_at": None,
        },
    ]
    result = compute_bucket_rollups(buckets, refresh_snapshot, [], cc_rows, [], [], [])
    checking = result["buckets"][0]
    assert checking["remaining"] == "-500.00"
    assert result["shortfall"] is True


@pytest.mark.asyncio
async def test_build_worksheet_envelope_no_refresh(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    envelope = await build_worksheet_envelope("2026-07")
    assert envelope["month"] == "2026-07"
    assert envelope["refreshed_at"] is None
    assert envelope["credit_cards"] == []
    assert envelope["excluded_credit_cards"] == []
    assert len(envelope["buckets"]) == 1
    assert envelope["buckets"][0]["reported_balance"] == "0.00"
    assert envelope["shortfall"] is False


@pytest.mark.asyncio
async def test_build_worksheet_envelope_with_refresh(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    balances = {
        "buckets": {"checking": {"reported_balance": "3000.00"}},
        "credit_cards": {
            "cc1": {
                "name": "Chase VISA",
                "credit_limit": "10000.00",
                "funding_bucket_key": "checking",
                "owed": "1200.00",
                "new_total": "150.00",
                "interest_accrued": "25.00",
                "fees": "0.00",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )
    await sidecar_db.upsert_worksheet_state_row(
        row_key="cc:cc1",
        row_type="credit_card",
        month="2026-07",
        planned_amount="500.00",
        planned_amount_override=1,
        paid_at="2026-07-10T00:00:00Z",
    )

    envelope = await build_worksheet_envelope("2026-07")
    assert envelope["refreshed_at"] == "2026-07-03T12:00:00Z"
    assert len(envelope["credit_cards"]) == 1
    card = envelope["credit_cards"][0]
    assert card["account_id"] == "cc1"
    assert card["name"] == "Chase VISA"
    assert card["planned_amount"] == "500.00"
    assert card["paid_at"] == "2026-07-10T00:00:00Z"
    assert card["new_transactions"] == []
    assert envelope["buckets"][0]["planned_outflows"] == "500.00"


@pytest.mark.asyncio
async def test_assemble_credit_cards_skips_profile_only_stubs(data_dir):
    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(
            {
                "buckets": {},
                "credit_cards": {
                    "404": {"funding_bucket_key": "checking"},
                    "cc1": {
                        "name": "Chase VISA",
                        "owed": "1200.00",
                        "new_total": "150.00",
                        "interest_accrued": "25.00",
                        "fees": "0.00",
                    },
                },
            }
        ),
    )

    envelope = await build_worksheet_envelope("2026-07")
    assert len(envelope["credit_cards"]) == 1
    assert envelope["credit_cards"][0]["account_id"] == "cc1"


def test_section_subtotals():
    bills = [
        {
            "amount_due": "100.00",
            "planned_amount": "80.00",
            "counts_toward_cash_plan": True,
            "payment_rail": "bank",
        },
        {
            "amount_due": "50.00",
            "planned_amount": "25.00",
            "counts_toward_cash_plan": False,
            "payment_rail": "credit_card",
        },
    ]
    liabilities = [
        {
            "account_id": "m1",
            "owed": "50000.00",
            "amount_due": "427.18",
            "planned_amount": "427.18",
        },
        {
            "amount_due": "200.00",
            "planned_amount": "0.00",
            "counts_toward_cash_plan": False,
            "payment_rail": "credit_card",
        },
    ]
    credit_cards = [{"planned_amount": "400.00", "owed": "1200.00"}]
    result = compute_section_subtotals(bills, liabilities, credit_cards)
    assert result["bills"]["owed"] == "0.00"
    assert result["bills"]["due"] == "150.00"
    assert result["bills"]["planned_cash"] == "80.00"
    assert result["bills"]["on_card_informational"] == "50.00"
    assert result["liabilities"]["owed"] == "50000.00"
    assert result["liabilities"]["due"] == "627.18"
    assert result["liabilities"]["planned_cash"] == "427.18"
    assert result["credit_cards"]["planned_cash"] == "400.00"
    assert "owed" not in result["credit_cards"]


def test_cc_rail_excluded():
    buckets = [
        {"id": "checking", "label": "Checking", "sort_order": 0, "firefly_account_ids": []},
    ]
    refresh_snapshot = {"buckets": {"checking": {"reported_balance": "5000.00"}}, "credit_cards": {}}
    cc_rows = [
        {
            "account_id": "cc1",
            "funding_bucket_key": "checking",
            "planned_amount": "200.00",
        },
    ]
    bill_rows = [
        {
            "funding_bucket_key": "checking",
            "planned_amount": "150.00",
            "counts_toward_cash_plan": False,
            "payment_rail": "credit_card",
        },
    ]
    liability_rows = [
        {
            "account_id": "m1",
            "funding_bucket_key": "checking",
            "planned_amount": "100.00",
        },
    ]
    result = compute_bucket_rollups(
        buckets, refresh_snapshot, [], cc_rows, bill_rows, liability_rows, []
    )
    checking = result["buckets"][0]
    assert checking["planned_outflows"] == "300.00"


def test_grand_totals_includes_cc_owed():
    credit_cards = [
        {"owed": "1200.00", "planned_amount": "400.00"},
        {"owed": "800.00", "planned_amount": "200.00"},
    ]
    bills = [{"amount_due": "150.00", "planned_amount": "80.00", "payment_rail": "bank", "counts_toward_cash_plan": True}]
    liabilities = [
        {
            "account_id": "m1",
            "owed": "50000.00",
            "amount_due": "627.18",
            "planned_amount": "427.18",
        }
    ]
    result = compute_grand_totals(bills, liabilities, credit_cards)
    assert result["owed"] == "52000.00"
    assert result["due"] == "777.18"
    assert result["planned_cash"] == "1107.18"
    assert result["planned_total"] == "1107.18"
    assert result["breakdown"]["owed"]["liabilities"] == "50000.00"
    assert result["breakdown"]["owed"]["revolving"] == "2000.00"
    assert result["breakdown"]["due"]["cash"] == "777.18"
    assert result["breakdown"]["due"]["credit"] == "0.00"
    assert result["breakdown"]["planned"]["cash"] == "1107.18"
    assert result["breakdown"]["planned"]["credit"] == "0.00"


def test_grand_totals_breakdown_due_and_planned_by_rail():
    bills = [
        {
            "amount_due": "100.00",
            "planned_amount": "100.00",
            "payment_rail": "bank",
            "counts_toward_cash_plan": True,
        },
        {
            "amount_due": "50.00",
            "planned_amount": "50.00",
            "payment_rail": "credit_card",
            "counts_toward_cash_plan": False,
        },
    ]
    liabilities = [
        {
            "amount_due": "25.00",
            "planned_amount": "25.00",
            "payment_rail": "credit_card",
            "counts_toward_cash_plan": False,
        },
        {
            "account_id": "loan-1",
            "owed": "10000.00",
            "amount_due": "500.00",
            "planned_amount": "500.00",
        },
    ]
    credit_cards = [{"owed": "300.00", "planned_amount": "200.00"}]
    result = compute_grand_totals(bills, liabilities, credit_cards)
    assert result["due"] == "675.00"
    assert result["breakdown"]["due"]["cash"] == "600.00"
    assert result["breakdown"]["due"]["credit"] == "75.00"
    assert result["planned_cash"] == "800.00"
    assert result["planned_total"] == "875.00"
    assert result["breakdown"]["planned"]["cash"] == "800.00"
    assert result["breakdown"]["planned"]["credit"] == "75.00"


def test_grand_totals_real_estate_vs_loans_split():
    liabilities = [
        {
            "account_id": "mortgage-1",
            "owed": "250000.00",
            "amount_due": "1800.00",
            "account_role": "mortgage",
        },
        {
            "account_id": "car-1",
            "owed": "12000.00",
            "amount_due": "350.00",
            "account_role": "debt",
        },
    ]
    result = compute_grand_totals([], liabilities, [])
    assert result["owed"] == "262000.00"
    assert result["breakdown"]["owed"]["liabilities"] == "262000.00"
    assert result["breakdown"]["owed"]["real_estate"] == "250000.00"
    assert result["breakdown"]["owed"]["loans"] == "12000.00"
    assert "revolving" in result["breakdown"]["owed"]
    assert result["breakdown"]["owed"]["revolving"] == "0.00"


def test_grand_totals_hides_zero_re_split_when_all_loans():
    liabilities = [
        {
            "account_id": "car-1",
            "owed": "5000.00",
            "amount_due": "200.00",
            "account_role": "debt",
        },
    ]
    result = compute_grand_totals([], liabilities, [])
    owed_breakdown = result["breakdown"]["owed"]
    assert owed_breakdown["loans"] == "5000.00"
    assert "real_estate" not in owed_breakdown


@pytest.mark.asyncio
async def test_build_worksheet_envelope_with_bills(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    reg_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "bill-1",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-1",
            "row_label": "Electric",
        }
    )
    balances = {
        "buckets": {"checking": {"reported_balance": "3000.00"}},
        "credit_cards": {},
        "liabilities": {},
        "excluded_liabilities": {},
        "bills": {
            str(reg_id): {
                "owed": "125.50",
                "firefly_bill_id": "bill-1",
                "name": "Electric",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )

    envelope = await build_worksheet_envelope("2026-07")
    assert len(envelope["bills"]) == 1
    bill = envelope["bills"][0]
    assert bill["row_key"] == bill_row_key(reg_id)
    assert bill["amount_due"] == "125.50"
    assert bill["row_label"] == "Electric"
    assert envelope["section_subtotals"]["bills"]["due"] == "125.50"
    assert envelope["grand_totals"]["due"] == "125.50"


@pytest.mark.asyncio
async def test_build_worksheet_envelope_bill_amount_due_override(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    reg_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": "bill-1",
            "worksheet_section": "bills",
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": "rule-1",
            "row_label": "Electric",
        }
    )
    balances = {
        "buckets": {"checking": {"reported_balance": "3000.00"}},
        "credit_cards": {},
        "liabilities": {},
        "excluded_liabilities": {},
        "bills": {
            str(reg_id): {
                "owed": "125.50",
                "firefly_bill_id": "bill-1",
                "name": "Electric",
            }
        },
    }
    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )
    await sidecar_db.upsert_worksheet_state_row(
        row_key=bill_row_key(reg_id),
        row_type="bill",
        month="2026-07",
        amount_due="200.00",
        amount_due_override=1,
    )

    envelope = await build_worksheet_envelope("2026-07")
    bill = envelope["bills"][0]
    assert bill["amount_due"] == "200.00"
    assert bill["amount_due_override"] is True
    assert envelope["section_subtotals"]["bills"]["due"] == "200.00"


@pytest.mark.asyncio
async def test_build_worksheet_envelope_liability_amount_due_defaults_to_planned(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    balances = {
        "buckets": {"checking": {"reported_balance": "3000.00"}},
        "credit_cards": {},
        "liabilities": {
            "loan-1": {
                "name": "Mortgage",
                "owed": "250000.00",
                "est_interest": "800.00",
                "remaining_payments": 142,
                "default_planned_payment": "1800.00",
            }
        },
        "excluded_liabilities": {},
        "bills": {},
    }
    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )
    await sidecar_db.upsert_worksheet_state_row(
        row_key="liability:loan-1",
        row_type="liability",
        month="2026-07",
        planned_amount="1800.00",
        planned_amount_override=0,
    )

    envelope = await build_worksheet_envelope("2026-07")
    liability = envelope["liabilities"][0]
    assert liability["owed"] == "250000.00"
    assert liability["amount_due"] == "1800.00"
    assert liability["planned_amount"] == "1800.00"
    assert liability["amount_due_override"] is False
    assert envelope["section_subtotals"]["liabilities"]["owed"] == "250000.00"
    assert envelope["section_subtotals"]["liabilities"]["due"] == "1800.00"


@pytest.mark.asyncio
async def test_bill_rows_sorted_cash_then_credit_monthly_before_intermittent(data_dir):
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )
    specs = [
        ("CC Intermittent", "credit_card", "intermittent"),
        ("Cash Monthly", "bank", "recurring"),
        ("Credit Monthly", "credit_card", "recurring"),
        ("Cash Intermittent", "bank", "intermittent"),
    ]
    reg_ids: list[int] = []
    bills_snapshot: dict[str, dict[str, str]] = {}
    for index, (label, rail, mode) in enumerate(specs):
        reg_id = await sidecar_db.insert_worksheet_registry(
            {
                "firefly_bill_id": f"bill-{index}",
                "worksheet_section": "bills",
                "funding_bucket_key": "checking",
                "amount_mode": mode,
                "planned_sync": "fixed" if mode == "recurring" else "manual",
                "payment_rail": rail,
                "rule_id": f"rule-{index}",
                "row_label": label,
                "credit_card_account_id": "card-1" if rail == "credit_card" else None,
            }
        )
        reg_ids.append(reg_id)
        bills_snapshot[str(reg_id)] = {
            "owed": "10.00",
            "firefly_bill_id": f"bill-{index}",
            "name": label,
        }

    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(
            {
                "buckets": {"checking": {"reported_balance": "3000.00"}},
                "credit_cards": {},
                "liabilities": {},
                "excluded_liabilities": {},
                "bills": bills_snapshot,
            }
        ),
    )

    envelope = await build_worksheet_envelope("2026-07")
    labels = [row["row_label"] for row in envelope["bills"]]
    assert labels == [
        "Cash Monthly",
        "Cash Intermittent",
        "Credit Monthly",
        "CC Intermittent",
    ]


async def _seed_funding_bucket() -> None:
    await sidecar_db.upsert_funding_bucket(
        id="checking",
        label="Checking",
        sort_order=0,
        firefly_account_ids=["1"],
    )


async def _seed_refresh(
    *,
    bills_snapshot: dict[str, dict[str, str]] | None = None,
    liabilities_snapshot: dict[str, dict[str, object]] | None = None,
) -> None:
    balances = {
        "buckets": {"checking": {"reported_balance": "5000.00"}},
        "credit_cards": {},
        "liabilities": liabilities_snapshot or {},
        "excluded_liabilities": {},
        "bills": bills_snapshot or {},
    }
    await sidecar_db.upsert_worksheet_refresh(
        month="2026-07",
        refreshed_at="2026-07-03T12:00:00Z",
        balances_json=json.dumps(balances),
    )


async def _insert_bill(
    *,
    label: str,
    amount: str = "100.00",
    worksheet_section: str = "bills",
    bill_group_id: str | None = None,
    show_in_group: bool = False,
    planned_amount: str | None = None,
) -> tuple[int, dict[str, dict[str, str]]]:
    reg_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": f"bill-{label}",
            "worksheet_section": worksheet_section,
            "funding_bucket_key": "checking",
            "amount_mode": "recurring",
            "planned_sync": "fixed",
            "payment_rail": "bank",
            "rule_id": f"rule-{label}",
            "row_label": label,
            "bill_group_id": bill_group_id,
            "show_in_group": show_in_group,
        }
    )
    if planned_amount is not None:
        await sidecar_db.upsert_worksheet_state_row(
            row_key=bill_row_key(reg_id),
            row_type="bill",
            month="2026-07",
            planned_amount=planned_amount,
            planned_amount_override=0,
        )
    snapshot = {
        str(reg_id): {
            "owed": amount,
            "firefly_bill_id": f"bill-{label}",
            "name": label,
        }
    }
    return reg_id, snapshot


@pytest.mark.asyncio
async def test_worksheet_envelope_includes_bill_groups(data_dir):
    await _seed_funding_bucket()
    await sidecar_db.upsert_bill_group(
        id="empty-group",
        label="Empty Group",
        sort_order=1,
    )
    await sidecar_db.upsert_bill_group(
        id="active-group",
        label="Active Group",
        sort_order=0,
    )

    bills_snapshot: dict[str, dict[str, str]] = {}
    for label in ("Electric", "Water"):
        _, snap = await _insert_bill(
            label=label,
            amount="50.00",
            bill_group_id="active-group",
            show_in_group=True,
        )
        bills_snapshot.update(snap)

    await _seed_refresh(bills_snapshot=bills_snapshot)

    envelope = await build_worksheet_envelope("2026-07")
    assert "bill_groups" in envelope
    assert len(envelope["bill_groups"]) == 2

    slim_keys = {"id", "label", "sort_order", "member_count", "visible_count"}
    for group in envelope["bill_groups"]:
        assert set(group.keys()) == slim_keys
        assert "members" not in group

    by_id = {group["id"]: group for group in envelope["bill_groups"]}
    sorted_groups = sorted(
        envelope["bill_groups"],
        key=lambda g: (g["sort_order"], g["label"].casefold()),
    )
    assert [g["id"] for g in sorted_groups] == ["active-group", "empty-group"]

    assert by_id["empty-group"]["member_count"] == 0
    assert by_id["empty-group"]["visible_count"] == 0
    assert by_id["active-group"]["member_count"] == 2
    assert by_id["active-group"]["visible_count"] == 2


@pytest.mark.asyncio
async def test_worksheet_bill_group_row_fields_on_bills_and_liabilities(data_dir):
    await _seed_funding_bucket()
    await sidecar_db.upsert_bill_group(id="bills-group", label="Bills Group", sort_order=0)
    await sidecar_db.upsert_bill_group(
        id="liabilities-group",
        label="Liabilities Group",
        sort_order=1,
    )

    bills_snapshot: dict[str, dict[str, str]] = {}
    bill_id, bill_snap = await _insert_bill(
        label="Electric",
        bill_group_id="bills-group",
        show_in_group=True,
    )
    bills_snapshot.update(bill_snap)

    liability_bill_id, liability_bill_snap = await _insert_bill(
        label="HOA",
        worksheet_section="liabilities",
        bill_group_id="liabilities-group",
        show_in_group=False,
    )
    bills_snapshot.update(liability_bill_snap)

    liabilities_snapshot = {
        "loan-1": {
            "name": "Mortgage",
            "owed": "250000.00",
            "default_planned_payment": "1800.00",
        }
    }
    await _seed_refresh(
        bills_snapshot=bills_snapshot,
        liabilities_snapshot=liabilities_snapshot,
    )

    envelope = await build_worksheet_envelope("2026-07")

    bill_row = next(row for row in envelope["bills"] if row["registry_id"] == bill_id)
    assert bill_row["bill_group_id"] == "bills-group"
    assert bill_row["show_in_group"] is True

    liability_bill_row = next(
        row for row in envelope["liabilities"] if row.get("registry_id") == liability_bill_id
    )
    assert liability_bill_row["bill_group_id"] == "liabilities-group"
    assert liability_bill_row["show_in_group"] is False

    firefly_liability = next(
        row for row in envelope["liabilities"] if row.get("account_id") == "loan-1"
    )
    assert "bill_group_id" not in firefly_liability or firefly_liability.get("bill_group_id") is None


@pytest.mark.asyncio
async def test_section_subtotals_unchanged_with_grouped_bills(data_dir):
    await _seed_funding_bucket()

    flat_rows: list[dict[str, object]] = []
    bills_snapshot: dict[str, dict[str, str]] = {}
    for index, (label, amount) in enumerate(
        (("Alpha", "100.00"), ("Beta", "100.00"), ("Gamma", "100.00"))
    ):
        reg_id, snap = await _insert_bill(
            label=label,
            amount=amount,
            bill_group_id="utilities" if index < 2 else None,
            show_in_group=index < 2,
            planned_amount=amount,
        )
        bills_snapshot.update(snap)
        flat_rows.append(
            {
                "amount_due": amount,
                "planned_amount": amount,
                "counts_toward_cash_plan": True,
                "payment_rail": "bank",
            }
        )

    liability_bill_id, liability_bill_snap = await _insert_bill(
        label="HOA",
        amount="200.00",
        worksheet_section="liabilities",
        bill_group_id="liability-group",
        show_in_group=True,
        planned_amount="200.00",
    )
    bills_snapshot.update(liability_bill_snap)

    liabilities_snapshot = {
        "loan-1": {
            "name": "Mortgage",
            "owed": "250000.00",
            "default_planned_payment": "1800.00",
        }
    }
    await sidecar_db.upsert_bill_group(id="utilities", label="Utilities", sort_order=0)
    await sidecar_db.upsert_bill_group(
        id="liability-group",
        label="Liability Group",
        sort_order=1,
    )
    await _seed_refresh(
        bills_snapshot=bills_snapshot,
        liabilities_snapshot=liabilities_snapshot,
    )
    await sidecar_db.upsert_worksheet_state_row(
        row_key="liability:loan-1",
        row_type="liability",
        month="2026-07",
        planned_amount="1800.00",
        planned_amount_override=0,
    )

    expected_section = compute_section_subtotals(
        flat_rows,
        [
            {
                "account_id": "loan-1",
                "owed": "250000.00",
                "amount_due": "1800.00",
                "planned_amount": "1800.00",
            },
            {
                "amount_due": "200.00",
                "planned_amount": "200.00",
                "counts_toward_cash_plan": True,
                "payment_rail": "bank",
            },
        ],
        [],
    )
    expected_grand = compute_grand_totals(flat_rows, [
            {
                "account_id": "loan-1",
                "owed": "250000.00",
                "amount_due": "1800.00",
                "planned_amount": "1800.00",
            },
            {
                "amount_due": "200.00",
                "planned_amount": "200.00",
                "counts_toward_cash_plan": True,
                "payment_rail": "bank",
            },
        ], [])

    envelope = await build_worksheet_envelope("2026-07")
    assert envelope["section_subtotals"]["bills"] == expected_section["bills"]
    assert envelope["section_subtotals"]["liabilities"] == expected_section["liabilities"]
    assert envelope["grand_totals"] == expected_grand
    assert envelope["bills"][0]["bill_group_id"] is not None


@pytest.mark.asyncio
async def test_bucket_rollups_unchanged_with_grouped_bills(data_dir):
    await _seed_funding_bucket()

    bills_snapshot: dict[str, dict[str, str]] = {}
    for label, amount in (("Electric", "150.00"), ("Water", "75.00")):
        _, snap = await _insert_bill(
            label=label,
            amount=amount,
            bill_group_id="utilities",
            show_in_group=True,
            planned_amount=amount,
        )
        bills_snapshot.update(snap)

    await sidecar_db.upsert_bill_group(id="utilities", label="Utilities", sort_order=0)
    await _seed_refresh(bills_snapshot=bills_snapshot)

    grouped_envelope = await build_worksheet_envelope("2026-07")
    grouped_rollups = grouped_envelope["buckets"][0]["planned_outflows"]

    for reg_row in await sidecar_db.list_worksheet_registry():
        await sidecar_db.update_worksheet_registry(
            reg_row["id"],
            {"bill_group_id": None, "show_in_group": False},
        )

    ungrouped_envelope = await build_worksheet_envelope("2026-07")
    ungrouped_rollups = ungrouped_envelope["buckets"][0]["planned_outflows"]

    assert grouped_rollups == ungrouped_rollups == "225.00"
    assert grouped_envelope["totals"] == ungrouped_envelope["totals"]
