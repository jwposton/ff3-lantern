"""Async Firefly III API client (httpx)."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

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
        self._accounts: dict[str, dict[str, Any]] | None = None
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
        if self._accounts is not None:
            return self._accounts
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
                    role_raw = attrs.get("account_role") or attrs.get("type")
                    accounts[aid] = {
                        "name": attrs.get("name"),
                        "type": _normalize_account_type(attrs.get("type")),
                        "role": _normalize_account_role(role_raw),
                    }
                pagination = payload.get("meta", {}).get("pagination", {})
                current = pagination.get("current_page", 1)
                total_pages = pagination.get("total_pages", 1)
                logger.info("Fetched accounts page %s/%s", current, total_pages)
                if current >= total_pages:
                    break
                page += 1
        self._accounts = accounts
        return accounts

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
                    attrs = entry.get("attributes", {})
                    parent_category = attrs.get("category_name")
                    parent_budget = attrs.get("budget_name")
                    for split in attrs.get("transactions", []):
                        source_id = str(split.get("source_id") or "")
                        dest_id = str(split.get("destination_id") or "")
                        source_acct = accounts.get(source_id, {})
                        dest_acct = accounts.get(dest_id, {})
                        flat.append(
                            {
                                "type": split.get("type"),
                                "amount": split.get("amount"),
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
