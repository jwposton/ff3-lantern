#!/usr/bin/env python3
"""One-shot Firefly import from operator-supplied firefly-export.sanitized.json (#102).

Runs on the host (not in CI). Creates accounts/bills/transactions via Firefly API,
remaps ff3lantern.db foreign keys to new Firefly IDs, and writes the sidecar for Lantern.

Usage:
  FIREFLY_BASE_URL=http://127.0.0.1:8080 FIREFLY_API_TOKEN=... \\
    python3 demo/seed/seed_demo_from_json.py \\
      --data-dir ~/ff3lantern-demo-data \\
      --sidecar-out ./demo/.runtime/lantern-data/ff3lantern.db
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError as exc:
    raise SystemExit("pip install httpx") from exc

BATCH_SIZE = 40


def _client(base_url: str, token: str) -> httpx.Client:
    return httpx.Client(
        base_url=base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=120.0,
    )


def _paginate(client: httpx.Client, resource: str) -> list[dict[str, Any]]:
    page = 1
    items: list[dict[str, Any]] = []
    while True:
        response = client.get(f"/api/v1/{resource}", params={"limit": 1000, "page": page})
        response.raise_for_status()
        payload = response.json()
        items.extend(payload.get("data", []))
        pagination = payload.get("meta", {}).get("pagination", {})
        if page >= pagination.get("total_pages", 1):
            break
        page += 1
    return items


def _transactions_exist(client: httpx.Client) -> bool:
    response = client.get(
        "/api/v1/transactions",
        params={"limit": 1, "start": "2000-01-01", "end": "2099-12-31"},
    )
    response.raise_for_status()
    return bool(response.json().get("data"))


def _ensure_category(client: httpx.Client, name: str, existing: set[str]) -> None:
    if not name or name in existing:
        return
    client.post("/api/v1/categories", json={"name": name}).raise_for_status()
    existing.add(name)


def _ensure_budget(client: httpx.Client, name: str, amount: str, existing: set[str]) -> None:
    if not name or name in existing:
        return
    body: dict[str, Any] = {"name": name}
    if amount:
        body["amount"] = amount
    client.post("/api/v1/budgets", json=body).raise_for_status()
    existing.add(name)


def _account_body(entry: dict[str, Any]) -> dict[str, Any]:
    attrs = entry.get("attributes") or {}
    body: dict[str, Any] = {
        "name": attrs.get("name") or f"Account {entry.get('id')}",
        "type": attrs.get("type") or "asset",
    }
    role = attrs.get("account_role")
    if role:
        body["account_role"] = role
    if attrs.get("credit_card_type"):
        body["credit_card_type"] = attrs["credit_card_type"]
    if attrs.get("monthly_payment_date"):
        body["monthly_payment_date"] = attrs["monthly_payment_date"]
    if attrs.get("notes"):
        body["notes"] = attrs["notes"]
    return body


def _import_accounts(
    client: httpx.Client, accounts: list[dict[str, Any]]
) -> dict[str, str]:
    id_map: dict[str, str] = {}
    existing = {(a.get("attributes") or {}).get("name") for a in _paginate(client, "accounts")}
    for entry in sorted(accounts, key=lambda item: int(item.get("id") or 0)):
        old_id = str(entry.get("id"))
        attrs = entry.get("attributes") or {}
        name = attrs.get("name") or ""
        acct_type = (attrs.get("type") or "").lower()
        if name in existing and acct_type not in {"liabilities", "debt"}:
            match = next(
                (
                    a
                    for a in _paginate(client, "accounts")
                    if (a.get("attributes") or {}).get("name") == name
                    and (a.get("attributes") or {}).get("type") == attrs.get("type")
                ),
                None,
            )
            if match:
                id_map[old_id] = str(match["id"])
                continue
        response = client.post("/api/v1/accounts", json=_account_body(entry))
        response.raise_for_status()
        new_id = str(response.json()["data"]["id"])
        id_map[old_id] = new_id
        existing.add(name)
    print(f"imported {len(id_map)} accounts", file=sys.stderr)
    return id_map


def _import_bills(client: httpx.Client, bills: list[dict[str, Any]]) -> dict[str, str]:
    id_map: dict[str, str] = {}
    for entry in sorted(bills, key=lambda item: int(item.get("id") or 0)):
        old_id = str(entry.get("id"))
        attrs = entry.get("attributes") or {}
        body = {
            "name": attrs.get("name") or f"Bill {old_id}",
            "amount_min": attrs.get("amount_min") or "0.00",
            "amount_max": attrs.get("amount_max") or attrs.get("amount_min") or "0.00",
            "date": (attrs.get("date") or "2026-01-01T00:00:00")[:10],
            "repeat_freq": attrs.get("repeat_freq") or "monthly",
            "active": bool(attrs.get("active", True)),
        }
        if attrs.get("currency_code"):
            body["currency_code"] = attrs["currency_code"]
        response = client.post("/api/v1/bills", json=body)
        response.raise_for_status()
        id_map[old_id] = str(response.json()["data"]["id"])
    print(f"imported {len(id_map)} bills", file=sys.stderr)
    return id_map


def _tx_body(row: dict[str, str]) -> dict[str, Any] | None:
    tx_type = (row.get("type") or "").lower()
    amount = (row.get("amount") or "").strip()
    if not tx_type or not amount:
        return None
    try:
        numeric = float(amount)
    except ValueError:
        return None
    if numeric == 0:
        return None
    body: dict[str, Any] = {
        "type": tx_type,
        "date": (row.get("date") or "")[:10] or "2026-01-01",
        "amount": f"{abs(numeric):.2f}",
        "description": row.get("description") or tx_type,
    }
    if row.get("source_name"):
        body["source_name"] = row["source_name"]
    if row.get("destination_name"):
        body["destination_name"] = row["destination_name"]
    if row.get("category"):
        body["category_name"] = row["category"]
    if row.get("budget"):
        body["budget_name"] = row["budget"]
    return body


def _import_transactions(client: httpx.Client, rows: list[dict[str, str]]) -> int:
    imported = 0
    batch: list[dict[str, Any]] = []
    for row in rows:
        item = _tx_body(row)
        if item is None:
            continue
        batch.append(item)
        if len(batch) >= BATCH_SIZE:
            client.post("/api/v1/transactions", json={"transactions": batch}).raise_for_status()
            imported += len(batch)
            batch.clear()
            if imported % 200 == 0:
                print(f"  … {imported} transactions", file=sys.stderr)
            time.sleep(0.05)
    if batch:
        client.post("/api/v1/transactions", json={"transactions": batch}).raise_for_status()
        imported += len(batch)
    print(f"imported {imported} transactions", file=sys.stderr)
    return imported


def _remap_sidecar(
    source_db: Path,
    dest_db: Path,
    account_map: dict[str, str],
    bill_map: dict[str, str],
) -> None:
    dest_db.parent.mkdir(parents=True, exist_ok=True)
    if dest_db.exists():
        dest_db.unlink()
    conn = sqlite3.connect(dest_db)
    source = sqlite3.connect(source_db)
    source.backup(conn)
    source.close()

    def remap_account_list(raw_json: str) -> str:
        ids = json.loads(raw_json or "[]")
        return json.dumps([account_map.get(str(i), str(i)) for i in ids])

    for row_id, bill_id in conn.execute(
        "SELECT id, firefly_bill_id FROM worksheet_registry WHERE firefly_bill_id IS NOT NULL"
    ):
        mapped = bill_map.get(str(bill_id))
        if mapped:
            conn.execute(
                "UPDATE worksheet_registry SET firefly_bill_id = ? WHERE id = ?",
                (mapped, row_id),
            )

    for row_id, cc_id in conn.execute(
        "SELECT id, credit_card_account_id FROM worksheet_registry WHERE credit_card_account_id IS NOT NULL"
    ):
        mapped = account_map.get(str(cc_id))
        if mapped:
            conn.execute(
                "UPDATE worksheet_registry SET credit_card_account_id = ? WHERE id = ?",
                (mapped, row_id),
            )

    conn.execute("UPDATE worksheet_registry SET rule_id = NULL")

    for bucket_id, raw in conn.execute(
        "SELECT id, firefly_account_ids_json FROM funding_buckets"
    ):
        conn.execute(
            "UPDATE funding_buckets SET firefly_account_ids_json = ? WHERE id = ?",
            (remap_account_list(raw), bucket_id),
        )

    for old_key, in conn.execute("SELECT row_key FROM worksheet_state"):
        if ":" not in old_key:
            continue
        prefix, raw_id = old_key.split(":", 1)
        if prefix in {"cc", "liability"}:
            mapped = account_map.get(raw_id)
            if mapped and mapped != raw_id:
                new_key = f"{prefix}:{mapped}"
                conn.execute(
                    "UPDATE worksheet_state SET row_key = ? WHERE row_key = ?",
                    (new_key, old_key),
                )

    conn.commit()
    conn.close()
    print(f"wrote remapped sidecar {dest_db}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import demo Firefly JSON + remap sidecar")
    parser.add_argument(
        "--data-dir",
        type=Path,
        required=True,
        help="Host directory with firefly-export.sanitized.json and ff3lantern.db",
    )
    parser.add_argument(
        "--bundle",
        type=Path,
        default=None,
        help="Override path to firefly-export.sanitized.json",
    )
    parser.add_argument(
        "--sidecar-in",
        type=Path,
        default=None,
        help="Override path to source ff3lantern.db",
    )
    parser.add_argument(
        "--sidecar-out",
        type=Path,
        required=True,
        help="Output path for remapped ff3lantern.db (Lantern /data volume)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Import even if Firefly already has transactions",
    )
    args = parser.parse_args()

    base_url = os.environ.get("FIREFLY_BASE_URL", "").strip()
    token = os.environ.get("FIREFLY_API_TOKEN", "").strip()
    if not base_url or not token:
        raise SystemExit("FIREFLY_BASE_URL and FIREFLY_API_TOKEN required")

    bundle_path = args.bundle or (args.data_dir / "firefly-export.sanitized.json")
    sidecar_in = args.sidecar_in or (args.data_dir / "ff3lantern.db")
    if not bundle_path.exists():
        raise SystemExit(f"Missing bundle: {bundle_path}")
    if not sidecar_in.exists():
        raise SystemExit(f"Missing sidecar: {sidecar_in}")

    bundle = json.loads(bundle_path.read_text())
    with _client(base_url, token) as client:
        if _transactions_exist(client) and not args.force:
            print("Firefly already has transactions; skipping import (use --force)", file=sys.stderr)
            if not args.sidecar_out.exists():
                shutil.copy2(sidecar_in, args.sidecar_out)
                print(f"copied sidecar to {args.sidecar_out}", file=sys.stderr)
            return

        categories: set[str] = set()
        budgets: set[str] = set()
        csv_exports = bundle.get("csv_exports") or {}
        for row in csv_exports.get("categories", {}).get("rows", []):
            _ensure_category(client, row.get("name", ""), categories)
        for row in csv_exports.get("budgets", {}).get("rows", []):
            _ensure_budget(client, row.get("name", ""), row.get("amount", ""), budgets)

        for row in bundle.get("transactions", {}).get("rows", []):
            cat = row.get("category")
            if cat:
                _ensure_category(client, cat, categories)
            bud = row.get("budget")
            if bud:
                _ensure_budget(client, bud, "", budgets)

        account_map = _import_accounts(client, bundle.get("accounts") or [])
        bill_map = _import_bills(client, bundle.get("bills") or [])
        _import_transactions(client, bundle.get("transactions", {}).get("rows") or [])

    _remap_sidecar(sidecar_in, args.sidecar_out, account_map, bill_map)
    print(json.dumps({"status": "imported", "accounts": len(account_map), "bills": len(bill_map)}))


if __name__ == "__main__":
    main()
