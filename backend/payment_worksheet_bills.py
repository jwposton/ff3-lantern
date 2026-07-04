"""Bill registration wizard orchestration (PAY-13, PAY-17, #21)."""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime
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
    destination_account: str = ""
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


def _bill_object_group_title() -> str:
    raw = os.environ.get("FF3ANALYTICS_PAYMENT_WORKSHEET_BILL_GROUP", "").strip()
    return raw or _rule_group_title()


def _planned_sync_for_amount_mode(amount_mode: str) -> str:
    return "fixed" if amount_mode == "recurring" else "manual"


def _default_bill_date() -> str:
    """First day of current UTC month — required by Firefly BillStore."""
    today = datetime.now(UTC)
    first = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return first.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _sanitize_optional_trigger_text(value: str, *, field_name: str) -> str:
    cleaned = _CONTROL_CHAR_RE.sub("", value or "").strip()
    if len(cleaned) > 255:
        raise BillRegistrationError(f"{field_name} must be at most 255 characters.")
    return cleaned


def _validate_rule_triggers(
    description_contains: str, destination_account: str
) -> tuple[str, str]:
    desc = _sanitize_optional_trigger_text(
        description_contains, field_name="description_contains"
    )
    payee = _sanitize_optional_trigger_text(
        destination_account, field_name="destination_account"
    )
    if not desc and not payee:
        raise BillRegistrationError(
            "At least one rule trigger is required: description contains "
            "and/or payee contains."
        )
    return desc, payee


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
    bill_name: str,
    title: str,
    description_contains: str,
    destination_account: str,
    amount_exactly: str | None,
    rule_group_id: str,
) -> dict[str, Any]:
    link_value = bill_name.strip()
    if not link_value:
        raise BillRegistrationError("bill name is required for link_to_bill rule action.")
    triggers: list[dict[str, Any]] = []
    if description_contains:
        triggers.append(
            {
                "type": "description_contains",
                "value": description_contains,
                "active": True,
            }
        )
    if destination_account:
        triggers.append(
            {
                "type": "destination_account_contains",
                "value": destination_account,
                "active": True,
            }
        )
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
            {"type": "link_to_bill", "value": link_value, "active": True},
        ],
    }


def _summarize_link_rules(rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summarized: list[dict[str, Any]] = []
    for rule in rules:
        triggers = rule.get("triggers") or []
        description_contains = next(
            (
                str(trigger.get("value") or "").strip()
                for trigger in triggers
                if trigger.get("type") == "description_contains"
            ),
            "",
        )
        amount_exactly = next(
            (
                str(trigger.get("value") or "").strip()
                for trigger in triggers
                if trigger.get("type") == "amount_exactly"
            ),
            "",
        )
        payee_contains = next(
            (
                str(trigger.get("value") or "").strip()
                for trigger in triggers
                if str(trigger.get("type") or "").startswith("destination_account")
            ),
            "",
        )
        summarized.append(
            {
                "id": str(rule.get("id")),
                "title": rule.get("title"),
                "description_contains": description_contains or None,
                "payee_contains": payee_contains or None,
                "amount_exactly": amount_exactly or None,
            }
        )
    return summarized


def find_link_rules_for_bill(
    rules: list[dict[str, Any]], bill_id: str, *, bill_name: str | None = None
) -> list[dict[str, Any]]:
    """Return rules whose link_to_bill action targets bill id or name."""
    targets = {str(bill_id)}
    if bill_name and str(bill_name).strip():
        targets.add(str(bill_name).strip())
    matched: list[dict[str, Any]] = []
    for rule in rules:
        actions = rule.get("actions") or []
        if not any(
            action.get("type") == "link_to_bill"
            and str(action.get("value") or "").strip() in targets
            for action in actions
        ):
            continue
        matched.append(rule)
    return _summarize_link_rules(matched)


async def list_link_rules_for_bill(
    client: FireflyClient, bill_id: str
) -> list[dict[str, Any]]:
    bill_id = str(bill_id).strip()
    if not bill_id:
        raise BillRegistrationError("bill_id is required.")
    try:
        await client.fetch_bill(bill_id)
    except RuntimeError as exc:
        raise BillRegistrationError(str(exc), status_code=422) from exc
    try:
        rules = await client.fetch_bill_rules(bill_id)
    except RuntimeError as exc:
        raise BillRegistrationError(str(exc), status_code=502) from exc
    return _summarize_link_rules(rules)


async def _validate_existing_rule_links_bill(
    client: FireflyClient, rule_id: str, bill_id: str, *, bill_name: str | None = None
) -> None:
    rules = await client.fetch_rules()
    rule = next((row for row in rules if str(row.get("id")) == str(rule_id)), None)
    if rule is None:
        raise BillRegistrationError(f"Unknown rule id: {rule_id}")
    targets = {str(bill_id)}
    if bill_name and str(bill_name).strip():
        targets.add(str(bill_name).strip())
    for action in rule.get("actions") or []:
        if (
            action.get("type") == "link_to_bill"
            and str(action.get("value") or "").strip() in targets
        ):
            return
    raise BillRegistrationError(
        "rule_id does not link to the selected Firefly bill."
    )


async def _create_link_rule(
    client: FireflyClient,
    *,
    bill_id: str,
    bill_name: str,
    title: str,
    description_contains: str,
    destination_account: str,
    amount_exactly: str | None,
) -> str:
    trigger_desc, trigger_payee = _validate_rule_triggers(
        description_contains, destination_account
    )
    amount_trigger = None
    if amount_exactly and str(amount_exactly).strip():
        amount_trigger = _format_amount(str(amount_exactly))
    group_id = await client.ensure_rule_group(_rule_group_title())
    rule_body = build_bill_link_rule_body(
        bill_name=bill_name,
        title=title,
        description_contains=trigger_desc,
        destination_account=trigger_payee,
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
    trigger_desc, trigger_payee = _validate_rule_triggers(
        body.description_contains, body.destination_account
    )
    amount = _format_amount(body.amount)
    bill_body: dict[str, Any] = {
        "name": body.name,
        "amount_min": amount,
        "amount_max": amount,
        "date": _default_bill_date(),
        "repeat_freq": (body.repeat_freq or "monthly").strip() or "monthly",
        "active": True,
    }
    group_title = _bill_object_group_title()
    if group_title:
        bill_body["object_group_title"] = group_title
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
    try:
        rule_id = await _create_link_rule(
            client,
            bill_id=bill_id,
            bill_name=body.name,
            title=body.name,
            description_contains=trigger_desc,
            destination_account=trigger_payee,
            amount_exactly=amount_trigger,
        )
    except Exception as exc:
        try:
            await client.delete_bill(bill_id)
        except RuntimeError:
            pass
        if isinstance(exc, BillRegistrationError):
            raise
        raise BillRegistrationError(str(exc), status_code=502) from exc
    try:
        registry_id = await insert_worksheet_registry(
            firefly_bill_id=bill_id,
            rule_id=rule_id,
            body=body,
        )
    except Exception as exc:
        try:
            await client.delete_rule(rule_id)
        except RuntimeError:
            pass
        try:
            await client.delete_bill(bill_id)
        except RuntimeError:
            pass
        raise BillRegistrationError(
            f"Registry insert failed after creating Firefly bill {bill_id} "
            f"and rule {rule_id}.",
            status_code=500,
        ) from exc
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
        bill = await client.fetch_bill(bill_id)
    except RuntimeError as exc:
        raise BillRegistrationError(str(exc), status_code=422) from exc
    bill_name = str(bill.get("name") or body.name).strip()
    created_rule = False
    if body.rule_id and str(body.rule_id).strip():
        rule_id = str(body.rule_id).strip()
        await _validate_existing_rule_links_bill(
            client, rule_id, bill_id, bill_name=bill_name
        )
    elif (body.description_contains or "").strip() or (
        body.destination_account or ""
    ).strip():
        rule_id = await _create_link_rule(
            client,
            bill_id=bill_id,
            bill_name=bill_name,
            title=body.name,
            description_contains=body.description_contains,
            destination_account=body.destination_account,
            amount_exactly=body.amount_exactly,
        )
        created_rule = True
    else:
        raise BillRegistrationError(
            "link_existing requires rule_id or rule triggers to create a rule."
        )
    try:
        registry_id = await insert_worksheet_registry(
            firefly_bill_id=bill_id,
            rule_id=rule_id,
            body=body,
        )
    except Exception as exc:
        if created_rule:
            try:
                await client.delete_rule(rule_id)
            except RuntimeError:
                pass
        raise BillRegistrationError(
            f"Registry insert failed for Firefly bill {bill_id} and rule {rule_id}.",
            status_code=500,
        ) from exc
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
