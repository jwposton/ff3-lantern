"""Infer loan split profile from liability-anchored Firefly journals."""

from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal
from statistics import median
from typing import Any

from loan_journal_splits import (
    decimal_amount,
    format_decimal,
    group_splits_by_journal,
    liability_principal_legs,
    sibling_legs,
)


def _account_name(accounts: dict[str, dict[str, Any]], account_id: str) -> str:
    return str((accounts.get(str(account_id)) or {}).get("name") or account_id)


def _split_type(split: dict[str, Any]) -> str:
    return str(split.get("type") or "transfer").lower()


def _stable_description_contains(descriptions: list[str]) -> str:
    cleaned = [desc.strip() for desc in descriptions if desc.strip()]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    first_words = cleaned[0].split()
    if not first_words:
        return cleaned[0]
    prefix: list[str] = []
    for index, word in enumerate(first_words):
        if all(
            len(parts) > index and parts[index].lower() == word.lower()
            for parts in (row.split() for row in cleaned)
        ):
            prefix.append(word)
        else:
            break
    if prefix:
        return " ".join(prefix)
    return first_words[0]


def _normalize_label(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _most_common(counter: Counter[str]) -> str | None:
    if not counter:
        return None
    return counter.most_common(1)[0][0]


def infer_component_metadata_by_role(
    splits: list[dict[str, Any]],
    account_id: str,
    sibling_dests: dict[str, str],
) -> dict[str, dict[str, str | None]]:
    """Pick category/budget per split role from liability-anchored journals."""
    category_counts: dict[str, Counter[str]] = defaultdict(Counter)
    budget_counts: dict[str, Counter[str]] = defaultdict(Counter)
    dest_to_role = {dest_id: role for role, dest_id in sibling_dests.items()}

    for journal_splits in group_splits_by_journal(splits).values():
        if not liability_principal_legs(journal_splits, account_id):
            continue
        for split in liability_principal_legs(journal_splits, account_id):
            category = _normalize_label(split.get("category_name"))
            budget = _normalize_label(split.get("budget_name"))
            if category:
                category_counts["principal"][category] += 1
            if budget:
                budget_counts["principal"][budget] += 1
        for split in sibling_legs(journal_splits, account_id):
            dest_id = str(split.get("destination_id") or "")
            role = dest_to_role.get(dest_id)
            if not role:
                continue
            category = _normalize_label(split.get("category_name"))
            budget = _normalize_label(split.get("budget_name"))
            if category:
                category_counts[role][category] += 1
            if budget:
                budget_counts[role][budget] += 1

    metadata: dict[str, dict[str, str | None]] = {}
    for role in ("principal", "interest", "escrow"):
        metadata[role] = {
            "category": _most_common(category_counts[role]),
            "budget": _most_common(budget_counts[role]),
        }
    return metadata


def infer_sibling_amounts_by_destination(
    splits: list[dict[str, Any]],
    account_id: str,
) -> dict[str, list[Decimal]]:
    """Median-ready sibling amounts keyed by destination account id."""
    amounts: dict[str, list[Decimal]] = defaultdict(list)
    for journal_splits in group_splits_by_journal(splits).values():
        if not liability_principal_legs(journal_splits, account_id):
            continue
        for split in sibling_legs(journal_splits, account_id):
            dest_id = str(split.get("destination_id") or "")
            if not dest_id:
                continue
            amounts[dest_id].append(abs(decimal_amount(split.get("amount"))))
    return amounts


def infer_split_budget_defaults(
    metadata_by_role: dict[str, dict[str, str | None]],
) -> tuple[str | None, dict[str, str | None]]:
    """Use one default budget when all roles agree; otherwise per-role overrides."""
    role_budgets = {
        role: metadata_by_role.get(role, {}).get("budget")
        for role in ("principal", "interest", "escrow")
        if metadata_by_role.get(role, {}).get("budget")
    }
    if not role_budgets:
        return None, {}
    unique = set(role_budgets.values())
    if len(unique) == 1:
        return next(iter(unique)), {
            role: None for role in ("principal", "interest", "escrow")
        }
    return None, {
        role: metadata_by_role.get(role, {}).get("budget")
        for role in ("principal", "interest", "escrow")
    }


def infer_sibling_destinations_by_role(
    splits: list[dict[str, Any]],
    account_id: str,
    accounts: dict[str, dict[str, Any]] | None = None,
) -> dict[str, str]:
    """Pick interest/escrow destinations from recurring sibling payee accounts."""
    _ = accounts
    dest_counts: Counter[str] = Counter()
    dest_amounts: dict[str, list[Decimal]] = defaultdict(list)

    for journal_splits in group_splits_by_journal(splits).values():
        if not liability_principal_legs(journal_splits, account_id):
            continue
        for split in sibling_legs(journal_splits, account_id):
            dest_id = str(split.get("destination_id") or "")
            if not dest_id:
                continue
            dest_counts[dest_id] += 1
            dest_amounts[dest_id].append(abs(decimal_amount(split.get("amount"))))

    if not dest_counts:
        return {}

    ranked = sorted(
        dest_counts.keys(),
        key=lambda dest_id: (
            -dest_counts[dest_id],
            median(dest_amounts[dest_id]),
        ),
    )
    destinations: dict[str, str] = {}
    if ranked:
        destinations["interest"] = ranked[0]
    if len(ranked) > 1:
        destinations["escrow"] = ranked[1]
    return destinations


def infer_match_fingerprint(
    splits: list[dict[str, Any]],
    account_id: str,
) -> dict[str, Any] | None:
    """Infer import fingerprint from recent liability-anchored journals."""
    candidates: list[dict[str, Any]] = []
    descriptions: list[str] = []
    totals: list[Decimal] = []

    for journal_splits in group_splits_by_journal(splits).values():
        legs = liability_principal_legs(journal_splits, account_id)
        if not legs:
            continue
        leg = legs[0]
        siblings = sibling_legs(journal_splits, account_id)
        principal = sum(abs(decimal_amount(split.get("amount"))) for split in legs)
        sibling_total = sum(
            abs(decimal_amount(split.get("amount"))) for split in siblings
        )
        total = principal + sibling_total if siblings else principal
        if total <= 0:
            continue
        candidates.append(leg)
        descriptions.append((leg.get("description") or "").strip())
        totals.append(total)

    if not candidates:
        return None

    candidates.sort(key=lambda row: row.get("date") or "", reverse=True)
    latest = candidates[0]
    expected = median(totals)
    description_contains = _stable_description_contains(descriptions)
    return {
        "type": _split_type(latest),
        "description_contains": description_contains,
        "expected_amount": f"{expected.quantize(Decimal('0.01'))}",
        "amount_tolerance": "0.50",
        "max_per_month": 1,
        "source_account_id": str(latest.get("source_id") or "") or None,
        "import_destination_account_id": None,
    }


def infer_loan_profile(
    splits: list[dict[str, Any]],
    *,
    account_id: str,
    liability_name: str,
    accounts: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Build a loan profile draft from split payment history on this liability account."""
    sibling_dests = infer_sibling_destinations_by_role(
        splits,
        account_id,
        accounts,
    )
    metadata_by_role = infer_component_metadata_by_role(
        splits,
        account_id,
        sibling_dests,
    )
    default_budget, budget_overrides = infer_split_budget_defaults(metadata_by_role)
    sibling_amounts = infer_sibling_amounts_by_destination(splits, account_id)
    match = infer_match_fingerprint(splits, account_id)
    if not sibling_dests and match is None:
        return None

    match_type = (match or {}).get("type") or "transfer"
    principal_meta = metadata_by_role.get("principal") or {}
    principal_budget = (
        budget_overrides["principal"]
        if "principal" in budget_overrides
        else principal_meta.get("budget")
    )
    components: list[dict[str, Any]] = [
        {
            "role": "principal",
            "type": match_type,
            "destination_account_id": str(account_id),
            "destination_account": liability_name,
            "category": principal_meta.get("category"),
            "budget": principal_budget,
        }
    ]
    for role in ("interest", "escrow"):
        dest_id = sibling_dests.get(role)
        if not dest_id:
            continue
        role_meta = metadata_by_role.get(role) or {}
        role_budget = (
            budget_overrides[role]
            if role in budget_overrides
            else role_meta.get("budget")
        )
        components.append(
            {
                "role": role,
                "type": "withdrawal" if match_type == "withdrawal" else match_type,
                "destination_account_id": dest_id,
                "destination_account": _account_name(accounts or {}, dest_id),
                "category": role_meta.get("category"),
                "budget": role_budget,
            }
        )

    escrow_dest = sibling_dests.get("escrow")
    escrow_amount = "0.00"
    if escrow_dest:
        escrow_values = sibling_amounts.get(escrow_dest) or []
        if escrow_values:
            escrow_amount = format_decimal(median(escrow_values))

    profile: dict[str, Any] = {
        "version": 1,
        "enabled": True,
        "match": match
        or {
            "type": "transfer",
            "description_contains": "",
            "expected_amount": "0.00",
            "amount_tolerance": "0.50",
            "max_per_month": 1,
        },
        "split": {
            "escrow_amount": escrow_amount,
            "budget": default_budget,
            "components": components,
        },
    }
    return profile


def profile_is_incomplete(profile: dict[str, Any] | None) -> bool:
    if not profile or not profile.get("enabled"):
        return True
    match = profile.get("match") or {}
    if not str(match.get("description_contains") or "").strip():
        return True
    expected = str(match.get("expected_amount") or "").strip().replace(",", "")
    if not expected:
        return True
    try:
        if Decimal(expected) == 0:
            return True
    except Exception:
        return True
    return False


def _merge_component(
    existing: dict[str, Any] | None,
    inferred_comp: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not existing and not inferred_comp:
        return None
    if not existing:
        return inferred_comp
    if not inferred_comp:
        return existing
    merged = {**inferred_comp, **existing}
    for key in (
        "destination_account_id",
        "destination_account",
        "category",
        "budget",
        "type",
    ):
        current = existing.get(key)
        if current in (None, ""):
            inferred_val = inferred_comp.get(key)
            if inferred_val not in (None, ""):
                merged[key] = inferred_val
    return merged


def merge_inferred_profile(
    profile: dict[str, Any] | None,
    inferred: dict[str, Any],
) -> dict[str, Any]:
    """Fill missing loan profile fields from an inferred draft."""
    base = dict(profile or {})
    base.setdefault("version", 1)
    base.setdefault("enabled", True)
    base.setdefault("match", {})
    base.setdefault("split", {"escrow_amount": "0.00", "components": []})

    match = {**(inferred.get("match") or {}), **(base.get("match") or {})}
    for key, value in (inferred.get("match") or {}).items():
        current = (base.get("match") or {}).get(key)
        if current in (None, "", 0):
            match[key] = value
    base["match"] = match

    existing_components = {
        comp.get("role"): comp
        for comp in (base.get("split") or {}).get("components") or []
        if comp.get("role")
    }
    inferred_components = {
        comp.get("role"): comp
        for comp in (inferred.get("split") or {}).get("components") or []
        if comp.get("role")
    }
    merged_components: list[dict[str, Any]] = []
    for role in ("principal", "interest", "escrow"):
        merged = _merge_component(
            existing_components.get(role),
            inferred_components.get(role),
        )
        if merged:
            merged_components.append(merged)
    split = {**(base.get("split") or {}), **(inferred.get("split") or {})}
    split["components"] = merged_components
    for key in ("budget", "escrow_amount"):
        current = (base.get("split") or {}).get(key)
        inferred_val = (inferred.get("split") or {}).get(key)
        if current in (None, "", "0.00", "0", 0):
            if inferred_val not in (None, "", "0.00", "0", 0):
                split[key] = inferred_val
    base["split"] = split
    return base
