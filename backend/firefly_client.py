"""Async Firefly III API client (httpx)."""

from __future__ import annotations

import logging
import os
import re
from copy import deepcopy
from typing import Any, Callable

import httpx

import firefly_reference_cache

logger = logging.getLogger(__name__)


def _format_firefly_error(response: httpx.Response) -> str:
    """Extract a short operator-facing message from a Firefly error response."""
    try:
        payload = response.json()
        if isinstance(payload, dict):
            message = payload.get("message")
            if message:
                return str(message)
            errors = payload.get("errors")
            if isinstance(errors, dict):
                parts: list[str] = []
                for field, msgs in errors.items():
                    if isinstance(msgs, list):
                        parts.extend(f"{field}: {m}" for m in msgs)
                    else:
                        parts.append(f"{field}: {msgs}")
                if parts:
                    return "; ".join(parts[:6])
    except Exception:
        pass
    text = response.text.strip()
    if len(text) > 400:
        return text[:400] + "…"
    return text or f"HTTP {response.status_code}"


_ACCOUNT_TYPE_MAP = {
    "asset": "Asset account",
    "expense": "Expense account",
    "revenue": "Revenue account",
    "liabilities": "Liabilities account",
}

_ACCOUNT_ROLE_MAP = {
    "creditcard": "Credit card",
    "ccasset": "Credit card",
    "defaultasset": "Default account",
}


def _normalize_account_type(raw: str | None) -> str | None:
    if raw is None:
        return None
    return _ACCOUNT_TYPE_MAP.get(raw.lower(), raw)


def _normalize_account_role(raw: str | None) -> str | None:
    if raw is None:
        return None
    key = raw.replace("_", "").lower()
    if key == "asset":
        return None
    return _ACCOUNT_ROLE_MAP.get(key, raw)


def _account_role_key(raw: str | None) -> str:
    return (raw or "").replace("_", "").lower()


def _map_bill_entry(entry: dict[str, Any]) -> dict[str, Any]:
    attrs = entry.get("attributes", {})
    repeat_freq = attrs.get("repeat_freq") or attrs.get("repeat_frequency")
    return {
        "id": str(entry.get("id")),
        "name": attrs.get("name"),
        "amount_min": attrs.get("amount_min"),
        "amount_max": attrs.get("amount_max"),
        "repeat_freq": repeat_freq,
    }


_MONTHLY_PAYMENT_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def _normalize_monthly_payment_date(raw: Any) -> str:
    """Return YYYY-MM-DD for Firefly ccAsset monthly_payment_date validation."""
    if raw is None:
        return "2000-01-01"
    text = str(raw).strip()
    if not text:
        return "2000-01-01"
    match = _MONTHLY_PAYMENT_DATE_RE.match(text)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    if text.isdigit():
        day = int(text)
        if 1 <= day <= 31:
            return f"2000-01-{day:02d}"
    return "2000-01-01"


def prepare_account_update_payload(
    attrs: dict[str, Any],
    **updates: Any,
) -> dict[str, Any]:
    """Build a Firefly-safe PUT body from GET attributes plus field updates."""
    merged = {**attrs, **updates}
    acct_type = str(merged.get("type") or "").lower()
    role_key = _account_role_key(merged.get("account_role"))

    asset_fields = {
        "name",
        "active",
        "type",
        "account_role",
        "currency_id",
        "currency_code",
        "virtual_balance",
        "include_net_worth",
        "iban",
        "bic",
        "account_number",
        "opening_balance",
        "opening_balance_date",
        "notes",
        "credit_card_type",
        "monthly_payment_date",
    }
    liability_fields = {
        "name",
        "active",
        "type",
        "account_role",
        "currency_id",
        "currency_code",
        "virtual_balance",
        "include_net_worth",
        "iban",
        "bic",
        "account_number",
        "opening_balance",
        "opening_balance_date",
        "notes",
        "liability_type",
        "liability_direction",
        "interest",
        "interest_period",
    }
    generic_fields = {
        "name",
        "active",
        "type",
        "account_role",
        "currency_id",
        "currency_code",
        "virtual_balance",
        "include_net_worth",
        "notes",
    }

    if acct_type == "asset":
        allowed = asset_fields
    elif acct_type in {"liabilities", "liability"}:
        allowed = liability_fields
    else:
        allowed = generic_fields

    payload: dict[str, Any] = {}
    for key in allowed:
        if key in updates:
            value = updates[key]
        else:
            value = merged.get(key)
        if value is not None:
            payload[key] = value

    if role_key in {"ccasset", "creditcard"}:
        payload.setdefault("type", "asset")
        payload.setdefault("account_role", merged.get("account_role") or "ccAsset")
        payload.setdefault(
            "credit_card_type",
            merged.get("credit_card_type") or "monthlyFull",
        )
        payload["monthly_payment_date"] = _normalize_monthly_payment_date(
            payload.get("monthly_payment_date", merged.get("monthly_payment_date")),
        )

    if acct_type in {"liabilities", "liability"}:
        payload.setdefault("liability_type", merged.get("liability_type") or "loan")
        payload.setdefault(
            "liability_direction",
            merged.get("liability_direction") or "credit",
        )
        payload.setdefault("interest", merged.get("interest") or "0")
        payload.setdefault(
            "interest_period",
            merged.get("interest_period") or "monthly",
        )

    return payload


def _map_rule_entry(entry: dict[str, Any]) -> dict[str, Any]:
    attrs = entry.get("attributes", {})
    return {
        "id": str(entry.get("id")),
        "title": attrs.get("title"),
        "triggers": attrs.get("triggers") or [],
        "actions": attrs.get("actions") or [],
    }


def _included_index(included: list[dict[str, Any]] | None) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for item in included or []:
        item_id = item.get("id")
        item_type = item.get("type")
        if item_id is not None and item_type:
            index[(str(item_type), str(item_id))] = item
    return index


def _map_rule_detail(
    entry: dict[str, Any],
    *,
    included: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    attrs = entry.get("attributes", {})
    inc_idx = _included_index(included)
    rule_group_id = attrs.get("rule_group_id")
    rule_group_title = attrs.get("rule_group_title")
    if rule_group_id is not None:
        rule_group_id = str(rule_group_id)
    else:
        rel = entry.get("relationships", {}).get("rule_group", {}).get("data")
        if rel and rel.get("id") is not None:
            rule_group_id = str(rel["id"])
            rel_type = str(rel.get("type") or "rule_groups")
            inc_item = inc_idx.get((rel_type, rule_group_id))
            if inc_item and not rule_group_title:
                rule_group_title = inc_item.get("attributes", {}).get("title")
    return {
        "id": str(entry.get("id")),
        "title": attrs.get("title"),
        "trigger": attrs.get("trigger"),
        "active": attrs.get("active", True),
        "strict": attrs.get("strict", False),
        "triggers": attrs.get("triggers") or [],
        "actions": attrs.get("actions") or [],
        "rule_group_id": rule_group_id,
        "rule_group_title": rule_group_title,
    }


class FireflyClient:
    """Fetch accounts and transaction splits from Firefly III (no stub fallback)."""

    def __init__(
        self,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        base_url: str | None = None,
        api_token: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get("FIREFLY_BASE_URL", "")).rstrip("/")
        self.api_token = api_token or os.environ.get("FIREFLY_API_TOKEN", "")
        if not self.base_url or not self.api_token:
            raise ValueError("Missing FIREFLY_BASE_URL or FIREFLY_API_TOKEN in environment.")
        self._transport = transport
        self._owns_client = transport is None

    def _build_client(self) -> httpx.AsyncClient:
        if self._transport is not None:
            return httpx.AsyncClient(
                transport=self._transport,
                base_url=self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_token}",
                    "Accept": "application/json",
                },
                timeout=httpx.Timeout(30.0, connect=10.0),
            )
        return httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(retries=1),
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_token}",
                "Accept": "application/json",
            },
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    async def fetch_accounts(self) -> dict[str, dict[str, Any]]:
        cached = firefly_reference_cache.get("accounts")
        if cached is not None:
            return cached
        accounts: dict[str, dict[str, Any]] = {}
        page = 1
        async with self._build_client() as client:
            while True:
                response = await client.get(
                    "/api/v1/accounts", params={"limit": 1000, "page": page}
                )
                if response.status_code != 200:
                    raise RuntimeError(
                        f"Firefly API error {response.status_code}: {response.text}"
                    )
                payload = response.json()
                for acct in payload.get("data", []):
                    aid = str(acct.get("id"))
                    attrs = acct.get("attributes", {})
                    accounts[aid] = {
                        "name": attrs.get("name"),
                        "type": _normalize_account_type(attrs.get("type")),
                        "role": _normalize_account_role(attrs.get("account_role")),
                    }
                pagination = payload.get("meta", {}).get("pagination", {})
                current = pagination.get("current_page", 1)
                total_pages = pagination.get("total_pages", 1)
                logger.info("Fetched accounts page %s/%s", current, total_pages)
                if current >= total_pages:
                    break
                page += 1
        firefly_reference_cache.set("accounts", accounts)
        return accounts

    async def _fetch_paginated_list(
        self,
        path: str,
        *,
        map_item: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 1
        async with self._build_client() as client:
            while True:
                response = await client.get(
                    path, params={"limit": 1000, "page": page}
                )
                if response.status_code != 200:
                    raise RuntimeError(
                        f"Firefly API error {response.status_code}: {response.text}"
                    )
                payload = response.json()
                for entry in payload.get("data", []):
                    items.append(map_item(entry))
                pagination = payload.get("meta", {}).get("pagination", {})
                current = pagination.get("current_page", 1)
                total_pages = pagination.get("total_pages", 1)
                if current >= total_pages:
                    break
                page += 1
        return items

    async def fetch_categories(self) -> list[dict[str, Any]]:
        cached = firefly_reference_cache.get("categories")
        if cached is not None:
            return cached
        categories = await self._fetch_paginated_list(
            "/api/v1/categories",
            map_item=lambda entry: {
                "id": str(entry.get("id")),
                "name": entry.get("attributes", {}).get("name"),
            },
        )
        firefly_reference_cache.set("categories", categories)
        return categories

    async def fetch_budgets(self) -> list[dict[str, Any]]:
        cached = firefly_reference_cache.get("budgets")
        if cached is not None:
            return cached
        budgets = await self._fetch_paginated_list(
            "/api/v1/budgets",
            map_item=lambda entry: {
                "id": str(entry.get("id")),
                "name": entry.get("attributes", {}).get("name"),
            },
        )
        firefly_reference_cache.set("budgets", budgets)
        return budgets

    async def fetch_rules(self) -> list[dict[str, Any]]:
        return await self._fetch_paginated_list(
            "/api/v1/rules",
            map_item=_map_rule_entry,
        )

    async def fetch_rule(self, rule_id: str) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.get(
                f"/api/v1/rules/{rule_id}",
                params={"include": "ruleGroup"},
            )
            if response.status_code != 200:
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {response.text}"
                )
            payload = response.json()
            return _map_rule_detail(
                payload.get("data", {}),
                included=payload.get("included"),
            )

    async def update_rule(
        self, rule_id: str, rule_body: dict[str, Any]
    ) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.put(f"/api/v1/rules/{rule_id}", json=rule_body)
            if response.status_code not in (200, 201):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {_format_firefly_error(response)}"
                )
            payload = response.json()
            data = payload.get("data", {})
            attrs = data.get("attributes", {})
            return {
                "id": str(data.get("id")),
                "title": attrs.get("title"),
            }

    async def fetch_rule_groups(self) -> list[dict[str, Any]]:
        return await self._fetch_paginated_list(
            "/api/v1/rule-groups",
            map_item=lambda entry: {
                "id": str(entry.get("id")),
                "title": entry.get("attributes", {}).get("title"),
            },
        )

    async def fetch_bill_rules(self, bill_id: str) -> list[dict[str, Any]]:
        return await self._fetch_paginated_list(
            f"/api/v1/bills/{bill_id}/rules",
            map_item=_map_rule_entry,
        )

    async def fetch_bills(self) -> list[dict[str, Any]]:
        return await self._fetch_paginated_list(
            "/api/v1/bills",
            map_item=_map_bill_entry,
        )

    async def fetch_bill(self, bill_id: str) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.get(f"/api/v1/bills/{bill_id}")
            if response.status_code != 200:
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {response.text}"
                )
            payload = response.json()
            return _map_bill_entry(payload.get("data", {}))

    async def create_bill(self, body: dict[str, Any]) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.post("/api/v1/bills", json=body)
            if response.status_code not in (200, 201):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {_format_firefly_error(response)}"
                )
            payload = response.json()
            data = payload.get("data", {})
            return {
                "id": str(data.get("id")),
                "attributes": data.get("attributes", {}),
            }

    async def update_bill(self, bill_id: str, body: dict[str, Any]) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.put(f"/api/v1/bills/{bill_id}", json=body)
            if response.status_code not in (200, 201):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {_format_firefly_error(response)}"
                )
            payload = response.json()
            data = payload.get("data", {})
            return {
                "id": str(data.get("id")),
                "attributes": data.get("attributes", {}),
            }

    async def delete_bill(self, bill_id: str) -> None:
        async with self._build_client() as client:
            response = await client.delete(f"/api/v1/bills/{bill_id}")
            if response.status_code not in (200, 204, 404):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {response.text}"
                )

    async def delete_rule(self, rule_id: str) -> None:
        async with self._build_client() as client:
            response = await client.delete(f"/api/v1/rules/{rule_id}")
            if response.status_code not in (200, 204, 404):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {response.text}"
                )

    async def create_rule_group(self, title: str) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.post(
                "/api/v1/rule-groups",
                json={"title": title.strip(), "active": True},
            )
            if response.status_code not in (200, 201):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {_format_firefly_error(response)}"
                )
            payload = response.json()
            data = payload.get("data", {})
            attrs = data.get("attributes", {})
            return {
                "id": str(data.get("id")),
                "title": attrs.get("title"),
            }

    async def ensure_rule_group(self, title: str) -> str:
        """Return rule group id, creating the group in Firefly when missing."""
        name = title.strip()
        if not name:
            raise ValueError("rule group title required")
        for group in await self.fetch_rule_groups():
            if (group.get("title") or "").strip() == name:
                return str(group["id"])
        created = await self.create_rule_group(name)
        return str(created["id"])

    async def create_rule(self, rule_body: dict[str, Any]) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.post("/api/v1/rules", json=rule_body)
            if response.status_code not in (200, 201):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {_format_firefly_error(response)}"
                )
            payload = response.json()
            data = payload.get("data", {})
            attrs = data.get("attributes", {})
            return {
                "id": str(data.get("id")),
                "title": attrs.get("title"),
            }

    async def trigger_rule(
        self, rule_id: str, start: str, end: str
    ) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.post(
                f"/api/v1/rules/{rule_id}/trigger",
                params={"start": start, "end": end},
                # Firefly 6.5+ rejects POST without Content-Type (415) even when
                # dates are passed as query params per the OpenAPI spec.
                json={},
            )
            if response.status_code not in (200, 201, 204):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {_format_firefly_error(response)}"
                )
            if response.status_code == 204 or not response.content:
                return {"ok": True}
            return response.json()

    async def fetch_account(self, account_id: str) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.get(f"/api/v1/accounts/{account_id}")
            if response.status_code != 200:
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {response.text}"
                )
            payload = response.json()
            data = payload.get("data", {})
            return {
                "id": str(data.get("id")),
                "attributes": data.get("attributes", {}),
            }

    async def fetch_transaction(self, group_id: str) -> dict[str, Any]:
        async with self._build_client() as client:
            response = await client.get(f"/api/v1/transactions/{group_id}")
            if response.status_code != 200:
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {response.text}"
                )
            payload = response.json()
            data = payload.get("data", {})
            return {
                "id": str(data.get("id")),
                "attributes": data.get("attributes", {}),
            }

    async def update_transaction(
        self,
        group_id: str,
        mutate_fn: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> dict[str, Any]:
        journal = await self.fetch_transaction(group_id)
        attrs = journal.get("attributes", {})
        updated_attrs = mutate_fn(deepcopy(attrs))
        original_ids = {
            str(t.get("transaction_journal_id"))
            for t in attrs.get("transactions", [])
            if t.get("transaction_journal_id") is not None
        }
        put_txns = updated_attrs.get("transactions", [])
        put_ids = {
            str(t.get("transaction_journal_id"))
            for t in put_txns
            if t.get("transaction_journal_id") is not None
        }
        if original_ids and original_ids != put_ids:
            raise ValueError(
                "mutate_fn must preserve all transaction_journal_id values; "
                f"expected {original_ids}, got {put_ids}"
            )
        put_body: dict[str, Any] = {
            "apply_rules": False,
            "transactions": updated_attrs.get("transactions", []),
        }
        txns = put_body["transactions"]
        if len(txns) > 1:
            put_body["group_title"] = (
                updated_attrs.get("group_title")
                or attrs.get("group_title")
                or (txns[0].get("description") if txns else None)
                or "Split transaction"
            )
        async with self._build_client() as client:
            response = await client.put(
                f"/api/v1/transactions/{group_id}",
                json=put_body,
            )
            if response.status_code not in (200, 201):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {response.text}"
                )
            payload = response.json()
            data = payload.get("data", {})
            return {
                "id": str(data.get("id")),
                "attributes": data.get("attributes", {}),
            }

    async def update_account(
        self, account_id: str, attributes: dict[str, Any]
    ) -> dict[str, Any]:
        payload = prepare_account_update_payload(attributes)
        async with self._build_client() as client:
            response = await client.put(
                f"/api/v1/accounts/{account_id}",
                json=payload,
            )
            if response.status_code not in (200, 201):
                raise RuntimeError(
                    f"Firefly API error {response.status_code}: {response.text}"
                )
            payload = response.json()
            data = payload.get("data", {})
            return {
                "id": str(data.get("id")),
                "attributes": data.get("attributes", {}),
            }

    async def fetch_splits(self, start: str, end: str) -> list[dict[str, Any]]:
        accounts = await self.fetch_accounts()
        flat: list[dict[str, Any]] = []
        page = 1
        async with self._build_client() as client:
            while True:
                response = await client.get(
                    "/api/v1/transactions",
                    params={
                        "start": start,
                        "end": end,
                        "limit": 1000,
                        "page": page,
                    },
                )
                if response.status_code != 200:
                    raise RuntimeError(
                        f"Firefly API error {response.status_code}: {response.text}"
                    )
                payload = response.json()
                journals = payload.get("data", [])
                for entry in journals:
                    # journal_id is Firefly transaction group id for /transactions/show/{id}
                    journal_id = str(entry.get("id") or "")
                    attrs = entry.get("attributes", {})
                    parent_category = attrs.get("category_name")
                    parent_budget = attrs.get("budget_name")
                    parent_description = attrs.get("description")
                    parent_notes = attrs.get("notes")
                    for split in attrs.get("transactions", []):
                        source_id = str(split.get("source_id") or "")
                        dest_id = str(split.get("destination_id") or "")
                        source_acct = accounts.get(source_id, {})
                        dest_acct = accounts.get(dest_id, {})
                        tjid = split.get("transaction_journal_id")
                        subscription_id = split.get("subscription_id")
                        subscription_name = split.get("subscription_name")
                        bill_id = split.get("bill_id")
                        bill_name = split.get("bill_name")
                        flat.append(
                            {
                                "journal_id": journal_id,
                                "type": split.get("type"),
                                "amount": split.get("amount"),
                                "source_id": source_id,
                                "destination_id": dest_id,
                                "category_name": split.get("category_name")
                                or parent_category,
                                "budget_name": split.get("budget_name") or parent_budget,
                                "date": split.get("date"),
                                "destination_name": split.get("destination_name"),
                                "destination_role": dest_acct.get("role"),
                                "destination_type": dest_acct.get("type"),
                                "source_name": split.get("source_name"),
                                "source_role": source_acct.get("role"),
                                "source_type": source_acct.get("type"),
                                "description": split.get("description")
                                or parent_description,
                                "transaction_journal_id": str(tjid) if tjid is not None else None,
                                "notes": split.get("notes") or parent_notes,
                                "tags": split.get("tags"),
                                "subscription_id": str(subscription_id)
                                if subscription_id is not None
                                and str(subscription_id).strip()
                                else None,
                                "subscription_name": str(subscription_name)
                                if subscription_name is not None
                                and str(subscription_name).strip()
                                else None,
                                "bill_id": str(bill_id)
                                if bill_id is not None and str(bill_id).strip()
                                else None,
                                "bill_name": str(bill_name)
                                if bill_name is not None and str(bill_name).strip()
                                else None,
                            }
                        )
                pagination = payload.get("meta", {}).get("pagination", {})
                current = pagination.get("current_page", 1)
                total_pages = pagination.get("total_pages", 1)
                logger.info(
                    "Fetched transactions page %s/%s (%s journals)",
                    current,
                    total_pages,
                    len(journals),
                )
                if current >= total_pages:
                    break
                page += 1
        return flat

    async def fetch_bill_transactions(
        self, bill_id: str, start: str, end: str
    ) -> list[dict[str, Any]]:
        flat: list[dict[str, Any]] = []
        page = 1
        async with self._build_client() as client:
            while True:
                response = await client.get(
                    f"/api/v1/bills/{bill_id}/transactions",
                    params={
                        "start": start,
                        "end": end,
                        "limit": 1000,
                        "page": page,
                    },
                )
                if response.status_code != 200:
                    raise RuntimeError(
                        f"Firefly API error {response.status_code}: {response.text}"
                    )
                payload = response.json()
                journals = payload.get("data", [])
                for entry in journals:
                    journal_id = str(entry.get("id") or "")
                    attrs = entry.get("attributes", {})
                    parent_description = attrs.get("description")
                    for split in attrs.get("transactions", []):
                        tjid = split.get("transaction_journal_id")
                        flat.append(
                            {
                                "journal_id": journal_id,
                                "bill_id": bill_id,
                                "type": split.get("type"),
                                "amount": split.get("amount"),
                                "date": split.get("date"),
                                "payee": split.get("destination_name"),
                                "description": split.get("description")
                                or parent_description,
                                "transaction_journal_id": str(tjid)
                                if tjid is not None
                                else None,
                            }
                        )
                pagination = payload.get("meta", {}).get("pagination", {})
                current = pagination.get("current_page", 1)
                total_pages = pagination.get("total_pages", 1)
                logger.info(
                    "Fetched bill %s transactions page %s/%s (%s journals)",
                    bill_id,
                    current,
                    total_pages,
                    len(journals),
                )
                if current >= total_pages:
                    break
                page += 1
        return flat
