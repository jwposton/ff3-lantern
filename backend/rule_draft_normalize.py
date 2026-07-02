"""Normalize AI rule drafts into sensible Firefly rule title."""

from __future__ import annotations

import re

from categorization_models import RuleDraft


def _looks_like_bad_title(
    title: str,
    *,
    description: str,
    category_name: str,
    destination_name: str | None,
) -> bool:
    if not title:
        return True
    if len(title) > 80:
        return True
    title_lower = title.lower()
    if title_lower == category_name.lower():
        return True
    if "→" not in title:
        merchant = (destination_name or "").strip().lower()
        words = title.split()
        if len(words) == 1 and title_lower not in {merchant, description.lower()}:
            if not merchant or title_lower not in merchant:
                return True
    if description and title.upper() == description.upper():
        return True
    if len(title) > 48 and description and description.upper() in title.upper():
        return True
    if title_lower.startswith(("matches ", "recurring ", "because ", "likely ")):
        return True
    return False


def derive_rule_title(
    *,
    destination_name: str | None,
    description: str,
    category_name: str,
) -> str:
    merchant = (destination_name or "").strip()
    generic = {"", "unknown", "expense account", "expenses", "cash"}
    if not merchant or merchant.lower() in generic:
        words = re.findall(r"[A-Za-z0-9]{3,}", description or "")
        merchant = words[0] if words else "Transaction"
        merchant = merchant.title()
    title = f"{merchant} → {category_name}".strip()
    return title[:100]


def normalize_rule_draft(
    draft: RuleDraft,
    *,
    description: str,
    destination_name: str | None,
    category_name: str,
) -> RuleDraft:
    """Ensure title is a short UI label; description always comes from the transaction."""
    desc = (description or "").strip()
    title = draft.title.strip()
    if _looks_like_bad_title(
        title,
        category_name=category_name,
        description=desc,
        destination_name=destination_name,
    ):
        title = derive_rule_title(
            destination_name=destination_name,
            description=desc,
            category_name=category_name,
        )

    return RuleDraft(
        title=title,
        description_contains=desc,
        destination_account=draft.destination_account,
        destination_match_type=draft.destination_match_type,
        transaction_type=draft.transaction_type,
        amount=draft.amount,
    )
