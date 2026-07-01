"""Async Firefly III API client (httpx)."""

from __future__ import annotations

import logging
import os
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
            map_item=lambda entry: {
                "id": str(entry.get("id")),
                "title": entry.get("attributes", {}).get("title"),
                "triggers": entry.get("attributes", {}).get("triggers") or [],
            },
        )

    async def fetch_rule_groups(self) -> list[dict[str, Any]]:
        return await self._fetch_paginated_list(
            "/api/v1/rule-groups",
            map_item=lambda entry: {
                "id": str(entry.get("id")),
                "title": entry.get("attributes", {}).get("title"),
            },
        )

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
        async with self._build_client() as client:
            response = await client.put(
                f"/api/v1/accounts/{account_id}",
                json=attributes,
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
