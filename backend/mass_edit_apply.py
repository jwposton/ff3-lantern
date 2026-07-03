"""Bulk category/budget updates from Transaction Explorer."""

from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from typing import Any

import sidecar_db
from firefly_client import FireflyClient

_MAX_TARGETS = 500
_CONCURRENCY = 5


def build_mass_edit_mutate_fn(
    transaction_journal_id: str,
    *,
    category_id: str | None = None,
    budget_id: str | None = None,
    clear_budget: bool = False,
) -> Any:
    """Return mutate_fn that updates category and/or budget on one split."""

    if category_id is None and budget_id is None and not clear_budget:
        raise ValueError("at least one of category_id, budget_id, or clear_budget required")

    def mutate(attrs: dict[str, Any]) -> dict[str, Any]:
        updated = deepcopy(attrs)
        found = False
        for split in updated.get("transactions", []):
            if str(split.get("transaction_journal_id")) != str(transaction_journal_id):
                continue
            if category_id is not None:
                split["category_id"] = category_id
            if budget_id is not None:
                split["budget_id"] = budget_id
            elif clear_budget:
                split["budget_id"] = None
            found = True
        if not found:
            raise ValueError(
                f"transaction_journal_id {transaction_journal_id} not found in journal"
            )
        return updated

    return mutate


async def apply_mass_edit_batch(
    client: FireflyClient,
    targets: list[dict[str, str]],
    *,
    category_id: str | None = None,
    budget_id: str | None = None,
    clear_budget: bool = False,
) -> dict[str, Any]:
    """Apply category/budget changes to up to _MAX_TARGETS splits."""
    if not targets:
        raise ValueError("targets must not be empty")
    if len(targets) > _MAX_TARGETS:
        raise ValueError(f"cannot apply more than {_MAX_TARGETS} targets at once")
    if category_id is None and budget_id is None and not clear_budget:
        raise ValueError("at least one of category_id, budget_id, or clear_budget required")

    if category_id is not None or budget_id is not None:
        categories = await client.fetch_categories()
        budgets = await client.fetch_budgets()
        allowed_cats = {c["id"] for c in categories}
        allowed_budgets = {b["id"] for b in budgets}
        if category_id is not None and category_id not in allowed_cats:
            raise ValueError(f"category_id not in allowlist: {category_id}")
        if budget_id is not None and budget_id not in allowed_budgets:
            raise ValueError(f"budget_id not in allowlist: {budget_id}")

    sem = asyncio.Semaphore(_CONCURRENCY)
    applied = 0
    errors: list[dict[str, str]] = []

    async def _apply_one(target: dict[str, str]) -> None:
        nonlocal applied
        group_id = target["journal_id"]
        tjid = target["transaction_journal_id"]
        async with sem:
            try:
                mutate = build_mass_edit_mutate_fn(
                    tjid,
                    category_id=category_id,
                    budget_id=budget_id,
                    clear_budget=clear_budget,
                )
                await client.update_transaction(group_id, mutate)
                applied += 1
            except Exception as exc:
                errors.append(
                    {
                        "journal_id": group_id,
                        "transaction_journal_id": tjid,
                        "error": str(exc),
                    }
                )

    await asyncio.gather(*[_apply_one(t) for t in targets])

    await sidecar_db.log_audit(
        "mass_edit_apply",
        details_json=json.dumps(
            {
                "target_count": len(targets),
                "applied": applied,
                "failed": len(errors),
                "category_id": category_id,
                "budget_id": budget_id,
                "clear_budget": clear_budget,
            }
        ),
    )

    return {
        "ok": len(errors) == 0,
        "applied": applied,
        "failed": len(errors),
        "errors": errors,
    }
