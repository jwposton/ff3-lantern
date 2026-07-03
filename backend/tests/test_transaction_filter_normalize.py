"""Tests for explorer filter normalization."""

from transaction_filter_models import ExplorerFilterDraft
from transaction_filter_normalize import (
    extract_broad_search_term,
    normalize_explorer_filter_draft,
    try_deterministic_search_query,
)


def test_try_deterministic_search_query_or_phrase():
    draft = try_deterministic_search_query("transactions for Patreon or CFBDB")
    assert draft is not None
    assert draft.search == "Patreon or CFBDB"


def test_try_deterministic_composite_or_keywords_and_amount():
    draft = try_deterministic_search_query(
        "Spotify or CFBD or Patreon or amount is 700"
    )
    assert draft is not None
    assert draft.search == "Spotify or CFBD or Patreon"
    assert draft.amount_exact == "700.00"


def test_try_deterministic_composite_amount_and_or_keywords():
    draft = try_deterministic_search_query("700 and CFBD or patreon charges")
    assert draft is not None
    assert draft.search == "CFBD or patreon"
    assert draft.amount_exact == "700.00"


def test_try_deterministic_amount_only():
    draft = try_deterministic_search_query("amount is 700")
    assert draft is not None
    assert draft.search == ""
    assert draft.amount_exact == "700.00"


def test_try_deterministic_amount_range_over():
    draft = try_deterministic_search_query("over 500")
    assert draft is not None
    assert draft.amount_min == "500.00"
    assert draft.amount_max == ""


def test_try_deterministic_amount_range_between():
    draft = try_deterministic_search_query("between 50 and 100")
    assert draft is not None
    assert draft.amount_min == "50.00"
    assert draft.amount_max == "100.00"


def test_try_deterministic_amount_range_with_or_keywords():
    draft = try_deterministic_search_query("spotify or patreon over 500")
    assert draft is not None
    assert draft.search == "spotify or patreon"
    assert draft.amount_min == "500.00"


def test_try_deterministic_amount_range_does_not_search_amount_keyword():
    draft = try_deterministic_search_query("amount between 100 and 200")
    assert draft is not None
    assert draft.amount_min == "100.00"
    assert draft.amount_max == "200.00"
    assert draft.search == ""


def test_try_deterministic_value_between_range():
    draft = try_deterministic_search_query("value between 50 and 100")
    assert draft is not None
    assert draft.amount_min == "50.00"
    assert draft.amount_max == "100.00"
    assert draft.search == ""


def test_normalize_clears_amount_search_noise_from_ai_draft():
    draft = ExplorerFilterDraft(
        search="amount",
        amount_min="100.00",
        amount_max="200.00",
        rationale="range",
    )
    normalized = normalize_explorer_filter_draft(draft, "amount between 100 and 200")
    assert normalized.search == ""
    assert normalized.amount_min == "100.00"


def test_extract_broad_search_term_strips_nl_phrasing():
    assert extract_broad_search_term("all transactions with spotify") == "spotify"
    assert extract_broad_search_term("spotify charges") == "spotify"


def test_try_deterministic_search_query_spotify():
    draft = try_deterministic_search_query("spotify")
    assert draft is not None
    assert draft.search == "spotify"
    assert draft.description_contains == ""


def test_try_deterministic_search_query_skips_structured():
    assert try_deterministic_search_query("uncategorized withdrawals") is None


def test_normalize_moves_description_contains_to_search():
    draft = ExplorerFilterDraft(
        description_contains="spotify",
        rationale="Spotify",
    )
    normalized = normalize_explorer_filter_draft(draft, "spotify charges")
    assert normalized.search == "spotify"
    assert normalized.description_contains == ""
    assert normalized.destination_account is None


def test_normalize_preserves_structured_filters():
    draft = ExplorerFilterDraft(
        categories=["Food"],
        description_contains="spotify",
        rationale="Food spotify",
    )
    normalized = normalize_explorer_filter_draft(draft, "spotify in food")
    assert normalized.categories == ["Food"]
    assert normalized.search == "spotify"
    assert normalized.description_contains == ""
