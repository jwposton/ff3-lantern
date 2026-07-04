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
from payment_worksheet_bill_history import bill_history_date_window
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
    amount: str = ""
    amount_min: str | None = None
    amount_max: str | None = None
    amount_mode: Literal["recurring", "intermittent"]
    repeat_freq: str | None = None
    worksheet_section: Literal["bills", "liabilities"]
    payment_rail: Literal["bank", "credit_card"]
    funding_bucket_key: str | None = None
    credit_card_account_id: str | None = None
    description_contains: str = ""
    destination_account: str = ""
    category_name: str = ""
    amount_exactly: str | None = None
    firefly_bill_id: str | None = None
    rule_id: str | None = None
    bill_group_id: str | None = None
    show_in_group: bool = False

    @field_validator("name")
    @classmethod
    def name_non_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must be non-empty")
        return stripped


def _rule_group_title() -> str:
    raw = os.environ.get("FF3LANTERN_PAYMENT_WORKSHEET_RULE_GROUP", "").strip()
    return raw or "Payment worksheet"


def _bill_object_group_title() -> str:
    raw = os.environ.get("FF3LANTERN_PAYMENT_WORKSHEET_BILL_GROUP", "").strip()
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
    description_contains: str, destination_account: str, category_name: str
) -> tuple[str, str, str]:
    desc = _sanitize_optional_trigger_text(
        description_contains, field_name="description_contains"
    )
    payee = _sanitize_optional_trigger_text(
        destination_account, field_name="destination_account"
    )
    category = _sanitize_optional_trigger_text(
        category_name, field_name="category_name"
    )
    if not desc and not payee and not category:
        raise BillRegistrationError(
            "At least one rule trigger is required: payee contains, "
            "description contains, and/or category."
        )
    return desc, payee, category


def _parse_amount(value: str) -> Decimal:
    try:
        return Decimal(str(value).replace(",", ""))
    except (InvalidOperation, ValueError):
        raise BillRegistrationError("invalid amount") from None


def _format_amount(value: str) -> str:
    return f"{_parse_amount(value).quantize(Decimal('0.01'))}"


# Firefly BillStore requires amount_min/max > 0; intermittent worksheet rows start at $0.
_INTERMITTENT_BILL_AMOUNT_MIN = "1.00"
_INTERMITTENT_BILL_AMOUNT_MAX = "99999.99"


def _optional_amount_text(value: str | None) -> str:
    return (value or "").strip()


def _resolve_firefly_bill_amounts(body: RegisterBillBody) -> tuple[str, str]:
    min_raw = _optional_amount_text(body.amount_min)
    max_raw = _optional_amount_text(body.amount_max)
    legacy = _optional_amount_text(body.amount)
    if not min_raw and not max_raw and legacy:
        min_raw = max_raw = legacy
    if min_raw and not max_raw:
        max_raw = min_raw
    elif max_raw and not min_raw:
        min_raw = max_raw
    if not min_raw and not max_raw:
        if body.amount_mode == "intermittent":
            return _INTERMITTENT_BILL_AMOUNT_MIN, _INTERMITTENT_BILL_AMOUNT_MAX
        raise BillRegistrationError(
            "Amount min or max is required for recurring bills."
        )
    parsed_min = _parse_amount(min_raw)
    parsed_max = _parse_amount(max_raw)
    if parsed_min <= 0 or parsed_max <= 0:
        raise BillRegistrationError("Bill amounts must be greater than zero.")
    if parsed_min > parsed_max:
        raise BillRegistrationError("Amount min cannot exceed amount max.")
    return _format_amount(min_raw), _format_amount(max_raw)


def compute_recurring_bill_owed(amount_min: str, amount_max: str) -> str:
    lo = _parse_amount(amount_min)
    hi = _parse_amount(amount_max)
    return f"{((lo + hi) / Decimal('2')).quantize(Decimal('0.01'))}"


def compute_bill_owed_from_firefly(
    ff_bill: dict[str, Any], *, amount_mode: str
) -> str:
    if amount_mode == "intermittent":
        return "0.00"
    amount_min = str(ff_bill.get("amount_min") or "").strip()
    amount_max = str(ff_bill.get("amount_max") or "").strip()
    if not amount_min and not amount_max:
        return "0.00"
    if not amount_min:
        amount_min = amount_max
    if not amount_max:
        amount_max = amount_min
    return compute_recurring_bill_owed(amount_min, amount_max)


def _firefly_bill_amounts(body: RegisterBillBody) -> tuple[str, str]:
    return _resolve_firefly_bill_amounts(body)


def _rule_amount_trigger(
    body: RegisterBillBody, *, amount_min: str, amount_max: str
) -> str | None:
    explicit = (body.amount_exactly or "").strip()
    if explicit:
        formatted = _format_amount(explicit)
        if _parse_amount(formatted) <= 0:
            return None
        return formatted
    if body.amount_mode != "recurring":
        return None
    if amount_min == amount_max and _parse_amount(amount_min) > 0:
        return amount_min
    return None


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
    category_name: str,
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
    if category_name:
        triggers.append(
            {
                "type": "category_is",
                "value": category_name,
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
        category_name = next(
            (
                str(trigger.get("value") or "").strip()
                for trigger in triggers
                if trigger.get("type") == "category_is"
            ),
            "",
        )
        summarized.append(
            {
                "id": str(rule.get("id")),
                "title": rule.get("title"),
                "description_contains": description_contains or None,
                "payee_contains": payee_contains or None,
                "category_name": category_name or None,
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
    category_name: str,
    amount_exactly: str | None,
) -> str:
    trigger_desc, trigger_payee, trigger_category = _validate_rule_triggers(
        description_contains, destination_account, category_name
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
        category_name=trigger_category,
        amount_exactly=amount_trigger,
        rule_group_id=group_id,
    )
    created = await client.create_rule(rule_body)
    return str(created["id"])


async def _trigger_bill_link_rule(client: FireflyClient, rule_id: str) -> None:
    start, end = bill_history_date_window()
    details = {"rule_id": rule_id, "start": start, "end": end}
    try:
        await client.trigger_rule(rule_id, start, end)
        await sidecar_db.log_audit(
            "bill_link_rule_trigger",
            details_json=json.dumps(details),
        )
    except RuntimeError as exc:
        await sidecar_db.log_audit(
            "bill_link_rule_trigger_failed",
            details_json=json.dumps({**details, "error": str(exc)}),
        )


async def register_new_bill(
    client: FireflyClient, body: RegisterBillBody
) -> dict[str, Any]:
    _validate_rail_fields(body)
    if body.payment_rail == "bank":
        await _validate_bucket_exists(str(body.funding_bucket_key))
    trigger_desc, trigger_payee, trigger_category = _validate_rule_triggers(
        body.description_contains, body.destination_account, body.category_name
    )
    amount_min, amount_max = _firefly_bill_amounts(body)
    bill_body: dict[str, Any] = {
        "name": body.name,
        "amount_min": amount_min,
        "amount_max": amount_max,
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
    amount_trigger = _rule_amount_trigger(
        body, amount_min=amount_min, amount_max=amount_max
    )
    try:
        rule_id = await _create_link_rule(
            client,
            bill_id=bill_id,
            bill_name=body.name,
            title=body.name,
            description_contains=trigger_desc,
            destination_account=trigger_payee,
            category_name=trigger_category,
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
    await _trigger_bill_link_rule(client, rule_id)
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
    ).strip() or (body.category_name or "").strip():
        rule_id = await _create_link_rule(
            client,
            bill_id=bill_id,
            bill_name=bill_name,
            title=body.name,
            description_contains=body.description_contains,
            destination_account=body.destination_account,
            category_name=body.category_name,
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
    if created_rule:
        await _trigger_bill_link_rule(client, rule_id)
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


def _resolve_firefly_bill_amount_update(
    *,
    amount_min: str | None,
    amount_max: str | None,
    amount_mode: str,
    current_min: str | None,
    current_max: str | None,
) -> tuple[str, str]:
    min_raw = _optional_amount_text(amount_min) or _optional_amount_text(current_min)
    max_raw = _optional_amount_text(amount_max) or _optional_amount_text(current_max)
    if not min_raw and not max_raw:
        if amount_mode == "intermittent":
            return _INTERMITTENT_BILL_AMOUNT_MIN, _INTERMITTENT_BILL_AMOUNT_MAX
        raise BillRegistrationError(
            "Amount min or max is required for recurring bills."
        )
    if min_raw and not max_raw:
        max_raw = min_raw
    elif max_raw and not min_raw:
        min_raw = max_raw
    parsed_min = _parse_amount(min_raw)
    parsed_max = _parse_amount(max_raw)
    if parsed_min <= 0 or parsed_max <= 0:
        raise BillRegistrationError("Bill amounts must be greater than zero.")
    if parsed_min > parsed_max:
        raise BillRegistrationError("Amount min cannot exceed amount max.")
    return _format_amount(min_raw), _format_amount(max_raw)


async def update_linked_firefly_bill(
    client: FireflyClient,
    *,
    firefly_bill_id: str,
    name: str | None = None,
    amount_min: str | None = None,
    amount_max: str | None = None,
    repeat_freq: str | None = None,
    amount_mode: str = "recurring",
) -> None:
    firefly_fields = (name, amount_min, amount_max, repeat_freq)
    if not any(value is not None for value in firefly_fields):
        return
    try:
        current = await client.fetch_bill(firefly_bill_id)
    except RuntimeError as exc:
        raise BillRegistrationError(str(exc), status_code=502) from exc

    resolved_name = name.strip() if name is not None else (current.get("name") or "")
    if not resolved_name:
        raise BillRegistrationError("Bill name is required.")

    resolved_min, resolved_max = _resolve_firefly_bill_amount_update(
        amount_min=amount_min,
        amount_max=amount_max,
        amount_mode=amount_mode,
        current_min=current.get("amount_min"),
        current_max=current.get("amount_max"),
    )
    bill_body: dict[str, Any] = {
        "name": resolved_name,
        "amount_min": resolved_min,
        "amount_max": resolved_max,
        "date": _default_bill_date(),
        "repeat_freq": (
            (repeat_freq or current.get("repeat_freq") or "monthly").strip()
            or "monthly"
        ),
        "active": True,
    }
    group_title = _bill_object_group_title()
    if group_title:
        bill_body["object_group_title"] = group_title
    try:
        await client.update_bill(firefly_bill_id, bill_body)
    except RuntimeError as exc:
        raise BillRegistrationError(str(exc), status_code=502) from exc


def serialize_bill_registry_for_edit(
    registry: dict[str, Any],
    firefly_bill: dict[str, Any],
) -> dict[str, Any]:
    return {
        "registry_id": registry["id"],
        "row_label": registry.get("row_label"),
        "firefly_bill_id": registry.get("firefly_bill_id"),
        "worksheet_section": registry.get("worksheet_section"),
        "payment_rail": registry.get("payment_rail"),
        "amount_mode": registry.get("amount_mode"),
        "funding_bucket_key": registry.get("funding_bucket_key"),
        "credit_card_account_id": registry.get("credit_card_account_id"),
        "name": firefly_bill.get("name"),
        "amount_min": firefly_bill.get("amount_min"),
        "amount_max": firefly_bill.get("amount_max"),
        "repeat_freq": firefly_bill.get("repeat_freq"),
    }
