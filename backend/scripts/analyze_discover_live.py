"""One-off: analyze live Firefly withdrawals for discover tuning. Run in backend container."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import date
from decimal import Decimal

import sidecar_db
from firefly_client import FireflyClient
from payment_worksheet_bill_suggestions import (
    _analyze_group,
    _is_bill_like_category,
    _is_noise_transaction,
    _is_recurring_candidate,
    _is_visit_style_spending,
    _subtract_months,
    build_bill_suggestions,
)

INTEREST_MARKERS = (
    "oil",
    "electric",
    "utilit",
    "trash",
    "waste",
    "heat",
    "propane",
    "water",
    "sewer",
    "mortgage",
    "rent",
    "insurance",
    "cell",
    "internet",
    "escrow",
)


async def main() -> None:
    settings = await sidecar_db.get_discover_settings()
    ignore = settings["ignored_categories"]
    client = FireflyClient()
    end = date.today()
    start = _subtract_months(end, 12)
    splits = await client.fetch_splits(start.isoformat(), end.isoformat())
    accounts = await client.fetch_accounts()
    bills = await client.fetch_bills()
    registry = await sidecar_db.list_worksheet_registry()

    by_cat_payee: dict[tuple[str, str], list] = defaultdict(list)
    for split in splits:
        if (split.get("type") or "").lower() != "withdrawal":
            continue
        cat = (split.get("category_name") or "").strip()
        if not cat:
            continue
        folded = cat.casefold()
        if not any(marker in folded for marker in INTEREST_MARKERS):
            continue
        try:
            amount = Decimal(str(split.get("amount") or "0")).copy_abs()
        except Exception:
            continue
        if amount <= 0:
            continue
        row = {**split, "amount": amount}
        if _is_noise_transaction(row, accounts, ignored_categories=ignore):
            continue
        payee = (split.get("destination_name") or "").strip() or "(none)"
        by_cat_payee[(cat, payee)].append(row)

    print("=== Bill-like category clusters (post-noise filter) ===")
    rows: list[tuple] = []
    for (cat, payee), txns in sorted(by_cat_payee.items(), key=lambda x: -len(x[1])):
        if len(txns) < 2:
            continue
        metrics = _analyze_group(payee, txns)
        if not metrics:
            continue
        rows.append(
            (
                len(txns),
                cat,
                payee,
                metrics["occurrences"],
                metrics["freq"],
                round(metrics["regularity"], 2),
                _is_recurring_candidate(metrics, txns),
                _is_visit_style_spending(txns, metrics=metrics),
                float(metrics["amount_avg"]),
                _is_bill_like_category(cat),
            )
        )
    for row in rows[:40]:
        print(
            f"  n={row[0]:2} occ={row[3]:2} {row[4]:10} reg={row[5]} "
            f"rec={str(row[6]):5} visit={str(row[7]):5} bill_like={str(row[9]):5} "
            f"avg=${row[8]:7.0f} | {row[1][:20]:20} | {row[2][:32]}"
        )

    result = build_bill_suggestions(
        splits,
        accounts=accounts,
        firefly_bills=bills,
        registry_rows=registry,
        period_start=start.isoformat(),
        period_end=end.isoformat(),
        ignored_categories=ignore,
    )
    print(f"\n=== Live suggestions: {len(result['data'])} ===")
    for suggestion in result["data"]:
        print(
            f"  {suggestion['merchant'][:36]:36} "
            f"cat={suggestion.get('category', '')[:16]:16} "
            f"occ={suggestion['occurrences']}"
        )

    suggested_cats = {s.get("category", "") for s in result["data"]}
    print("\n=== Bill-like categories with 2+ txns but no suggestion row ===")
    for cat in sorted({cat for cat, _ in by_cat_payee}):
        if cat in suggested_cats:
            continue
        payees = [p for (c, p), t in by_cat_payee.items() if c == cat and len(t) >= 2]
        if payees:
            print(f"  {cat}: {payees}")


if __name__ == "__main__":
    asyncio.run(main())
