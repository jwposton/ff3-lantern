"""Pydantic models for AI bill suggestion explain (#35)."""

from __future__ import annotations

from pydantic import BaseModel

EXPLAIN_SYSTEM_PROMPT = """You interpret deterministic bill-suggestion metrics for an FF3 Lantern operator auditing a withdrawal pattern before Adopt.

Goals:
- Identify the likely service or vendor name from merchant, cluster, category, and sample descriptions.
- Explain why the amount pattern looks recurring versus intermittent using the provided metrics.
- For opaque payee clusters, suggest practical rule triggers (destination account, category, exact amount).
- Flag likely cancellation or stale service when last_date is old or occurrences are sparse.

Hard constraints:
- Output is display-only advisory text for the operator.
- Never instruct auto-register, auto-adopt, or bill creation.
- Never add, remove, or re-rank suggestions.
- Ground rationale only on the provided metrics, reasons, sample descriptions, and cluster — do not invent transaction history.
"""


class RuleHints(BaseModel):
    destination_account: str = ""
    category_name: str = ""
    amount_exactly: str = ""


class BillSuggestionExplainResponse(BaseModel):
    suggestion_id: str
    display_name: str
    service_guess: str
    amount_mode_rationale: str
    rule_hints: RuleHints
    rationale: str
    confidence_note: str


EXPLAIN_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "suggestion_id": {"type": "string"},
        "display_name": {"type": "string"},
        "service_guess": {"type": "string"},
        "amount_mode_rationale": {"type": "string"},
        "rule_hints": {
            "type": "object",
            "properties": {
                "destination_account": {"type": "string"},
                "category_name": {"type": "string"},
                "amount_exactly": {"type": "string"},
            },
            "required": [
                "destination_account",
                "category_name",
                "amount_exactly",
            ],
            "additionalProperties": False,
        },
        "rationale": {"type": "string"},
        "confidence_note": {"type": "string"},
    },
    "required": [
        "suggestion_id",
        "display_name",
        "service_guess",
        "amount_mode_rationale",
        "rule_hints",
        "rationale",
        "confidence_note",
    ],
    "additionalProperties": False,
}
