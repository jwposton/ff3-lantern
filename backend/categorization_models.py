"""Pydantic models for AI categorization suggestions."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

DestinationMatchType = Literal["contains", "starts_with", "ends_with", "is"]


class RuleDraft(BaseModel):
    title: str
    description_contains: str = ""
    destination_account: str | None = None
    destination_match_type: DestinationMatchType = "is"
    transaction_type: Literal["withdrawal", "deposit"] | None = None


def validate_rule_triggers(draft: RuleDraft) -> None:
    if not draft.description_contains.strip() and not (draft.destination_account or "").strip():
        raise ValueError("Set description_contains and/or destination_account")


class CategorizationSuggestion(BaseModel):
    category: str
    budget: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    recommendation: Literal["direct", "rule"]
    rule: RuleDraft | None = None
    rationale: str

    @model_validator(mode="after")
    def rule_present_when_recommended(self) -> CategorizationSuggestion:
        if self.recommendation == "rule" and self.rule is None:
            raise ValueError("rule required when recommendation is 'rule'")
        return self

    def validate_against_allowlists(
        self,
        categories: dict[str, str],
        budgets: dict[str, str],
    ) -> tuple[str, str | None]:
        """Return category_id and optional budget_id; raise ValueError on miss."""
        if self.category not in categories:
            raise ValueError(f"category not in allowlist: {self.category}")
        budget_id: str | None = None
        if self.budget is not None:
            if self.budget not in budgets:
                raise ValueError(f"budget not in allowlist: {self.budget}")
            budget_id = budgets[self.budget]
        return categories[self.category], budget_id


SUGGESTION_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "category": {"type": "string"},
        "budget": {"type": ["string", "null"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "recommendation": {"type": "string", "enum": ["direct", "rule"]},
        "rule": {
            "type": ["object", "null"],
            "properties": {
                "title": {"type": "string"},
                "description_contains": {"type": "string"},
                "destination_account": {
                    "type": ["string", "null"],
                },
                "destination_match_type": {
                    "type": "string",
                    "enum": ["contains", "starts_with", "ends_with", "is"],
                },
                "transaction_type": {
                    "type": ["string", "null"],
                    "enum": ["withdrawal", "deposit", None],
                },
            },
            "required": [
                "title",
                "description_contains",
                "destination_account",
                "destination_match_type",
                "transaction_type",
            ],
            "additionalProperties": False,
        },
        "rationale": {"type": "string"},
    },
    "required": [
        "category",
        "budget",
        "confidence",
        "recommendation",
        "rule",
        "rationale",
    ],
    "additionalProperties": False,
}
