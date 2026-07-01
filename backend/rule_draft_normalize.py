"""Normalize AI rule drafts into sensible Firefly rule title + trigger needle."""

from __future__ import annotations

import re

from categorization_models import RuleDraft

_TOKEN_SPLIT = re.compile(r"[\s*#./\\|,:;]+")
_GENERIC_DESCRIPTIONS = frozenset(
    {
        "POS PURCHASE",
        "DEBIT",
        "DEBIT CARD",
        "DEBIT CARD PURCHASE",
        "WITHDRAWAL",
        "PAYMENT",
        "CHECKCARD",
        "ACH",
        "ACH DEBIT",
        "ACH PAYMENT",
        "ONLINE PAYMENT",
        "TRANSFER",
        "ELECTRONIC PAYMENT",
    }
)


def is_generic_description(description: str) -> bool:
    normalized = re.sub(r"[^A-Z ]", " ", (description or "").upper())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return True
    if normalized in _GENERIC_DESCRIPTIONS:
        return True
    return len(normalized) < 8


def extract_description_needle(description: str) -> str:
    """Pick a short stable substring for Firefly description_contains."""
    desc = (description or "").strip()
    if not desc:
        return ""
    upper = desc.upper()
    for part in _TOKEN_SPLIT.split(upper):
        token = re.sub(r"[^A-Z0-9]", "", part)
        if len(token) >= 4:
            return token[:32]
    cleaned = re.sub(r"[^A-Z0-9 ]", " ", upper).strip()
    return cleaned[:32] if cleaned else upper[:32]


def _looks_like_bad_title(
    title: str,
    *,
    needle: str,
    category_name: str,
    description: str,
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
        if len(words) == 1 and title_lower not in {merchant, needle.lower()}:
            if not merchant or title_lower not in merchant:
                return True
    if needle and title.upper() == needle.upper():
        return True
    if description and title.upper() == description.upper():
        return True
    # Rationale-style titles or full bank descriptions
    if len(title) > 48 and needle and needle.upper() in title.upper():
        return True
    if title_lower.startswith(("matches ", "recurring ", "because ", "likely ")):
        return True
    return False


def derive_rule_title(
    *,
    destination_name: str | None,
    description: str,
    category_name: str,
    needle: str,
) -> str:
    merchant = (destination_name or "").strip()
    generic = {"", "unknown", "expense account", "expenses", "cash"}
    if not merchant or merchant.lower() in generic:
        merchant = needle.split()[0] if needle else ""
        if not merchant:
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
    """Ensure title is a short UI label and triggers match the transaction."""
    needle = draft.description_contains.strip()
    dest_account = (draft.destination_account or "").strip()
    payee = (destination_name or "").strip()
    generic_payees = {"", "unknown", "expense account", "expenses", "cash"}

    if is_generic_description(description) and payee.lower() not in generic_payees:
        dest_account = dest_account or payee
        needle = ""

    if needle and (len(needle) > 40 or needle.upper() == (description or "").upper()):
        needle = extract_description_needle(description) or needle
    if not needle and not dest_account:
        needle = extract_description_needle(description)
        if not needle and payee.lower() not in generic_payees:
            dest_account = payee

    title = draft.title.strip()
    if _looks_like_bad_title(
        title,
        needle=needle,
        category_name=category_name,
        description=description,
        destination_name=destination_name,
    ):
        title = derive_rule_title(
            destination_name=destination_name,
            description=description,
            category_name=category_name,
            needle=needle,
        )

    return RuleDraft(
        title=title,
        description_contains=needle,
        destination_account=dest_account or None,
        destination_match_type=draft.destination_match_type,
        transaction_type=draft.transaction_type,
    )
