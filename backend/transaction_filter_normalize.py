"""Normalize AI-parsed explorer filters to match general search behavior."""

from __future__ import annotations

import re
from dataclasses import dataclass

from transaction_filter_models import ExplorerFilterDraft

STRUCTURED_PATTERN = re.compile(
    r"\b(?:"
    r"uncategorized|"
    r"category|categories|"
    r"budget|"
    r"deposit|withdrawals?|transfers?|"
    r"amount|exactly|\$|"
    r"source\s+account|from\s+checking|"
    r"destination\s+account|payee|"
    r"description\s+contains|memo\s+includes?"
    r")\b",
    re.IGNORECASE,
)

_STRUCTURED_NON_AMOUNT = re.compile(
    r"\b(?:"
    r"uncategorized|"
    r"category|categories|"
    r"budget|"
    r"deposit|withdrawals?|transfers?|"
    r"source\s+account|from\s+checking|"
    r"destination\s+account|payee|"
    r"description\s+contains|memo\s+includes?"
    r")\b",
    re.IGNORECASE,
)

_AMOUNT_TRAILING = re.compile(
    r"(?:\s+or\s+|\s+and\s+)*(?:amount\s+(?:is\s+)?)?\$?(\d+(?:\.\d{1,2})?)\s*$",
    re.IGNORECASE,
)
_AMOUNT_LEADING = re.compile(
    r"^\$?(\d+(?:\.\d{1,2})?)\s+and\s+",
    re.IGNORECASE,
)
_OR_SPLIT = re.compile(r"\s+or\s+|\|", re.IGNORECASE)

_AMOUNT_BETWEEN = re.compile(
    r"(?:(?:amount|value)\s+)?(?:between|from)\s+\$?(\d+(?:\.\d{1,2})?)\s+"
    r"(?:and|to)\s+\$?(\d+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
_AMOUNT_DASH = re.compile(
    r"\$?(\d+(?:\.\d{1,2})?)\s*[-–]\s*\$?(\d+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
_AMOUNT_OVER_TRAILING = re.compile(
    r"(?:\s+or\s+|\s+and\s+)*(?:(?:amount|value)\s+)?"
    r"(?:over|above|more than|greater than|at least)\s+"
    r"\$?(\d+(?:\.\d{1,2})?)\s*$",
    re.IGNORECASE,
)
_AMOUNT_UNDER_TRAILING = re.compile(
    r"(?:\s+or\s+|\s+and\s+)*(?:(?:amount|value)\s+)?"
    r"(?:under|below|less than|at most|up to)\s+"
    r"\$?(\d+(?:\.\d{1,2})?)\s*$",
    re.IGNORECASE,
)
_AMOUNT_OVER_LEADING = re.compile(
    r"^(?:(?:amount|value)\s+)?(?:over|above|more than|greater than|at least)\s+"
    r"\$?(\d+(?:\.\d{1,2})?)\s+(?:and\s+)?",
    re.IGNORECASE,
)
_AMOUNT_UNDER_LEADING = re.compile(
    r"^(?:(?:amount|value)\s+)?(?:under|below|less than|at most|up to)\s+"
    r"\$?(\d+(?:\.\d{1,2})?)\s+(?:and\s+)?",
    re.IGNORECASE,
)
_AMOUNT_SEARCH_NOISE = re.compile(
    r"^(?:amount|value|exact(?:ly)?|price|cost)"
    r"(?:\s+(?:is|of|for|between|over|under|above|below))?\s*$",
    re.IGNORECASE,
)

_NL_PREFIX = re.compile(
    r"^(?:all\s+)?transactions?\s+(?:with|containing|matching|from|for)\s+",
    re.IGNORECASE,
)
_NL_SUFFIX = re.compile(
    r"\s+(?:charges?|purchases?|payments?|transactions?|subs?(?:cription)?s?)$",
    re.IGNORECASE,
)


def _format_amount(raw: str) -> str:
    return f"{float(raw):.2f}"


@dataclass
class ParsedAmountClauses:
    amount_exact: str | None = None
    amount_min: str | None = None
    amount_max: str | None = None

    def has_any(self) -> bool:
        return bool(self.amount_exact or self.amount_min or self.amount_max)


def _strip_joiner_noise(text: str) -> str:
    text = re.sub(r"^\s+and\s+", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s+and\s+$", "", text, flags=re.IGNORECASE).strip()
    return strip_amount_remainder(text)


def is_amount_search_noise(term: str) -> bool:
    return bool(_AMOUNT_SEARCH_NOISE.match(term.strip()))


def strip_amount_remainder(text: str) -> str:
    """Drop leftover amount/value keywords after parsing numeric clauses."""
    value = text.strip()
    if not value or is_amount_search_noise(value):
        return ""
    value = re.sub(r"^(?:amount|value)\s+", "", value, flags=re.IGNORECASE).strip()
    if is_amount_search_noise(value):
        return ""
    return value


def _apply_between(amounts: ParsedAmountClauses, lo: str, hi: str) -> None:
    low = _format_amount(lo)
    high = _format_amount(hi)
    if float(low) > float(high):
        low, high = high, low
    amounts.amount_min = low
    amounts.amount_max = high


def parse_amount_clauses(query: str) -> tuple[ParsedAmountClauses, str]:
    """Extract exact/range amount clauses and return the remaining query text."""
    text = query.strip()
    amounts = ParsedAmountClauses()
    if not text:
        return amounts, ""

    between = _AMOUNT_BETWEEN.search(text)
    if between:
        _apply_between(amounts, between.group(1), between.group(2))
        text = _strip_joiner_noise(
            (text[: between.start()] + " " + text[between.end() :]).strip()
        )
        return amounts, text

    dash = _AMOUNT_DASH.search(text)
    if dash:
        _apply_between(amounts, dash.group(1), dash.group(2))
        text = _strip_joiner_noise(
            (text[: dash.start()] + " " + text[dash.end() :]).strip()
        )
        return amounts, text

    while True:
        over = _AMOUNT_OVER_TRAILING.search(text)
        if over:
            amounts.amount_min = _format_amount(over.group(1))
            text = text[: over.start()].strip()
            continue
        under = _AMOUNT_UNDER_TRAILING.search(text)
        if under:
            amounts.amount_max = _format_amount(under.group(1))
            text = text[: under.start()].strip()
            continue
        break

    over_lead = _AMOUNT_OVER_LEADING.match(text)
    if over_lead:
        amounts.amount_min = _format_amount(over_lead.group(1))
        text = text[over_lead.end() :].strip()
    under_lead = _AMOUNT_UNDER_LEADING.match(text)
    if under_lead:
        amounts.amount_max = _format_amount(under_lead.group(1))
        text = text[under_lead.end() :].strip()

    if not amounts.has_any():
        exact, text = _extract_exact_amount(text)
        if exact:
            amounts.amount_exact = exact

    return amounts, _strip_joiner_noise(text)


def _extract_exact_amount(text: str) -> tuple[str | None, str]:
    """Pull a trailing/leading exact amount clause out of free-text."""
    if not text:
        return None, ""
    amount: str | None = None
    trailing = _AMOUNT_TRAILING.search(text)
    if trailing:
        amount = _format_amount(trailing.group(1))
        text = text[: trailing.start()].strip()
    leading = _AMOUNT_LEADING.match(text)
    if leading:
        amount = _format_amount(leading.group(1))
        text = text[leading.end() :].strip()
    return amount, text


def extract_amount_from_query(query: str) -> tuple[str | None, str]:
    """Pull a trailing/leading amount clause out of a free-text query."""
    amounts, remainder = parse_amount_clauses(query)
    if amounts.amount_exact:
        return amounts.amount_exact, remainder
    if amounts.amount_min and amounts.amount_max:
        return None, query.strip()
    if amounts.amount_min or amounts.amount_max:
        return None, query.strip()
    return None, remainder


def build_or_search_string(text: str) -> str:
    """Join OR terms after stripping NL suffixes from each segment."""
    if not text.strip():
        return ""
    cleaned: list[str] = []
    for part in _OR_SPLIT.split(text):
        segment = part.strip()
        if not segment:
            continue
        term = extract_broad_search_term(segment) or segment
        if term and not is_amount_search_noise(term):
            cleaned.append(term)
    return " or ".join(cleaned)


def try_deterministic_composite_query(query: str) -> ExplorerFilterDraft | None:
    """OR keyword search combined with amount filters (AND between the two)."""
    trimmed = query.strip()
    if not trimmed or _STRUCTURED_NON_AMOUNT.search(trimmed):
        return None

    amounts, remainder = parse_amount_clauses(trimmed)
    search = build_or_search_string(remainder)
    has_or = bool(_OR_SPLIT.search(remainder))

    if not amounts.has_any() and not has_or:
        return None
    if not search and not amounts.has_any():
        return None

    rationale_parts: list[str] = []
    if search:
        rationale_parts.append(f'search "{search}"')
    if amounts.amount_exact:
        rationale_parts.append(f"amount {amounts.amount_exact}")
    elif amounts.amount_min and amounts.amount_max:
        rationale_parts.append(f"amount {amounts.amount_min}–{amounts.amount_max}")
    elif amounts.amount_min:
        rationale_parts.append(f"amount ≥ {amounts.amount_min}")
    elif amounts.amount_max:
        rationale_parts.append(f"amount ≤ {amounts.amount_max}")
    rationale = "; ".join(rationale_parts).capitalize() + "."

    return ExplorerFilterDraft(
        search=search,
        amount_exact=amounts.amount_exact or "",
        amount_min=amounts.amount_min or "",
        amount_max=amounts.amount_max or "",
        rationale=rationale,
    )


def extract_broad_search_term(text: str) -> str:
    """Pull a keyword from free-text or lightly phrased queries."""
    value = text.strip()
    if not value:
        return ""
    value = _NL_PREFIX.sub("", value).strip()
    value = _NL_SUFFIX.sub("", value).strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1].strip()
    return value


def has_structured_filters(draft: ExplorerFilterDraft) -> bool:
    return bool(
        draft.categories
        or draft.budget
        or draft.account
        or draft.transaction_type
        or draft.amount_exact
        or draft.amount_min
        or draft.amount_max
        or draft.uncategorized_only
    )


def try_deterministic_search_query(query: str) -> ExplorerFilterDraft | None:
    """Skip the LLM when the query is clearly a general keyword search."""
    composite = try_deterministic_composite_query(query)
    if composite is not None:
        return composite

    trimmed = query.strip()
    if not trimmed or STRUCTURED_PATTERN.search(trimmed):
        return None
    keyword = extract_broad_search_term(trimmed)
    if not keyword:
        return None
    return ExplorerFilterDraft(
        search=keyword,
        rationale=f'Search all fields for "{keyword}".',
    )


def _clear_amount_search_noise(draft: ExplorerFilterDraft) -> ExplorerFilterDraft:
    if not (draft.amount_exact or draft.amount_min or draft.amount_max):
        return draft
    search = draft.search.strip()
    if search and is_amount_search_noise(search):
        return draft.model_copy(update={"search": ""})
    return draft


def normalize_explorer_filter_draft(
    draft: ExplorerFilterDraft,
    query: str,
) -> ExplorerFilterDraft:
    """Route broad text to search so AI parse matches the general search box."""
    desc = draft.description_contains.strip()
    dest = (draft.destination_account or "").strip()
    search = draft.search.strip()

    def to_search_only(keyword: str) -> ExplorerFilterDraft:
        term = extract_broad_search_term(keyword) or keyword
        return draft.model_copy(
            update={
                "search": term,
                "description_contains": "",
                "destination_account": None,
                "destination_match_type": "contains",
            }
        )

    if has_structured_filters(draft):
        if desc and not search:
            return _clear_amount_search_noise(to_search_only(desc))
        return _clear_amount_search_noise(draft)

    if search:
        return _clear_amount_search_noise(to_search_only(search))
    if desc:
        return _clear_amount_search_noise(to_search_only(desc))
    if dest:
        return _clear_amount_search_noise(to_search_only(dest))

    keyword = extract_broad_search_term(query)
    if keyword and not STRUCTURED_PATTERN.search(query):
        return _clear_amount_search_noise(
            draft.model_copy(
                update={
                    "search": keyword,
                    "description_contains": "",
                    "destination_account": None,
                    "rationale": draft.rationale
                    or f'Search all fields for "{keyword}".',
                }
            )
        )

    return _clear_amount_search_noise(draft)
