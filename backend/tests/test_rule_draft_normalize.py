"""Tests for AI rule draft normalization."""

from __future__ import annotations

from categorization_models import RuleDraft
from rule_draft_normalize import (
    derive_rule_title,
    extract_description_needle,
    normalize_rule_draft,
)


def test_extract_description_needle_prefers_merchant_token():
    assert extract_description_needle("AMZN MKTP US*AB12") == "AMZN"


def test_normalize_rule_draft_replaces_rationale_style_title():
    draft = RuleDraft(
        title="Matches prior Amazon purchases with stable payee token",
        description_contains="AMZN MKTP",
        transaction_type="withdrawal",
    )
    normalized = normalize_rule_draft(
        draft,
        description="AMZN MKTP US*AB12",
        destination_name="Amazon",
        category_name="Shopping",
    )
    assert normalized.title == "Amazon → Shopping"
    assert normalized.description_contains == "AMZN MKTP"


def test_normalize_rule_draft_fills_needle_from_description():
    draft = RuleDraft(
        title="Shopping",
        description_contains="",
        transaction_type="withdrawal",
    )
    normalized = normalize_rule_draft(
        draft,
        description="NETFLIX.COM 866-579-7172",
        destination_name="Netflix",
        category_name="Entertainment",
    )
    assert normalized.description_contains == "NETFLIX"
    assert normalized.destination_account is None
    assert normalized.title == "Netflix → Entertainment"


def test_normalize_rule_draft_keeps_good_title():
    draft = RuleDraft(
        title="Amazon marketplace",
        description_contains="AMZN MKTP",
        transaction_type="withdrawal",
    )
    normalized = normalize_rule_draft(
        draft,
        description="AMZN MKTP US",
        destination_name="Amazon",
        category_name="Shopping",
    )
    assert normalized.title == "Amazon marketplace"
    assert normalized.description_contains == "AMZN MKTP"


def test_normalize_rule_draft_generic_description_uses_destination():
    draft = RuleDraft(
        title="Groceries",
        description_contains="POS PURCHASE",
        transaction_type="withdrawal",
    )
    normalized = normalize_rule_draft(
        draft,
        description="POS PURCHASE",
        destination_name="Safeway",
        category_name="Groceries",
    )
    assert normalized.description_contains == ""
    assert normalized.destination_account == "Safeway"
    assert normalized.title == "Safeway → Groceries"


def test_derive_rule_title_uses_destination():
    assert (
        derive_rule_title(
            destination_name="Safeway",
            description="SAFEWAY #1234",
            category_name="Groceries",
            needle="SAFEWAY",
        )
        == "Safeway → Groceries"
    )
