"""Bill registration wizard orchestration (PAY-13, PAY-17, #21)."""

from __future__ import annotations

import json
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

import sidecar_db
from firefly_client import FireflyClient
from pydantic import BaseModel, field_validator

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")


class BillRegistrationError(Exception):
    def __init__(self, detail: str, status_code: int = 422) -> None:
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


class RegisterBillBody(BaseModel):
    mode: Literal["create_new", "link_existing"]
    name: str
    amount: str
    amount_mode: Literal["recurring", "intermittent"]
    repeat_freq: str | None = None
    worksheet_section: Literal["bills", "liabilities"]
    payment_rail: Literal["bank", "credit_card"]
    funding_bucket_key: str | None = None
    credit_card_account_id: str | None = None
    description_contains: str = ""
    amount_exactly: str | None = None
    firefly_bill_id: str | None = None
    rule_id: str | None = None

    @field_validator("name")
    @classmethod
    def name_non_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must be non-empty")
        return stripped


def _rule_group_title() -> str:
    raw = os.environ.get("FF3ANALYTICS_PAYMENT_WORKSHEET_RULE_GROUP", "").strip()
    return raw or "Payment worksheet"


def _planned_sync_for_amount_mode(amount_mode: str) -> str:
    return "fixed" if amount_mode == "recurring" else "manual"


def _sanitize_description_contains(value: str) -> str:
    cleaned = _CONTROL_CHAR_RE.sub("", value or "").strip()
    if not cleaned:
        raise BillRegistrationError("description_contains must be non-empty.")
    if len(cleaned) > 255:
        raise BillRegistrationError("description_contains must be at most 255 characters.")
    return cleaned


def _format_amount(value: str) -> str:
    try:
        amount = Decimal(str(value).replace(",", ""))
    except (InvalidOperation, ValueError):
        raise BillRegistrationError("invalid amount") from None
    return f"{amount.quantize(Decimal('0.01'))}"


def _validate_rail_fields(body: RegisterBillBody) -> None:
    if body.payment_rail == "credit_card":
        if not (body.credit_card_account_id or "").strip():
            raise BillRegistrationError(
                "credit_card_account_id is required for credit_card payment rail."
            )
    elif body.payment_rail == "bank":
        if not (body.funding_bucket_key or "").strip():
            raise BillRegistrationError(
                "funding_bucket_key is required for bank payment rail."
            )


async def _validate_bucket_exists(bucket_key: str) -> None:
    bucket = await sidecar_db.get_funding_bucket(bucket_key)
    if bucket is None:
        raise BillRegistrationError(f"Unknown funding bucket: {bucket_key}")


async def _registered_bill_ids() -> set[str]:
    rows = await sidecar_db.list_worksheet_registry()
    return {
        str(row["firefly_bill_id"])
        for row in rows
        if row.get("firefly_bill_id")
    }


def build_bill_link_rule_body(
    *,
    bill_id: str,
    title: str,
    description_contains: str,
    amount_exactly: str | None,
    rule_group_id: str,
) -> dict[str, Any]:
    triggers: list[dict[str, Any]] = [
        {
            "type": "description_contains",
            "value": description_contains,
            "active": True,
        },
    ]
    if amount_exactly:
        triggers.append(
            {
                "type": "amount_exactly",
                "value": amount_exactly,
                "active": True,
            }
        )
    return {
        "title": title.strip(),
        "rule_group_id": rule_group_id,
        "trigger": "store-journal",
        "active": True,
        "strict": len(triggers) > 1,
        "triggers": triggers,
        "actions": [
            {"type": "link_to_bill", "value": bill_id, "active": True},
        ],
    }


async def _validate_existing_rule_links_bill(
    client: FireflyClient, rule_id: str, bill_id: str
) -> None:
    rules = await client.fetch_rules()
    rule = next((row for row in rules if str(row.get("id")) == str(rule_id)), None)
    if rule is None:
        raise BillRegistrationError(f"Unknown rule id: {rule_id}")
    for action in rule.get("actions") or []:
        if (
            action.get("type") == "link_to_bill"
            and str(action.get("value")) == str(bill_id)
        ):
            return
    raise BillRegistrationError(
        "rule_id does not link to the selected Firefly bill."
    )


async def _create_link_rule(
    client: FireflyClient,
    *,
    bill_id: str,
    title: str,
    description_contains: str,
    amount_exactly: str | None,
) -> str:
    trigger_text = _sanitize_description_contains(description_contains)
    amount_trigger = None
    if amount_exactly and str(amount_exactly).strip():
        amount_trigger = _format_amount(str(amount_exactly))
    group_id = await client.ensure_rule_group(_rule_group_title())
    rule_body = build_bill_link_rule_body(
        bill_id=bill_id,
        title=title,
        description_contains=trigger_text,
        amount_exactly=amount_trigger,
        rule_group_id=group_id,
    )
    created = await client.create_rule(rule_body)
    return str(created["id"])


async def register_new_bill(
    client: FireflyClient, body: RegisterBillBody
) -> dict[str, Any]:
    _validate_rail_fields(body)
    if body.payment_rail == "bank":
        await _validate_bucket_exists(str(body.funding_bucket_key))
    trigger_text = _sanitize_description_contains(body.description_contains)
    amount = _format_amount(body.amount)
    bill_body = {
        "name": body.name,
        "amount_min": amount,
        "amount_max": amount,
        "repeat_freq": (body.repeat_freq or "monthly").strip() or "monthly",
    }
    try:
        created_bill = await client.create_bill(bill_body)
    except RuntimeError as exc:
        raise BillRegistrationError(str(exc), status_code=502) from exc
    bill_id = str(created_bill["id"])
    amount_trigger = body.amount_exactly
    if amount_trigger and str(amount_trigger).strip():
        amount_trigger = _format_amount(str(amount_trigger))
    else:
        amount_trigger = amount
    rule_id = await _create_link_rule(
        client,
        bill_id=bill_id,
        title=body.name,
        description_contains=trigger_text,
        amount_exactly=amount_trigger,
    )
    registry_id = await insert_worksheet_registry(
        firefly_bill_id=bill_id,
        rule_id=rule_id,
        body=body,
    )
    return await _registry_response(registry_id)


async def register_linked_bill(
    client: FireflyClient, body: RegisterBillBody
) -> dict[str, Any]:
    bill_id = (body.firefly_bill_id or "").strip()
    if not bill_id:
        raise BillRegistrationError("firefly_bill_id is required for link_existing.")
    _validate_rail_fields(body)
    if body.payment_rail == "bank":
        await _validate_bucket_exists(str(body.funding_bucket_key))
    if bill_id in await _registered_bill_ids():
        raise BillRegistrationError("Bill is already registered on the worksheet.")
    try:
        await client.fetch_bill(bill_id)
    except RuntimeError as exc:
        raise BillRegistrationError(str(exc), status_code=422) from exc
    if body.rule_id and str(body.rule_id).strip():
        rule_id = str(body.rule_id).strip()
        await _validate_existing_rule_links_bill(client, rule_id, bill_id)
    elif (body.description_contains or "").strip():
        rule_id = await _create_link_rule(
            client,
            bill_id=bill_id,
            title=body.name,
            description_contains=body.description_contains,
            amount_exactly=body.amount_exactly,
        )
    else:
        raise BillRegistrationError(
            "link_existing requires rule_id or description_contains to create a rule."
        )
    registry_id = await insert_worksheet_registry(
        firefly_bill_id=bill_id,
        rule_id=rule_id,
        body=body,
    )
    return await _registry_response(registry_id)


async def insert_worksheet_registry(
    *,
    firefly_bill_id: str,
    rule_id: str,
    body: RegisterBillBody,
) -> int:
    planned_sync = _planned_sync_for_amount_mode(body.amount_mode)
    registry_id = await sidecar_db.insert_worksheet_registry(
        {
            "firefly_bill_id": firefly_bill_id,
            "worksheet_section": body.worksheet_section,
            "funding_bucket_key": body.funding_bucket_key,
            "amount_mode": body.amount_mode,
            "planned_sync": planned_sync,
            "payment_rail": body.payment_rail,
            "rule_id": rule_id,
            "row_label": body.name,
            "credit_card_account_id": body.credit_card_account_id,
        }
    )
    await sidecar_db.log_audit(
        "payment_worksheet_bill_register",
        details_json=json.dumps(
            {
                "registry_id": registry_id,
                "firefly_bill_id": firefly_bill_id,
                "rule_id": rule_id,
                "mode": body.mode,
                "worksheet_section": body.worksheet_section,
                "payment_rail": body.payment_rail,
            }
        ),
    )
    return registry_id


async def _registry_response(registry_id: int) -> dict[str, Any]:
    row = await sidecar_db.get_worksheet_registry(registry_id)
    if row is None:
        raise BillRegistrationError("Failed to load registry row.", status_code=500)
    return row


async def register_bill(
    client: FireflyClient, body: RegisterBillBody
) -> dict[str, Any]:
    """Create or link a Firefly bill with matching rule and registry row."""
    if body.mode == "create_new":
        return await register_new_bill(client, body)
    return await register_linked_bill(client, body)
