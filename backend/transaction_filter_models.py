"""Pydantic models for AI-parsed Transaction Explorer filters."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

DestinationMatchType = Literal["contains", "starts_with", "ends_with", "is"]


class ExplorerFilterDraft(BaseModel):
    categories: list[str] = Field(default_factory=list)
    budget: str | None = None
    account: str | None = None
    search: str = ""
    description_contains: str = ""
    destination_account: str | None = None
    destination_match_type: DestinationMatchType = "contains"
    transaction_type: Literal["withdrawal", "deposit", "transfer"] | None = None
    amount_exact: str | None = None
    amount_min: str | None = None
    amount_max: str | None = None
    uncategorized_only: bool = False
    rationale: str = ""


FILTER_PARSE_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "categories": {
            "type": "array",
            "items": {"type": "string"},
        },
        "budget": {"type": ["string", "null"]},
        "account": {"type": ["string", "null"]},
        "search": {"type": "string"},
        "description_contains": {"type": "string"},
        "destination_account": {"type": ["string", "null"]},
        "destination_match_type": {
            "type": "string",
            "enum": ["contains", "starts_with", "ends_with", "is"],
        },
        "transaction_type": {
            "type": ["string", "null"],
            "enum": ["withdrawal", "deposit", "transfer", None],
        },
        "amount_exact": {"type": ["string", "null"]},
        "amount_min": {"type": ["string", "null"]},
        "amount_max": {"type": ["string", "null"]},
        "uncategorized_only": {"type": "boolean"},
        "rationale": {"type": "string"},
    },
    "required": [
        "categories",
        "budget",
        "account",
        "search",
        "description_contains",
        "destination_account",
        "destination_match_type",
        "transaction_type",
        "amount_exact",
        "amount_min",
        "amount_max",
        "uncategorized_only",
        "rationale",
    ],
    "additionalProperties": False,
}
