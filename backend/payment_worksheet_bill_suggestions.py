"""Build bill suggestions from Firefly withdrawal history (DISC-01–DISC-12, #32)."""

from __future__ import annotations

import hashlib
import re
import statistics
from datetime import date, datetime
from decimal import ROUND_HALF_UP, ROUND_UP, Decimal, InvalidOperation
from difflib import SequenceMatcher
from typing import Any, Iterator, Literal, NamedTuple

import app_clock
import sidecar_db
from firefly_client import FireflyClient
from payment_worksheet_bill_history import compute_trailing_monthly_average
from payment_worksheet_liabilities import is_liability_summary
from payment_worksheet_profiles import is_credit_card_asset
from transaction_normalization import description_fingerprint

LOOKBACK_CHOICES: tuple[int, ...] = (6, 12, 24)

CONFIDENCE_RANK: dict[str, int] = {"high": 0, "medium": 1, "low": 2}

LEGAL_SUFFIX_RE = re.compile(
    r"\b(inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|ltd\.?|usa)\s*$",
    re.IGNORECASE,
)

FUZZY_PAYEE_MERGE_RATIO = 0.85
_PAYEE_HANDOFF_MAX_OVERLAP = 0.25

GAS_MERCHANT_KEYWORDS: tuple[str, ...] = (
    "sunoco",
    "exxon",
    "shell",
    "chevron",
    "mobil",
    "texaco",
    "marathon",
    "speedway",
    "bp ",
    "circle k",
)

APPLE_CASH_P2P_RE = re.compile(r"APPLE CASH SENT MONEY", re.IGNORECASE)
CC_INTEREST_DESC_RE = re.compile(r"interest charge", re.IGNORECASE)

_CATEGORY_IGNORE_ALIASES: dict[str, frozenset[str]] = {
    "restaurants": frozenset({"restaurant", "restraunt", "restraunts", "dining out", "food & dining"}),
    "gas": frozenset({"gasoline", "fuel"}),
    "groceries": frozenset({"grocery"}),
}

# Substrings — utility/bill categories get relaxed variable-amount recurrence rules.
_BILL_LIKE_CATEGORY_MARKERS: tuple[str, ...] = (
    "utilit",
    "electric",
    "heat",
    "fuel",
    "oil",
    "propane",
    "trash",
    "waste",
    "water",
    "sewer",
    "internet",
    "phone",
    "cell",
    "cable",
    "insurance",
    "rent",
    "mortgage",
    "subscription",
    "streaming",
)

OPAQUE_NOTES = "Multiple subscriptions detected; review before adopting"

PREAPPROVED_RE = re.compile(r"preapproved payment", re.IGNORECASE)
BILL_USER_PAYMENT_RE = re.compile(r"bill user payment", re.IGNORECASE)


def _category_folded(category: str) -> str:
    return (category or "").strip().casefold()


def _category_matches_markers(category: str, markers: tuple[str, ...]) -> bool:
    folded = _category_folded(category)
    if not folded:
        return False
    return any(marker in folded for marker in markers)


def _is_bill_like_category(category: str) -> bool:
    return _category_matches_markers(category, _BILL_LIKE_CATEGORY_MARKERS)


def _charges_per_calendar_month(txns: list[dict[str, Any]]) -> dict[str, int]:
    """Count withdrawal rows per YYYY-MM."""
    counts: dict[str, int] = {}
    for txn in txns:
        date_str = str(txn.get("date") or "")[:10]
        if len(date_str) < 7:
            continue
        month_key = date_str[:7]
        counts[month_key] = counts.get(month_key, 0) + 1
    return counts


def _monthly_charge_slots(
    txns: list[dict[str, Any]],
) -> dict[str, list[tuple[int, Decimal]]]:
    """Map YYYY-MM -> [(day_of_month, amount), ...] sorted by day."""
    by_month: dict[str, list[tuple[int, Decimal]]] = {}
    for txn in txns:
        date_str = str(txn.get("date") or "")[:10]
        if len(date_str) < 10:
            continue
        month = date_str[:7]
        dom = int(date_str[8:10])
        amount = txn.get("amount")
        if not isinstance(amount, Decimal):
            try:
                amount = Decimal(str(amount))
            except (InvalidOperation, TypeError):
                continue
        by_month.setdefault(month, []).append((dom, amount))
    for month in by_month:
        by_month[month].sort(key=lambda item: item[0])
    return by_month


def _dom_spread(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return statistics.pstdev(values)


def _tier_ratio_cv(pairs: list[tuple[Decimal, Decimal]]) -> float | None:
    """Coefficient of variation for larger/smaller amount ratio across months."""
    ratios: list[float] = []
    for a1, a2 in pairs:
        lo, hi = (a1, a2) if a1 <= a2 else (a2, a1)
        if lo <= 0:
            continue
        ratios.append(float(hi / lo))
    if len(ratios) < 2:
        return None
    mean = sum(ratios) / len(ratios)
    if mean <= 0:
        return None
    return statistics.pstdev(ratios) / mean


def _has_billing_anchor_cyclicality(
    txns: list[dict[str, Any]],
    *,
    min_months: int = 3,
    dom_spread_max: float = 2.5,
    tier_ratio_cv_max: float = 0.35,
) -> bool:
    """True when charges land on 1-2 stable calendar days each cycle — not habit visits.

    Semi-monthly billing (e.g. Backblaze on ~12 and ~19) repeats the same anchor days
    with a stable amount tier ratio. Twice-monthly dining on similar days but varying
    tier ratios still reads as visit-style.
    """
    by_month = _monthly_charge_slots(txns)
    if len(by_month) < min_months:
        return False

    if any(len(slots) >= 4 for slots in by_month.values()):
        return False

    single_months = [(month, slots[0]) for month, slots in by_month.items() if len(slots) == 1]
    if len(single_months) >= min_months:
        doms = [float(slot[0]) for _, slot in single_months]
        if _dom_spread(doms) <= dom_spread_max and len(single_months) / len(by_month) >= 0.6:
            return True

    pair_months = [(month, slots) for month, slots in by_month.items() if len(slots) == 2]
    if len(pair_months) >= min_months:
        first_doms = [float(slots[0][0]) for _, slots in pair_months]
        second_doms = [float(slots[1][0]) for _, slots in pair_months]
        if (
            _dom_spread(first_doms) <= dom_spread_max
            and _dom_spread(second_doms) <= dom_spread_max
        ):
            amount_pairs = [(slots[0][1], slots[1][1]) for _, slots in pair_months]
            tier_cv = _tier_ratio_cv(amount_pairs)
            if tier_cv is not None and tier_cv <= tier_ratio_cv_max:
                ratios = []
                for a1, a2 in amount_pairs:
                    lo, hi = (a1, a2) if a1 <= a2 else (a2, a1)
                    if lo > 0:
                        ratios.append(float(hi / lo))
                if ratios and (sum(ratios) / len(ratios)) >= 1.5:
                    return True

    return False


_BILLING_ANCHOR_MIN_PAIR_MONTHS = 3
_BILLING_ANCHOR_DOM_SPREAD_MAX = 2.5


def _infer_two_billing_anchors(
    txns: list[dict[str, Any]],
) -> tuple[float, float] | None:
    """Median day-of-month for two semi-monthly billing anchors, when stable."""
    by_month = _monthly_charge_slots(txns)
    if len(by_month) < _BILLING_ANCHOR_MIN_PAIR_MONTHS:
        return None

    pair_months = [(month, slots) for month, slots in by_month.items() if len(slots) == 2]
    if len(pair_months) < _BILLING_ANCHOR_MIN_PAIR_MONTHS:
        return None

    first_doms = [float(slots[0][0]) for _, slots in pair_months]
    second_doms = [float(slots[1][0]) for _, slots in pair_months]
    if (
        _dom_spread(first_doms) > _BILLING_ANCHOR_DOM_SPREAD_MAX
        or _dom_spread(second_doms) > _BILLING_ANCHOR_DOM_SPREAD_MAX
    ):
        return None

    anchor_a = float(statistics.median(first_doms))
    anchor_b = float(statistics.median(second_doms))
    if anchor_a == anchor_b:
        return None
    return (min(anchor_a, anchor_b), max(anchor_a, anchor_b))


def _billing_anchor_slot(dom: int, anchors: tuple[float, float]) -> int:
    """0 = earlier anchor, 1 = later anchor."""
    dist_a = abs(dom - anchors[0])
    dist_b = abs(dom - anchors[1])
    return 0 if dist_a <= dist_b else 1


def _group_by_billing_anchors(
    txns: list[dict[str, Any]],
) -> dict[int, list[dict[str, Any]]] | None:
    """Split charges into earlier/later anchor streams when semi-monthly anchors are stable."""
    anchors = _infer_two_billing_anchors(txns)
    if anchors is None:
        return None

    groups: dict[int, list[dict[str, Any]]] = {0: [], 1: []}
    for txn in txns:
        date_str = str(txn.get("date") or "")[:10]
        if len(date_str) < 10:
            continue
        dom = int(date_str[8:10])
        groups[_billing_anchor_slot(dom, anchors)].append(txn)

    if not groups[0] or not groups[1]:
        return None
    return groups


def _billing_anchor_cluster_key(category: str, anchor_dom: float) -> str:
    dom = int(round(anchor_dom))
    return f"anchor:{category}:{dom:02d}"


def _is_visit_style_spending(
    txns: list[dict[str, Any]],
    *,
    metrics: dict[str, Any] | None = None,
) -> bool:
    """True when the payee looks like repeat visits, not one bill per cycle.

    Dining/gas habits often hit 2+ times in the same calendar month with varying
    amounts and uneven spacing (e.g. 9 days then 22 days). True subscriptions
    and biweekly bills keep steady gaps (~14 days) with at most two hits per month.

    High-dollar clusters (e.g. heating-oil fill-ups in the same cold month) are
    not visit-style even when 3+ hits land in one calendar month.
    """
    by_month = _charges_per_calendar_month(txns)
    if not by_month:
        return False

    if _has_billing_anchor_cyclicality(txns):
        return False

    amounts: list[Decimal] = []
    for txn in txns:
        amount = txn.get("amount")
        if isinstance(amount, Decimal):
            amounts.append(amount)
        else:
            try:
                amounts.append(Decimal(str(amount)))
            except (InvalidOperation, TypeError):
                continue
    if amounts:
        amount_avg = sum(amounts, Decimal("0")) / Decimal(len(amounts))
        if amount_avg >= Decimal("75"):
            return False

    if any(count >= 3 for count in by_month.values()):
        return True

    multi_charge_months = sum(1 for count in by_month.values() if count >= 2)
    if multi_charge_months < 2:
        return False

    if metrics is None:
        return True

    avg_gap = float(metrics.get("avg_gap_days") or 0)
    gap_std = float(metrics.get("gap_std") or 0)
    if avg_gap <= 0:
        return True

    gap_irregularity = gap_std / avg_gap
    # Twice-a-month habits (short + long gaps) vs steady biweekly (~14d, low std).
    return gap_irregularity >= 0.25


def _category_is_ignored(category: str, ignored_categories: list[str]) -> bool:
    """True when category matches operator ignore list (case-insensitive, with aliases)."""
    text = (category or "").strip()
    if not text or not ignored_categories:
        return False
    folded = text.casefold()
    for ignored in ignored_categories:
        ignored_text = ignored.strip()
        if not ignored_text:
            continue
        ignored_folded = ignored_text.casefold()
        if folded == ignored_folded:
            return True
        aliases = _CATEGORY_IGNORE_ALIASES.get(ignored_folded, frozenset())
        if folded in aliases:
            return True
    return False


def _payee_is_ignored(destination: str, ignored_payees: list[str]) -> bool:
    """True when Firefly destination_name matches operator payee ignore list."""
    text = (destination or "").strip()
    if not text or not ignored_payees:
        return False
    folded = text.casefold()
    return any(payee.strip().casefold() == folded for payee in ignored_payees if payee.strip())


def _account_summary(
    tx: dict[str, Any],
    accounts: dict[str, dict[str, Any]],
    *,
    side: str,
) -> dict[str, Any]:
    account_id = str(tx.get(f"{side}_id") or "")
    if account_id and account_id in accounts:
        return accounts[account_id]
    return {
        "type": tx.get(f"{side}_type") or "",
        "role": tx.get(f"{side}_role") or "",
    }


def _is_asset_account(summary: dict[str, Any]) -> bool:
    acct_type = (summary.get("type") or "").casefold()
    return "asset" in acct_type


def _is_gas_merchant(destination: str, category: str) -> bool:
    dest = (destination or "").casefold()
    if "gas" in (category or "").casefold():
        return True
    return any(keyword in dest for keyword in GAS_MERCHANT_KEYWORDS)


def _is_noise_transaction(
    tx: dict[str, Any],
    accounts: dict[str, dict[str, Any]],
    *,
    ignored_categories: list[str],
    ignored_payees: list[str] | None = None,
) -> bool:
    """Exclude operator-ignored categories/payees and accounting-only noise."""
    category = str(tx.get("category_name") or "")
    if _category_is_ignored(category, ignored_categories):
        return True

    destination = str(tx.get("destination_name") or "")
    if _payee_is_ignored(destination, ignored_payees or []):
        return True
    description = str(tx.get("description") or "")

    if _is_gas_merchant(destination, category):
        return True

    if APPLE_CASH_P2P_RE.search(description):
        return True

    if CC_INTEREST_DESC_RE.search(description) or category.casefold() == "credit card interest":
        return True

    dest_summary = _account_summary(tx, accounts, side="destination")
    if is_liability_summary(dest_summary):
        return True

    source_summary = _account_summary(tx, accounts, side="source")
    if _is_asset_account(source_summary) and _is_asset_account(dest_summary):
        if destination.strip() and not is_liability_summary(dest_summary):
            src_name = (source_summary.get("name") or str(tx.get("source_name") or "")).casefold()
            dst_name = (dest_summary.get("name") or destination).casefold()
            if src_name != dst_name:
                return True

    return False


def _subtract_months(end: date, months: int) -> date:
    """Return calendar date N months before end (day clamped to month length)."""
    year = end.year
    month = end.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(end.day, _days_in_month(year, month))
    return date(year, month, day)


def _lookback_period_start(end: date, months: int) -> date:
    """First day of the month N calendar months before end's month."""
    year = end.year
    month = end.month - months
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1)


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    first = date(year, month, 1)
    return (next_month - first).days


def _parse_withdrawal(split: dict[str, Any]) -> dict[str, Any] | None:
    """Keep only positive withdrawal splits."""
    if (split.get("type") or "").lower() != "withdrawal":
        return None
    try:
        amount = Decimal(str(split.get("amount") or "0")).copy_abs()
    except InvalidOperation:
        return None
    if amount <= 0:
        return None
    return {**split, "amount": amount}


def _split_subscription_id(row: dict[str, Any]) -> str | None:
    """Return Firefly subscription or bill linkage id when split is already linked."""
    for key in ("subscription_id", "bill_id"):
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _live_firefly_bill_ids(firefly_bills: list[dict[str, Any]]) -> set[str]:
    return {
        str(bill.get("id") or "").strip()
        for bill in firefly_bills
        if bill.get("id") is not None and str(bill.get("id")).strip()
    }


def _is_active_subscription_link(
    row: dict[str, Any],
    *,
    live_bill_ids: set[str],
    registered_bill_ids: set[str],
) -> bool:
    """True when split links to a Firefly bill/subscription that still exists.

    Journals can retain subscription_id after the bill was deleted in Firefly —
    those stale links are ignored so discover can still suggest the charge.
    """
    linked_id = _split_subscription_id(row)
    if not linked_id:
        return False
    if linked_id in live_bill_ids:
        return True
    return linked_id in registered_bill_ids


def _normalize_key(destination: str, description: str) -> str:
    """Group key: payee when present, else normalized description fingerprint."""
    payee = (destination or "").strip()
    if payee:
        return payee.lower()
    return description_fingerprint(description)


def _group_withdrawals(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Group parsed withdrawal rows by normalized payee/description key."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = _normalize_key(
            str(row.get("destination_name") or ""),
            str(row.get("description") or ""),
        )
        if not key:
            continue
        groups.setdefault(key, []).append(row)
    return groups


def _group_by_fingerprint(
    rows: list[dict[str, Any]],
) -> dict[tuple[str, Decimal], list[dict[str, Any]]]:
    groups: dict[tuple[str, Decimal], list[dict[str, Any]]] = {}
    for row in rows:
        amount = row.get("amount")
        if not isinstance(amount, Decimal):
            try:
                amount = Decimal(str(amount))
            except (InvalidOperation, TypeError):
                continue
        fp = _fingerprint({**row, "amount": amount})
        groups.setdefault(fp, []).append(row)
    return groups


def _fingerprint_cluster_key(category: str, amount: Decimal) -> str:
    return f"fp:{category}:{amount.quantize(Decimal('0.01'), ROUND_HALF_UP)}"


def _normalize_payee_for_fuzzy_match(name: str) -> str:
    text = (name or "").strip()
    text = LEGAL_SUFFIX_RE.sub("", text).strip()
    text = re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()
    return text


def _payee_similarity(a: str, b: str) -> float:
    na = _normalize_payee_for_fuzzy_match(a)
    nb = _normalize_payee_for_fuzzy_match(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def _pick_canonical_payee(txns: list[dict[str, Any]]) -> str:
    """Most frequent destination_name; tie → most recent charge date."""
    counts: dict[str, int] = {}
    latest: dict[str, str] = {}
    for txn in txns:
        payee = str(txn.get("destination_name") or "").strip()
        if not payee:
            continue
        counts[payee] = counts.get(payee, 0) + 1
        charge_date = str(txn.get("date") or "")[:10]
        if payee not in latest or charge_date > latest[payee]:
            latest[payee] = charge_date
    if not counts:
        return ""
    max_count = max(counts.values())
    candidates = [payee for payee, count in counts.items() if count == max_count]
    if len(candidates) == 1:
        return candidates[0]
    return max(candidates, key=lambda payee: latest.get(payee, ""))


def _charge_dates_for_payee(txns: list[dict[str, Any]]) -> set[date]:
    dates: set[date] = set()
    for txn in txns:
        parsed = _parse_date(str(txn.get("date") or ""))
        if parsed is not None:
            dates.add(parsed)
    return dates


def _payee_streams_are_handoff(dates_a: set[date], dates_b: set[date]) -> bool:
    """True when payee streams look like rename/handoff, not parallel subscriptions."""
    if not dates_a or not dates_b:
        return False
    overlap = len(dates_a & dates_b)
    denom = min(len(dates_a), len(dates_b))
    if denom == 0:
        return False
    return (overlap / denom) <= _PAYEE_HANDOFF_MAX_OVERLAP


def _merge_clusters_same_fingerprint(
    clusters: dict[str, list[dict[str, Any]]],
) -> list[list[dict[str, Any]]]:
    """Merge payee-first clusters sharing a fingerprint when fuzzy match or handoff."""
    payee_to_txns: dict[str, list[dict[str, Any]]] = {}
    for key, txns in clusters.items():
        for txn in txns:
            payee = str(txn.get("destination_name") or "").strip() or key
            payee_to_txns.setdefault(payee, []).append(txn)

    payees = list(payee_to_txns.keys())
    if len(payees) <= 1:
        return [txns for txns in payee_to_txns.values()]

    parent = {payee: payee for payee in payees}

    def find(payee: str) -> str:
        while parent[payee] != payee:
            parent[payee] = parent[parent[payee]]
            payee = parent[payee]
        return payee

    def union(a: str, b: str) -> None:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    dates_by_payee = {
        payee: _charge_dates_for_payee(txns) for payee, txns in payee_to_txns.items()
    }

    for i, payee_a in enumerate(payees):
        for payee_b in payees[i + 1 :]:
            if _payee_similarity(payee_a, payee_b) >= FUZZY_PAYEE_MERGE_RATIO:
                union(payee_a, payee_b)
            elif _payee_streams_are_handoff(
                dates_by_payee[payee_a],
                dates_by_payee[payee_b],
            ):
                union(payee_a, payee_b)

    merged: dict[str, list[dict[str, Any]]] = {}
    for payee, txns in payee_to_txns.items():
        root = find(payee)
        merged.setdefault(root, []).extend(txns)

    return list(merged.values())


_BILL_SPLIT_MIN_AMOUNT = Decimal("40.00")


def _fingerprint_groups_are_distinct_fixed_bills(
    fingerprint_groups: dict[tuple[str, Decimal], list[dict[str, Any]]],
) -> bool:
    """True when 2+ amount fingerprints look like separate fixed recurring bills."""
    stable_recurring = 0
    for fingerprint, fp_rows in fingerprint_groups.items():
        if fingerprint[1] < _BILL_SPLIT_MIN_AMOUNT:
            continue
        metrics = _analyze_group("", fp_rows)
        if metrics is None or not _is_recurring_candidate(metrics, fp_rows):
            continue
        if metrics.get("amt_variance_pct", 100) < 3:
            stable_recurring += 1
    return stable_recurring >= 2


def _payee_has_distinct_monthly_amount_bills(txns: list[dict[str, Any]]) -> bool:
    """True when the same calendar month often has multiple distinct charge amounts."""
    by_month: dict[str, set[Decimal]] = {}
    for txn in txns:
        month = str(txn.get("date") or "")[:7]
        amount = txn.get("amount")
        if not month or not isinstance(amount, Decimal):
            continue
        by_month.setdefault(month, set()).add(
            amount.quantize(Decimal("0.01"), ROUND_HALF_UP),
        )
    months_with_multiple = sum(1 for amounts in by_month.values() if len(amounts) > 1)
    return months_with_multiple >= 2


def _merge_payee_clusters_in_category(
    payee_clusters: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    """Apply D-44 fuzzy payee merge within stable category+amount fingerprints."""
    if not payee_clusters:
        return {}

    consumed_ids: set[int] = set()
    merged: dict[str, list[dict[str, Any]]] = {}

    by_fingerprint: dict[tuple[str, Decimal], dict[str, list[dict[str, Any]]]] = {}
    for payee_key, txns in payee_clusters.items():
        for txn in txns:
            fingerprint = _fingerprint(txn)
            by_fingerprint.setdefault(fingerprint, {}).setdefault(payee_key, []).append(txn)

    for fingerprint, fingerprint_clusters in by_fingerprint.items():
        if len(fingerprint_clusters) < 2:
            continue
        merged_groups = _merge_clusters_same_fingerprint(fingerprint_clusters)
        cluster_key = _fingerprint_cluster_key(fingerprint[0], fingerprint[1])
        if len(merged_groups) == 1:
            merged[cluster_key] = list(merged_groups[0])
            for txn in merged_groups[0]:
                consumed_ids.add(id(txn))
            continue
        for txns in merged_groups:
            payee_key = _normalize_key(_pick_canonical_payee(txns), "")
            merged[payee_key] = list(txns)
            for txn in txns:
                consumed_ids.add(id(txn))

    for payee_key, txns in payee_clusters.items():
        remaining = [txn for txn in txns if id(txn) not in consumed_ids]
        if not remaining:
            continue
        fingerprint_groups = _group_by_fingerprint(remaining)
        if (
            len(fingerprint_groups) > 1
            and _payee_has_distinct_monthly_amount_bills(remaining)
            and _fingerprint_groups_are_distinct_fixed_bills(fingerprint_groups)
            and not _is_visit_style_spending(remaining)
        ):
            anchor_groups = _group_by_billing_anchors(remaining)
            anchors = _infer_two_billing_anchors(remaining)
            if anchor_groups is not None and anchors is not None:
                category = (
                    str(remaining[0].get("category_name") or "").strip()
                    or "(uncategorized)"
                )
                for slot, stream_txns in anchor_groups.items():
                    metrics = _analyze_group(payee_key, stream_txns)
                    if metrics is None or not _is_recurring_candidate(
                        metrics,
                        stream_txns,
                    ):
                        continue
                    merged[_billing_anchor_cluster_key(category, anchors[slot])] = list(
                        stream_txns,
                    )
                continue
            for fingerprint, fp_rows in fingerprint_groups.items():
                metrics = _analyze_group(payee_key, fp_rows)
                if metrics is None or not _is_recurring_candidate(metrics, fp_rows):
                    continue
                merged[_fingerprint_cluster_key(fingerprint[0], fingerprint[1])] = list(fp_rows)
            continue
        if payee_key in merged:
            merged[payee_key].extend(remaining)
        else:
            merged[payee_key] = list(remaining)

    return merged


def _is_quiet_category(txns: list[dict[str, Any]]) -> bool:
    """D-43: 2–3 payee variants and at most 3 amount fingerprints in category."""
    if not txns:
        return False
    payee_keys = {
        _normalize_key(
            str(txn.get("destination_name") or ""),
            str(txn.get("description") or ""),
        )
        for txn in txns
    }
    payee_keys.discard("")
    if len(payee_keys) < 2:
        return False
    fp_counts = _fingerprint_date_counts(txns)
    return len(payee_keys) <= 3 and len(fp_counts) <= 3


def _cluster_withdrawals(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Route withdrawals: opaque payee → payee sub-split; quiet category → fingerprint; else payee."""
    payee_groups = _group_withdrawals(rows)
    opaque_keys = {
        key
        for key, txns in payee_groups.items()
        if _should_subsplit_opaque_payee(txns)
    }

    clusters: dict[str, list[dict[str, Any]]] = {}
    for key in opaque_keys:
        clusters[key] = payee_groups[key]

    remaining: list[dict[str, Any]] = []
    for key, txns in payee_groups.items():
        if key not in opaque_keys:
            remaining.extend(txns)

    by_category: dict[str, list[dict[str, Any]]] = {}
    for row in remaining:
        category = str(row.get("category_name") or "").strip() or "(uncategorized)"
        by_category.setdefault(category, []).append(row)

    for category, cat_rows in by_category.items():
        if _is_quiet_category(cat_rows):
            for fp, fp_rows in _group_by_fingerprint(cat_rows).items():
                clusters[_fingerprint_cluster_key(fp[0], fp[1])] = fp_rows
        else:
            payee_clusters = _group_withdrawals(cat_rows)
            for key, txns in _merge_payee_clusters_in_category(payee_clusters).items():
                clusters[key] = txns

    return clusters


def _format_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _parse_date(value: str) -> date | None:
    text = (value or "")[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def _analyze_group(key: str, txns: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Compute recurrence metrics for a grouped withdrawal cluster."""
    _ = key
    dated: list[tuple[date, dict[str, Any]]] = []
    for txn in txns:
        parsed = _parse_date(str(txn.get("date") or ""))
        if parsed is not None:
            dated.append((parsed, txn))

    unique_dates = sorted({d for d, _ in dated})
    if len(unique_dates) < 2:
        return None

    amounts = [txn["amount"] for _, txn in dated if isinstance(txn.get("amount"), Decimal)]
    if not amounts:
        return None

    amount_min = min(amounts)
    amount_max = max(amounts)
    amount_avg = sum(amounts, Decimal("0")) / Decimal(len(amounts))

    if amount_avg > 0:
        max_dev = max(abs(a - amount_avg) for a in amounts)
        amt_variance_pct = float((max_dev / amount_avg) * Decimal("100"))
    else:
        amt_variance_pct = 0.0

    gaps: list[int] = []
    for prev, curr in zip(unique_dates, unique_dates[1:]):
        gaps.append((curr - prev).days)

    avg_gap_days = sum(gaps) / len(gaps) if gaps else 0.0
    gap_std = statistics.pstdev(gaps) if len(gaps) >= 2 else 0.0
    if avg_gap_days > 0:
        regularity = 1.0 - min(gap_std / avg_gap_days, 1.0)
    else:
        regularity = 0.0

    latest_txn = max(dated, key=lambda item: item[0])[1]
    last_date = unique_dates[-1].isoformat()
    first_date = unique_dates[0].isoformat()
    payment_source = str(latest_txn.get("source_name") or "")
    category = str(latest_txn.get("category_name") or "")
    merchant = str(latest_txn.get("destination_name") or "").strip() or key
    descriptions = sorted({
        str(txn.get("description") or "").strip()
        for _, txn in dated
        if str(txn.get("description") or "").strip()
    })

    freq = _classify_freq(avg_gap_days)
    if _has_billing_anchor_cyclicality(txns):
        # Semi-monthly billing (e.g. Backblaze ~12 + ~19) averages ~14d gaps but
        # repeats on stable monthly anchors — not true biweekly cadence.
        freq = "monthly"

    return {
        "occurrences": len(unique_dates),
        "amount_min": amount_min,
        "amount_max": amount_max,
        "amount_avg": amount_avg,
        "amt_variance_pct": amt_variance_pct,
        "gaps": gaps,
        "avg_gap_days": avg_gap_days,
        "gap_std": gap_std,
        "regularity": regularity,
        "freq": freq,
        "last_date": last_date,
        "first_date": first_date,
        "payment_source": payment_source,
        "category": category,
        "merchant": merchant,
        "sample_descriptions": descriptions[:3],
    }


def _classify_freq(avg_gap_days: float) -> str:
    if 25 <= avg_gap_days <= 35:
        return "monthly"
    if 12 <= avg_gap_days <= 18:
        return "biweekly"
    if 85 <= avg_gap_days <= 100:
        return "quarterly"
    if 250 <= avg_gap_days <= 400:
        return "annual"
    return "irregular"


def _is_fixed_subscription(metrics: dict[str, Any]) -> bool:
    return (
        metrics["amt_variance_pct"] < 3
        and metrics["occurrences"] >= 3
        and metrics["amount_avg"] <= Decimal("200")
    )


def _is_utility_like(metrics: dict[str, Any]) -> bool:
    """Recurring spend with moderate date regularity (any category, any amount)."""
    return (
        metrics["regularity"] >= 0.4
        and metrics["occurrences"] >= 3
    )


def _is_variable_bill(metrics: dict[str, Any]) -> bool:
    """Bill-like categories with varying amounts on monthly or seasonal cadence."""
    if not _is_bill_like_category(str(metrics.get("category") or "")):
        return False
    if metrics["occurrences"] < 3:
        return False
    if metrics["freq"] == "monthly" and metrics["regularity"] >= 0.35:
        return True
    if metrics["regularity"] >= 0.35 and 20 <= metrics["avg_gap_days"] <= 45:
        return True
    # Seasonal / irregular cadence (heating oil, propane): steady spacing among deliveries.
    return metrics["regularity"] >= 0.4 and metrics["occurrences"] >= 3


def _analyze_misc_metrics(key: str, txns: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Build metrics for misc catch-all one-offs that lack recurrence threshold."""
    if not txns:
        return None
    amounts: list[Decimal] = []
    unique_dates: set[date] = set()
    for txn in txns:
        amount = txn.get("amount")
        if isinstance(amount, Decimal):
            amounts.append(amount)
        parsed = _parse_date(str(txn.get("date") or ""))
        if parsed is not None:
            unique_dates.add(parsed)
    if not amounts:
        return None

    amount_min = min(amounts)
    amount_max = max(amounts)
    amount_avg = sum(amounts, Decimal("0")) / Decimal(len(amounts))
    if amount_avg > 0:
        max_dev = max(abs(a - amount_avg) for a in amounts)
        amt_variance_pct = float((max_dev / amount_avg) * Decimal("100"))
    else:
        amt_variance_pct = 0.0

    sorted_dates = sorted(unique_dates)
    latest_txn = max(txns, key=lambda txn: str(txn.get("date") or ""))
    last_date = sorted_dates[-1].isoformat() if sorted_dates else ""
    first_date = sorted_dates[0].isoformat() if sorted_dates else ""

    return {
        "occurrences": len(unique_dates) or len(txns),
        "amount_min": amount_min,
        "amount_max": amount_max,
        "amount_avg": amount_avg,
        "amt_variance_pct": amt_variance_pct,
        "gaps": [],
        "avg_gap_days": 0.0,
        "gap_std": 0.0,
        "regularity": 0.0,
        "freq": "irregular",
        "last_date": last_date,
        "first_date": first_date,
        "payment_source": str(latest_txn.get("source_name") or ""),
        "category": str(latest_txn.get("category_name") or ""),
        "merchant": str(latest_txn.get("destination_name") or "").strip() or key,
        "sample_descriptions": sorted({
            str(txn.get("description") or "").strip()
            for txn in txns
            if str(txn.get("description") or "").strip()
        })[:3],
    }


def _has_in_month_usage_cluster(txns: list[dict[str, Any]], *, max_span_days: int = 10) -> bool:
    """True when 3+ charges in one month fall within a short window (metered billing)."""
    by_month = _monthly_charge_slots(txns)
    for slots in by_month.values():
        if len(slots) < 3:
            continue
        span = slots[-1][0] - slots[0][0]
        if span <= max_span_days:
            return True
    return False


def _is_usage_metered_saas(
    metrics: dict[str, Any],
    txns: list[dict[str, Any]],
) -> bool:
    """Usage line items clustered in-month (e.g. AI metered billing) — category-agnostic."""
    if metrics["occurrences"] < 3:
        return False
    by_month = _charges_per_calendar_month(txns)
    if len(by_month) < 3:
        return False
    peak = max(by_month.values())
    if peak > 4 or peak < 3:
        return False
    return _has_in_month_usage_cluster(txns)


def _is_recurring_candidate(
    metrics: dict[str, Any],
    txns: list[dict[str, Any]] | None = None,
) -> bool:
    if txns and _is_usage_metered_saas(metrics, txns):
        return True
    if txns and _is_visit_style_spending(txns, metrics=metrics):
        return False
    freq = metrics["freq"]
    if freq == "monthly" and metrics["regularity"] >= 0.5 and metrics["occurrences"] >= 3:
        return True
    if freq in ("annual", "quarterly") and metrics["occurrences"] >= 2:
        return True
    if _is_fixed_subscription(metrics):
        return True
    if _is_utility_like(metrics):
        return True
    if _is_variable_bill(metrics):
        return True
    return False


def _should_emit_opaque_subgroup(
    sub_metrics: dict[str, Any],
    *,
    is_misc: bool,
    txns: list[dict[str, Any]] | None = None,
) -> bool:
    """Stable opaque subgroups under D-34-01 may have only two hits."""
    if is_misc:
        return True
    if _is_recurring_candidate(sub_metrics, txns):
        return True
    return sub_metrics["occurrences"] >= 2


def _score_confidence(metrics: dict[str, Any]) -> Literal["high", "medium", "low"]:
    freq = metrics["freq"]
    if (
        freq == "monthly"
        and metrics["regularity"] >= 0.7
        and metrics["occurrences"] >= 3
        and metrics["amt_variance_pct"] < 5
    ):
        return "high"
    if (
        (freq == "monthly" and metrics["regularity"] >= 0.5)
        or _is_fixed_subscription(metrics)
        or _is_utility_like(metrics)
        or _is_variable_bill(metrics)
    ):
        return "medium"
    return "low"


def _assign_status(
    confidence: str,
    *,
    is_opaque_combined: bool = False,
) -> Literal["ready", "review"]:
    if is_opaque_combined:
        return "review"
    if confidence == "high":
        return "ready"
    return "review"


def _friendly_merchant_name(raw_payee: str) -> str:
    text = (raw_payee or "").strip()
    if not text:
        return ""
    while True:
        stripped = LEGAL_SUFFIX_RE.sub("", text).strip()
        if stripped == text:
            break
        text = stripped
    words: list[str] = []
    for word in text.split():
        if word.isupper() and len(word) <= 4:
            words.append(word)
        elif "&" in word:
            words.append(word)
        else:
            words.append(word.capitalize())
    return " ".join(words)


def _pad_amounts(
    amount_min: Decimal,
    amount_max: Decimal,
    *,
    pct: Decimal = Decimal("0.05"),
) -> tuple[str, str]:
    lo = (amount_min * (Decimal("1") - pct)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    hi = (amount_max * (Decimal("1") + pct)).quantize(Decimal("0.01"), ROUND_UP)
    return f"{lo}", f"{hi}"


def _recommend_amount_mode(metrics: dict[str, Any]) -> Literal["recurring", "intermittent"]:
    if metrics["amt_variance_pct"] <= 10 and metrics["regularity"] >= 0.5:
        return "recurring"
    return "intermittent"


def _infer_payment_rail(
    txns: list[dict[str, Any]],
    accounts: dict[str, dict[str, Any]],
) -> Literal["bank", "credit_card"]:
    latest = max(txns, key=lambda txn: str(txn.get("date") or ""))
    source_id = str(latest.get("source_id") or "")
    summary = accounts.get(source_id, {})
    attrs = {
        "type": summary.get("type") or latest.get("source_type") or "",
        "account_role": summary.get("role") or latest.get("source_role") or "",
    }
    if summary.get("role") == "Credit card" or is_credit_card_asset(attrs):
        return "credit_card"
    return "bank"


def _has_generic_payment_description(txns: list[dict[str, Any]]) -> bool:
    for txn in txns:
        desc = str(txn.get("description") or "").strip()
        if PREAPPROVED_RE.search(desc) or BILL_USER_PAYMENT_RE.search(desc):
            return True
    return False


def _fingerprint(txn: dict[str, Any]) -> tuple[str, Decimal]:
    cat = str(txn.get("category_name") or "").strip()
    amount = txn.get("amount")
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    else:
        amount = amount.quantize(Decimal("0.01"), ROUND_HALF_UP)
    return (cat, amount)


def _fingerprint_date_counts(txns: list[dict[str, Any]]) -> dict[tuple[str, Decimal], int]:
    counts: dict[tuple[str, Decimal], set[str]] = {}
    for txn in txns:
        cat = str(txn.get("category_name") or "").strip()
        if not cat:
            continue
        amount = txn.get("amount")
        if not isinstance(amount, Decimal):
            try:
                amount = Decimal(str(amount))
            except (InvalidOperation, TypeError):
                continue
        fp = _fingerprint({**txn, "amount": amount})
        date_str = str(txn.get("date") or "")[:10]
        if not date_str:
            continue
        counts.setdefault(fp, set()).add(date_str)
    return {fp: len(dates) for fp, dates in counts.items()}


def _should_subsplit_opaque_payee(txns: list[dict[str, Any]]) -> bool:
    if not txns:
        return False
    if not _has_generic_payment_description(txns):
        return False
    date_counts = _fingerprint_date_counts(txns)
    if len(date_counts) < 2:
        return False
    distinct_categories = {fp[0] for fp in date_counts}
    if len(distinct_categories) < 2:
        return False
    qualifying_two_plus = [count for count in date_counts.values() if count >= 2]
    if len(qualifying_two_plus) >= 2:
        return True
    return any(count >= 3 for count in date_counts.values())


def _slugify_cluster(raw_payee: str) -> str:
    text = raw_payee.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def _merchant_from_category(category: str, occurrences: int) -> str:
    label = _friendly_merchant_name(category)
    if 3 <= occurrences <= 5:
        label = f"{label} (likely)"
    return label


def _subgroups_for_opaque_payee(
    txns: list[dict[str, Any]],
) -> list[tuple[list[dict[str, Any]], Literal["stable", "misc"]]]:
    by_fp: dict[tuple[str, Decimal], list[dict[str, Any]]] = {}
    misc_txns: list[dict[str, Any]] = []
    for txn in txns:
        cat = str(txn.get("category_name") or "").strip()
        if not cat:
            misc_txns.append(txn)
            continue
        amount = txn.get("amount")
        if not isinstance(amount, Decimal):
            try:
                amount = Decimal(str(amount))
            except (InvalidOperation, TypeError):
                continue
        by_fp.setdefault(_fingerprint({**txn, "amount": amount}), []).append(txn)

    stable: list[tuple[list[dict[str, Any]], Literal["stable", "misc"]]] = []
    trigger_active = _should_subsplit_opaque_payee(txns)

    for group_txns in by_fp.values():
        unique_dates = {str(t.get("date") or "")[:10] for t in group_txns}
        date_count = len(unique_dates)
        if date_count >= 3:
            stable.append((group_txns, "stable"))
        elif date_count >= 2 and trigger_active:
            stable.append((group_txns, "stable"))
        else:
            misc_txns.extend(group_txns)

    result = stable
    if misc_txns:
        result.append((misc_txns, "misc"))
    return result


_OPAQUE_DESCRIPTION_TOKEN_RE = re.compile(
    r"[A-Z][A-Z0-9./_*-]+(?:\s*\*[A-Z0-9]+)?",
)
_OPAQUE_TOKEN_STOPWORDS = frozenset(
    {"PREAPPROVED", "PAYMENT", "BILL", "USER", "VIA", "MOBILE"},
)


def _is_canonical_payee_token(token: str) -> bool:
    """Domain- or processor-style tokens suitable for bill rule triggers."""
    return "." in token or "/" in token or "*" in token


def _resolve_opaque_raw_payee(txns: list[dict[str, Any]], fallback: str) -> str:
    """Prefer canonical payee token from withdrawal descriptions over friendly destination_name."""
    counts: dict[str, int] = {}
    for txn in txns:
        description = str(txn.get("description") or "").upper()
        for match in _OPAQUE_DESCRIPTION_TOKEN_RE.finditer(description):
            token = match.group(0).strip()
            if token in _OPAQUE_TOKEN_STOPWORDS or len(token) < 4:
                continue
            if not _is_canonical_payee_token(token):
                continue
            counts[token] = counts.get(token, 0) + 1
    if not counts:
        return fallback.strip()
    max_count = max(counts.values())
    candidates = [token for token, count in counts.items() if count == max_count]
    return sorted(candidates)[0]


def _opaque_subgroup_amount_exactly(
    sub_metrics: dict[str, Any],
    *,
    is_misc: bool,
) -> str | None:
    if is_misc:
        return None
    if (
        sub_metrics["amt_variance_pct"] < 5
        and sub_metrics["occurrences"] >= 3
        and sub_metrics["freq"] == "monthly"
    ):
        return _format_decimal(sub_metrics["amount_avg"])
    return None


def _make_opaque_subgroup_id(
    key: str,
    category: str,
    amount: Decimal,
    *,
    is_misc: bool,
) -> str:
    if is_misc:
        digest_input = f"{key}:misc"
    else:
        digest_input = f"{key}:{category}:{amount}"
    digest = hashlib.sha256(digest_input.encode("utf-8")).hexdigest()[:16]
    return f"sug-{digest}"


def _enrich_opaque_subgroup(
    key: str,
    subgroup_txns: list[dict[str, Any]],
    sub_metrics: dict[str, Any],
    accounts: dict[str, dict[str, Any]],
    *,
    raw_payee: str,
    category: str,
    is_misc: bool,
) -> dict[str, Any]:
    if is_misc:
        merchant = f"{raw_payee.strip()} (misc)"
    else:
        merchant = _merchant_from_category(category, sub_metrics["occurrences"])

    register_prefill = _build_register_prefill(
        sub_metrics,
        subgroup_txns,
        accounts,
        raw_payee=raw_payee,
        is_opaque=False,
    )
    register_prefill["name"] = merchant
    register_prefill["destination_account"] = raw_payee
    if is_misc:
        register_prefill["category_name"] = ""
        register_prefill["amount_mode"] = "intermittent"
        register_prefill["amount_exactly"] = None
    else:
        register_prefill["category_name"] = category
        register_prefill["amount_exactly"] = _opaque_subgroup_amount_exactly(
            sub_metrics,
            is_misc=False,
        )

    confidence = _score_confidence(sub_metrics)
    status: Literal["ready", "review"] = "review" if is_misc else _assign_status(confidence)

    fp_amount = subgroup_txns[0].get("amount") if subgroup_txns else Decimal("0")
    if not isinstance(fp_amount, Decimal):
        fp_amount = Decimal(str(fp_amount)).quantize(Decimal("0.01"), ROUND_HALF_UP)

    suggestion: dict[str, Any] = {
        "id": _make_opaque_subgroup_id(key, category, fp_amount, is_misc=is_misc),
        "merchant": merchant,
        "confidence": confidence,
        "status": status,
        "amount_min": _format_decimal(sub_metrics["amount_min"]),
        "amount_max": _format_decimal(sub_metrics["amount_max"]),
        "amount_avg": _format_decimal(sub_metrics["amount_avg"]),
        "occurrences": sub_metrics["occurrences"],
        "freq": sub_metrics["freq"],
        "regularity": round(sub_metrics["regularity"], 2),
        "last_date": sub_metrics["last_date"],
        "first_date": sub_metrics["first_date"],
        "category": category if not is_misc else sub_metrics["category"],
        "payment_source": sub_metrics["payment_source"],
        "sample_descriptions": sub_metrics["sample_descriptions"],
        "payee": raw_payee,
        "destination_name": _pick_canonical_payee(subgroup_txns) or None,
        "bucket": raw_payee,
        "cluster": _slugify_cluster(raw_payee),
        "register_prefill": register_prefill,
        "reasons": _build_reasons(sub_metrics, is_opaque=True),
    }
    return suggestion


def _is_opaque_payee_cluster(txns: list[dict[str, Any]]) -> bool:
    if not _has_generic_payment_description(txns):
        return False
    categories = {
        str(txn.get("category_name") or "").strip()
        for txn in txns
        if str(txn.get("category_name") or "").strip()
    }
    return len(categories) >= 2


def _freq_to_repeat_freq(freq: str) -> str | None:
    """Map engine freq labels to Firefly bill repeat_freq enum values."""
    mapping: dict[str, str | None] = {
        "monthly": "monthly",
        "biweekly": "weekly",
        "quarterly": "quarterly",
        "annual": "yearly",
        "irregular": None,
    }
    return mapping.get(freq, "monthly")


def _build_register_prefill(
    metrics: dict[str, Any],
    txns: list[dict[str, Any]],
    accounts: dict[str, dict[str, Any]],
    *,
    raw_payee: str,
    is_opaque: bool = False,
) -> dict[str, Any]:
    friendly = _friendly_merchant_name(raw_payee)
    freq = metrics["freq"]
    if freq == "irregular":
        amount_mode: Literal["recurring", "intermittent"] = "intermittent"
        repeat_freq = None
        amount_min, amount_max = _pad_amounts(metrics["amount_min"], metrics["amount_max"])
    else:
        amount_mode = _recommend_amount_mode(metrics)
        repeat_freq = _freq_to_repeat_freq(freq)
        if amount_mode == "recurring" and freq == "monthly":
            monthly_avg = compute_trailing_monthly_average(txns, months=3)
            if monthly_avg is not None:
                avg_text = _format_decimal(monthly_avg)
                amount_min = amount_max = avg_text
            else:
                amount_min, amount_max = _pad_amounts(
                    metrics["amount_min"], metrics["amount_max"]
                )
        else:
            amount_min, amount_max = _pad_amounts(metrics["amount_min"], metrics["amount_max"])
    return {
        "mode": "create_new",
        "name": friendly,
        "amount_mode": amount_mode,
        "amount_min": amount_min,
        "amount_max": amount_max,
        "repeat_freq": repeat_freq,
        "worksheet_section": "bills",
        "payment_rail": _infer_payment_rail(txns, accounts),
        "destination_account": raw_payee,
        "category_name": "" if is_opaque else metrics["category"],
        "description_contains": "",
        "amount_exactly": None,
    }


def _make_suggestion_id(key: str) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return f"sug-{digest}"


def _build_reasons(metrics: dict[str, Any], *, is_opaque: bool) -> list[str]:
    reasons: list[str] = []
    if metrics["freq"] == "monthly" and metrics["regularity"] >= 0.7:
        reasons.append("regular_monthly")
    if metrics["amt_variance_pct"] < 5:
        reasons.append("stable_amount")
    if is_opaque:
        reasons.append("opaque_payee")
    return reasons


def _is_already_registered(
    key: str,
    metrics: dict[str, Any],
    *,
    registry_rows: list[dict[str, Any]],
    firefly_bills: list[dict[str, Any]],
    registered_bill_ids: set[str],
    txns: list[dict[str, Any]] | None = None,
) -> bool:
    """Skip suggestions already represented in worksheet registry or Firefly bills."""
    if txns:
        live_bill_ids = _live_firefly_bill_ids(firefly_bills)
        for txn in txns:
            if _is_active_subscription_link(
                txn,
                live_bill_ids=live_bill_ids,
                registered_bill_ids=registered_bill_ids,
            ):
                return True

    friendly = _friendly_merchant_name(str(metrics.get("merchant") or key))
    raw_payee = str(metrics.get("merchant") or key).strip() or key
    labels = {friendly.casefold(), raw_payee.casefold(), key.casefold()}

    registered_labels = {
        str(row.get("row_label") or "").casefold()
        for row in registry_rows
        if row.get("row_label")
    }
    if labels & registered_labels:
        return True

    bill_names = {
        str(bill.get("name") or "").casefold(): str(bill.get("id") or "")
        for bill in firefly_bills
    }
    for label in labels:
        bill_id = bill_names.get(label)
        if bill_id and bill_id in registered_bill_ids:
            return True

    return False


def _sort_suggestions(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def sort_key(item: dict[str, Any]) -> tuple[str, int, int, str, int]:
        payee = str(item.get("payee") or item.get("bucket") or "").casefold()
        confidence = str(item.get("confidence") or "low")
        merchant = str(item.get("merchant") or "")
        last_date = str(item.get("last_date") or "")
        date_key = -int(last_date.replace("-", "") or 0)
        return (
            payee,
            CONFIDENCE_RANK.get(confidence, 99),
            -int(item.get("occurrences") or 0),
            merchant.casefold(),
            date_key,
        )

    return sorted(items, key=sort_key)


def _enrich_suggestion(
    key: str,
    txns: list[dict[str, Any]],
    metrics: dict[str, Any],
    accounts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    raw_payee = str(metrics["merchant"] or key).strip() or key
    is_opaque = _is_opaque_payee_cluster(txns)
    friendly = _friendly_merchant_name(raw_payee)
    confidence = _score_confidence(metrics)
    status = _assign_status(confidence, is_opaque_combined=is_opaque)
    latest_category = metrics["category"]
    register_prefill = _build_register_prefill(
        metrics,
        txns,
        accounts,
        raw_payee=raw_payee,
        is_opaque=is_opaque,
    )
    suggestion: dict[str, Any] = {
        "id": _make_suggestion_id(key),
        "merchant": friendly,
        "confidence": confidence,
        "status": status,
        "amount_min": _format_decimal(metrics["amount_min"]),
        "amount_max": _format_decimal(metrics["amount_max"]),
        "amount_avg": _format_decimal(metrics["amount_avg"]),
        "occurrences": metrics["occurrences"],
        "freq": metrics["freq"],
        "regularity": round(metrics["regularity"], 2),
        "last_date": metrics["last_date"],
        "first_date": metrics["first_date"],
        "category": latest_category,
        "payment_source": metrics["payment_source"],
        "sample_descriptions": metrics["sample_descriptions"],
        "payee": raw_payee,
        "destination_name": _pick_canonical_payee(txns) or None,
        "bucket": raw_payee,
        "cluster": None,
        "register_prefill": register_prefill,
        "reasons": _build_reasons(metrics, is_opaque=is_opaque),
    }
    if is_opaque:
        suggestion["notes"] = OPAQUE_NOTES
    return suggestion


def _normalize_drilldown_transaction(row: dict[str, Any]) -> dict[str, Any]:
    amount = row.get("amount")
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    return {
        "date": str(row.get("date") or "")[:10],
        "amount": _format_decimal(amount),
        "description": str(row.get("description") or "").strip(),
        "category": (str(row.get("category_name") or "").strip() or None),
        "payee": (str(row.get("destination_name") or "").strip() or None),
        "budget": (str(row.get("budget_name") or "").strip() or None),
    }


def _sort_drilldown_transactions(txns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [_normalize_drilldown_transaction(txn) for txn in txns]
    normalized.sort(key=lambda row: row["date"] or "", reverse=True)
    return normalized


def _prepare_bill_suggestion_groups(
    splits: list[dict[str, Any]],
    *,
    accounts: dict[str, dict[str, Any]],
    firefly_bills: list[dict[str, Any]],
    registry_rows: list[dict[str, Any]],
    ignored_categories: list[str] | None = None,
    ignored_payees: list[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], set[str], set[str]]:
    ignore_list = ignored_categories if ignored_categories is not None else []
    payee_ignore_list = ignored_payees if ignored_payees is not None else []
    registered_bill_ids = {
        str(row["firefly_bill_id"])
        for row in registry_rows
        if row.get("firefly_bill_id")
    }
    live_bill_ids = _live_firefly_bill_ids(firefly_bills)

    parsed = [row for row in (_parse_withdrawal(split) for split in splits) if row is not None]
    filtered = [
        row
        for row in parsed
        if not _is_noise_transaction(
            row,
            accounts,
            ignored_categories=ignore_list,
            ignored_payees=payee_ignore_list,
        )
    ]
    filtered = [
        row
        for row in filtered
        if not _is_active_subscription_link(
            row,
            live_bill_ids=live_bill_ids,
            registered_bill_ids=registered_bill_ids,
        )
    ]
    groups = _cluster_withdrawals(filtered)
    return parsed, groups, registered_bill_ids, live_bill_ids


def _resolve_opaque_subgroup_suggestion_id(
    key: str,
    subgroup_txns: list[dict[str, Any]],
    *,
    is_misc: bool,
    category: str,
) -> str:
    if is_misc:
        return _make_opaque_subgroup_id(key, category, Decimal("0"), is_misc=True)
    fp_amount = subgroup_txns[0].get("amount") if subgroup_txns else Decimal("0")
    if not isinstance(fp_amount, Decimal):
        fp_amount = Decimal(str(fp_amount)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return _make_opaque_subgroup_id(key, category, fp_amount, is_misc=False)


class _EmittedSuggestionGroup(NamedTuple):
    suggestion_id: str
    key: str
    txns: list[dict[str, Any]]
    kind: Literal["opaque", "regular"]
    metrics: dict[str, Any]
    raw_payee: str = ""
    category: str = ""
    is_misc: bool = False


def _iter_emitted_suggestion_groups(
    groups: dict[str, list[dict[str, Any]]],
    *,
    firefly_bills: list[dict[str, Any]],
    registry_rows: list[dict[str, Any]],
    registered_bill_ids: set[str],
) -> Iterator[_EmittedSuggestionGroup]:
    """Yield suggestion groups that would appear in the discover list."""
    for key, txns in groups.items():
        metrics = _analyze_group(key, txns)
        if metrics is None:
            continue
        if _should_subsplit_opaque_payee(txns):
            raw_payee = _resolve_opaque_raw_payee(
                txns,
                str(metrics["merchant"] or key).strip() or key,
            )
            for subgroup_txns, subgroup_kind in _subgroups_for_opaque_payee(txns):
                is_misc = subgroup_kind == "misc"
                sub_metrics = _analyze_group(key, subgroup_txns)
                if sub_metrics is None and is_misc:
                    sub_metrics = _analyze_misc_metrics(key, subgroup_txns)
                if sub_metrics is None:
                    continue
                if not _should_emit_opaque_subgroup(
                    sub_metrics,
                    is_misc=is_misc,
                    txns=subgroup_txns,
                ):
                    continue
                if is_misc:
                    category = sub_metrics["category"]
                    merchant_label = f"{raw_payee.strip()} (misc)"
                else:
                    category, _ = _fingerprint(subgroup_txns[0])
                    merchant_label = _merchant_from_category(
                        category,
                        sub_metrics["occurrences"],
                    )
                reg_metrics = {**sub_metrics, "merchant": merchant_label}
                if _is_already_registered(
                    key,
                    reg_metrics,
                    registry_rows=registry_rows,
                    firefly_bills=firefly_bills,
                    registered_bill_ids=registered_bill_ids,
                    txns=subgroup_txns,
                ):
                    continue
                subgroup_id = _resolve_opaque_subgroup_suggestion_id(
                    key,
                    subgroup_txns,
                    is_misc=is_misc,
                    category=category,
                )
                yield _EmittedSuggestionGroup(
                    subgroup_id,
                    key,
                    subgroup_txns,
                    "opaque",
                    sub_metrics,
                    raw_payee=raw_payee,
                    category=category,
                    is_misc=is_misc,
                )
            continue
        if not _is_recurring_candidate(metrics, txns):
            continue
        if _is_already_registered(
            key,
            metrics,
            registry_rows=registry_rows,
            firefly_bills=firefly_bills,
            registered_bill_ids=registered_bill_ids,
            txns=txns,
        ):
            continue
        yield _EmittedSuggestionGroup(
            _make_suggestion_id(key),
            key,
            txns,
            "regular",
            metrics,
        )


def _find_matching_suggestion_transactions(
    groups: dict[str, list[dict[str, Any]]],
    *,
    firefly_bills: list[dict[str, Any]],
    registry_rows: list[dict[str, Any]],
    registered_bill_ids: set[str],
    suggestion_id: str,
) -> list[dict[str, Any]] | None:
    for emitted in _iter_emitted_suggestion_groups(
        groups,
        firefly_bills=firefly_bills,
        registry_rows=registry_rows,
        registered_bill_ids=registered_bill_ids,
    ):
        if emitted.suggestion_id == suggestion_id:
            return _sort_drilldown_transactions(emitted.txns)
    return None


def _find_emitted_suggestion(
    splits: list[dict[str, Any]],
    *,
    accounts: dict[str, dict[str, Any]],
    firefly_bills: list[dict[str, Any]],
    registry_rows: list[dict[str, Any]],
    ignored_categories: list[str] | None = None,
    ignored_payees: list[str] | None = None,
    suggestion_id: str,
) -> _EmittedSuggestionGroup | None:
    _, groups, registered_bill_ids, _live_bill_ids = _prepare_bill_suggestion_groups(
        splits,
        accounts=accounts,
        firefly_bills=firefly_bills,
        registry_rows=registry_rows,
        ignored_categories=ignored_categories,
        ignored_payees=ignored_payees,
    )
    for emitted in _iter_emitted_suggestion_groups(
        groups,
        firefly_bills=firefly_bills,
        registry_rows=registry_rows,
        registered_bill_ids=registered_bill_ids,
    ):
        if emitted.suggestion_id == suggestion_id:
            return emitted
    return None


def resolve_suggestion_destination_name(
    splits: list[dict[str, Any]],
    *,
    accounts: dict[str, dict[str, Any]],
    firefly_bills: list[dict[str, Any]],
    registry_rows: list[dict[str, Any]],
    ignored_categories: list[str] | None = None,
    ignored_payees: list[str] | None = None,
    suggestion_id: str,
) -> str | None:
    """Canonical Firefly destination_name for a visible suggestion, or None."""
    emitted = _find_emitted_suggestion(
        splits,
        accounts=accounts,
        firefly_bills=firefly_bills,
        registry_rows=registry_rows,
        ignored_categories=ignored_categories,
        ignored_payees=ignored_payees,
        suggestion_id=suggestion_id,
    )
    if emitted is None:
        return None
    payee = _pick_canonical_payee(emitted.txns)
    return payee.strip() if payee else None


def find_suggestion_transactions(
    splits: list[dict[str, Any]],
    *,
    accounts: dict[str, dict[str, Any]],
    firefly_bills: list[dict[str, Any]],
    registry_rows: list[dict[str, Any]],
    period_start: str,
    period_end: str,
    ignored_categories: list[str] | None = None,
    ignored_payees: list[str] | None = None,
    suggestion_id: str,
) -> list[dict[str, Any]] | None:
    """Return normalized withdrawal rows for suggestion_id, or None if not found."""
    _ = period_start, period_end
    _, groups, registered_bill_ids, _live_bill_ids = _prepare_bill_suggestion_groups(
        splits,
        accounts=accounts,
        firefly_bills=firefly_bills,
        registry_rows=registry_rows,
        ignored_categories=ignored_categories,
        ignored_payees=ignored_payees,
    )
    return _find_matching_suggestion_transactions(
        groups,
        firefly_bills=firefly_bills,
        registry_rows=registry_rows,
        registered_bill_ids=registered_bill_ids,
        suggestion_id=suggestion_id,
    )


async def fetch_bill_suggestions(
    client: FireflyClient,
    *,
    lookback_months: int = 12,
) -> dict[str, Any]:
    """Fetch Firefly data and build bill suggestions (compute-on-demand, read-only sidecar)."""
    if lookback_months not in LOOKBACK_CHOICES:
        raise ValueError("lookback_months must be 6, 12, or 24.")
    period_end = app_clock.today()
    period_start = _lookback_period_start(period_end, lookback_months)
    start_iso = period_start.isoformat()
    end_iso = period_end.isoformat()
    splits = await client.fetch_splits(start_iso, end_iso)
    accounts = await client.fetch_accounts()
    bills = await client.fetch_bills()
    registry_rows = await sidecar_db.list_worksheet_registry()
    settings = await sidecar_db.get_discover_settings()
    return build_bill_suggestions(
        splits,
        accounts=accounts,
        firefly_bills=bills,
        registry_rows=registry_rows,
        period_start=start_iso,
        period_end=end_iso,
        ignored_categories=settings["ignored_categories"],
        ignored_payees=settings["ignored_payees"],
    )


async def fetch_bill_suggestion_transactions(
    client: FireflyClient,
    *,
    suggestion_id: str,
    lookback_months: int = 12,
) -> dict[str, Any] | None:
    """Fetch Firefly data and resolve drill-down transactions for one suggestion."""
    if lookback_months not in LOOKBACK_CHOICES:
        raise ValueError("lookback_months must be 6, 12, or 24.")
    period_end = app_clock.today()
    period_start = _lookback_period_start(period_end, lookback_months)
    start_iso = period_start.isoformat()
    end_iso = period_end.isoformat()
    splits = await client.fetch_splits(start_iso, end_iso)
    accounts = await client.fetch_accounts()
    bills = await client.fetch_bills()
    registry_rows = await sidecar_db.list_worksheet_registry()
    settings = await sidecar_db.get_discover_settings()
    txns = find_suggestion_transactions(
        splits,
        accounts=accounts,
        firefly_bills=bills,
        registry_rows=registry_rows,
        period_start=start_iso,
        period_end=end_iso,
        ignored_categories=settings["ignored_categories"],
        ignored_payees=settings["ignored_payees"],
        suggestion_id=suggestion_id,
    )
    if txns is None:
        return None
    return {
        "data": txns,
        "meta": {
            "suggestion_id": suggestion_id,
            "transaction_count": len(txns),
            "period_start": start_iso,
            "period_end": end_iso,
        },
    }


def build_bill_suggestions(
    splits: list[dict[str, Any]],
    *,
    accounts: dict[str, dict[str, Any]],
    firefly_bills: list[dict[str, Any]],
    registry_rows: list[dict[str, Any]],
    period_start: str,
    period_end: str,
    ignored_categories: list[str] | None = None,
    ignored_payees: list[str] | None = None,
) -> dict[str, Any]:
    """Pure engine — primary unit-test entry point."""
    parsed, groups, registered_bill_ids, _live_bill_ids = _prepare_bill_suggestion_groups(
        splits,
        accounts=accounts,
        firefly_bills=firefly_bills,
        registry_rows=registry_rows,
        ignored_categories=ignored_categories,
        ignored_payees=ignored_payees,
    )

    suggestions: list[dict[str, Any]] = []
    for emitted in _iter_emitted_suggestion_groups(
        groups,
        firefly_bills=firefly_bills,
        registry_rows=registry_rows,
        registered_bill_ids=registered_bill_ids,
    ):
        if emitted.kind == "opaque":
            suggestions.append(
                _enrich_opaque_subgroup(
                    emitted.key,
                    emitted.txns,
                    emitted.metrics,
                    accounts,
                    raw_payee=emitted.raw_payee,
                    category=emitted.category,
                    is_misc=emitted.is_misc,
                )
            )
        else:
            suggestions.append(
                _enrich_suggestion(emitted.key, emitted.txns, emitted.metrics, accounts)
            )

    sorted_suggestions = _sort_suggestions(suggestions)

    return {
        "data": sorted_suggestions,
        "meta": {
            "withdrawals_analyzed": len(parsed),
            "suggestions_count": len(sorted_suggestions),
            "period_start": period_start,
            "period_end": period_end,
        },
    }
